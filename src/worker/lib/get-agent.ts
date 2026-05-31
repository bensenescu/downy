import { getAgentByName } from "agents";

import type { DownyAgent } from "../agent/DownyAgent";

const DEFAULT_AGENT_SLUG = "default";
const SLUG_REGEX = /^[a-z][a-z0-9-]{1,30}$/;
const RESERVED_SLUGS = new Set(["profile", ""]);

export function isValidSlug(slug: string): boolean {
  if (!SLUG_REGEX.test(slug)) return false;
  if (RESERVED_SLUGS.has(slug)) return false;
  if (slug.startsWith("__")) return false;
  return true;
}

/**
 * Read the target agent slug and session ID from headers.
 * Returns `slug:sessionId` or just `slug`.
 */
export function slugFromRequest(request: Request): string {
  const slug = request.headers.get("X-Agent-Slug") || DEFAULT_AGENT_SLUG;
  if (slug !== DEFAULT_AGENT_SLUG && !isValidSlug(slug)) {
    throw new Error(`Invalid agent slug: ${slug}`);
  }

  const sessionId = request.headers.get("X-Session-Id");
  if (sessionId) {
    // Basic validation for sessionId to prevent path traversal etc if used in filenames
    if (!/^[a-zA-Z0-9-]{1,64}$/.test(sessionId)) {
      throw new Error(`Invalid session ID: ${sessionId}`);
    }
    return `${slug}:${sessionId}`;
  }

  return slug;
}

type AgentSlugErrorCode = "invalid_slug" | "unknown_agent" | "archived_agent";

export class AgentSlugError extends Error {
  constructor(
    message: string,
    readonly code: AgentSlugErrorCode,
    readonly status: number,
  ) {
    super(message);
    this.name = "AgentSlugError";
  }
}

/**
 * Get a typed stub for the DownyAgent DO with the given name (slug:sessionId).
 */
export async function getAgentStub(
  env: Cloudflare.Env,
  name: string,
): Promise<DurableObjectStub<DownyAgent>> {
  return getAgentByName<Cloudflare.Env, DownyAgent>(env.DownyAgent, name);
}
