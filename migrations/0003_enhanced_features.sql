-- Multi-session chat
CREATE TABLE sessions (
  id           TEXT PRIMARY KEY, -- UUID
  agent_slug   TEXT NOT NULL,
  title        TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  FOREIGN KEY (agent_slug) REFERENCES agents(slug)
);
CREATE INDEX idx_sessions_agent ON sessions (agent_slug);

-- AI Providers
CREATE TABLE ai_providers (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  type         TEXT NOT NULL, -- 'google', 'anthropic', 'openrouter', 'openai', 'custom'
  api_key      TEXT,
  endpoint     TEXT,
  is_default   INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);

-- Telegram Integration (stored in user_profile_kv, but we can add a table for whitelisted chats if preferred)
-- Actually, let's keep it simple and use user_profile_kv for bot_token and whitelisted_chats.
-- But we need a mapping from telegram_chat_id to agent_slug and session_id.
CREATE TABLE telegram_chats (
  telegram_chat_id TEXT PRIMARY KEY,
  agent_slug       TEXT NOT NULL,
  session_id       TEXT NOT NULL,
  FOREIGN KEY (agent_slug) REFERENCES agents(slug),
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);
