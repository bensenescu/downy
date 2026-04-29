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
 * Read the target agent slug from the `X-Agent-Slug` request header. Falls
 * back to the default agent. Invalid slugs are rejected to defense-in-depth
 * against bad client state — slugs become R2 path components downstream, so a
 * stray `..` or `/` would corrupt the workspace namespace.
 */
export function slugFromRequest(request: Request): string {
  const raw = request.headers.get("X-Agent-Slug");
  if (!raw) return DEFAULT_AGENT_SLUG;
  if (raw === DEFAULT_AGENT_SLUG) return raw;
  if (!isValidSlug(raw)) {
    throw new Error(`Invalid agent slug: ${raw}`);
  }
  return raw;
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
 * Get a typed stub for the DownyAgent DO with the given slug. Uses
 * `getAgentByName` (not `env.DownyAgent.get(idFromName(...))`) because the
 * agent's underlying partyserver `Server` requires `.setName()` to be called
 * on the stub before `.name` is readable inside the DO. `routeAgentRequest`
 * does that for the chat path; on direct RPC entry points we have to go
 * through `getAgentByName`, which sets the name for us.
 *
 * The slug is the DO name. Workspace files in R2 are namespaced by `this.name`,
 * so each agent gets fully isolated storage automatically.
 */
export async function getAgentStub(
  env: Cloudflare.Env,
  slug: string,
): Promise<DurableObjectStub<DownyAgent>> {
  return getAgentByName(env.DownyAgent, slug);
}
