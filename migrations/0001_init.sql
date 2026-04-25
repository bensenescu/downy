-- Agent registry. One row per named agent. The slug is the DO name; workspace
-- files in R2 are namespaced by it via `Workspace({ name: () => this.name })`.
-- archived_at = NULL means the agent is active. Archive instead of delete so
-- users don't lose data if they change their mind.
CREATE TABLE agents (
  slug         TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  is_private   INTEGER NOT NULL DEFAULT 0,
  archived_at  INTEGER,
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_agents_active ON agents (archived_at);

-- User-level key/value store. Currently holds:
--   key='user_file' -> shared USER.md content (one human, all agents).
-- Future user-level settings (e.g. server-synced theme) live here too.
CREATE TABLE user_profile_kv (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
