import { getAgentByName } from "agents";

import type { OpenClawAgent } from "../agent/OpenClawAgent";

const SINGLETON_NAME = "singleton";

/**
 * Get a typed stub for the singleton OpenClawAgent. Uses `getAgentByName` so
 * the stub is initialized with its logical name before first access —
 * otherwise methods that touch `this.workspace` (which reads `this.name`)
 * throw the "name not set" error for any entry path other than the
 * WebSocket one set up by `routeAgentRequest`.
 */
export async function getAgentStub(
  env: Cloudflare.Env,
): Promise<DurableObjectStub<OpenClawAgent>> {
  return getAgentByName<Cloudflare.Env, OpenClawAgent>(
    env.OpenClawAgent,
    SINGLETON_NAME,
  );
}
