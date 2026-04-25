import { Think } from "@cloudflare/think";
import { createExecuteTool } from "@cloudflare/think/tools/execute";
import { Workspace } from "@cloudflare/shell";
import type { FileInfo } from "@cloudflare/shell";
import type { LanguageModel, ToolSet, UIMessage } from "ai";
import type { Session } from "agents/experimental/memory/session";

import { buildSystemPrompt } from "./build-system-prompt";
import { getCodexRelayModel } from "./get-model";
import {
  BOOTSTRAP_PATH,
  BOOTSTRAP_SEED,
  CORE_FILES,
  coreFileMeta,
  isAgentManagedPath,
  isBootstrapPath,
  isCorePath,
  resolveCoreFile,
  type CoreFileRecord,
} from "./core-files";
import {
  BACKGROUND_TASK_UPDATED_TYPE,
  type BackgroundTaskRecord,
} from "./background-task-types";
import { ignoreClientCancels } from "./ignore-client-cancels";
import {
  deleteIntegration,
  getIntegrationSecret,
  listIntegrations,
  putIntegration,
  NAME_PATTERN,
  type ApiAuthMeta,
  type ApiAuthSecret,
  type RestApiIntegration,
} from "./integrations";
import {
  createConnectMcpServerTool,
  createDisconnectMcpServerTool,
  createListMcpServersTool,
} from "./tools/mcp-servers";
import {
  buildIntegrationRequestTool,
  createConnectRestApiTool,
  createDisconnectRestApiTool,
  createListRestApisTool,
} from "./tools/rest-apis";
import { createSpawnBackgroundTaskTool } from "./tools/spawn-background-task";
import { createWebScrapeTool } from "./tools/web-scrape";
import { createWebSearchTool } from "./tools/web-search";

const BOOTSTRAP_SEEDED_KEY = "openclaw:bootstrap-seeded";

const backgroundTaskKey = (id: string) => `background_task:${id}`;

export class OpenClawAgent extends Think {
  override workspace = new Workspace({
    sql: this.ctx.storage.sql,
    r2: this.env.WORKSPACE_BUCKET,
    name: () => this.name,
  });

  override maxSteps = 250;

  override chatRecovery = true;

  #bootstrapInit?: Promise<void>;

  // In-memory cache of REST API integrations, keyed by id. Hydrated from DO
  // storage on `onStart`; mutated through connectRestApi / disconnectRestApi.
  // `getTools()` reads this every turn to register per-integration request
  // tools dynamically — the credentials themselves stay in DO storage and are
  // fetched per-call inside the tool's execute.
  #restIntegrations: Map<string, RestApiIntegration> = new Map();
  #restIntegrationsLoaded = false;

  override getModel(): LanguageModel {
    return getCodexRelayModel();
  }

  override getTools(): ToolSet {
    const tools: ToolSet = {
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
      // REST API integrations — user-supplied keys, persisted in DO storage,
      // signed onto outbound requests on the host. Each connected integration
      // exposes a per-integration `<name>__request` tool, registered below.
      connect_rest_api: createConnectRestApiTool({ agent: this }),
      list_rest_apis: createListRestApisTool({ agent: this }),
      disconnect_rest_api: createDisconnectRestApiTool({ agent: this }),
    };
    for (const integration of this.#restIntegrations.values()) {
      tools[`${integration.name}__request`] = buildIntegrationRequestTool(
        this,
        integration,
      );
    }
    return tools;
  }

  override configureSession(session: Session) {
    return session.withCachedPrompt();
  }

  #abortsWrapped = false;
  override async onStart(): Promise<void> {
    await super.onStart();
    await this.#loadRestIntegrations();
    if (this.#abortsWrapped) return;
    this.#abortsWrapped = true;
    ignoreClientCancels(this, "[agent]");
  }

  async #loadRestIntegrations(): Promise<void> {
    if (this.#restIntegrationsLoaded) return;
    const records = await listIntegrations(this.ctx.storage);
    this.#restIntegrations = new Map(records.map((r) => [r.id, r]));
    this.#restIntegrationsLoaded = true;
    if (records.length > 0) {
      console.log("[agent] restored rest integrations", {
        count: records.length,
        names: records.map((r) => r.name),
      });
    }
  }

  async connectRestApi(input: {
    name: string;
    baseUrl: string;
    description?: string;
    auth: ApiAuthSecret;
  }): Promise<string> {
    if (!NAME_PATTERN.test(input.name)) {
      throw new Error(
        "Invalid integration name. Use 1–32 chars, lowercase a-z / 0-9 / underscore / hyphen; must start and end with alphanumeric.",
      );
    }
    await this.#loadRestIntegrations();
    for (const existing of this.#restIntegrations.values()) {
      if (existing.name === input.name) {
        throw new Error(
          `An integration named '${input.name}' already exists. Use disconnect_rest_api first or pick a different name.`,
        );
      }
    }
    const id = crypto.randomUUID();
    const authMeta: ApiAuthMeta =
      input.auth.kind === "header"
        ? { kind: "header", headerName: input.auth.headerName }
        : { kind: input.auth.kind };
    const record: RestApiIntegration = {
      id,
      name: input.name,
      baseUrl: input.baseUrl,
      description: input.description,
      authMeta,
      createdAt: Date.now(),
    };
    await putIntegration(this.ctx.storage, record, input.auth);
    this.#restIntegrations.set(id, record);
    return id;
  }

  async disconnectRestApi(id: string): Promise<boolean> {
    await this.#loadRestIntegrations();
    if (!this.#restIntegrations.has(id)) return false;
    await deleteIntegration(this.ctx.storage, id);
    this.#restIntegrations.delete(id);
    return true;
  }

  async listRestApis(): Promise<RestApiIntegration[]> {
    await this.#loadRestIntegrations();
    return [...this.#restIntegrations.values()].sort(
      (a, b) => b.createdAt - a.createdAt,
    );
  }

  async getRestApiSecret(id: string): Promise<ApiAuthSecret | null> {
    return getIntegrationSecret(this.ctx.storage, id);
  }

  #turnStartedAt = 0;
  #lastChunkAt = 0;
  #chunkCount = 0;
  #lastStepFinishAt = 0;

  override async beforeTurn(ctx: {
    system: string;
    messages: unknown[];
    tools: unknown;
    continuation: boolean;
  }) {
    await this.#ensureBootstrapSeeded();
    this.#turnStartedAt = Date.now();
    this.#lastChunkAt = 0;
    this.#chunkCount = 0;
    this.#lastStepFinishAt = 0;
    console.log("[agent] beforeTurn", {
      messageCount: ctx.messages.length,
      continuation: ctx.continuation,
      startedAt: this.#turnStartedAt,
    });
    const system = await buildSystemPrompt(this.workspace);
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

  async listCoreFiles(): Promise<CoreFileRecord[]> {
    return Promise.all(
      CORE_FILES.map((meta) => resolveCoreFile(this.workspace, meta)),
    );
  }

  async readCoreFile(path: string): Promise<CoreFileRecord | null> {
    const meta = coreFileMeta(path);
    if (!meta) return null;
    return resolveCoreFile(this.workspace, meta);
  }

  async writeCoreFile(path: string, content: string): Promise<void> {
    if (!isCorePath(path)) {
      throw new Error("Path is not a core identity file");
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
        } else if (entry.type === "file" && !isAgentManagedPath(entry.name)) {
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
          backgroundTaskStatus: status,
          ...(artifactPath ? { artifactPath } : {}),
        },
      },
    ]);
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
