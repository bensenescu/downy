import { z } from "zod";

// `name` doubles as the directory name under `skills/`. Slug shape so it's
// safe in URLs, R2 keys, and prompt blocks; lower-case-only so case-confusion
// can't produce two different skills that R2 sees as one folder on
// case-insensitive filesystems (the workspace abstraction sits on R2 which is
// case-sensitive but client tooling isn't always).
export const SkillNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/, {
    message:
      "name must be lowercase, start with a letter, and contain only a-z, 0-9, and -",
  });

export const SkillFrontmatterSchema = z.object({
  name: SkillNameSchema,
  description: z.string().min(1).max(500),
  hidden: z.boolean().default(false),
});

export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

export type SkillEntry = {
  /** Slug — also the directory name under `skills/`. */
  name: string;
  description: string;
  /** When true, hidden from the prompt catalog but still readable / editable. */
  hidden: boolean;
  /** R2 path of the SKILL.md file (`skills/<name>/SKILL.md`). */
  path: string;
  /** Size of SKILL.md in bytes. Companion-file sizes are not counted. */
  bytes: number;
  updatedAt: number;
};

export const SKILLS_DIR = "skills";
export const SKILL_FILE = "SKILL.md";

/** True for any path under `skills/` — used to filter workspace listings. */
export function isSkillPath(path: string): boolean {
  const stripped = path.replace(/^\/+/, "");
  return stripped === SKILLS_DIR || stripped.startsWith(`${SKILLS_DIR}/`);
}

/** `skills/<name>/SKILL.md` for a given skill name. */
export function skillFilePath(name: string): string {
  return `${SKILLS_DIR}/${name}/${SKILL_FILE}`;
}

/** `skills/<name>/` prefix (used for recursive delete of companion files). */
export function skillDirPath(name: string): string {
  return `${SKILLS_DIR}/${name}/`;
}
