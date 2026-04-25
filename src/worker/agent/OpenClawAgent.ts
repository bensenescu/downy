import { Think } from "@cloudflare/think";
import { createExecuteTool } from "@cloudflare/think/tools/execute";
import { CHAT_MESSAGE_TYPES } from "agents/chat";
import { Workspace } from "@cloudflare/shell";
import type { FileInfo } from "@cloudflare/shell";
import type { LanguageModel, ToolSet, UIMessage } from "ai";
import type { Session } from "agents/experimental/memory/session";

import { buildSystemPrompt } from "./build-system-prompt";
import { getCodexRelayModel } from "./get-model";
import {
  AGENT_CORE_FILES,
  BOOTSTRAP_PATH,
  BOOTSTRAP_SEED,
  coreFileMeta,
  isAgentCorePath,
  isAgentManagedPath,
  isBootstrapPath,
  isCorePath,
  isProfileCorePath,
  resolveCoreFile,
  type CoreFileRecord,
} from "./core-files";
import { readUserFile } from "../db/profile";
import {
  BACKGROUND_TASK_UPDATED_TYPE,
  type BackgroundTaskRecord,
} from "./background-task-types";
import { ignoreClientCancels } from "./ignore-client-cancels";
import {
  createConnectMcpServerTool,
  createDisconnectMcpServerTool,
  createListMcpServersTool,
} from "./tools/mcp-servers";
import { createReadPeerAgentTool } from "./tools/read-peer-agent";
import {
  createCreateSkillTool,
  createDeleteSkillTool,
  createListSkillFilesTool,
  createListSkillsTool,
  createReadSkillTool,
  createUpdateSkillTool,
} from "./tools/skills";
import { listSkills } from "./skills/loader";
import { isSkillPath, type SkillEntry } from "./skills/types";
import { createSpawnBackgroundTaskTool } from "./tools/spawn-background-task";
import { createWebScrapeTool } from "./tools/web-scrape";
import { createWebSearchTool } from "./tools/web-search";

import {
  callMcpToolViaParent,
  listMcpToolDescriptors,
  type McpToolDescriptor,
} from "./mcp-proxy";
import { getAgent, listAgents } from "../db/profile";

const BOOTSTRAP_SEEDED_KEY = "openclaw:bootstrap-seeded";

const backgroundTaskKey = (id: string) => `background_task:${id}`;
const MCP_SERVER_KEY_PREFIX = "mcp_server:";
const mcpServerKey = (id: string) => `${MCP_SERVER_KEY_PREFIX}${id}`;

type StoredMcpServer = {
  id: string;
  name: string;
  url: string;
  transport?: "auto" | "streamable-http" | "sse";
  headers?: Record<string, string>;
};

export class OpenClawAgent extends Think {
  override workspace = new Workspace({
    sql: this.ctx.storage.sql,
    r2: this.env.WORKSPACE_BUCKET,
    name: () => this.name,
  });

  override maxSteps = 250;

  override chatRecovery = true;

  // After hibernation, the base Agent kicks off `restoreConnectionsFromStorage`
  // in the background — but Think defaults to NOT waiting, so the first
  // post-wake turn fires with an empty MCP tool set and the user has to ask
  // the agent to reconnect. Block each turn on the in-flight reconnect (10s
  // default) so MCP tools are actually available.
  override waitForMcpConnections = true;

  #bootstrapInit?: Promise<void>;

  override getModel(): LanguageModel {
    return getCodexRelayModel();
  }

  override getTools(): ToolSet {
    return {
      // `execute` exposes web_search + web_scrape inside a sandboxed Worker
      // as `codemode.web_search` / `codemode.web_scrape`. The model writes one
      // JS snippet per turn that can fan out scrapes in parallel instead of
      // emitting one tool call per URL. Workspace file tools (read/write/
      // edit/list/grep/find/delete) are still auto-registered by Think as
      // top-level tools — they stay on the outside for direct use.
      execute: createExecuteTool({
        tools: {
          web_search: createWebSearchTool(this.env.EXA_API_KEY),
          web_scrape: createWebScrapeTool(this.env.BROWSER),
          // Peer-agent reads also live inside `codemode.*` so the model can
          // fan out across multiple peers/paths in one snippet via
          // Promise.all — same shape as web_search/web_scrape.
          read_peer_agent: createReadPeerAgentTool({
            env: this.env,
            parentSlug: this.name,
            bumpCount: () => this.bumpPeerReadCount(),
          }),
          // Skill reads. `list_skills` lets the model collision-check before
          // a write; `read_skill` returns parsed frontmatter + body (optionally
          // with one-level-deep companion files); `list_skill_files` surfaces
          // the bundled `reference/` and `scripts/` files. All are
          // fanout-friendly when the model is comparing several skills.
          list_skills: createListSkillsTool({
            getWorkspace: () => this.workspace,
          }),
          read_skill: createReadSkillTool({
            getWorkspace: () => this.workspace,
          }),
          list_skill_files: createListSkillFilesTool({
            getWorkspace: () => this.workspace,
          }),
        },
        loader: this.env.LOADER,
        timeout: 60_000,
      }),
      // Stays top-level: closes over DO state (`this.name`, `putRecord`,
      // `broadcastUpdate`) and does DO-to-DO RPC — awkward inside a sandbox
      // and it's already a single call per dispatch, so codemode adds nothing.
      spawn_background_task: createSpawnBackgroundTaskTool({
        namespace: this.env.ChildAgent,
        parentName: this.name,
        putRecord: (id, record) =>
          this.ctx.storage.put(backgroundTaskKey(id), record),
        broadcastUpdate: (record) => {
          this.#broadcastBackgroundTaskUpdate(record);
        },
      }),
      // MCP plumbing — Think auto-merges any tools from connected servers into
      // the next turn's tool set, so we just need to expose the connect/list/
      // disconnect surface. v0: HTTP-only, header-auth (no end-to-end OAuth).
      connect_mcp_server: createConnectMcpServerTool({ agent: this }),
      list_mcp_servers: createListMcpServersTool({ agent: this }),
      disconnect_mcp_server: createDisconnectMcpServerTool({ agent: this }),
      // Skill writes stay top-level so each "I created skill X" claim
      // corresponds to one auditable tool call (mirrors spawn_background_task
      // and the honest-claim guardrail). The structured tools enforce
      // frontmatter shape; the model can still use the workspace
      // read/write/edit/delete tools on `skills/<name>/...` paths as an
      // escape hatch.
      create_skill: createCreateSkillTool({
        getWorkspace: () => this.workspace,
      }),
      update_skill: createUpdateSkillTool({
        getWorkspace: () => this.workspace,
      }),
      delete_skill: createDeleteSkillTool({
        getWorkspace: () => this.workspace,
      }),
    };
  }

  override configureSession(session: Session) {
    return session.withCachedPrompt();
  }

  #abortsWrapped = false;
  override async onStart(): Promise<void> {
    await super.onStart();
    if (this.#abortsWrapped) return;
    this.#abortsWrapped = true;
    ignoreClientCancels(this, "[agent]");
  }

  #turnStartedAt = 0;
  #lastChunkAt = 0;
  #chunkCount = 0;
  #lastStepFinishAt = 0;

  // Per-turn peer-read counter — reset in beforeTurn, incremented by
  // read_peer_agent. Hard cap acts as a safety net so a misbehaving snippet
  // can't fan out unbounded across peers.
  #peerReadCount = 0;
  bumpPeerReadCount(): number {
    this.#peerReadCount += 1;
    return this.#peerReadCount;
  }

  // Cache the agent's own privacy flag for ~5s so peer-read RPCs don't hit
  // D1 on every call within a chatty turn.
  #privateCachedAt = 0;
  #privateCached = false;
  async #isThisAgentPrivate(): Promise<boolean> {
    const now = Date.now();
    if (now - this.#privateCachedAt < 5_000) return this.#privateCached;
    const record = await getAgent(this.env.DB, this.name);
    this.#privateCached = record?.isPrivate ?? false;
    this.#privateCachedAt = now;
    return this.#privateCached;
  }

  override async beforeTurn(ctx: {
    system: string;
    messages: unknown[];
    tools: unknown;
    continuation: boolean;
  }) {
    await this.#ensureBootstrapSeeded();
    await this.#restoreMcpServers();
    this.#turnStartedAt = Date.now();
    this.#lastChunkAt = 0;
    this.#chunkCount = 0;
    this.#lastStepFinishAt = 0;
    this.#peerReadCount = 0;
    console.log("[agent] beforeTurn", {
      messageCount: ctx.messages.length,
      continuation: ctx.continuation,
      startedAt: this.#turnStartedAt,
    });
    const [userFile, allAgents] = await Promise.all([
      readUserFile(this.env.DB),
      listAgents(this.env.DB),
    ]);
    const peers = allAgents.filter((a) => a.slug !== this.name);
    const system = await buildSystemPrompt(
      this.workspace,
      userFile.content,
      peers,
    );
    return { system };
  }

  // Structured logging to diagnose stuck-tool-call cases — fires for every
  // step of the agent loop. `finishReason` ≠ "stop" / "tool-calls" is a smoke
  // signal (e.g. "length" means the model hit its max-token budget mid-turn
  // and tool calls won't complete). `toolCalls.length !== toolResults.length`
  // would mean a tool call was emitted but its result never landed.
  override onStepFinish(ctx: {
    stepType: string;
    text: string;
    toolCalls: unknown[];
    toolResults: unknown[];
    finishReason: string;
  }): void {
    this.#lastStepFinishAt = Date.now();
    console.log("[agent] step finished", {
      stepType: ctx.stepType,
      finishReason: ctx.finishReason,
      toolCalls: ctx.toolCalls.length,
      toolResults: ctx.toolResults.length,
      textLen: ctx.text.length,
      chunksThisTurn: this.#chunkCount,
      msSinceTurnStart: Date.now() - this.#turnStartedAt,
    });
    if (ctx.toolCalls.length !== ctx.toolResults.length) {
      console.warn("[agent] step ended with mismatched tool calls / results", {
        toolCalls: ctx.toolCalls,
        toolResults: ctx.toolResults,
      });
    }
  }

  // Token-level visibility, throttled so it doesn't flood. Also lets us see
  // the gap between the last chunk and the abort — an abort that arrives
  // within the same tick as the last chunk points at an explicit cancel
  // (client stop / stream close); a long quiet gap points at the server
  // waiting on something that never came back.
  override onChunk(): void {
    const now = Date.now();
    this.#chunkCount += 1;
    // First chunk, then every 1s to keep volume sane.
    if (this.#lastChunkAt === 0 || now - this.#lastChunkAt > 1000) {
      console.log("[agent] chunk", {
        chunkCount: this.#chunkCount,
        msSinceTurnStart: now - this.#turnStartedAt,
      });
    }
    this.#lastChunkAt = now;
  }

  override onChatResponse(result: {
    requestId: string;
    continuation: boolean;
    status: "completed" | "error" | "aborted";
    error?: string;
  }): void {
    const now = Date.now();
    console.log("[agent] chat response", {
      requestId: result.requestId,
      status: result.status,
      continuation: result.continuation,
      error: result.error,
      chunks: this.#chunkCount,
      msSinceTurnStart: now - this.#turnStartedAt,
      msSinceLastChunk: this.#lastChunkAt ? now - this.#lastChunkAt : null,
      msSinceLastStepFinish: this.#lastStepFinishAt
        ? now - this.#lastStepFinishAt
        : null,
    });
  }

  override onChatError(error: unknown): unknown {
    console.error("[agent] chat error", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      msSinceTurnStart: this.#turnStartedAt
        ? Date.now() - this.#turnStartedAt
        : null,
      msSinceLastChunk: this.#lastChunkAt
        ? Date.now() - this.#lastChunkAt
        : null,
    });
    return error;
  }

  // Seed BOOTSTRAP.md exactly once per deployment. Concurrent turns share the
  // same promise so only one writer runs; the durable flag prevents re-seeding
  // after the agent deletes the file to mark the ritual complete.
  #ensureBootstrapSeeded(): Promise<void> {
    this.#bootstrapInit ??= this.#seedBootstrapOnce();
    return this.#bootstrapInit;
  }

  async #seedBootstrapOnce(): Promise<void> {
    const seeded = await this.ctx.storage.get<boolean>(BOOTSTRAP_SEEDED_KEY);
    if (seeded === true) return;
    await this.workspace.writeFile(BOOTSTRAP_PATH, BOOTSTRAP_SEED);
    await this.ctx.storage.put(BOOTSTRAP_SEEDED_KEY, true);
  }

  // Kicks off the bootstrap ritual by injecting a synthetic user message, so
  // the agent speaks first on a fresh chat instead of waiting for input.
  // The client filters kickoff messages from the transcript using the
  // `metadata.kickoff` flag.
  //
  // `saveMessages` always starts a new inference turn, even when its callback
  // returns `current` unchanged — so we gate on `this.messages.length` BEFORE
  // calling it, otherwise every refresh retriggers the greeting.
  async startBootstrapIfPending(): Promise<{ started: boolean }> {
    await this.#ensureBootstrapSeeded();
    if (this.messages.length > 0) return { started: false };
    const pending = (await this.workspace.readFile(BOOTSTRAP_PATH)) != null;
    if (!pending) return { started: false };

    const result = await this.saveMessages([
      {
        id: crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", text: "begin" }],
        metadata: { kickoff: true },
      },
    ]);
    return { started: result.status === "completed" };
  }

  // Dev-only reset. Wipes the conversation, resets the bootstrap sentinel, and
  // re-seeds BOOTSTRAP.md so the next page load re-runs onboarding. Gated at
  // the HTTP layer by checking the request hostname.
  async devReset(): Promise<void> {
    this.clearMessages();
    await this.ctx.storage.delete(BOOTSTRAP_SEEDED_KEY);
    this.#bootstrapInit = undefined;
    await this.#ensureBootstrapSeeded();
  }

  // Best-effort revert: drop the last user-initiated turn (the most recent
  // real user message + every assistant/tool message that followed). Synthetic
  // kickoff and background-task-result messages are skipped — those aren't
  // user turns the user can sensibly undo. Side effects from the deleted turn
  // (file writes, MCP calls, spawned tasks) are NOT rolled back; the client
  // surfaces a tooltip warning when the deleted turn touched anything.
  async revertLastTurn(): Promise<{ deletedCount: number }> {
    const cutoff = this.#findLastUserTurnIndex();
    if (cutoff === -1) return { deletedCount: 0 };
    const ids = this.messages.slice(cutoff).map((m) => m.id);
    this.session.deleteMessages(ids);
    // session.deleteMessages doesn't broadcast — replicate the same frame
    // Think uses internally so connected clients refresh.
    this.broadcast(
      JSON.stringify({
        type: CHAT_MESSAGE_TYPES.CHAT_MESSAGES,
        messages: this.messages,
      }),
    );
    return { deletedCount: ids.length };
  }

  // Edit = revert last turn, then send a new user message in its place.
  // Re-uses the same truncation logic, then hands off to saveMessages which
  // appends and triggers a fresh inference loop.
  async editLastUserMessage(text: string): Promise<{ replaced: boolean }> {
    const trimmed = text.trim();
    if (!trimmed) return { replaced: false };
    const cutoff = this.#findLastUserTurnIndex();
    if (cutoff === -1) return { replaced: false };
    const ids = this.messages.slice(cutoff).map((m) => m.id);
    this.session.deleteMessages(ids);
    // saveMessages auto-broadcasts the appended message and starts a turn,
    // so no manual broadcast is needed here.
    await this.saveMessages([
      {
        id: crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", text: trimmed }],
      },
    ]);
    return { replaced: true };
  }

  // Returns the index of the most recent non-synthetic user message in the
  // current transcript, or -1 if there isn't one. "Synthetic" = bootstrap
  // kickoff or background-task-result injection, which the user shouldn't
  // be able to undo because they didn't author them.
  #findLastUserTurnIndex(): number {
    const messages = this.messages;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== "user") continue;
      if (isSyntheticUserMessage(m.metadata)) continue;
      return i;
    }
    return -1;
  }

  // Returns the agent-managed core files only (SOUL, IDENTITY, MEMORY).
  // USER.md is user-level and lives in D1 — clients fetch it separately
  // through `/api/profile/user-file`.
  async listCoreFiles(): Promise<CoreFileRecord[]> {
    return Promise.all(
      AGENT_CORE_FILES.map((meta) => resolveCoreFile(this.workspace, meta)),
    );
  }

  async readCoreFile(path: string): Promise<CoreFileRecord | null> {
    if (isProfileCorePath(path)) {
      throw new Error(
        "USER.md is user-level — read it via /api/profile/user-file",
      );
    }
    const meta = coreFileMeta(path);
    if (!meta || !isAgentCorePath(path)) return null;
    return resolveCoreFile(this.workspace, meta);
  }

  async writeCoreFile(path: string, content: string): Promise<void> {
    if (isProfileCorePath(path)) {
      throw new Error(
        "USER.md is user-level — write it via /api/profile/user-file",
      );
    }
    if (!isAgentCorePath(path)) {
      throw new Error("Path is not an agent-managed core file");
    }
    await this.workspace.writeFile(path, content);
  }

  // Walks the workspace recursively and returns a flat list of every file, so
  // nested paths like `content/linkedin-posts.md` show up in the workspace
  // browser — not just the top-level `content` directory. Identity files and
  // the bootstrap artifact are filtered out (they live elsewhere in the UI).
  // The agent's own read/write/edit/delete tools go directly against
  // `this.workspace` and aren't affected by this filter.
  async listWorkspaceFiles(): Promise<FileInfo[]> {
    const out: FileInfo[] = [];
    const walk = async (dir: string): Promise<void> => {
      const entries = await this.workspace.readDir(dir);
      for (const entry of entries) {
        if (entry.type === "directory") {
          await walk(entry.path);
        } else if (
          entry.type === "file" &&
          !isAgentManagedPath(entry.name) &&
          !isSkillPath(entry.path)
        ) {
          // Skills live under `skills/<name>/...` and have their own UI
          // section; hide them from the generic workspace browser so the
          // workspace tab stays focused on Claw's notes/artifacts.
          out.push(entry);
        }
      }
    };
    await walk("/");
    return out;
  }

  async readWorkspaceFile(
    path: string,
  ): Promise<{ content: string; stat: FileInfo | null } | null> {
    // Stat first so we can return `null` (→ 404) for directories and missing
    // entries instead of letting `workspace.readFile` throw `EISDIR` for a
    // directory path. `readFile` would also throw on permission errors etc.
    // — we catch those and treat as "not a file."
    const stat = await this.workspace.stat(path);
    if (!stat || stat.type !== "file") return null;
    try {
      const content = await this.workspace.readFile(path);
      if (content == null) return null;
      return { content, stat };
    } catch (err) {
      console.warn("[agent] readWorkspaceFile failed", {
        path,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  async writeWorkspaceFile(path: string, content: string): Promise<void> {
    if (isCorePath(path)) {
      throw new Error("Use writeCoreFile for identity files");
    }
    if (isBootstrapPath(path)) {
      throw new Error("BOOTSTRAP.md is managed by the agent");
    }
    await this.workspace.writeFile(path, content);
  }

  /** Skill catalog — surfaced to the UI sidebar and the /agent/:slug/skills page. */
  async listAgentSkills(): Promise<SkillEntry[]> {
    return listSkills(this.workspace);
  }

  async deleteWorkspaceFile(path: string): Promise<void> {
    if (isCorePath(path)) {
      throw new Error("Cannot delete identity files");
    }
    if (isBootstrapPath(path)) {
      throw new Error("BOOTSTRAP.md is managed by the agent");
    }
    await this.workspace.deleteFile(path);
  }

  // Called by ChildAgent via DO-to-DO RPC when a dispatched background task
  // finishes. Wakes this DO from hibernation if needed, persists the worker's
  // output as a workspace artifact under `notes/`, then injects a short
  // synthetic user turn pointing at that file. The agent reads the file via
  // its normal workspace tools when it needs the detail — this keeps the
  // conversation transcript free of multi-page research dumps.
  async onBackgroundTaskComplete(
    taskId: string,
    status: "done" | "error",
    result: string,
  ): Promise<void> {
    const key = backgroundTaskKey(taskId);
    const prior = await this.ctx.storage.get<BackgroundTaskRecord>(key);
    if (!prior) throw new Error(`No background task record for ${taskId}`);

    const trimmed = result.trim();
    let artifactPath: string | undefined;
    if (status === "done" && trimmed.length > 0) {
      const { slug, body } = parseSlugHeader(trimmed);
      artifactPath = await this.#pickArtifactPath(slug, prior.kind, taskId);
      await this.workspace.writeFile(artifactPath, body);
    }

    const next: BackgroundTaskRecord = {
      ...prior,
      status,
      completedAt: Date.now(),
      artifactPath,
    };
    await this.ctx.storage.put(key, next);
    this.#broadcastBackgroundTaskUpdate(next);

    const messageText =
      status === "done"
        ? artifactPath
          ? `<background_task ${taskId} (${next.kind}) completed — findings saved to ${artifactPath}. Read that file now, then synthesize a reply for the user.>`
          : `<background_task ${taskId} (${next.kind}) completed but produced no output. Tell the user honestly.>`
        : `<background_task ${taskId} (${next.kind}) failed>\n${trimmed}`;

    console.log("[agent] onBackgroundTaskComplete", {
      taskId,
      status,
      artifactPath,
      resultLen: result.length,
    });

    await this.saveMessages((current): UIMessage[] => [
      ...current,
      {
        id: crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", text: messageText }],
        metadata: {
          backgroundTaskResult: true,
          taskId,
          taskKind: next.kind,
          backgroundTaskStatus: status,
          ...(artifactPath ? { artifactPath } : {}),
        },
      },
    ]);
  }

  // ChildAgent calls these over RPC — a child can't open its own MCP
  // connections (the live transport / OAuth state lives here). See
  // mcp-proxy.ts and ChildAgent#beforeTurn.
  async listMcpToolsForChild(): Promise<McpToolDescriptor[]> {
    return listMcpToolDescriptors(this.mcp);
  }

  async callMcpToolForChild(
    serverId: string,
    name: string,
    args: unknown,
  ): Promise<unknown> {
    return callMcpToolViaParent(this.mcp, serverId, name, args);
  }

  // ── MCP server config persistence ────────────────────────────────────────
  // Think's `restoreConnectionsFromStorage` covers part of this, but we
  // persist our own copy of `{name, url, transport, headers}` so a wake
  // can re-attach silently even when Bearer-token auth is involved. Storage
  // shape: `mcp_server:{id} → StoredMcpServer`.
  //
  // Token-leak note: bearer tokens land in DO SQLite at rest. Same trust
  // boundary as workspace files. Never log header values; redact in any
  // future export endpoint.

  async persistMcpServer(config: StoredMcpServer): Promise<void> {
    await this.ctx.storage.put(mcpServerKey(config.id), config);
  }

  async forgetMcpServer(id: string): Promise<void> {
    await this.ctx.storage.delete(mcpServerKey(id));
  }

  async disconnectMcpServer(id: string): Promise<void> {
    await this.removeMcpServer(id);
    await this.forgetMcpServer(id);
  }

  async #restoreMcpServers(): Promise<void> {
    const stored = await this.ctx.storage.list<StoredMcpServer>({
      prefix: MCP_SERVER_KEY_PREFIX,
    });
    if (stored.size === 0) return;
    const live = this.getMcpServers().servers;
    const liveUrls = new Set(
      Object.values(live).map((s) => s.server_url),
    );
    for (const config of stored.values()) {
      if (liveUrls.has(config.url)) continue;
      try {
        // eslint-disable-next-line typescript/no-unsafe-type-assertion -- narrow `auto`/`streamable-http`/`sse` enum.
        const type = (config.transport ?? "auto") as "auto" | "streamable-http" | "sse";
        if (config.headers) {
          // Header-auth path: bypass addMcpServer for the same reason the
          // connect tool does — see `tools/mcp-servers.ts` for context.
          const id = `mcp_${Math.random().toString(36).slice(2, 10)}`;
          const headers = config.headers;
          await this.mcp.registerServer(id, {
            url: config.url,
            name: config.name,
            transport: {
              type,
              requestInit: { headers },
              eventSourceInit: {
                fetch: (u: string | URL | globalThis.Request, init?: RequestInit) =>
                  fetch(u, { ...init, headers: { ...(init?.headers ?? {}), ...headers } }),
              },
            },
          });
          const result = await this.mcp.connectToServer(id);
          if (result.state === "connected") {
            await this.mcp.discoverIfConnected(id);
          }
        } else {
          await this.addMcpServer(config.name, config.url, { transport: { type } });
        }
      } catch (err) {
        console.warn("[agent] restoreMcpServer failed", {
          id: config.id,
          name: config.name,
          // Never log headers (Bearer tokens).
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // ── Peer-agent RPC ────────────────────────────────────────────────────────
  // Read-only methods exposed to other OpenClawAgent instances. The frontend
  // never calls these directly; the model invokes them via the
  // `read_peer_agent` CodeMode tool, which dispatches based on `op`. Each
  // method enforces its own privacy check so future callers of the RPC can't
  // bypass it. `peerDescribe` is exempt — discoverability is independent of
  // content access (the model needs to know the agent exists to mention it).

  async peerDescribe(): Promise<{
    slug: string;
    displayName: string;
    isPrivate: boolean;
    identitySummary: string;
  }> {
    const record = await getAgent(this.env.DB, this.name);
    const displayName = record?.displayName ?? this.name;
    const isPrivate = record?.isPrivate ?? false;
    let identitySummary = "";
    if (!isPrivate) {
      // First couple of lines of IDENTITY.md gives the model enough to
      // pattern-match on. Strip the markdown header so we don't waste tokens
      // on "# Identity".
      const identity = await this.workspace.readFile("IDENTITY.md");
      if (identity) {
        identitySummary = identity
          .replace(/^#.*$/m, "")
          .trim()
          .split(/\n\s*\n/)[0]
          .slice(0, 400);
      }
    }
    return { slug: this.name, displayName, isPrivate, identitySummary };
  }

  async peerListWorkspace(prefix?: string): Promise<FileInfo[]> {
    if (await this.#isThisAgentPrivate()) {
      throw new Error(`Agent is private: ${this.name}`);
    }
    const all = await this.listWorkspaceFiles();
    if (!prefix) return all;
    const normalized = prefix.replace(/^\/+/, "");
    return all.filter((f) => f.path.replace(/^\/+/, "").startsWith(normalized));
  }

  async peerReadFile(
    path: string,
  ): Promise<{ content: string; stat: FileInfo | null } | null> {
    if (await this.#isThisAgentPrivate()) {
      throw new Error(`Agent is private: ${this.name}`);
    }
    if (isAgentManagedPath(path)) {
      // Identity files are exposed via peerReadIdentityFiles, not via this
      // method — keep the surface deliberate.
      throw new Error(
        `Use peerReadIdentityFiles for ${path}, not peerReadFile.`,
      );
    }
    return this.readWorkspaceFile(path);
  }

  async peerReadIdentityFiles(): Promise<CoreFileRecord[]> {
    if (await this.#isThisAgentPrivate()) {
      throw new Error(`Agent is private: ${this.name}`);
    }
    return this.listCoreFiles();
  }

  // Snapshot of attached MCP servers for the settings UI. Same shape as the
  // in-agent `list_mcp_servers` tool, just exposed over RPC so the frontend
  // can render it without going through the model.
  async listMcpServers(): Promise<
    Array<{
      id: string;
      name: string;
      url: string;
      state: string;
      error: string | null;
      toolNames: string[];
    }>
  > {
    const state = this.getMcpServers();
    return Object.entries(state.servers).map(([id, s]) => ({
      id,
      name: s.name,
      url: s.server_url,
      state: s.state,
      error: s.error,
      toolNames: state.tools
        .filter((t) => t.serverId === id)
        .map((t) => t.name),
    }));
  }

  // Returns every background task ever dispatched by this agent, newest first.
  async listBackgroundTasks(): Promise<BackgroundTaskRecord[]> {
    const map = await this.ctx.storage.list<BackgroundTaskRecord>({
      prefix: "background_task:",
    });
    const records = [...map.values()];
    // eslint-disable-next-line unicorn/no-array-sort -- `records` is a fresh array from the Map iterator, not a shared reference.
    records.sort((a, b) => b.spawnedAt - a.spawnedAt);
    return records;
  }

  #broadcastBackgroundTaskUpdate(record: BackgroundTaskRecord): void {
    this.broadcast(
      JSON.stringify({ type: BACKGROUND_TASK_UPDATED_TYPE, record }),
    );
  }

  // Pick a workspace path for the worker's artifact. Prefer the slug the
  // worker proposed in its `slug:` header (descriptive, e.g.
  // `notes/openseo-content-idea-tracker.md`); fall back to a generated
  // `{date}-{kind}-{shortId}` name if the header was missing or malformed.
  // On collision, append the short task id to keep the descriptive name.
  async #pickArtifactPath(
    slug: string | undefined,
    kind: string,
    taskId: string,
  ): Promise<string> {
    const shortId = taskId.slice(0, 8);
    if (slug) {
      const clean = `notes/${slug}.md`;
      if ((await this.workspace.readFile(clean)) == null) return clean;
      return `notes/${slug}-${shortId}.md`;
    }
    const date = new Date().toISOString().slice(0, 10);
    const kindSlug =
      kind
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || "task";
    return `notes/${date}-${kindSlug}-${shortId}.md`;
  }
}

// `kickoff` is the synthetic user turn we inject to start the bootstrap
// ritual; `backgroundTaskResult` is the synthetic user turn ChildAgent
// injects when a spawned task finishes. Neither was authored by the user, so
// `revertLastTurn` walks past them when looking for the cutoff.
function isSyntheticUserMessage(metadata: unknown): boolean {
  if (typeof metadata !== "object" || metadata === null) return false;
  if ("kickoff" in metadata && metadata.kickoff === true) return true;
  if ("backgroundTaskResult" in metadata && metadata.backgroundTaskResult === true)
    return true;
  return false;
}

// Worker output starts with `slug: <kebab-slug>` on its own line so the
// parent can name the file descriptively. Pull that out and return the
// remaining body. If the header is missing or invalid, return the body
// unchanged and let the caller fall back to a generated name.
function parseSlugHeader(text: string): { slug?: string; body: string } {
  const match = /^slug:\s*([a-z0-9][a-z0-9-]{1,60})\s*\n+/i.exec(text);
  if (!match) return { body: text };
  const slug = match[1]
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length < 3) return { body: text };
  return { slug, body: text.slice(match[0].length).trimStart() };
}
