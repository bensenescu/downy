import { Think } from "@cloudflare/think";
import { Workspace } from "@cloudflare/shell";
import type { FileInfo } from "@cloudflare/shell";
import { MessageType } from "@cloudflare/ai-chat/types";
import { createWorkersAI } from "workers-ai-provider";
import type { LanguageModel, ToolSet, UIMessage } from "ai";
import type { Session } from "agents/experimental/memory/session";

import { buildSystemPrompt } from "./build-system-prompt";
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
import { createWebScrapeTool } from "./tools/web-scrape";
import { createWebSearchTool } from "./tools/web-search";

const BOOTSTRAP_SEEDED_KEY = "openclaw:bootstrap-seeded";

export class OpenClawAgent extends Think {
  override workspace = new Workspace({
    sql: this.ctx.storage.sql,
    r2: this.env.WORKSPACE_BUCKET,
    name: () => this.name,
  });

  override maxSteps = 20;

  override chatRecovery = true;

  #bootstrapInit?: Promise<void>;

  override getModel(): LanguageModel {
    const workersAI = createWorkersAI({ binding: this.env.AI });
    return workersAI(this.env.MODEL_ID);
  }

  override getTools(): ToolSet {
    return {
      web_search: createWebSearchTool(this.env.EXA_API_KEY),
      web_scrape: createWebScrapeTool(this.env.BROWSER),
    };
  }

  override configureSession(session: Session) {
    return session.withCachedPrompt();
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
  // The `saveMessages` callback re-checks history at dispatch time — if a real
  // message already exists, we no-op. The client filters kickoff messages from
  // the transcript using the `metadata.kickoff` flag.
  async startBootstrapIfPending(): Promise<{ started: boolean }> {
    await this.#ensureBootstrapSeeded();
    const pending = (await this.workspace.readFile(BOOTSTRAP_PATH)) != null;
    if (!pending) return { started: false };

    const result = await this.saveMessages((current): UIMessage[] => {
      if (current.length > 0) return current;
      return [
        {
          id: crypto.randomUUID(),
          role: "user",
          parts: [{ type: "text", text: "begin" }],
          metadata: { kickoff: true },
        },
      ];
    });
    return { started: result.status === "completed" };
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

  // Remove a single message from the chat transcript and push the updated
  // history to every connected client. Think's own `_broadcastMessages` is
  // private, so we emit the same `CF_AGENT_CHAT_MESSAGES` frame that the
  // React client already listens for — this is what keeps the `useAgentChat`
  // hook's local state in sync with the server's source-of-truth session.
  // Unlike `saveMessages`, this does NOT kick off a new model turn; it's a
  // pure transcript edit.
  async deleteChatMessage(messageId: string): Promise<{ deleted: boolean }> {
    const existing = this.session.getMessage(messageId);
    if (!existing) return { deleted: false };
    this.session.deleteMessages([messageId]);
    this.broadcast(
      JSON.stringify({
        type: MessageType.CF_AGENT_CHAT_MESSAGES,
        messages: this.messages,
      }),
    );
    return { deleted: true };
  }
}
