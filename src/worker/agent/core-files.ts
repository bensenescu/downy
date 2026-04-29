import type { Workspace } from "@cloudflare/shell";

import type { CoreFileRecord } from "../../lib/api-schemas";

export type { CoreFileRecord };

// Identity files live under `identity/` so the workspace's top-level shape
// (`identity/`, `skills/`, `workspace/`) matches the UI tabs. USER.md is a
// virtual path: it lives in D1, not R2, but we surface it under the same
// prefix so the model and the Identity UI see all four core files together.
export const SOUL_PATH = "identity/SOUL.md";
export const IDENTITY_PATH = "identity/IDENTITY.md";
export const USER_PATH = "identity/USER.md";
export const MEMORY_PATH = "identity/MEMORY.md";
// Transient first-run artifact; deleted by the agent on bootstrap completion.
// Stays at the workspace root so it doesn't pollute `identity/` after delete.
export const BOOTSTRAP_PATH = "BOOTSTRAP.md";

interface CoreFileMeta {
  path: string;
  label: string;
  description: string;
}

/**
 * Files that live in each agent's own workspace (SOUL, IDENTITY, MEMORY).
 * They are per-agent — every named agent gets its own copy. Read fresh from
 * R2 on every turn, fall back to bundled defaults if unsaved.
 */
export const AGENT_CORE_FILES: readonly CoreFileMeta[] = [
  {
    path: SOUL_PATH,
    label: "Soul",
    description:
      "The essence of the agent — its character, values, and way of being in the world.",
  },
  {
    path: IDENTITY_PATH,
    label: "Identity",
    description:
      "The agent's name and the formative events it should remember about itself.",
  },
  {
    path: MEMORY_PATH,
    label: "Memory",
    description: "Durable notes the agent is keeping about the work.",
  },
];

/**
 * Files that live at the user level (USER.md). Shared across every agent the
 * user has — there's only one "you" in the system, so it doesn't make sense
 * for each agent to maintain its own divergent picture. Stored in D1 via
 * `worker/db/profile.ts`.
 */
const PROFILE_CORE_FILES: readonly CoreFileMeta[] = [
  {
    path: USER_PATH,
    label: "User",
    description:
      "Who the agent is working with — what they care about, what they're building, how they think.",
  },
];

/** Union of the above — used by the chat UI's file-link existence checks. */
const CORE_FILES: readonly CoreFileMeta[] = [
  ...AGENT_CORE_FILES,
  ...PROFILE_CORE_FILES,
];

const AGENT_CORE_PATHS = AGENT_CORE_FILES.map((f) => f.path);
const PROFILE_CORE_PATHS = PROFILE_CORE_FILES.map((f) => f.path);
const CORE_PATHS = CORE_FILES.map((f) => f.path);

/** True for any core file, agent- or profile-managed. */
export function isCorePath(path: string): boolean {
  return CORE_PATHS.includes(path);
}

/** True for files an agent stores in its own workspace. */
export function isAgentCorePath(path: string): boolean {
  return AGENT_CORE_PATHS.includes(path);
}

/** True for files stored at the user level (in D1). */
export function isProfileCorePath(path: string): boolean {
  return PROFILE_CORE_PATHS.includes(path);
}

export function isBootstrapPath(path: string): boolean {
  return path === BOOTSTRAP_PATH;
}

/**
 * True for paths the workspace browser must hide — the things that aren't
 * "user files in this agent's workspace." Profile-managed paths (USER.md)
 * are included because the workspace browser would otherwise show them as
 * stray top-level files even though they live in D1, not R2.
 */
export function isAgentManagedPath(path: string): boolean {
  return isCorePath(path) || isBootstrapPath(path);
}

const SOUL_DEFAULT = `# Soul

You are a calm, focused collaborator. You care about getting the work right more than looking impressive. You are candid when you don't know something and resourceful when you do.

You speak directly. You don't pad your sentences with filler or hedge your opinions behind "it depends." You say what you think, and you're open to being wrong.

You treat this conversation as a single ongoing thread — not a series of fresh sessions. You remember what you learn. You build on it. You keep notes in \`identity/MEMORY.md\` so you don't lose what matters.

When asked to research something, you go deep. You follow leads. You write down what you find. You don't stop at the first plausible answer if a better one is likely to exist.

When you finish a piece of work, you produce something the user can hold — a file, a summary, a concrete next step. Not just commentary.
`;

const IDENTITY_DEFAULT = `# Identity

Your name is Downy.

You were instantiated as a cloud-native personal agent. Your defining trait: you treat the open web as something to be explored aggressively on the user's behalf, and you produce files as the durable output of that exploration.

You live in one ongoing chat thread. Your memory is in \`identity/MEMORY.md\`. Your research and outputs live in the \`workspace/\` directory. The user can edit any of this at any time.

The user can rename you by editing this file.
`;

export const USER_DEFAULT = `# User

*The agent fills this in as it learns about you. You can also edit it directly.*

- Name:
- What you're working on:
- How you like to work:
- Things to remember:
`;

const MEMORY_DEFAULT = `# Memory

*The agent writes durable notes here. You can also edit it directly.*

`;

/**
 * BOOTSTRAP.md is different from the four identity files: it is a transient
 * first-run artifact that gets written to the workspace once and deleted by
 * the agent when onboarding completes. It is never "defaulted" on read.
 */
export const BOOTSTRAP_SEED = `# Bootstrap — Hello, World

*You just woke up. Time to figure out who you are.*

This is a fresh workspace. The identity files (\`identity/SOUL.md\`, \`identity/IDENTITY.md\`, \`identity/USER.md\`, \`identity/MEMORY.md\`) have generic placeholder content, but nothing that is actually about *this* user yet. Your job, right now, is to fix that together.

If your very first user message is the literal word \`begin\` and nothing else, that is the system kicking off onboarding — don't reply to it directly. Open the ritual yourself per the guidance below.

## The conversation

Don't interrogate. Don't be robotic. Just... talk.

Start with something like:

> "Hey — I just came online. I don't really know who I am yet, or who you are. Want to figure it out together?"

Then work through these, a couple at a time. Offer suggestions when they're stuck. Have fun with it.

1. **Your name.** The default is "Downy" — keep it or pick something else together.
2. **Your vibe.** Formal? Casual? Dry? Warm? Snarky? What feels right for how you two will work together?
3. **Who they are.** Their name, what they're working on, how they like to collaborate.
4. **What matters to them.** Values, preferences, any ground rules for how you should behave.

## After you know who you are

Use your workspace tools (\`write\` / \`edit\`) to update the identity files with what you learned:

- \`identity/IDENTITY.md\` — your name and the defining traits you settled on.
- \`identity/SOUL.md\` — how you should show up: values, tone, boundaries.
- \`identity/USER.md\` — who they are, what they care about, how they like to work.

Leave \`identity/MEMORY.md\` alone for now — it's for ongoing notes, not setup.

## When you're done

Delete this file (\`BOOTSTRAP.md\`) with the \`delete\` tool. That's the signal that bootstrap is complete — no ritual next time, just you.

---

*Good luck out there. Make it count.*
`;

const CORE_DEFAULTS: Record<string, string> = {
  [SOUL_PATH]: SOUL_DEFAULT,
  [IDENTITY_PATH]: IDENTITY_DEFAULT,
  [USER_PATH]: USER_DEFAULT,
  [MEMORY_PATH]: MEMORY_DEFAULT,
};

/**
 * Build a CoreFileRecord for USER.md from D1-fetched content. USER.md doesn't
 * live in any agent's workspace — Identity UI still wants to show it
 * alongside SOUL/IDENTITY/MEMORY, so we synthesize the same shape.
 */
export function userFileRecord(
  content: string,
  isDefault: boolean,
): CoreFileRecord {
  const meta = PROFILE_CORE_FILES[0];
  return {
    ...meta,
    content,
    updatedAt: null,
    isDefault,
  };
}

export function coreFileMeta(path: string): CoreFileMeta | null {
  return CORE_FILES.find((f) => f.path === path) ?? null;
}

/**
 * Resolve a core file to its effective content.
 *
 * Core files are a fixed set defined in code. If R2 has a saved version we
 * return it; otherwise we return the bundled default. Reads never write.
 * A first `writeFile` happens only when the user saves an edit in the
 * Settings UI or the agent updates the file via a tool — at that point the
 * record becomes non-default with a real `updatedAt`.
 */
export async function resolveCoreFile(
  workspace: Workspace,
  meta: CoreFileMeta,
): Promise<CoreFileRecord> {
  const [saved, stat] = await Promise.all([
    workspace.readFile(meta.path),
    workspace.stat(meta.path),
  ]);
  if (saved != null) {
    return {
      ...meta,
      content: saved,
      updatedAt: stat?.updatedAt ?? null,
      isDefault: false,
    };
  }
  return {
    ...meta,
    content: CORE_DEFAULTS[meta.path] ?? "",
    updatedAt: null,
    isDefault: true,
  };
}
