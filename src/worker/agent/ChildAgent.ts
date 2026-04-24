import { Think } from "@cloudflare/think";
import { getAgentByName } from "agents";
import type { LanguageModel, ToolSet, UIMessage } from "ai";
import type { Session } from "agents/experimental/memory/session";

import { getCodexRelayModel } from "./get-model";
import { ignoreClientCancels } from "./ignore-client-cancels";
import { createWebScrapeTool } from "./tools/web-scrape";
import { createWebSearchTool } from "./tools/web-search";
import type { OpenClawAgent } from "./OpenClawAgent";

type BackgroundTaskMeta = {
  parentName: string;
  taskId: string;
  kind: string;
  brief: string;
  startedAt: number;
};

const META_KEY = "meta";

const BACKGROUND_TASK_SYSTEM_PROMPT = `You are a focused background task worker dispatched by a parent agent. You have no conversation history — the brief below is self-contained. Use web_search and web_scrape to gather what you need, then return a tight, structured summary that the parent can hand back to the user. Do not ask clarifying questions.`;

/**
 * A background task worker — same Think-based chat session as the parent,
 * just spawned per-task. The parent dispatches via `spawn_background_task`,
 * which calls `startTask` here with a brief. That injects the brief as the
 * first user message and Think runs its own inference loop (tools, streaming,
 * persistence) against it. When the turn completes, `onChatResponse` calls
 * back to the parent with the final assistant text so the parent can
 * synthesize a reply for the user.
 *
 * Observers (the `/background-tasks/$taskId` route) connect via
 * `useAgentChat` just like the main chat — they see the same `UIMessage[]`
 * transcript rendered by `MessageView`.
 */
export class ChildAgent extends Think {
  override maxSteps = 20;

  override chatRecovery = true;

  override getModel(): LanguageModel {
    return getCodexRelayModel();
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

  override async beforeTurn() {
    return {
      system: BACKGROUND_TASK_SYSTEM_PROMPT,
      // The background task worker only needs web tools. Workspace file tools
      // are auto-merged by Think from `this.workspace`; restrict to keep the
      // surface tight and avoid the worker trying to scribble files.
      activeTools: ["web_search", "web_scrape"],
    };
  }

  #abortsWrapped = false;
  override async onStart(): Promise<void> {
    await super.onStart();
    if (this.#abortsWrapped) return;
    this.#abortsWrapped = true;
    ignoreClientCancels(this, "[ChildAgent]");
  }

  /**
   * Called by the parent's `spawn_background_task` tool via DO-to-DO RPC.
   * Stores the task metadata and kicks off a Think inference turn with the
   * brief as the user message. Returns immediately — the parent's tool call
   * must not block on the background task completing.
   */
  async startTask(
    input: Omit<BackgroundTaskMeta, "startedAt">,
  ): Promise<{ accepted: true }> {
    const meta: BackgroundTaskMeta = { ...input, startedAt: Date.now() };
    await this.ctx.storage.put(META_KEY, meta);
    console.log("[ChildAgent] startTask", {
      taskId: meta.taskId,
      kind: meta.kind,
      parentName: meta.parentName,
    });
    // Fire-and-forget: `saveMessages` runs the full inference turn under the
    // hood. We don't await because the parent's tool call needs to return
    // immediately with `{ taskId, status: "dispatched" }`. Any failure is
    // surfaced via `onChatResponse(status: "error")`.
    void this.saveMessages([
      {
        id: crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", text: meta.brief }],
      },
    ]).catch((err: unknown) => {
      console.error("[ChildAgent] saveMessages failed", {
        taskId: meta.taskId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
    return { accepted: true };
  }

  /**
   * Fires once per completed turn. A background task has exactly one turn
   * (the brief), so this is where we report back to the parent.
   */
  override async onChatResponse(result: {
    message: UIMessage;
    requestId: string;
    continuation: boolean;
    status: "completed" | "error" | "aborted";
    error?: string;
  }): Promise<void> {
    if (result.status === "aborted") return;
    const meta = await this.ctx.storage.get<BackgroundTaskMeta>(META_KEY);
    if (!meta) throw new Error("onChatResponse fired before startTask");

    const status: "done" | "error" =
      result.status === "completed" ? "done" : "error";
    const body =
      status === "done" ? extractAssistantText(result.message) : result.error!;

    console.log("[ChildAgent] reportBack", {
      taskId: meta.taskId,
      status,
      resultLen: body.length,
    });
    const parent = await getAgentByName<Cloudflare.Env, OpenClawAgent>(
      this.env.OpenClawAgent,
      meta.parentName,
    );
    await parent.onBackgroundTaskComplete(meta.taskId, status, body);
  }
}

function extractAssistantText(message: UIMessage): string {
  return message.parts
    .flatMap((p) => (p.type === "text" ? [p.text] : []))
    .join("\n")
    .trim();
}
