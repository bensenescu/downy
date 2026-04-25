import type { Workspace } from "@cloudflare/shell";
import { tool } from "ai";
import { z } from "zod";

import { composeSkillFile } from "../skills/frontmatter";
import { listSkills, readSkill } from "../skills/loader";
import {
  SkillNameSchema,
  SkillFrontmatterSchema,
  skillDirPath,
  skillFilePath,
} from "../skills/types";

const SKILL_BODY_MAX_BYTES = 256_000;

type Args = {
  /** Lazy accessor so each tool call sees the current `this.workspace`. */
  getWorkspace: () => Workspace;
};

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
});

export function createReadSkillTool(args: Args) {
  return tool({
    description:
      "Read a single skill's full body, with frontmatter parsed. Use inside an `execute` snippet with `Promise.all` to read multiple skills in parallel when triaging which one fits the request. Returns `{ name, description, hidden, body }` or `{ error }`.",
    inputSchema: readSkillInput,
    execute: async ({ name }) => {
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

// ── top-level (write-side) ────────────────────────────────────────────────

const createSkillInput = z.object({
  name: SkillNameSchema,
  description: z
    .string()
    .min(1)
    .max(500)
    .describe(
      "One to three sentences. This is the only thing the model sees in the catalog when deciding whether to load the skill — make it concrete about *when* to use the skill, not what it contains.",
    ),
  body: z
    .string()
    .min(1)
    .describe(
      "The full skill body in markdown. Instructions, examples, templates — whatever the agent needs to follow this skill. Frontmatter is added automatically; do not include `---` blocks.",
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
    description:
      "Create a new skill. Validates the name slug, composes frontmatter, and writes `skills/<name>/SKILL.md`. Errors if a skill with that name already exists — call `update_skill` instead in that case. Use this when the user asks you to remember a way of doing something or codify a reusable instruction set.",
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
        SkillFrontmatterSchema.parse({ name, description, hidden: hidden ?? false }),
        body,
      );
      await workspace.writeFile(path, file);
      return { created: true, name, path };
    },
  });
}

const updateSkillInput = z.object({
  name: SkillNameSchema,
  description: z.string().min(1).max(500).optional(),
  body: z.string().min(1).optional(),
  hidden: z.boolean().optional(),
});

export function createUpdateSkillTool(args: Args) {
  return tool({
    description:
      "Update an existing skill. Pass only the fields you want to change — the rest are preserved. Errors if the skill doesn't exist (use `create_skill`). Returns the list of fields that actually changed.",
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
      if (description != null && description !== current.frontmatter.description) {
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
      return { updated: true, name, path, changedFields };
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
            const ok = await workspace.deleteFile(entry.path).catch(() => false);
            if (ok) removed += 1;
          }
        }
      };
      await walk(dir);
      return { deleted: true, name, removed };
    },
  });
}
