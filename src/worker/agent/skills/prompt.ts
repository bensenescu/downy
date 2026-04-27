import type { SkillEntry } from "./types";

// Budgets lifted from the original OpenClaw skills prompt:
//   maxSkillsInPrompt = 150 — number of entries before truncation kicks in.
//   maxSkillsPromptChars = 18000 — total budget for the catalog block.
// We render in three tiers: full → compact (name only) → truncated compact.
const MAX_SKILLS_IN_PROMPT = 150;
const MAX_CHARS = 18_000;

const PREAMBLE = [
  "## Skills",
  "",
  "Reusable instruction packs you've created or the user has built. Each lives at `skills/<name>/SKILL.md` in this workspace. When a skill's description matches the request, read its file via the workspace `read_file` tool (or `codemode.read_skill({ name })` for parsed output) and follow its instructions.",
  "",
].join("\n");

const COMPACT_NOTE =
  "Catalog using compact format — descriptions omitted to fit budget. Read `skills/<name>/SKILL.md` to learn what each does.";

const TRUNCATION_NOTE = (shown: number, total: number): string =>
  `Catalog truncated — showing ${String(shown)} of ${String(total)} skills.`;

function renderFull(entries: readonly SkillEntry[]): string {
  const lines = [PREAMBLE];
  for (const e of entries) {
    lines.push(`- **${e.name}** — ${e.description}`);
  }
  return lines.join("\n");
}

function renderCompact(entries: readonly SkillEntry[]): string {
  const lines = [PREAMBLE, `_${COMPACT_NOTE}_`, ""];
  for (const e of entries) {
    lines.push(`- ${e.name}`);
  }
  return lines.join("\n");
}

/**
 * Render the skills catalog section for the system prompt, applying budgets.
 *
 * Returns `null` when there are no visible skills (caller skips the section
 * entirely). Hidden skills are filtered out — they're still readable via
 * tools, but the prompt doesn't carry their tokens.
 */
export function buildSkillsPromptSection(
  entries: readonly SkillEntry[],
): string | null {
  const visible = entries.filter((e) => !e.hidden);
  if (visible.length === 0) return null;

  const byCount = visible.slice(0, MAX_SKILLS_IN_PROMPT);

  const full = renderFull(byCount);
  if (full.length <= MAX_CHARS) return full;

  const compactAll = renderCompact(byCount);
  if (compactAll.length <= MAX_CHARS) return compactAll;

  // Compact is still too long — binary-search the largest prefix that fits.
  let lo = 0;
  let hi = byCount.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (renderCompact(byCount.slice(0, mid)).length <= MAX_CHARS) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  const truncated = byCount.slice(0, lo);
  const lines = [
    PREAMBLE,
    `_${TRUNCATION_NOTE(truncated.length, visible.length)} ${COMPACT_NOTE}_`,
    "",
    ...truncated.map((e) => `- ${e.name}`),
  ];
  return lines.join("\n");
}
