import type { Workspace } from "@cloudflare/shell";

import { parseSkillFile, type ParsedSkillFile } from "./frontmatter";
import {
  SKILLS_DIR,
  SKILL_FILE,
  skillFilePath,
  type SkillEntry,
} from "./types";

const SKILL_GLOB = `${SKILLS_DIR}/*/${SKILL_FILE}`;

/**
 * Walk the workspace `skills/` prefix and return one entry per skill that
 * has a parseable `SKILL.md`. Malformed skills are logged and dropped — they
 * don't poison the catalog. Sorted alphabetically by name for stable
 * prompt output.
 */
export async function listSkills(workspace: Workspace): Promise<SkillEntry[]> {
  const matches = await workspace.glob(SKILL_GLOB).catch(() => []);
  const entries = await Promise.all(
    matches.map(async (info) => {
      const content = await workspace.readFile(info.path).catch(() => null);
      if (content == null) return null;
      const parsed = parseSkillFile(content);
      if (!parsed.ok) {
        console.warn("[skills] skipping malformed SKILL.md", {
          path: info.path,
          error: parsed.error,
        });
        return null;
      }
      const entry: SkillEntry = {
        name: parsed.parsed.frontmatter.name,
        description: parsed.parsed.frontmatter.description,
        hidden: parsed.parsed.frontmatter.hidden,
        path: info.path.replace(/^\/+/, ""),
        bytes: info.size,
        updatedAt: info.updatedAt,
      };
      return entry;
    }),
  );
  const filtered = entries.filter((e): e is SkillEntry => e !== null);
  // eslint-disable-next-line unicorn/no-array-sort -- `filtered` is a fresh array from filter, not a shared reference.
  filtered.sort((a, b) => a.name.localeCompare(b.name, "en"));
  return filtered;
}

/**
 * Read a single skill's parsed contents, or `null` if it doesn't exist or
 * can't be parsed. Use this in the read-skill tool — `listSkills` is for the
 * catalog and per-listing is wasteful when we only want one.
 */
export async function readSkill(
  workspace: Workspace,
  name: string,
): Promise<ParsedSkillFile | null> {
  const path = skillFilePath(name);
  const content = await workspace.readFile(path).catch(() => null);
  if (content == null) return null;
  const parsed = parseSkillFile(content);
  if (!parsed.ok) {
    console.warn("[skills] readSkill: malformed SKILL.md", {
      name,
      error: parsed.error,
    });
    return null;
  }
  return parsed.parsed;
}
