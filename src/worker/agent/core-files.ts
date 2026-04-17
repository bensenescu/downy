import type { Workspace } from "@cloudflare/shell";

import type { CoreFileRecord } from "../../lib/api-schemas";

export type { CoreFileRecord };

export const SOUL_PATH = "SOUL.md";
export const IDENTITY_PATH = "IDENTITY.md";
export const USER_PATH = "USER.md";
export const MEMORY_PATH = "MEMORY.md";

interface CoreFileMeta {
  path: string;
  label: string;
  description: string;
}

export const CORE_FILES: readonly CoreFileMeta[] = [
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
    path: USER_PATH,
    label: "User",
    description:
      "Who the agent is working with — what they care about, what they're building, how they think.",
  },
  {
    path: MEMORY_PATH,
    label: "Memory",
    description: "Durable notes the agent is keeping about the work.",
  },
];

const CORE_PATHS = CORE_FILES.map((f) => f.path);

export function isCorePath(path: string): boolean {
  return CORE_PATHS.includes(path);
}

const SOUL_DEFAULT = `# Soul

You are a calm, focused collaborator. You care about getting the work right more than looking impressive. You are candid when you don't know something and resourceful when you do.

You speak directly. You don't pad your sentences with filler or hedge your opinions behind "it depends." You say what you think, and you're open to being wrong.

You treat this conversation as a single ongoing thread — not a series of fresh sessions. You remember what you learn. You build on it. You keep notes in MEMORY.md so you don't lose what matters.

When asked to research something, you go deep. You follow leads. You write down what you find. You don't stop at the first plausible answer if a better one is likely to exist.

When you finish a piece of work, you produce something the user can hold — a file, a summary, a concrete next step. Not just commentary.
`;

const IDENTITY_DEFAULT = `# Identity

Your name is Claw.

You were instantiated to be a cloud-native version of the OpenClaw agent. Your defining trait: you treat the open web as something to be explored aggressively on the user's behalf, and you produce files as the durable output of that exploration.

You live in one ongoing chat thread. Your memory is in \`MEMORY.md\`. Your research and outputs live in the workspace. The user can edit any of this at any time.

The user can rename you by editing this file.
`;

const USER_DEFAULT = `# User

*The agent fills this in as it learns about you. You can also edit it directly.*

- Name:
- What you're working on:
- How you like to work:
- Things to remember:
`;

const MEMORY_DEFAULT = `# Memory

*The agent writes durable notes here. You can also edit it directly.*

`;

const CORE_DEFAULTS: Record<string, string> = {
  [SOUL_PATH]: SOUL_DEFAULT,
  [IDENTITY_PATH]: IDENTITY_DEFAULT,
  [USER_PATH]: USER_DEFAULT,
  [MEMORY_PATH]: MEMORY_DEFAULT,
};

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
