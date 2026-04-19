import type { Workspace } from "@cloudflare/shell";

import {
  BOOTSTRAP_PATH,
  coreFileMeta,
  IDENTITY_PATH,
  MEMORY_PATH,
  resolveCoreFile,
  SOUL_PATH,
  USER_PATH,
} from "./core-files";

const PREAMBLE = `You are a persistent, always-on collaborator. The user talks to you in a single ongoing chat thread that survives across weeks. You have a workspace of files you can read, write, edit, search, and delete using the built-in tools.

You also have two external tools:
- **web_search** — search the open web via Exa.
- **web_scrape** — fetch a URL and extract its text.

The four files below — SOUL.md, IDENTITY.md, USER.md, MEMORY.md — are your grounding. They are read fresh on every turn, so edits the user makes in the Settings UI take effect immediately. When you learn something durable about the user, update USER.md. When you produce a research artifact or durable note, write it to a descriptive path in the workspace (e.g. \`notes/competitive-research-2026-04.md\`). Update MEMORY.md with short pointers to things you want to remember across turns.

**Never claim an outcome you did not produce.** Do not say "I've created", "I wrote", "I saved to", "I've updated", or "I've deleted" unless you actually invoked the corresponding \`write\`, \`edit\`, or \`delete\` tool in *this* turn and it returned success. If a previous turn was aborted or a tool call failed, acknowledge that and re-run the tool — don't pretend the outcome happened. If you tried and it didn't succeed, say so plainly.

When asked to do research, go deep: search, scrape, dedupe, and write a file. Respond in chat with a brief summary and a link to the file. Do not invent URLs; if a source is unavailable, say so.`;

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

export async function buildSystemPrompt(workspace: Workspace): Promise<string> {
  const [soul, identity, user, memory, bootstrap] = await Promise.all([
    resolveCoreFile(workspace, metaFor(SOUL_PATH)),
    resolveCoreFile(workspace, metaFor(IDENTITY_PATH)),
    resolveCoreFile(workspace, metaFor(USER_PATH)),
    resolveCoreFile(workspace, metaFor(MEMORY_PATH)),
    workspace.readFile(BOOTSTRAP_PATH),
  ]);

  const sections = [
    PREAMBLE,
    `## IDENTITY.md\n${identity.content.trim()}`,
    `## SOUL.md\n${soul.content.trim()}`,
    `## USER.md\n${user.content.trim()}`,
    `## MEMORY.md\n${memory.content.trim()}`,
  ];

  if (bootstrap != null) {
    sections.push(
      `## BOOTSTRAP (first-run ritual — active)\n${BOOTSTRAP_PROMPT_LINES.join(
        "\n",
      )}\n\n---\n${bootstrap.trim()}`,
    );
  }

  return sections.join("\n\n");
}
