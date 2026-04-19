import { getAgentByName } from "agents";

import type { OpenClawAgent } from "../agent/OpenClawAgent";

const SINGLETON_NAME = "singleton";

/**
 * Get a typed stub for the singleton OpenClawAgent. Uses `getAgentByName`
 * (not `env.OpenClawAgent.get(idFromName(...))`) because the agent's
 * underlying partyserver `Server` requires `.setName()` to be called on the
 * stub before `.name` is readable inside the DO. `routeAgentRequest` does
 * that for the chat path; on direct RPC entry points (e.g. `/api/files/*`)
 * we have to go through `getAgentByName`, which sets the name for us.
 */
export async function getAgentStub(
  env: Cloudflare.Env,
): Promise<DurableObjectStub<OpenClawAgent>> {
  return getAgentByName(env.OpenClawAgent, SINGLETON_NAME);
}
