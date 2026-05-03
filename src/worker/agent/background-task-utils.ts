// `kickoff` is the synthetic user turn we inject to start the bootstrap
// ritual; `backgroundTaskResult` is the synthetic user turn ChildAgent
// injects when a spawned task finishes. Neither was authored by the user, so
// `revertLastTurn` walks past them when looking for the cutoff.
export function isSyntheticUserMessage(metadata: unknown): boolean {
  if (typeof metadata !== "object" || metadata === null) return false;
  if ("kickoff" in metadata && metadata.kickoff === true) return true;
  return (
    "backgroundTaskResult" in metadata && metadata.backgroundTaskResult === true
  );
}

// Worker output starts with `slug: <kebab-slug>` on its own line so the
// parent can name the file descriptively. Pull that out and return the
// remaining body. If the header is missing or invalid, return the body
// unchanged and let the caller fall back to a generated name.
export function parseSlugHeader(text: string): { slug?: string; body: string } {
  const match = /^slug:\s*([a-z0-9][a-z0-9-]{1,60})\s*\n+/i.exec(text);
  if (!match) return { body: text };
  const slug = match[1]
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length < 3) return { body: text };
  return { slug, body: text.slice(match[0].length).trimStart() };
}
