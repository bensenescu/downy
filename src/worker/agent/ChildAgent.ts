import { Think } from "@cloudflare/think";
import type { Workspace } from "@cloudflare/shell";
import { getAgentByName } from "agents";
import type { LanguageModel, ToolSet, UIMessage } from "ai";
import type { Session } from "agents/experimental/memory/session";

import { DEFAULT_AI_PROVIDER, getModelFor, readAiProvider } from "./get-model";
import { ignoreClientCancels } from "./ignore-client-cancels";
import type { McpToolDescriptor } from "./mcp-proxy";
import type { DownyAgent } from "./DownyAgent";
import { createRemoteWorkspace } from "./RemoteWorkspace";
import { buildMcpProxyTools, buildSharedToolSet } from "./tool-registry";

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
- \`codemode.read_peer_agent({ slug, op, path? })\` — read another of the user's agents (ops: \`describe\`, \`list_workspace\`, \`read_file\`, \`read_identity\`).
- \`codemode.list_skills()\` / \`codemode.read_skill({ name, includeReferences? })\` / \`codemode.list_skill_files({ name })\` — inspect the parent's skill catalog.

You also have the parent's full top-level tool set, scoped to the parent's workspace:
- File tools (\`read\`, \`write\`, \`edit\`, \`list\`, \`grep\`, \`find\`, \`delete\`) — every call routes back to the parent's workspace, so anything you write is visible to the parent on completion.
- Skill writes (\`create_skill\`, \`update_skill\`, \`delete_skill\`) — use these directly when the brief asks you to author a skill rather than just drafting one. Before \`create_skill\`, scan \`codemode.list_skills()\` first; if the name (or a near-synonym) already exists, call \`update_skill\` instead of probing for the conflict.

**Workspace layout.** Three top-level directories: \`identity/\` (the parent's grounding files — read-only for you), \`skills/<name>/\` (reusable packs, including any companions), and \`workspace/\` (the working desk — write your drafts and any standalone artifacts under \`workspace/notes/...\`, \`workspace/drafts/...\`, etc.). Pass full paths to the file tools.

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

Your final assistant message (plain markdown, no tool calls) is saved as a file in the parent's workspace. The parent picks the directory; you pick the filename via a slug header. Even when you also use \`write\` / \`create_skill\` directly, still produce a final markdown message — that's how the parent knows the task is complete and gets a pointer it can show the user.

**Output shape:**

\`\`\`
slug: <kebab-case-slug>

# <Document title>

...body...
\`\`\`

Hard rules:
- First line MUST be \`slug: <slug>\` — 3–6 hyphenated lowercase words describing the document (e.g. \`dataforseo-mcp-setup\`, \`competitive-research-pricing\`). The parent strips this line and uses it to name the file.
- Do NOT include a path like \`workspace/notes/foo.md\` anywhere in the document — the parent owns the path.
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
  // The child's workspace is a Proxy that forwards every method call to the
  // parent agent over RPC (see RemoteWorkspace.ts). This way the workspace
  // tools Think auto-registers off `this.workspace` (read/write/edit/list/
  // grep/find/delete) operate on the parent's authoritative workspace,
  // and the explicit tools we register in `getTools` see the same files.
  // Resolved lazily via `meta.parentName` — the child can't know its parent
  // until `startTask` lands, so the proxy reads the meta on demand.
  override workspace: Workspace = createRemoteWorkspace(async () => {
    const meta = await this.ctx.storage.get<BackgroundTaskMeta>(META_KEY);
    if (!meta) {
      throw new Error("ChildAgent workspace accessed before startTask");
    }
    return getAgentByName<Cloudflare.Env, DownyAgent>(
      this.env.DownyAgent,
      meta.parentName,
    );
  });

  override maxSteps = 250;

  override chatRecovery = true;

  // Default model — real per-turn selection happens in `beforeTurn` based on
  // the user's `ai_provider` preference (the same setting the parent uses).
  override getModel(): LanguageModel {
    return getModelFor(this.env, DEFAULT_AI_PROVIDER);
  }

  // Tool registration is centralised in `tool-registry.ts` so the child's
  // surface tracks the parent's automatically. Two pieces are deferred to
  // `beforeTurn` because they need values that aren't available at field-
  // initialisation time:
  //   - `read_peer_agent` (built inside `buildSharedToolSet`) needs the
  //     parent's slug; we read it from the task meta below.
  //   - MCP proxy tools come from a live RPC to the parent and vary per turn.
  // We deliberately omit `spawn_background_task` (no recursive dispatch)
  // and the MCP connect/list/disconnect tools (live transport state lives
  // on the parent).
  override getTools(): ToolSet {
    return {};
  }

  // Per-turn peer-read counter — same shape as the parent agent's. The
  // counter is local (the child has its own turn budget), not proxied, so a
  // misbehaving snippet can't fan out unbounded across peer agents.
  #peerReadCount = 0;
  bumpPeerReadCount(): number {
    this.#peerReadCount += 1;
    return this.#peerReadCount;
  }

  override configureSession(session: Session) {
    return session.withCachedPrompt();
  }

  override async beforeTurn() {
    this.#peerReadCount = 0;
    // Resolve the parent stub once and reuse it for both the MCP listing
    // and the MCP proxy `execute` callbacks. `getAgentByName` is cheap, but
    // a single stub also keeps log lines correlated.
    const meta = await this.ctx.storage.get<BackgroundTaskMeta>(META_KEY);
    if (!meta) {
      throw new Error(
        "ChildAgent.beforeTurn ran before startTask — no parent context",
      );
    }
    const parent = await getAgentByName<Cloudflare.Env, DownyAgent>(
      this.env.DownyAgent,
      meta.parentName,
    );
    const [mcpDescriptors, aiProvider] = await Promise.all([
      this.#fetchMcpDescriptors(parent, meta.taskId),
      readAiProvider(this.env.DB),
    ]);
    const mcpTools = buildMcpProxyTools({
      descriptors: mcpDescriptors,
      callTool: (serverId, name, args) =>
        parent.callMcpToolForChild(serverId, name, args),
    });
    // No `activeTools` filter — Think exposes the full merged tool set
    // (shared bundle + workspace tools auto-registered off `this.workspace`
    // + MCP proxies). Mirrors the parent, which also doesn't filter.
    return {
      system: BACKGROUND_TASK_SYSTEM_PROMPT,
      tools: {
        ...buildSharedToolSet({
          env: this.env,
          getWorkspace: () => this.workspace,
          parentSlug: meta.parentName,
          bumpPeerReadCount: () => this.bumpPeerReadCount(),
        }),
        ...mcpTools,
      },
      model: getModelFor(this.env, aiProvider),
    };
  }

  async #fetchMcpDescriptors(
    parent: DurableObjectStub<DownyAgent>,
    taskId: string,
  ): Promise<McpToolDescriptor[]> {
    try {
      return await parent.listMcpToolsForChild();
    } catch (err) {
      // Any failure here just means the child runs without MCP — keep
      // going. The most common cause is the parent still warming up its
      // MCP transports after a hibernation.
      console.warn("[ChildAgent] failed to fetch parent MCP tools", {
        taskId,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
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
    const parent = await getAgentByName<Cloudflare.Env, DownyAgent>(
      this.env.DownyAgent,
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
