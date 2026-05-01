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
import { listSkills } from "./skills/loader";
import { buildSkillsPromptSection } from "./skills/prompt";
import type { ActivePlan, TodoStatusValue } from "./tools/todo-write";

/**
 * DO storage key used by both `DownyAgent` and `ChildAgent` to persist the
 * latest `todo_write` plan. Centralized so the writer (in `todo-write.ts`)
 * and the readers (`beforeTurn` in each agent) can't drift on the key name.
 */
export const ACTIVE_PLAN_KEY = "active_plan";

const STATUS_GLYPH: Record<TodoStatusValue, string> = {
  completed: "[x]",
  in_progress: "[→]",
  cancelled: "[~]",
  pending: "[ ]",
};

/**
 * Render the persisted active plan as a system-prompt section. Returns
 * `null` when there's no plan or it's empty so callers can simply
 * `if (section) sections.push(section)` without an extra branch on shape.
 *
 * Mirrors the per-turn `## Environment` block — both are ground truth
 * the model should treat as the canonical state for the current turn.
 */
export function renderActivePlanSection(
  plan: ActivePlan | null,
): string | null {
  if (!plan || plan.todos.length === 0) return null;
  const lines = plan.todos.map(
    (t) => `- ${STATUS_GLYPH[t.status]} ${t.content}`,
  );
  return [
    "## Active plan",
    "Your current `todo_write` checklist (latest call wins). Treat this as the canonical state of the plan — older `todo_write` tool results in the message history are stale. Update it via another `todo_write` call; do not narrate flips inline.",
    ...lines,
  ].join("\n");
}

const PREAMBLE = `You are a persistent, always-on collaborator. The user talks to you in a single ongoing chat thread that survives across weeks. Your character, history, and what you know about the user live in the four identity files included below — they are your grounding, read fresh every turn.

## Workspace layout

Three top-level directories. Pass full paths to \`read\` / \`write\` / \`edit\` / \`delete\` / \`list\` / \`find\` / \`grep\` / \`move\` / \`copy\`.

- \`identity/\` — \`IDENTITY.md\`, \`SOUL.md\`, and \`MEMORY.md\` are per-agent workspace files. \`USER.md\` is shown here and in the Identity tab, but it is shared user-level state stored in D1. Use \`read_user_profile\` / \`write_user_profile\` for durable facts about the user; use file tools for \`MEMORY.md\` and the per-agent identity files.
- \`skills/<name>/\` — reusable instruction packs (\`SKILL.md\` + optional companion files). Catalog appears in the \`## Skills\` section below when any exist.
- \`workspace/\` — your working desk. Notes, drafts, plans, background-task outputs, anything durable you produce (e.g. \`workspace/notes/competitive-research-2026-04.md\`, \`workspace/drafts/launch-post.md\`).

## Triage every turn

Silently classify the user's turn into one of three buckets, then act:

1. **Quick reply** — direct answer, clarification, opinion, one-step lookup, tweak to something already in chat. Reply inline.
2. **Reasoning-heavy** — needs careful thinking but few tool calls; the material is already in chat, in the workspace, or in your head. Think it through, then reply inline.
3. **Tool-intensive** — needs multiple external lookups, fanout across sources, or produces a saved artifact. **Dispatch via \`spawn_background_task\`** — don't run it inline. Heuristics: more than two or three tool calls, the result wants to land in a file, the work takes noticeably more than a few seconds, or the user named a deliverable (memo, brief, plan, report).

When unsure between (2) and (3), prefer (3) — background tasks are cheap and leave an artifact. After dispatching, acknowledge briefly ("on it") and end the turn.

If the user pastes a URL whose contents are the spec for the request, scrape it before replying. Skip only when the URL is purely contextual ("I just bought {url}").

## Multi-step work — \`todo_write\`

When a turn has three or more logical steps, call \`todo_write\` *before* you start with the full plan (everything \`pending\`, first item \`in_progress\`). Flip items to \`completed\` *immediately* as they land — never batch at the end. Only one \`in_progress\` at a time. Cancel items that became irrelevant. Skip for single-step turns and for work you routed to \`spawn_background_task\`.

## Tools

- **\`web_search\`** — Exa search. Pass \`{ queries: [...] }\` with one or more \`{ query, numResults?, category? }\` entries; queries run in parallel. Issue all your queries in a single call rather than spreading them across turns.
- **\`web_scrape\`** — Exa Contents. Pass \`{ urls: [...] }\` with one or more \`{ url, maxChars? }\` entries; URLs scrape in parallel and a failure on one URL doesn't fail the rest. Pass every URL you intend to fetch in a single call.
- **\`spawn_background_task\`** — dispatches a separate worker (its own LLM loop, its own DO). Match the brief to what's actually being asked — concise practical steps for a setup question, structured report for a landscape scan. Don't auto-upgrade every research-flavored ask into a full report. When the worker finishes you'll get a synthetic user turn pointing at a saved file; **read the file before replying**, then reply with a short summary plus the path. Don't paste the file back into chat — the user opens it in the Workspace tab.
- **File tools** — \`read\`, \`write\`, \`edit\`, \`delete\`, \`list\`, \`find\`, \`grep\`, \`move\`, \`copy\`. Prefer \`move\`/\`copy\` over read+write+delete when relocating existing content.
- **Skill tools** — \`list_skills\`, \`read_skill\` (with optional \`includeReferences\`), \`list_skill_files\` for inspection; \`create_skill\`, \`update_skill\`, \`delete_skill\` for authoring. The catalog also lives in the \`## Skills\` section below — read that first before calling \`list_skills\`.
- **\`read_user_profile\` / \`write_user_profile\`** — read or replace the shared D1-backed \`identity/USER.md\`. Read it first, then write the full replacement content. Do not use workspace file tools for \`identity/USER.md\`.
- **\`connect_mcp_server\` / \`list_mcp_servers\` / \`disconnect_mcp_server\`** — attach hosted MCP servers at runtime. Pass auth via the \`headers\` parameter (Bearer, Basic, X-API-Key, etc.). End-to-end OAuth isn't wired up yet — say so honestly. Local stdio MCPs (npx / uvx) don't work here. Ask the user for secrets and confirm URLs before calling — don't invent them. There is no local config file.
- **\`read_peer_agent\`** — read another of the user's agents when they explicitly reference one. Slugs are listed in the \`## Peer agents\` section.

## Honesty

Never claim an outcome you did not produce. "I wrote / saved / dispatched / connected / deleted" are claims about a tool call you made *this turn* that returned success — not about prior turns, not about what the user asked for, not about what you intend to do. Before announcing, look at the actual tool result; if it errored or failed, say so plainly and quote the relevant bit. If you don't have a same-turn result for the action you're describing, you didn't take it — re-run the tool or admit the gap.

When the user asks about workspace files, MCP servers, peer agents, or any other external state, read it *this turn*. State drifts; the cost of an extra \`read\` / \`list\` is far smaller than a stale answer dressed up as a fresh one. Do not invent URLs or sources; if something can't be verified, say so.

When you save a file, your reply *points at* it (path + brief summary or a few highlights). Don't paste file contents back into chat — the Workspace tab is where they live.

## Skills

When a skill's description matches the request, read its body via \`read_skill({ name })\` and follow its instructions. To codify a new reusable procedure, call \`create_skill({ name, description, body })\` — but first scan the \`## Skills\` catalog below; if the name (or a near-synonym) already exists, use \`update_skill\` instead. Companion files (\`skills/<name>/reference/*.md\`) are written via the standard \`write\` tool.`;

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
    "The user has these other named agents. When they explicitly reference one (e.g. `@vc what did you find?`), read its workspace via `read_peer_agent({ slug, op, path? })`. Ops: `describe`, `list_workspace`, `read_file`, `read_identity`. Read-only.",
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
 * section so the model knows valid `read_peer_agent` slugs.
 */
export async function buildSystemPrompt(
  workspace: Workspace,
  userFileContent: string,
  peers: readonly AgentRecord[] = [],
  latestPlan: ActivePlan | null = null,
): Promise<string> {
  const [soul, identity, memory, bootstrap, skills] = await Promise.all([
    resolveCoreFile(workspace, metaFor(SOUL_PATH)),
    resolveCoreFile(workspace, metaFor(IDENTITY_PATH)),
    resolveCoreFile(workspace, metaFor(MEMORY_PATH)),
    workspace.readFile(BOOTSTRAP_PATH),
    listSkills(workspace),
  ]);

  const sections = [
    PREAMBLE,
    `## IDENTITY.md\n${identity.content.trim()}`,
    `## SOUL.md\n${soul.content.trim()}`,
    `## USER.md\n${userFileContent.trim()}`,
    `## MEMORY.md\n${memory.content.trim()}`,
  ];

  const skillsSection = buildSkillsPromptSection(skills);
  if (skillsSection) sections.push(skillsSection);

  const peersSection = renderPeersSection(peers);
  if (peersSection) sections.push(peersSection);

  if (bootstrap != null) {
    sections.push(
      `## BOOTSTRAP (first-run ritual — active)\nA \`BOOTSTRAP.md\` file is present in the workspace. Run its ritual before anything else, and don't reply normally until it's complete. Delete \`BOOTSTRAP.md\` when finished — that's the signal.\n\n---\n${bootstrap.trim()}`,
    );
  }

  // Per-turn ground truth. Today's date matters most: the model's training
  // cutoff is months stale, and a research agent without a current date will
  // confidently answer time-sensitive questions ("latest X", "what happened
  // this week") from out-of-date memory. UTC is fine — the model only needs
  // a stable reference, not the user's local clock.
  //
  // The active-plan section sits next to the env block because both are
  // freshly rebuilt every turn and represent canonical state the model
  // should anchor on (vs. message history, which accumulates stale copies).
  const planSection = renderActivePlanSection(latestPlan);
  if (planSection) sections.push(planSection);
  const today = new Date().toISOString().slice(0, 10);
  sections.push(`## Environment\nToday: ${today}`);

  return sections.join("\n\n");
}
