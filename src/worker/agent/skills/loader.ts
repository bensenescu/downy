import type { Workspace } from "@cloudflare/shell";

import { parseSkillFile, type ParsedSkillFile } from "./frontmatter";
import {
  SKILLS_DIR,
  SKILL_FILE,
  skillDirPath,
  skillFilePath,
  type SkillEntry,
  type SkillFileEntry,
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

/**
 * Recursively walk `skills/<name>/` and return an entry per file (relative
 * path within the skill dir). Returns `[]` if the skill directory doesn't
 * exist. Used by `list_skill_files` to surface companion files (scripts/,
 * reference/) that the catalog doesn't mention.
 */
export async function listSkillFiles(
  workspace: Workspace,
  name: string,
): Promise<SkillFileEntry[]> {
  const root = skillDirPath(name).replace(/\/$/, "");
  const out: SkillFileEntry[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries = await workspace.readDir(dir).catch(() => []);
    for (const entry of entries) {
      if (entry.type === "directory") {
        await walk(entry.path);
      } else if (entry.type === "file") {
        out.push({
          path: entry.path.replace(/^\/+/, ""),
          relativePath: entry.path
            .replace(/^\/+/, "")
            .replace(new RegExp(`^${escapeRegex(root)}/`), ""),
          bytes: entry.size,
          updatedAt: entry.updatedAt,
        });
      }
    }
  };
  await walk(root);
  // eslint-disable-next-line unicorn/no-array-sort -- `out` is a local array.
  out.sort((a, b) => a.relativePath.localeCompare(b.relativePath, "en"));
  return out;
}

type SkillReference = {
  /** Path relative to the skill directory, e.g. `reference/forms.md`. */
  relativePath: string;
  /** Full workspace path, e.g. `skills/<name>/reference/forms.md`. */
  path: string;
  content: string;
};

type ParsedSkillWithReferences = ParsedSkillFile & {
  references: SkillReference[];
  /** Links the body referenced but the file didn't exist. */
  missingReferences: string[];
};

/**
 * Parse SKILL.md, then resolve **one level deep** of relative markdown links
 * to companion files inside `skills/<name>/`. Anti-pattern guard: nested
 * references aren't followed — skill authors should keep all reference links
 * in SKILL.md so the agent can see the full scope at a glance (matches
 * Anthropic's "one level deep" rule).
 *
 * Skips: external URLs, anchors, parent-escaping paths (`../`), and links
 * pointing back at SKILL.md. Missing files are reported in
 * `missingReferences` so the caller can surface broken links without throwing.
 */
export async function readSkillWithReferences(
  workspace: Workspace,
  name: string,
): Promise<ParsedSkillWithReferences | null> {
  const parsed = await readSkill(workspace, name);
  if (!parsed) return null;

  const root = skillDirPath(name).replace(/\/$/, "");
  const linkPaths = extractLocalLinkPaths(parsed.body);

  const references: SkillReference[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const rel of linkPaths) {
    if (seen.has(rel)) continue;
    seen.add(rel);
    const fullPath = `${root}/${rel}`;
    const content = await workspace.readFile(fullPath).catch(() => null);
    if (content == null) {
      missing.push(rel);
      continue;
    }
    references.push({ relativePath: rel, path: fullPath, content });
  }

  return { ...parsed, references, missingReferences: missing };
}

/**
 * Extract relative paths from markdown `[label](path)` links that look like
 * companion-file references. We deliberately keep this conservative: only
 * accept paths that don't contain `://`, don't start with `#` or `/`, and
 * don't contain `..` segments. Trailing query/fragment is stripped.
 */
function extractLocalLinkPaths(body: string): string[] {
  const out: string[] = [];
  const re = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    const raw = match[1];
    if (!raw) continue;
    if (raw.includes("://")) continue;
    if (raw.startsWith("#") || raw.startsWith("/") || raw.startsWith("mailto:"))
      continue;
    const cleaned = raw.split(/[?#]/)[0];
    if (!cleaned || cleaned === SKILL_FILE) continue;
    if (cleaned.split("/").some((seg) => seg === "..")) continue;
    out.push(cleaned);
  }
  return out;
}

function escapeRegex(s: string): string {
  return s.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
