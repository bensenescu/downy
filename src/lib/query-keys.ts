/**
 * Centralized query-key factory. Components import from here so a typo or a
 * key-shape change can't drift across call sites.
 *
 * Convention: a per-agent resource is `["resource", slug]`; a single record
 * within it is `["resource", slug, id]`. Top-level resources skip the slug.
 */
export const queryKeys = {
  agents: () => ["agents"] as const,
  coreFiles: (slug: string) => ["coreFiles", slug] as const,
  coreFile: (slug: string, path: string) => ["coreFiles", slug, path] as const,
  workspaceFiles: (slug: string) => ["workspaceFiles", slug] as const,
  workspaceFile: (slug: string, path: string) =>
    ["workspaceFiles", slug, path] as const,
  skills: (slug: string) => ["skills", slug] as const,
  mcpServers: (slug: string) => ["mcpServers", slug] as const,
  backgroundTasks: (slug: string) => ["backgroundTasks", slug] as const,
  userFile: () => ["userFile"] as const,
};
