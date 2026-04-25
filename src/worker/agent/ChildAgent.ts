import { Think } from "@cloudflare/think";
import { createExecuteTool } from "@cloudflare/think/tools/execute";
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

const BACKGROUND_TASK_SYSTEM_PROMPT = `You are a focused background task worker dispatched by a parent agent. You have no conversation history — the brief below is self-contained.

You have one tool: \`execute\`. It runs a JavaScript snippet in a sandboxed Worker with access to:
- \`codemode.web_search({ query, numResults?, category? })\` — Exa search.
- \`codemode.web_scrape({ url, render?, maxChars? })\` — fetch and extract page text.

**Always fan out in parallel.** For any task touching more than one URL, issue a single \`execute\` call that awaits \`Promise.all([...])\` over all the scrapes — do not scrape pages one-by-one across multiple turns. Typical shape:

\`\`\`js
const hits = await codemode.web_search({ query: "...", numResults: 8 });
const pages = await Promise.all(
  hits.results.map(r => codemode.web_scrape({ url: r.url }).catch(e => ({ url: r.url, error: String(e) })))
);
return { hits, pages };
\`\`\`

You can call \`execute\` more than once (e.g. search → inspect → targeted follow-up scrapes). Each call should do as much work as possible in parallel. Return structured data from the snippet — that becomes the tool result visible to you on the next turn.

Your final assistant message (plain markdown, no tool calls) will be saved as a file in the parent agent's workspace. The parent picks the directory; you pick the filename via a slug header.

**Required output shape:**

\`\`\`
slug: <kebab-case-slug>

# <Document title>

...rest of the markdown document...
\`\`\`

Rules:
- The very first line MUST be \`slug: <slug>\` where \`<slug>\` is 3–6 hyphenated lowercase words describing the document (e.g. \`competitive-research-pricing\`, \`openseo-content-idea-tracker\`). The parent strips this line and uses it to name the file.
- Do NOT include a path like \`notes/foo.md\` anywhere in the document — the parent owns the path.
- After the slug line, leave a blank line, then start the document with an H1 title.

Write the body as a complete, standalone research document optimized for being read cold:
- Lead with a short "Headline takeaways" section (3–6 bullets).
- Follow with structured findings under clear H2 headings.
- Cite source URLs inline next to each claim that came from a scrape or search.
- End with a "Sources" list of the URLs you actually used.

Do not address the parent or the user, do not ask clarifying questions, do not include meta-commentary about your process — produce only the slug line followed by the markdown document.`;

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
  override maxSteps = 250;

  override chatRecovery = true;

  override getModel(): LanguageModel {
    return getCodexRelayModel();
  }

  override getTools(): ToolSet {
    return {
      execute: createExecuteTool({
        tools: {
          web_search: createWebSearchTool(this.env.EXA_API_KEY),
          web_scrape: createWebScrapeTool(this.env.BROWSER),
        },
        loader: this.env.LOADER,
        timeout: 60_000,
      }),
    };
  }

  override configureSession(session: Session) {
    return session.withCachedPrompt();
  }

  override async beforeTurn() {
    return {
      system: BACKGROUND_TASK_SYSTEM_PROMPT,
      // Worker has no workspace of its own; the parent owns all file writes.
      // Its assistant text is the artifact body — the parent saves it under
      // `notes/` on completion. Restricting to `execute` pushes the worker to
      // fan out scrapes in parallel via codemode instead of sequential calls.
      activeTools: ["execute"],
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

    const assistantText =
      result.status === "completed" ? extractAssistantText(result.message) : "";
    // An empty assistant message on a "completed" turn means the worker hit
    // its step budget before synthesizing — surface as an error so the parent
    // doesn't silently report "completed but no output."
    const status: "done" | "error" =
      result.status === "completed" && assistantText.length > 0
        ? "done"
        : "error";
    const body =
      status === "done"
        ? assistantText
        : (result.error ??
          "Background worker finished without producing any output (likely hit maxSteps before synthesizing).");

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
