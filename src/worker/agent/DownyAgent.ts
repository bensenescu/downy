import { Think } from "@cloudflare/think";
import { CHAT_MESSAGE_TYPES } from "agents/chat";
import { Workspace, type FileInfo } from "@cloudflare/shell";
import {
  generateText,
  type LanguageModel,
  type ToolSet,
  type UIMessage,
} from "ai";
import { createWorkersAI } from "workers-ai-provider";
import type { Session } from "agents/experimental/memory/session";
import { createCompactFunction } from "agents/experimental/memory/utils";

import { ACTIVE_PLAN_KEY, buildSystemPrompt } from "./build-system-prompt";
import {
  isSyntheticUserMessage,
  parseSlugHeader,
} from "./background-task-utils";
import { assertChildWorkspaceCallAllowed } from "./child-workspace-rpc";
import type { ActivePlan } from "./tools/todo-write";
import { DEFAULT_AI_PROVIDER, getModelFor, readAiProvider } from "./get-model";
import {
  AGENT_CORE_FILES,
  BOOTSTRAP_PATH,
  BOOTSTRAP_SEED,
  coreFileMeta,
  IDENTITY_PATH,
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
import {
  createReadUserProfileTool,
  createWriteUserProfileTool,
} from "./tools/user-profile";
import { listSkills } from "./skills/loader";
import { type SkillEntry } from "./skills/types";
import { createSpawnBackgroundTaskTool } from "./tools/spawn-background-task";
import * as toolRegistry from "./tool-registry";

import {
  callMcpToolViaParent,
  isReconnectableMcpError,
  listMcpToolDescriptors,
  type McpToolDescriptor,
} from "./mcp-proxy";
import {
  rebuildMcpServer,
  restoreHeaderAuthServer,
  type StoredMcpServer,
} from "./mcp-reconnect";
import { getAgent, listAgents, readPreferences } from "../db/profile";

const BOOTSTRAP_SEEDED_KEY = "downy:bootstrap-seeded";

const backgroundTaskKey = (id: string) => `background_task:${id}`;
const MCP_SERVER_KEY_PREFIX = "mcp_server:";
const mcpServerKey = (id: string) => `${MCP_SERVER_KEY_PREFIX}${id}`;
const mcpServerIdentityKey = (name: string, url: string) => `${name}\n${url}`;

export class DownyAgent extends Think {
  get slug() {
    return this.name.split(":")[0];
  }

  get sessionId() {
    return this.name.split(":")[1] || "default";
  }

  override workspace = new Workspace({
    sql: this.ctx.storage.sql,
    r2: this.env.WORKSPACE_BUCKET,
    name: () => this.slug,
  });

  override maxSteps = 250;

  override chatRecovery = true;

  // Wait for the base Agent's hibernation restore before each turn so MCP
  // tools are available without asking the user to reconnect.
  override waitForMcpConnections = true;

  #bootstrapInit?: Promise<void>;

  // Default model used if `beforeTurn` doesn't override it (e.g. recovery
  // turns that bypass the hook).
  override getModel(): LanguageModel {
    return createWorkersAI({ binding: this.env.AI }).chat(this.env.MODEL_ID);
  }

  // Shared tools live in `tool-registry.ts`; parent-only tools are layered on.
  override getTools(): ToolSet {
    return {
      ...toolRegistry.buildSharedToolSet({
        env: this.env,
        getWorkspace: () => this.workspace,
        parentSlug: this.slug,
        bumpPeerReadCount: () => this.bumpPeerReadCount(),
        setActivePlan: (plan) => this.#setActivePlan(plan),
      }),
      read_user_profile: createReadUserProfileTool({ db: this.env.DB }),
      write_user_profile: createWriteUserProfileTool({ db: this.env.DB }),
      spawn_background_task: createSpawnBackgroundTaskTool({
        namespace: this.env.ChildAgent,
        parentName: this.name,
        putRecord: (id, record) =>
          this.ctx.storage.put(backgroundTaskKey(id), record),
        broadcastUpdate: (record) => {
          this.#broadcastBackgroundTaskUpdate(record);
        },
      }),
      connect_mcp_server: createConnectMcpServerTool({ agent: this }),
      list_mcp_servers: createListMcpServersTool({ agent: this }),
      disconnect_mcp_server: createDisconnectMcpServerTool({ agent: this }),
    };
  }

  override async configureSession(session: Session) {
    const compactFn = createCompactFunction({
      summarize: async (prompt) => {
        const provider = await readAiProvider(this.env.DB).catch(
          () => DEFAULT_AI_PROVIDER,
        );
        const model = await getModelFor(this.env, provider);
        const result = await generateText({
          model,
          prompt,
        });
        return result.text;
      },
    });
    return session
      .onCompaction(compactFn)
      .compactAfter(150_000)
      .withCachedPrompt();
  }

  #abortsWrapped = false;
  override async onStart(): Promise<void> {
    await super.onStart();
    await this.mcp.waitForConnections({ timeout: 10_000 });
    await this.#restoreMcpServers();
    await this.mcp.waitForConnections({ timeout: 10_000 });
    if (this.#abortsWrapped) return;
    this.#abortsWrapped = true;
    ignoreClientCancels(this, "[agent]");
  }

  #turnStartedAt = 0;
  #lastChunkAt = 0;
  #chunkCount = 0;
  #lastStepFinishAt = 0;

  // Per-turn peer-read counter — reset in beforeTurn, incremented by
  // read_peer_agent. Hard cap is a safety net so a misbehaving turn can't
  // fan out unbounded across peers.
  #peerReadCount = 0;
  bumpPeerReadCount(): number {
    return (this.#peerReadCount += 1);
  }

  // Persist (or clear) the latest `todo_write` plan. Read back in
  // `beforeTurn` so the next turn's system prompt carries an `## Active
  // plan` section — see `renderActivePlanSection` in build-system-prompt.ts.
  async #setActivePlan(plan: ActivePlan | null): Promise<void> {
    if (plan == null) await this.ctx.storage.delete(ACTIVE_PLAN_KEY);
    else await this.ctx.storage.put(ACTIVE_PLAN_KEY, plan);
  }

  // Cache the agent's own privacy flag for ~5s so peer-read RPCs don't hit
  // D1 on every call within a chatty turn.
  #privateCachedAt = 0;
  #privateCached = false;
  async #isThisAgentPrivate(): Promise<boolean> {
    const now = Date.now();
    if (now - this.#privateCachedAt < 5_000) return this.#privateCached;
    const record = await getAgent(this.env.DB, this.slug);
    this.#privateCached = record?.isPrivate ?? false;
    this.#privateCachedAt = now;
    return this.#privateCached;
  }

  override async beforeTurn(ctx: {
    system: string;
    messages: unknown[];
    tools: ToolSet;
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
    const [userFile, allAgents, aiProvider, latestPlan] = await Promise.all([
      readUserFile(this.env.DB),
      listAgents(this.env.DB),
      readAiProvider(this.env.DB),
      this.ctx.storage.get<ActivePlan>(ACTIVE_PLAN_KEY).then((v) => v ?? null),
    ]);
    const peers = allAgents.filter((a) => a.slug !== this.slug);
    const system = await buildSystemPrompt(
      this.workspace,
      userFile.content,
      peers,
      latestPlan,
    );
    const mcpTools = toolRegistry.buildMcpProxyTools({
      descriptors: listMcpToolDescriptors(this.mcp),
      callTool: (serverId, name, args) =>
        this.callMcpToolWithRecovery(serverId, name, args),
    });

    const model = await getModelFor(this.env, aiProvider);

    return {
      system,
      model,
      tools: mcpTools,
      activeTools: toolRegistry.activeToolsWithMcpWrappers(ctx.tools, mcpTools),
    };
  }

  override onStepFinish(ctx: {
    stepType: string;
    text: string;
    toolCalls: unknown[];
    toolResults: unknown[];
    finishReason: string;
    usage: { inputTokens: number; outputTokens: number };
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
      usage: ctx.usage,
    });

    // Store usage metrics in DO storage for the health dashboard
    void this.#recordUsage(ctx.usage);

    if (ctx.toolCalls.length !== ctx.toolResults.length) {
      console.warn("[agent] step ended with mismatched tool calls / results", {
        toolCalls: ctx.toolCalls,
        toolResults: ctx.toolResults,
      });
    }
  }

  async #recordUsage(usage: { inputTokens: number; outputTokens: number }) {
    const key = "metrics:usage";
    const current = (await this.ctx.storage.get<{
      input: number;
      output: number;
    }>(key)) || { input: 0, output: 0 };
    await this.ctx.storage.put(key, {
      input: current.input + usage.inputTokens,
      output: current.output + usage.outputTokens,
    });
  }

  // Token-level visibility, throttled so it doesn't flood.
  override onChunk(): void {
    const now = Date.now();
    this.#chunkCount += 1;
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
    message?: any; // Added to match result type
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

    if (result.status === "completed" && result.message) {
      const lastUserMetadata = this.messages[this.messages.length - 2]
        ?.metadata as any;
      const telegramMetadata = lastUserMetadata?.telegram
        ? lastUserMetadata
        : null;

      if (telegramMetadata) {
        const chatId = telegramMetadata.chatId;
        const text = result.message.parts
          .filter((p: any) => p.type === "text")
          .map((p: any) => p.text)
          .join("\n");
        void this.#sendTelegramReply(chatId, text);
      }
    }
  }

  async #sendTelegramReply(chatId: string, text: string) {
    const [prefs] = await Promise.all([readPreferences(this.env.DB)]);
    const token =
      (prefs as any).telegram_bot_token || (this.env as any).TELEGRAM_BOT_TOKEN;
    if (!token) return;

    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
      }),
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

  async devReset(): Promise<void> {
    this.clearMessages();
    await this.ctx.storage.delete(BOOTSTRAP_SEEDED_KEY);
    this.#bootstrapInit = undefined;
    await this.#ensureBootstrapSeeded();
  }

  async revertLastTurn(): Promise<{ deletedCount: number }> {
    const cutoff = this.#findLastUserTurnIndex();
    if (cutoff === -1) return { deletedCount: 0 };
    const ids = this.messages.slice(cutoff).map((m) => m.id);
    this.session.deleteMessages(ids);
    this.broadcast(
      JSON.stringify({
        type: CHAT_MESSAGE_TYPES.CHAT_MESSAGES,
        messages: this.messages,
      }),
    );
    return { deletedCount: ids.length };
  }

  async editLastUserMessage(text: string): Promise<{ replaced: boolean }> {
    const trimmed = text.trim();
    if (!trimmed) return { replaced: false };
    const cutoff = this.#findLastUserTurnIndex();
    if (cutoff === -1) return { replaced: false };
    const ids = this.messages.slice(cutoff).map((m) => m.id);
    this.session.deleteMessages(ids);
    await this.saveMessages([
      {
        id: crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", text: trimmed }],
      },
    ]);
    return { replaced: true };
  }

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

  async listWorkspaceFiles(): Promise<FileInfo[]> {
    const out: FileInfo[] = [];
    const walk = async (dir: string): Promise<void> => {
      const entries = await this.workspace.readDir(dir);
      for (const entry of entries) {
        if (entry.type === "directory") {
          await walk(entry.path);
        } else if (entry.type === "file") {
          out.push(entry);
        }
      }
    };
    await walk("workspace");
    return out;
  }

  async readWorkspaceFile(
    path: string,
  ): Promise<{ content: string; stat: FileInfo | null } | null> {
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

  async listMcpToolsForChild(): Promise<McpToolDescriptor[]> {
    return listMcpToolDescriptors(this.mcp);
  }

  async callMcpToolForChild(
    serverId: string,
    name: string,
    args: unknown,
  ): Promise<unknown> {
    return this.callMcpToolWithRecovery(serverId, name, args);
  }

  async callMcpToolWithRecovery(
    serverId: string,
    name: string,
    args: unknown,
  ): Promise<unknown> {
    try {
      return await callMcpToolViaParent(this.mcp, serverId, name, args);
    } catch (err) {
      if (!isReconnectableMcpError(err)) throw err;
      const rebuiltId = await this.#rebuildStoredMcpServer(serverId);
      if (!rebuiltId) throw err;
      return callMcpToolViaParent(this.mcp, rebuiltId, name, args);
    }
  }

  async workspaceCallForChild(
    method: string,
    args: unknown[],
  ): Promise<unknown> {
    assertChildWorkspaceCallAllowed(method, args);
    const fn = Reflect.get(this.workspace, method) as (
      ...args: unknown[]
    ) => Promise<unknown>;
    return fn.apply(this.workspace, args);
  }

  async childParentSlug(): Promise<string> {
    return this.slug;
  }

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
    const liveByServer = new Map(
      Object.entries(live).map(([id, s]) => [
        mcpServerIdentityKey(s.name, s.server_url),
        { id, state: s.state },
      ]),
    );
    for (const config of stored.values()) {
      const key = mcpServerIdentityKey(config.name, config.url);
      const liveForServer = liveByServer.get(key);
      if (liveForServer) {
        if (!config.headers || liveForServer.state === "ready") {
          if (liveForServer.id !== config.id) {
            await this.forgetMcpServer(config.id);
            await this.persistMcpServer({ ...config, id: liveForServer.id });
          }
          continue;
        }
        await this.removeMcpServer(liveForServer.id);
      }
      try {
        const type = config.transport ?? "auto";
        let restored = false;
        if (config.headers) {
          restored = await restoreHeaderAuthServer(this.mcp, {
            ...config,
            headers: config.headers,
          });
        } else {
          const result = await this.addMcpServer(config.name, config.url, {
            transport: { type },
          });
          if (result.id !== config.id) {
            await this.forgetMcpServer(config.id);
            await this.persistMcpServer({ ...config, id: result.id });
          }
          restored = true;
          config.id = result.id;
        }
        if (restored) {
          liveByServer.set(key, { id: config.id, state: "ready" });
        }
      } catch (err) {
        console.warn("[agent] restoreMcpServer failed", {
          id: config.id,
          name: config.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  async #rebuildStoredMcpServer(id: string): Promise<string | null> {
    const config = await this.ctx.storage.get<StoredMcpServer>(
      mcpServerKey(id),
    );
    if (!config) return null;
    const rebuiltId = await rebuildMcpServer(
      this.mcp,
      config,
      (name, url, options) => this.addMcpServer(name, url, options),
    );
    if (rebuiltId && rebuiltId !== id) {
      await this.forgetMcpServer(id);
      await this.persistMcpServer({ ...config, id: rebuiltId });
    }
    return rebuiltId;
  }

  async peerDescribe(): Promise<{
    slug: string;
    displayName: string;
    isPrivate: boolean;
    identitySummary: string;
  }> {
    const record = await getAgent(this.env.DB, this.slug);
    const displayName = record?.displayName ?? this.slug;
    const isPrivate = record?.isPrivate ?? false;
    let identitySummary = "";
    if (!isPrivate) {
      const identity = await this.workspace.readFile(IDENTITY_PATH);
      if (identity) {
        identitySummary = identity
          .replace(/^#.*$/m, "")
          .trim()
          .split(/\n\s*\n/)[0]
          .slice(0, 400);
      }
    }
    return { slug: this.slug, displayName, isPrivate, identitySummary };
  }

  async peerListWorkspace(prefix?: string): Promise<FileInfo[]> {
    if (await this.#isThisAgentPrivate()) {
      throw new Error(`Agent is private: ${this.slug}`);
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
      throw new Error(`Agent is private: ${this.slug}`);
    }
    if (isAgentManagedPath(path)) {
      throw new Error(
        `Use peerReadIdentityFiles for ${path}, not peerReadFile.`,
      );
    }
    return this.readWorkspaceFile(path);
  }

  async peerReadIdentityFiles(): Promise<CoreFileRecord[]> {
    if (await this.#isThisAgentPrivate()) {
      throw new Error(`Agent is private: ${this.slug}`);
    }
    return this.listCoreFiles();
  }

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

  async listBackgroundTasks(): Promise<BackgroundTaskRecord[]> {
    const map = await this.ctx.storage.list<BackgroundTaskRecord>({
      prefix: "background_task:",
    });
    const records = [...map.values()];
    records.sort((a, b) => b.spawnedAt - a.spawnedAt);
    return records;
  }

  #broadcastBackgroundTaskUpdate(record: BackgroundTaskRecord): void {
    this.broadcast(
      JSON.stringify({ type: BACKGROUND_TASK_UPDATED_TYPE, record }),
    );
  }

  async #pickArtifactPath(
    slug: string | undefined,
    kind: string,
    taskId: string,
  ): Promise<string> {
    const shortId = taskId.slice(0, 8);
    if (slug) {
      const clean = `workspace/notes/${slug}.md`;
      if ((await this.workspace.readFile(clean)) == null) return clean;
      return `workspace/notes/${slug}-${shortId}.md`;
    }
    const date = new Date().toISOString().slice(0, 10);
    const kindSlug =
      kind
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || "task";
    return `workspace/notes/${date}-${kindSlug}-${shortId}.md`;
  }

  // Health / Status Metrics
  async getStatus() {
    const usage = (await this.ctx.storage.get<{
      input: number;
      output: number;
    }>("metrics:usage")) || { input: 0, output: 0 };
    const tasks = await this.listBackgroundTasks();
    const files = await this.listWorkspaceFiles();

    return {
      name: this.name,
      slug: this.slug,
      sessionId: this.sessionId,
      usage,
      activeTasks: tasks.filter((t) => t.status === "running").length,
      completedTasks: tasks.filter((t) => t.status === "done").length,
      failedTasks: tasks.filter((t) => t.status === "error").length,
      fileCount: files.length,
      storageUsage: files.reduce((acc, f) => acc + (f.size || 0), 0),
    };
  }
}
