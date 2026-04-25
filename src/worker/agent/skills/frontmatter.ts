import { SkillFrontmatterSchema, type SkillFrontmatter } from "./types";

// Hand-rolled YAML for a fixed three-key shape (name / description / hidden).
// Adding a real YAML parser would be overkill — the schema is closed and we
// emit the file ourselves on every save, so input only ever has the three
// known shapes (string, quoted string, bool, number).

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/;

/** Strip surrounding single or double quotes if both ends match. */
function stripQuotes(raw: string): string {
  if (raw.length >= 2) {
    const first = raw[0];
    const last = raw[raw.length - 1];
    if ((first === '"' || first === "'") && first === last) {
      return raw.slice(1, -1);
    }
  }
  return raw;
}

function parseScalar(raw: string): string | boolean | number {
  const trimmed = raw.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return stripQuotes(trimmed);
}

/**
 * Extract the YAML frontmatter block at the top of a markdown string.
 * Returns `{ data: parsed-object, body: rest }` or `null` if there's no
 * `---` block at the start.
 */
function splitFrontmatter(
  source: string,
): { data: Record<string, unknown>; body: string } | null {
  const match = FRONTMATTER_RE.exec(source);
  if (!match) return null;
  const [, yaml, body] = match;
  const data: Record<string, unknown> = {};
  for (const rawLine of yaml.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    data[key] = parseScalar(value);
  }
  return { data, body: body ?? "" };
}

export type ParsedSkillFile = {
  frontmatter: SkillFrontmatter;
  body: string;
};

/**
 * Parse a SKILL.md file. Returns `{ ok: true, parsed }` on success or
 * `{ ok: false, error }` describing why parsing failed (no frontmatter,
 * schema mismatch, etc.). The loader logs and skips skills that fail.
 */
export function parseSkillFile(
  source: string,
): { ok: true; parsed: ParsedSkillFile } | { ok: false; error: string } {
  const split = splitFrontmatter(source);
  if (!split) {
    return { ok: false, error: "missing YAML frontmatter (--- block)" };
  }
  const result = SkillFrontmatterSchema.safeParse(split.data);
  if (!result.success) {
    const issue = result.error.issues[0];
    return {
      ok: false,
      error: `frontmatter: ${issue?.path.join(".") ?? "?"} — ${issue?.message ?? "invalid"}`,
    };
  }
  return {
    ok: true,
    parsed: { frontmatter: result.data, body: split.body.trimStart() },
  };
}

/**
 * Compose a SKILL.md file from frontmatter + body. We always emit the same
 * key order and quote-only-when-needed so the on-disk format stays stable
 * across writes (helpful for diffs in the UI).
 */
export function composeSkillFile(
  frontmatter: SkillFrontmatter,
  body: string,
): string {
  const lines: string[] = ["---"];
  lines.push(`name: ${yamlScalar(frontmatter.name)}`);
  lines.push(`description: ${yamlScalar(frontmatter.description)}`);
  lines.push(`hidden: ${String(frontmatter.hidden)}`);
  lines.push("---");
  lines.push("");
  const trimmed = body.replace(/^\n+/, "");
  lines.push(trimmed);
  if (!trimmed.endsWith("\n")) lines.push("");
  return lines.join("\n");
}

/**
 * Quote a scalar only if it contains characters that would confuse our
 * minimal parser: leading/trailing whitespace, a colon, a hash, a leading
 * quote, or a line break. Otherwise emit it bare.
 */
function yamlScalar(raw: string): string {
  if (raw.length === 0) return '""';
  if (/^\s|\s$|[:#\n]|^['"]/u.test(raw)) {
    return JSON.stringify(raw);
  }
  return raw;
}
