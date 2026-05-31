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
  "telegram_bot_token",
  "telegram_whitelist",
  "exa_api_key",
  "openrouter_api_key",
  "openrouter_model_id",
] as const;
type PrefKey = (typeof PREF_KEYS)[number];

type Preferences = Partial<Record<PrefKey, string>>;

const PREF_STORAGE_KEY = (key: PrefKey) => `pref:${key}`;

export type AiProviderRecord = {
  id: string;
  name: string;
  type: string;
  apiKey: string | null;
  endpoint: string | null;
  modelId: string | null;
  isDefault: boolean;
  createdAt: number;
};

type AiProviderRow = {
  id: string;
  name: string;
  type: string;
  api_key: string | null;
  endpoint: string | null;
  model_id: string | null;
  is_default: number;
  created_at: number;
};

function rowToAiProvider(row: AiProviderRow): AiProviderRecord {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    apiKey: row.api_key,
    endpoint: row.endpoint,
    modelId: row.model_id,
    isDefault: row.is_default !== 0,
    createdAt: row.created_at,
  };
}

export async function listAiProviders(
  db: D1Database,
): Promise<AiProviderRecord[]> {
  const result = await db
    .prepare("SELECT * FROM ai_providers ORDER BY created_at")
    .all<AiProviderRow>();
  return (result.results ?? []).map(rowToAiProvider);
}

export async function getAiProvider(
  db: D1Database,
  id: string,
): Promise<AiProviderRecord | null> {
  const row = await db
    .prepare("SELECT * FROM ai_providers WHERE id = ?")
    .bind(id)
    .first<AiProviderRow>();
  return row ? rowToAiProvider(row) : null;
}

export async function createAiProvider(
  db: D1Database,
  input: Omit<AiProviderRecord, "createdAt">,
): Promise<AiProviderRecord> {
  const now = Date.now();
  await db
    .prepare(
      "INSERT INTO ai_providers (id, name, type, api_key, endpoint, model_id, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      input.id,
      input.name,
      input.type,
      input.apiKey,
      input.endpoint,
      input.modelId,
      input.isDefault ? 1 : 0,
      now,
    )
    .run();
  return { ...input, createdAt: now };
}

export async function updateAiProvider(
  db: D1Database,
  id: string,
  input: Partial<Omit<AiProviderRecord, "id" | "createdAt">>,
): Promise<void> {
  const sets: string[] = [];
  const binds: any[] = [];
  if (input.name !== undefined) {
    sets.push("name = ?");
    binds.push(input.name);
  }
  if (input.type !== undefined) {
    sets.push("type = ?");
    binds.push(input.type);
  }
  if (input.apiKey !== undefined) {
    sets.push("api_key = ?");
    binds.push(input.apiKey);
  }
  if (input.endpoint !== undefined) {
    sets.push("endpoint = ?");
    binds.push(input.endpoint);
  }
  if (input.modelId !== undefined) {
    sets.push("model_id = ?");
    binds.push(input.modelId);
  }
  if (input.isDefault !== undefined) {
    sets.push("is_default = ?");
    binds.push(input.isDefault ? 1 : 0);
  }

  if (sets.length === 0) return;
  binds.push(id);
  await db
    .prepare(`UPDATE ai_providers SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...binds)
    .run();
}

export async function deleteAiProvider(
  db: D1Database,
  id: string,
): Promise<void> {
  await db.prepare("DELETE FROM ai_providers WHERE id = ?").bind(id).run();
}

export type SessionRecord = {
  id: string;
  agentSlug: string;
  title: string;
  createdAt: number;
};

export async function listSessions(
  db: D1Database,
  agentSlug: string,
): Promise<SessionRecord[]> {
  const result = await db
    .prepare(
      "SELECT * FROM sessions WHERE agent_slug = ? ORDER BY created_at DESC",
    )
    .bind(agentSlug)
    .all<{
      id: string;
      agent_slug: string;
      title: string;
      created_at: number;
    }>();
  return (result.results ?? []).map((row) => ({
    id: row.id,
    agentSlug: row.agent_slug,
    title: row.title,
    createdAt: row.created_at,
  }));
}

export async function createSession(
  db: D1Database,
  input: { id: string; agentSlug: string; title: string },
): Promise<SessionRecord> {
  const now = Date.now();
  await db
    .prepare(
      "INSERT INTO sessions (id, agent_slug, title, created_at) VALUES (?, ?, ?, ?)",
    )
    .bind(input.id, input.agentSlug, input.title, now)
    .run();
  return { ...input, createdAt: now };
}

export async function deleteSession(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
}

export async function getTelegramChat(
  db: D1Database,
  telegramChatId: string,
): Promise<{ agentSlug: string; sessionId: string } | null> {
  const row = await db
    .prepare(
      "SELECT agent_slug, session_id FROM telegram_chats WHERE telegram_chat_id = ?",
    )
    .bind(telegramChatId)
    .first<{ agent_slug: string; session_id: string }>();
  return row ? { agentSlug: row.agent_slug, sessionId: row.session_id } : null;
}

export async function setTelegramChat(
  db: D1Database,
  telegramChatId: string,
  agentSlug: string,
  sessionId: string,
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO telegram_chats (telegram_chat_id, agent_slug, session_id) VALUES (?, ?, ?) ON CONFLICT (telegram_chat_id) DO UPDATE SET agent_slug = excluded.agent_slug, session_id = excluded.session_id",
    )
    .bind(telegramChatId, agentSlug, sessionId)
    .run();
}

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

/**
 * Read a configuration value from D1 preferences with fallback to env var.
 * This allows users to manage API keys and other configuration from the
 * Cloudflare dashboard (as secrets) or the app's own Settings UI (as D1 prefs).
 *
 * Order of precedence:
 *   1. D1 preference (set via app Settings UI)
 *   2. Environment variable (set via `wrangler secret put` or dashboard)
 *   3. Default value
 */
export async function readConfigWithEnvFallback(
  db: D1Database,
  prefKey: PrefKey,
  env: Cloudflare.Env,
  envKey: string,
  defaultValue = "",
): Promise<string> {
  const prefs = await readPreferences(db);
  const fromPref = prefs[prefKey];
  if (fromPref) return fromPref;

  const fromEnv = (env as Record<string, string>)[envKey];
  if (fromEnv) return fromEnv;

  return defaultValue;
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
