import { isValidSlug } from "../lib/get-agent";
import { USER_DEFAULT } from "../agent/core-files";

export type AgentRecord = {
  slug: string;
  displayName: string;
  isPrivate: boolean;
  archivedAt: number | null;
  createdAt: number;
};

const USER_FILE_KEY = "user_file";

type AgentRow = {
  slug: string;
  display_name: string;
  is_private: number;
  archived_at: number | null;
  created_at: number;
};

function rowToRecord(row: AgentRow): AgentRecord {
  return {
    slug: row.slug,
    displayName: row.display_name,
    isPrivate: row.is_private !== 0,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
  };
}

export async function listAgents(
  db: D1Database,
  opts?: { includeArchived?: boolean },
): Promise<AgentRecord[]> {
  const sql = opts?.includeArchived
    ? "SELECT * FROM agents ORDER BY created_at"
    : "SELECT * FROM agents WHERE archived_at IS NULL ORDER BY created_at";
  const result = await db.prepare(sql).all<AgentRow>();
  return (result.results ?? []).map(rowToRecord);
}

export async function getAgent(
  db: D1Database,
  slug: string,
): Promise<AgentRecord | null> {
  const row = await db
    .prepare("SELECT * FROM agents WHERE slug = ?")
    .bind(slug)
    .first<AgentRow>();
  return row ? rowToRecord(row) : null;
}

export async function createAgent(
  db: D1Database,
  input: { slug: string; displayName: string },
): Promise<AgentRecord> {
  if (!isValidSlug(input.slug)) {
    throw new Error(`Invalid slug: ${input.slug}`);
  }
  const trimmed = input.displayName.trim();
  if (!trimmed) throw new Error("displayName is required");
  if (trimmed.length > 64) throw new Error("displayName too long (max 64)");
  const now = Date.now();
  // INSERT … ON CONFLICT DO NOTHING + check rowsAffected so we get a clear
  // error on slug collision rather than corrupting an existing agent.
  const result = await db
    .prepare(
      "INSERT INTO agents (slug, display_name, is_private, archived_at, created_at) VALUES (?, ?, 0, NULL, ?) ON CONFLICT (slug) DO NOTHING",
    )
    .bind(input.slug, trimmed, now)
    .run();
  // D1 typings are loose here; use the meta object if present.
  const changes = result.meta?.changes ?? 0;
  if (changes === 0) {
    throw new Error(`Slug already in use: ${input.slug}`);
  }
  const created = await getAgent(db, input.slug);
  if (!created) {
    throw new Error("Failed to read back created agent");
  }
  return created;
}

export async function renameAgent(
  db: D1Database,
  slug: string,
  displayName: string,
): Promise<AgentRecord> {
  const trimmed = displayName.trim();
  if (!trimmed) throw new Error("displayName is required");
  if (trimmed.length > 64) throw new Error("displayName too long (max 64)");
  const result = await db
    .prepare("UPDATE agents SET display_name = ? WHERE slug = ?")
    .bind(trimmed, slug)
    .run();
  if ((result.meta?.changes ?? 0) === 0) {
    throw new Error(`Unknown agent: ${slug}`);
  }
  const updated = await getAgent(db, slug);
  if (!updated) throw new Error(`Unknown agent: ${slug}`);
  return updated;
}

export async function setAgentPrivate(
  db: D1Database,
  slug: string,
  isPrivate: boolean,
): Promise<AgentRecord> {
  const result = await db
    .prepare("UPDATE agents SET is_private = ? WHERE slug = ?")
    .bind(isPrivate ? 1 : 0, slug)
    .run();
  if ((result.meta?.changes ?? 0) === 0) {
    throw new Error(`Unknown agent: ${slug}`);
  }
  const updated = await getAgent(db, slug);
  if (!updated) throw new Error(`Unknown agent: ${slug}`);
  return updated;
}

export async function archiveAgent(
  db: D1Database,
  slug: string,
): Promise<AgentRecord> {
  const now = Date.now();
  const result = await db
    .prepare(
      "UPDATE agents SET archived_at = ? WHERE slug = ? AND archived_at IS NULL",
    )
    .bind(now, slug)
    .run();
  if ((result.meta?.changes ?? 0) === 0) {
    const existing = await getAgent(db, slug);
    if (!existing) throw new Error(`Unknown agent: ${slug}`);
    return existing; // already archived — no-op
  }
  const updated = await getAgent(db, slug);
  if (!updated) throw new Error(`Unknown agent: ${slug}`);
  return updated;
}

export async function unarchiveAgent(
  db: D1Database,
  slug: string,
): Promise<AgentRecord> {
  const result = await db
    .prepare("UPDATE agents SET archived_at = NULL WHERE slug = ?")
    .bind(slug)
    .run();
  if ((result.meta?.changes ?? 0) === 0) {
    throw new Error(`Unknown agent: ${slug}`);
  }
  const updated = await getAgent(db, slug);
  if (!updated) throw new Error(`Unknown agent: ${slug}`);
  return updated;
}

export async function readUserFile(
  db: D1Database,
): Promise<{ content: string; isDefault: boolean }> {
  const row = await db
    .prepare("SELECT value FROM user_profile_kv WHERE key = ?")
    .bind(USER_FILE_KEY)
    .first<{ value: string }>();
  if (row) return { content: row.value, isDefault: false };
  return { content: USER_DEFAULT, isDefault: true };
}

export async function writeUserFile(
  db: D1Database,
  content: string,
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO user_profile_kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    )
    .bind(USER_FILE_KEY, content)
    .run();
}

// ── User preferences ────────────────────────────────────────────────────────
// Stored in user_profile_kv under the `pref:` prefix. Only theme + show_thinking
// today; new preferences slot in by adding a key here. Reads coalesce into a
// single object so the client can rehydrate localStorage in one round trip.

const PREF_KEYS = [
  "theme_id",
  "color_scheme",
  "show_thinking",
  "ai_provider",
] as const;
type PrefKey = (typeof PREF_KEYS)[number];

type Preferences = Partial<Record<PrefKey, string>>;

const PREF_STORAGE_KEY = (key: PrefKey) => `pref:${key}`;

export async function readPreferences(db: D1Database): Promise<Preferences> {
  const placeholders = PREF_KEYS.map(() => "?").join(", ");
  const sql = `SELECT key, value FROM user_profile_kv WHERE key IN (${placeholders})`;
  const result = await db
    .prepare(sql)
    .bind(...PREF_KEYS.map((k) => PREF_STORAGE_KEY(k)))
    .all<{ key: string; value: string }>();
  const out: Preferences = {};
  for (const row of result.results ?? []) {
    const stripped = row.key.replace(/^pref:/, "");
    if (isPrefKey(stripped)) {
      out[stripped] = row.value;
    }
  }
  return out;
}

export async function writePreference(
  db: D1Database,
  key: PrefKey,
  value: string,
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO user_profile_kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    )
    .bind(PREF_STORAGE_KEY(key), value)
    .run();
}

export function isPrefKey(value: string): value is PrefKey {
  return (PREF_KEYS as readonly string[]).includes(value);
}

/**
 * Idempotently insert the default agent on a fresh DB. Cached in worker-global
 * memory by `ensureProfileSeeded`, so this runs at most once per worker
 * instance lifetime.
 */
export async function seedDefaultAgent(db: D1Database): Promise<void> {
  await db
    .prepare(
      "INSERT INTO agents (slug, display_name, is_private, archived_at, created_at) VALUES (?, ?, 0, NULL, ?) ON CONFLICT (slug) DO NOTHING",
    )
    .bind("default", "Default agent", Date.now())
    .run();
}
