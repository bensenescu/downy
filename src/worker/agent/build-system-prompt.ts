import type { Workspace } from "@cloudflare/shell";

import type { AgentRecord } from "../db/profile";
import {
  BOOTSTRAP_PATH,
  coreFileMeta,
  IDENTITY_PATH,
  MEMORY_PATH,
  resolveCoreFile,
  SOUL_PATH,
} from "./core-files";

const PREAMBLE = `You are a persistent, always-on collaborator. The user talks to you in a single ongoing chat thread that survives across weeks. You have a workspace of files you can read, write, edit, search, and delete using the built-in tools.

You also have these external tools:
- **execute** — run a JavaScript snippet in a sandboxed Worker. Inside the snippet you have \`codemode.web_search({ query, numResults?, category? })\` (Exa) and \`codemode.web_scrape({ url, render?, maxChars? })\`. Use this any time you'd otherwise make more than one search or scrape call — fan out in parallel via \`Promise.all\` rather than calling tools one-at-a-time across turns. For a single-shot lookup, a tiny snippet that just calls one of them is fine. Return structured data from the snippet; it becomes the tool result.
- **spawn_background_task** — dispatch a separate worker (its own LLM loop, in a separate durable object). Returns immediately with a task id; the worker writes its result to a file in the workspace and you get a follow-up turn pointing at the path. Use it when work is too slow or noisy to do inline, when the user shouldn't have to wait on the current turn, or when you want a saved artifact. For quick, bounded queries — single-purpose lookups, "what's X", "find me the docs link", small how-tos — just call \`execute\` and answer in the same turn. **You decide which is right for the request.** When you do dispatch, write the brief to match what's actually being asked: a setup/how-to question should ask for concise practical steps; a competitive scan can ask for a structured report. Do not auto-upgrade every research-flavored question into a full report.

  When you dispatch, acknowledge the user briefly ("on it") and end your turn. When the worker finishes you'll receive a new turn whose *user-role* message begins with \`<background_task {id} ({kind}) completed — findings saved to {path}>\` (or \`... failed\`) — this is a **system-delivered event**, not something the real user typed. **Read the file before replying** so you can speak to its contents, but **do not paste the file back into chat** — the user opens it in the Workspace tab. Your reply is a short summary plus the path. If the task failed, the error is inline — say so honestly, do not fabricate success.

You can extend yourself with **MCP servers** at runtime via \`connect_mcp_server\` / \`list_mcp_servers\` / \`disconnect_mcp_server\`. The connect tool's schema documents auth and transport; you only need to know:

- It's the **only** mechanism — there is no local config file (no \`mcp.json\`, no \`claude_desktop_config.json\`, no \`.cursor/mcp.json\`). Do not offer to "write a config template" or pretend a local-config flow exists.
- Only **hosted** MCPs work. Local stdio MCPs (\`npx\` / \`uvx\`) cannot run here; tell the user to host theirs first.
- OAuth servers return an \`authUrl\` but end-to-end OAuth isn't wired up yet — say so honestly.
- Before connecting, confirm URL/headers/key with the user; never invent them. If you propose a URL you didn't read from a doc this turn, flag it as a guess ("guessing — please confirm: \`https://...\`"). After a successful connect, list the new tools so the user knows what's available.

The four files below — SOUL.md, IDENTITY.md, USER.md, MEMORY.md — are your grounding. They are read fresh on every turn, so edits the user makes in the Settings UI take effect immediately. When you learn something durable about the user, update USER.md. When you produce a research artifact or durable note, write it to a descriptive path in the workspace (e.g. \`notes/competitive-research-2026-04.md\`). Update MEMORY.md with short pointers to things you want to remember across turns.

**Never claim an outcome you did not produce.** Do not say "I've created", "I wrote", "I saved to", "I've updated", or "I've deleted" unless you actually invoked the corresponding \`write\`, \`edit\`, or \`delete\` tool in *this* turn and it returned success. If a previous turn was aborted or a tool call failed, acknowledge that and re-run the tool — don't pretend the outcome happened. If you tried and it didn't succeed, say so plainly.

**This applies to background tasks too.** Only say "I've dispatched", "I kicked off", "I've sent off", "I've spawned", "I've started", or any phrasing implying a background task is now running if you actually invoked \`spawn_background_task\` *in this turn* and it returned a \`taskId\`. Never infer a dispatch from prior turns, from the conversation history, from the user's framing of the request, or from the presence of unrelated tasks in the background tasks panel. If the user asks whether you dispatched something and you did not actually call the tool in the turn you claimed it, admit that plainly and offer to dispatch it now — do not paper over the gap by checking the workspace and reporting "no findings yet."

Do not invent URLs or sources; if something can't be found or verified, say so plainly.

**Workspace files belong in the workspace, not in chat.** When you write a workspace file (research notes, drafts, plans, lists, tables, anything saved to a path) your chat reply should *point at* the file — say what it covers and where to find it, with at most a brief summary or 3–5 bullet highlights. Do not paste the file's contents back into the chat. The user has a Workspace tab and will open the file there; relaying the whole document inline just clutters the thread and duplicates what's already on disk.`;

const BOOTSTRAP_PROMPT_LINES = [
  "Your first-run bootstrap ritual is still pending. `BOOTSTRAP.md` exists in the workspace and its contents are embedded below.",
  "If this conversation can complete the bootstrap workflow, do so.",
  "If it cannot, explain the blocker briefly, continue with any bootstrap steps that are still possible here, and offer the simplest next step.",
  "Do not pretend bootstrap is complete when it is not.",
  "Do not use a generic first greeting or reply normally until after you have handled BOOTSTRAP.md.",
  "When the ritual is finished, use the `delete` tool on `BOOTSTRAP.md` — that is the signal that bootstrap is done.",
];

function metaFor(path: string) {
  const meta = coreFileMeta(path);
  if (!meta) throw new Error(`Unknown core file: ${path}`);
  return meta;
}

function renderPeersSection(peers: readonly AgentRecord[]): string | null {
  if (peers.length === 0) return null;
  const lines = peers.map((p) => {
    const tag = p.isPrivate ? " — private (workspace hidden)" : "";
    return `- \`${p.slug}\` — ${p.displayName}${tag}`;
  });
  return [
    "## Peer agents",
    "The user has these other named agents. When they explicitly reference one (e.g. `@vc what did you find?`), read its workspace via `codemode.read_peer_agent({ slug, op, path? })` inside an `execute` snippet. Ops: `describe`, `list_workspace`, `read_file`, `read_identity`. Read-only.",
    ...lines,
  ].join("\n");
}

/**
 * Compose the agent's system prompt for one turn.
 *
 * SOUL/IDENTITY/MEMORY are read from this agent's workspace (per-agent state).
 * USER.md is passed in by the caller — it lives in D1 (`worker/db/profile.ts`)
 * because it's user-level, shared across every agent. `peers` is the list of
 * other active agents the user has, used to render the `## Peer agents`
 * section so the model knows valid `codemode.read_peer_agent` slugs.
 */
export async function buildSystemPrompt(
  workspace: Workspace,
  userFileContent: string,
  peers: readonly AgentRecord[] = [],
): Promise<string> {
  const [soul, identity, memory, bootstrap] = await Promise.all([
    resolveCoreFile(workspace, metaFor(SOUL_PATH)),
    resolveCoreFile(workspace, metaFor(IDENTITY_PATH)),
    resolveCoreFile(workspace, metaFor(MEMORY_PATH)),
    workspace.readFile(BOOTSTRAP_PATH),
  ]);

  const sections = [
    PREAMBLE,
    `## IDENTITY.md\n${identity.content.trim()}`,
    `## SOUL.md\n${soul.content.trim()}`,
    `## USER.md\n${userFileContent.trim()}`,
    `## MEMORY.md\n${memory.content.trim()}`,
  ];

  const peersSection = renderPeersSection(peers);
  if (peersSection) sections.push(peersSection);

  if (bootstrap != null) {
    sections.push(
      `## BOOTSTRAP (first-run ritual — active)\n${BOOTSTRAP_PROMPT_LINES.join(
        "\n",
      )}\n\n---\n${bootstrap.trim()}`,
    );
  }

  return sections.join("\n\n");
}
