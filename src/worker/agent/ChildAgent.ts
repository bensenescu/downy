import { Think } from "@cloudflare/think";
import { createExecuteTool } from "@cloudflare/think/tools/execute";
import { getAgentByName } from "agents";
import { dynamicTool, jsonSchema } from "ai";
import type { LanguageModel, ToolSet, UIMessage } from "ai";
import type { Session } from "agents/experimental/memory/session";

import { DEFAULT_AI_PROVIDER, getModelFor, readAiProvider } from "./get-model";
import { ignoreClientCancels } from "./ignore-client-cancels";
import { createWebScrapeTool } from "./tools/web-scrape";
import { createWebSearchTool } from "./tools/web-search";
import type { McpToolDescriptor } from "./mcp-proxy";
import type { OpenClawAgent } from "./OpenClawAgent";

type BackgroundTaskMeta = {
  parentName: string;
  taskId: string;
  kind: string;
  brief: string;
  startedAt: number;
};

const META_KEY = "meta";

const BACKGROUND_TASK_SYSTEM_PROMPT = `You are a focused background worker dispatched by a parent agent. You have no conversation history — the brief below is self-contained.

Your primary tool is \`execute\`. It runs a JavaScript snippet in a sandboxed Worker with access to:
- \`codemode.web_search({ query, numResults?, category? })\` — Exa search.
- \`codemode.web_scrape({ url, render?, maxChars? })\` — fetch and extract page text.

You may also have direct tools named \`tool_<server>_<name>\` — these are MCP server tools the parent has connected (e.g. DataForSEO, Linear, PostHog). Call them as top-level tools, not from inside \`execute\`. Each call round-trips through the parent agent's live MCP connection. If the brief implies one of these tools is the right fit (specialized data the parent connected on purpose), prefer it over scraping.

**Fan out in parallel.** When a step touches more than one URL, issue a single \`execute\` call that awaits \`Promise.all([...])\` over the scrapes — do not scrape pages one-by-one across turns. Typical shape:

\`\`\`js
const hits = await codemode.web_search({ query: "...", numResults: 8 });
const pages = await Promise.all(
  hits.results.map(r => codemode.web_scrape({ url: r.url }).catch(e => ({ url: r.url, error: String(e) })))
);
return { hits, pages };
\`\`\`

You can call \`execute\` more than once (search → inspect → targeted follow-up). Return structured data from each snippet — it becomes the tool result on the next turn. Stop searching once you have enough to answer the brief; don't pad.

Your final assistant message (plain markdown, no tool calls) is saved as a file in the parent's workspace. The parent picks the directory; you pick the filename via a slug header.

**Output shape:**

\`\`\`
slug: <kebab-case-slug>

# <Document title>

...body...
\`\`\`

Hard rules:
- First line MUST be \`slug: <slug>\` — 3–6 hyphenated lowercase words describing the document (e.g. \`dataforseo-mcp-setup\`, \`competitive-research-pricing\`). The parent strips this line and uses it to name the file.
- Do NOT include a path like \`notes/foo.md\` anywhere in the document — the parent owns the path.
- After the slug line, leave a blank line, then start the document with an H1 title.
- Cite source URLs inline next to claims that came from a scrape or search.
- Do not address the parent or the user. Do not ask clarifying questions. Do not include meta-commentary about your process.

**Match the document's length and shape to the brief, not to a template.** A "how do I set up X" brief should produce concise practical steps (install command, env vars, config snippet, gotchas) — a few hundred words is usually right. A "scan the competitive landscape" brief can produce a longer structured report with headline takeaways and per-tool sections. Do not impose headline-takeaways / H2-sections / sources-list scaffolding on every output — use those structures only when the brief actually wants a report. When in doubt, err shorter.`;

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

  // Default model — real per-turn selection happens in `beforeTurn` based on
  // the user's `ai_provider` preference (the same setting the parent uses).
  override getModel(): LanguageModel {
    return getModelFor(this.env, DEFAULT_AI_PROVIDER);
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
    // Fetch the parent's connected MCP tools and wrap each one in a
    // proxy that round-trips back to the parent over DO-to-DO RPC. The
    // child can't open its own MCP connections (the live transport state
    // lives in the parent), so this is how it gets MCP access. Any
    // failure here just means the child runs without MCP — keep going.
    const [{ tools: mcpTools, names: mcpNames }, aiProvider] =
      await Promise.all([
        this.#buildMcpProxyTools(),
        readAiProvider(this.env.DB),
      ]);
    return {
      system: BACKGROUND_TASK_SYSTEM_PROMPT,
      // Worker has no workspace of its own; the parent owns all file writes.
      // Its assistant text is the artifact body — the parent saves it under
      // `notes/` on completion. Restricting to `execute` plus MCP proxies
      // keeps the surface tight while still letting the worker call any
      // specialized server the parent has connected.
      tools: mcpTools,
      activeTools: ["execute", ...mcpNames],
      model: getModelFor(this.env, aiProvider),
    };
  }

  async #buildMcpProxyTools(): Promise<{ tools: ToolSet; names: string[] }> {
    const meta = await this.ctx.storage.get<BackgroundTaskMeta>(META_KEY);
    if (!meta) return { tools: {}, names: [] };
    const parent = await getAgentByName<Cloudflare.Env, OpenClawAgent>(
      this.env.OpenClawAgent,
      meta.parentName,
    );
    let entries: McpToolDescriptor[];
    try {
      entries = await parent.listMcpToolsForChild();
    } catch (err) {
      console.warn("[ChildAgent] failed to fetch parent MCP tools", {
        taskId: meta.taskId,
        error: err instanceof Error ? err.message : String(err),
      });
      return { tools: {}, names: [] };
    }
    const tools: ToolSet = {};
    const names: string[] = [];
    for (const entry of entries) {
      // Match the AI SDK naming the parent's framework uses
      // (`tool_<serverId-without-dashes>_<toolName>`) so the model sees
      // identical names whether it's running in the parent or here.
      const key = `tool_${entry.serverId.replace(/-/g, "")}_${entry.name}`;
      tools[key] = dynamicTool({
        description: entry.description,
        // McpToolDescriptor.inputSchema is structurally a JSONSchema7
        // (object-rooted with optional properties/required), but the
        // type-utils signature wants the canonical JSONSchema7 type.
        // eslint-disable-next-line typescript/no-unsafe-type-assertion -- structural match enforced by McpToolDescriptor.
        inputSchema: jsonSchema(
          entry.inputSchema as Parameters<typeof jsonSchema>[0],
        ),
        execute: async (args) =>
          parent.callMcpToolForChild(entry.serverId, entry.name, args),
      });
      names.push(key);
    }
    return { tools, names };
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
