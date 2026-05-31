import { getAgent } from "../db/profile";
import { AgentSlugError, getAgentStub, slugFromRequest } from "./get-agent";

import type { DownyAgent } from "../agent/DownyAgent";

/**
 * Validates the agent slug from the request against D1 and returns the full DO name (slug:sessionId).
 */
async function activeNameFromRequest(
  request: Request,
  db: D1Database,
): Promise<string> {
  let name: string;
  try {
    name = slugFromRequest(request);
  } catch (err) {
    throw new AgentSlugError(
      err instanceof Error ? err.message : String(err),
      "invalid_slug",
      400,
    );
  }

  const slug = name.split(":")[0];
  const agent = await getAgent(db, slug);
  if (!agent) {
    throw new AgentSlugError(`Unknown agent: ${slug}`, "unknown_agent", 404);
  }
  if (agent.archivedAt !== null) {
    throw new AgentSlugError(
      `Agent is archived: ${slug}`,
      "archived_agent",
      410,
    );
  }
  return name;
}

export async function getActiveAgentStub(
  request: Request,
  env: Cloudflare.Env,
): Promise<DurableObjectStub<DownyAgent>> {
  const name = await activeNameFromRequest(request, env.DB);
  return getAgentStub(env, name);
}
