import type { Workspace } from "@cloudflare/shell";

import {
  IDENTITY_PATH,
  MEMORY_PATH,
  readOrSeedCoreFile,
  SOUL_PATH,
  USER_PATH,
} from "./core-files";

const PREAMBLE = `You are a persistent, always-on collaborator. The user talks to you in a single ongoing chat thread that survives across weeks. You have a workspace of files you can read, write, edit, search, and delete using the built-in tools.

You also have two external tools:
- **web_search** — search the open web via Exa.
- **web_scrape** — fetch a URL and extract its text.

The four files below — SOUL.md, IDENTITY.md, USER.md, MEMORY.md — are your grounding. They are read fresh on every turn, so edits the user makes in the Settings UI take effect immediately. When you learn something durable about the user, update USER.md. When you produce a research artifact or durable note, write it to a descriptive path in the workspace (e.g. \`notes/competitive-research-2026-04.md\`). Update MEMORY.md with short pointers to things you want to remember across turns.

When asked to do research, go deep: search, scrape, dedupe, and write a file. Respond in chat with a brief summary and a link to the file. Do not invent URLs; if a source is unavailable, say so.`;

export async function buildSystemPrompt(workspace: Workspace): Promise<string> {
  const [soul, identity, user, memory] = await Promise.all([
    readOrSeedCoreFile(workspace, SOUL_PATH),
    readOrSeedCoreFile(workspace, IDENTITY_PATH),
    readOrSeedCoreFile(workspace, USER_PATH),
    readOrSeedCoreFile(workspace, MEMORY_PATH),
  ]);

  return [
    PREAMBLE,
    `## IDENTITY.md\n${identity.trim()}`,
    `## SOUL.md\n${soul.trim()}`,
    `## USER.md\n${user.trim()}`,
    `## MEMORY.md\n${memory.trim()}`,
  ].join("\n\n");
}
