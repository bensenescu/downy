INSERT INTO agents (slug, display_name, is_private, archived_at, created_at)
VALUES ('default', 'Default agent', 0, NULL, unixepoch() * 1000)
ON CONFLICT (slug) DO NOTHING;
