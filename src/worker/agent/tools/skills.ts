import type { Workspace } from "@cloudflare/shell";
import { tool } from "ai";
import { z } from "zod";

import { composeSkillFile } from "../skills/frontmatter";
import {
  listSkillFiles,
  listSkills,
  readSkill,
  readSkillWithReferences,
} from "../skills/loader";
import {
  SkillNameSchema,
  SkillFrontmatterSchema,
  skillDirPath,
  skillFilePath,
} from "../skills/types";

const SKILL_BODY_MAX_BYTES = 256_000;
const SKILL_BODY_SOFT_LINE_LIMIT = 500;

type Args = {
  /** Lazy accessor so each tool call sees the current `this.workspace`. */
  getWorkspace: () => Workspace;
};

// The authoring rules embedded in `create_skill` / `update_skill`. Adapted
// from Anthropic's skill-creator best-practices spec
// (https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices).
// Lives in tool descriptions (not the system prompt) so it only costs tokens
// when the model is actually creating a skill.
const AUTHORING_GUIDE = `
Authoring rules:
- Naming: lowercase, hyphens, gerund form preferred ('processing-pdfs', 'analyzing-spreadsheets'). Cannot contain 'anthropic' or 'claude'.
- Description (1-3 sentences, ≤1024 chars, third-person): include both *what* it does AND *when* to use it (specific triggers/contexts). The model only sees this in the catalog when deciding whether to load — be specific, not vague. Good: "Processes Excel files and generates pivot tables. Use when analyzing .xlsx files or tabular data." Bad: "Helps with documents."
- Body: Claude is already smart. Only add context Claude doesn't already have — challenge each paragraph: does it justify its tokens? Keep under ${String(SKILL_BODY_SOFT_LINE_LIMIT)} lines.
- If approaching that limit, split into companion files at 'skills/<name>/reference/foo.md' (markdown reference) or 'skills/<name>/scripts/foo.py' (executable utility), then link from SKILL.md with relative paths like '[forms guide](reference/forms.md)'. Keep links one level deep — don't nest references.
- Prefer imperative form ('Use X', 'Run Y'). Avoid ALL-CAPS 'ALWAYS'/'NEVER' and rigid scolding — explain reasoning instead.
- Use forward slashes in paths. Use one term per concept (don't mix 'field' / 'box' / 'control').
- Don't include time-sensitive info ('after August 2025...'). Don't list dependencies you didn't verify exist.

Companion files (reference/*.md, scripts/*) are written via the standard 'write' tool, then surfaced via 'list_skill_files' or 'read_skill({ includeReferences: true })'.
`.trim();

// ── codemode (read-side) ──────────────────────────────────────────────────

export function createListSkillsTool(args: Args) {
  return tool({
    description:
      "List the current agent's skills. Returns one entry per skill with name, description, hidden flag, and SKILL.md path. Use this before `create_skill` to check for collisions, or before `read_skill` to find a name. The same catalog is also rendered into the system prompt at the start of every turn.",
    inputSchema: z.object({}),
    execute: async () => {
      const entries = await listSkills(args.getWorkspace());
      return { skills: entries };
    },
  });
}

const readSkillInput = z.object({
  name: SkillNameSchema.describe("The skill's slug (the directory name)."),
  includeReferences: z
    .boolean()
    .optional()
    .describe(
      "Default false. When true, also load any one-level-deep `[label](reference/foo.md)` companion files referenced from the body, returned as a `references` array. Use when the SKILL.md points at reference files you'll need.",
    ),
});

export function createReadSkillTool(args: Args) {
  return tool({
    description:
      "Read a single skill's full body, with frontmatter parsed. Pass `includeReferences: true` to also load any one-level-deep companion files (e.g. `reference/forms.md`) the body links to — useful when the skill uses progressive disclosure. Use inside an `execute` snippet with `Promise.all` to read multiple skills in parallel when triaging which one fits the request. Returns `{ name, description, hidden, body, references?, missingReferences? }` or `{ error }`.",
    inputSchema: readSkillInput,
    execute: async ({ name, includeReferences }) => {
      if (includeReferences === true) {
        const parsed = await readSkillWithReferences(args.getWorkspace(), name);
        if (!parsed) return { error: `Unknown or unparseable skill: ${name}` };
        return {
          name: parsed.frontmatter.name,
          description: parsed.frontmatter.description,
          hidden: parsed.frontmatter.hidden,
          body: parsed.body,
          references: parsed.references,
          missingReferences: parsed.missingReferences,
        };
      }
      const parsed = await readSkill(args.getWorkspace(), name);
      if (!parsed) return { error: `Unknown or unparseable skill: ${name}` };
      return {
        name: parsed.frontmatter.name,
        description: parsed.frontmatter.description,
        hidden: parsed.frontmatter.hidden,
        body: parsed.body,
      };
    },
  });
}

const listSkillFilesInput = z.object({
  name: SkillNameSchema.describe("The skill's slug (the directory name)."),
});

export function createListSkillFilesTool(args: Args) {
  return tool({
    description:
      "List every file under `skills/<name>/` — SKILL.md plus any companion files. Companion-file convention: markdown references at `reference/*.md`, executable utilities at `scripts/*`. Use to discover what a skill bundles before reading, or before adding new companion files (avoid name collisions).",
    inputSchema: listSkillFilesInput,
    execute: async ({ name }) => {
      const files = await listSkillFiles(args.getWorkspace(), name);
      if (files.length === 0) return { error: `Unknown skill: ${name}` };
      return { files };
    },
  });
}

// ── top-level (write-side) ────────────────────────────────────────────────

const createSkillInput = z.object({
  name: SkillNameSchema,
  description: z
    .string()
    .min(1)
    .max(1024)
    .describe(
      "1-3 sentences, third person, ≤1024 chars. Include both *what* the skill does AND *when* to use it (specific triggers/contexts). Example: 'Processes PDF files and extracts text or fills forms. Use when working with PDFs or when the user mentions forms, extraction, or document parsing.'",
    ),
  body: z
    .string()
    .min(1)
    .describe(
      `The full SKILL.md body in markdown. Frontmatter is added automatically; do not include '---' blocks. Keep under ${String(SKILL_BODY_SOFT_LINE_LIMIT)} lines — split longer content into companion files at 'skills/<name>/reference/*.md' (write via the 'write' tool) and link with relative paths.`,
    ),
  hidden: z
    .boolean()
    .optional()
    .describe(
      "Default false. When true, the skill is omitted from the prompt catalog (saves tokens) but still readable / editable.",
    ),
});

export function createCreateSkillTool(args: Args) {
  return tool({
    description: `Create a new skill at 'skills/<name>/SKILL.md'. Use when the user asks to remember a way of doing something or codify a reusable procedure.

Before calling, scan the '## Skills' catalog already in your system prompt. If the chosen name (or a near-synonym) is already listed there, call 'update_skill' directly — don't probe with 'create_skill' to discover the conflict via its error path. This tool is for genuinely new entries.

${AUTHORING_GUIDE}`,
    inputSchema: createSkillInput,
    execute: async ({ name, description, body, hidden }) => {
      if (new TextEncoder().encode(body).byteLength > SKILL_BODY_MAX_BYTES) {
        return {
          error: `Body exceeds ${String(SKILL_BODY_MAX_BYTES)} bytes.`,
        };
      }
      const workspace = args.getWorkspace();
      const path = skillFilePath(name);
      const existing = await workspace.readFile(path).catch(() => null);
      if (existing != null) {
        return {
          error: `Skill ${name} already exists. Use update_skill to modify it.`,
        };
      }
      const file = composeSkillFile(
        SkillFrontmatterSchema.parse({
          name,
          description,
          hidden: hidden ?? false,
        }),
        body,
      );
      await workspace.writeFile(path, file);
      const result: {
        created: true;
        name: string;
        path: string;
        warning?: string;
      } = { created: true, name, path };
      const warning = bodyLengthWarning(body);
      if (warning) result.warning = warning;
      return result;
    },
  });
}

const updateSkillInput = z.object({
  name: SkillNameSchema,
  description: z.string().min(1).max(1024).optional(),
  body: z.string().min(1).optional(),
  hidden: z.boolean().optional(),
});

export function createUpdateSkillTool(args: Args) {
  return tool({
    description: `Update an existing skill. Pass only the fields you want to change — the rest are preserved. Errors if the skill doesn't exist (use 'create_skill'). Returns the list of fields that actually changed.

${AUTHORING_GUIDE}`,
    inputSchema: updateSkillInput,
    execute: async ({ name, description, body, hidden }) => {
      const workspace = args.getWorkspace();
      const current = await readSkill(workspace, name);
      if (!current) {
        return {
          error: `Unknown skill: ${name}. Use create_skill to make a new one.`,
        };
      }
      if (
        body != null &&
        new TextEncoder().encode(body).byteLength > SKILL_BODY_MAX_BYTES
      ) {
        return {
          error: `Body exceeds ${String(SKILL_BODY_MAX_BYTES)} bytes.`,
        };
      }

      const changedFields: string[] = [];
      const nextDescription = description ?? current.frontmatter.description;
      if (
        description != null &&
        description !== current.frontmatter.description
      ) {
        changedFields.push("description");
      }
      const nextHidden = hidden ?? current.frontmatter.hidden;
      if (hidden != null && hidden !== current.frontmatter.hidden) {
        changedFields.push("hidden");
      }
      const nextBody = body ?? current.body;
      if (body != null && body !== current.body) {
        changedFields.push("body");
      }

      if (changedFields.length === 0) {
        return { updated: false, name, changedFields };
      }

      const file = composeSkillFile(
        SkillFrontmatterSchema.parse({
          name,
          description: nextDescription,
          hidden: nextHidden,
        }),
        nextBody,
      );
      const path = skillFilePath(name);
      await workspace.writeFile(path, file);
      const result: {
        updated: true;
        name: string;
        path: string;
        changedFields: string[];
        warning?: string;
      } = { updated: true, name, path, changedFields };
      if (body != null) {
        const warning = bodyLengthWarning(nextBody);
        if (warning) result.warning = warning;
      }
      return result;
    },
  });
}

const deleteSkillInput = z.object({ name: SkillNameSchema });

export function createDeleteSkillTool(args: Args) {
  return tool({
    description:
      "Delete a skill and any companion files under `skills/<name>/`. Use when the user asks to remove a skill or when a skill has been superseded.",
    inputSchema: deleteSkillInput,
    execute: async ({ name }) => {
      const workspace = args.getWorkspace();
      const dir = skillDirPath(name);
      // Recursive delete: walk the directory, deleteFile each entry.
      const entries = await workspace.readDir(dir).catch(() => []);
      if (entries.length === 0) {
        return { error: `Unknown skill: ${name}` };
      }
      let removed = 0;
      const walk = async (currentDir: string): Promise<void> => {
        const list = await workspace.readDir(currentDir).catch(() => []);
        for (const entry of list) {
          if (entry.type === "directory") {
            await walk(entry.path);
          } else {
            const ok = await workspace
              .deleteFile(entry.path)
              .catch(() => false);
            if (ok) removed += 1;
          }
        }
      };
      await walk(dir);
      return { deleted: true, name, removed };
    },
  });
}

/**
 * Soft-warn (not reject) when a skill body crosses the Anthropic-recommended
 * 500-line threshold. Returned as a `warning` field on the tool result so the
 * agent sees it after the write succeeds. The reject threshold remains
 * `SKILL_BODY_MAX_BYTES` (256KB) — this is a nudge, not a limit.
 */
function bodyLengthWarning(body: string): string | undefined {
  const lines = body.split("\n").length;
  if (lines <= SKILL_BODY_SOFT_LINE_LIMIT) return undefined;
  return `SKILL.md body is ${String(lines)} lines. Anthropic recommends keeping it under ${String(SKILL_BODY_SOFT_LINE_LIMIT)}. Consider splitting into 'skills/<name>/reference/*.md' files and linking from SKILL.md (one level deep).`;
}
