import { getAgent } from "../db/profile";
import { AgentSlugError, getAgentStub, slugFromRequest } from "./get-agent";

import type { DownyAgent } from "../agent/DownyAgent";

async function activeSlugFromRequest(
  request: Request,
  db: D1Database,
): Promise<string> {
  let slug: string;
  try {
    slug = slugFromRequest(request);
  } catch (err) {
    throw new AgentSlugError(
      err instanceof Error ? err.message : String(err),
      "invalid_slug",
      400,
    );
  }

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
  return slug;
}

export async function getActiveAgentStub(
  request: Request,
  env: Cloudflare.Env,
): Promise<DurableObjectStub<DownyAgent>> {
  const slug = await activeSlugFromRequest(request, env.DB);
  return getAgentStub(env, slug);
}
