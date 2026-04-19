import type { OpenClawAgent } from "../agent/OpenClawAgent";

const SINGLETON_NAME = "singleton";

/**
 * Get a typed stub for the singleton OpenClawAgent. The Durable Object
 * namespace's class generic is emitted by `wrangler types` (see
 * `cf-typegen` npm script, and `predev`/`prebuild` which re-run it), so
 * `.get()` returns `DurableObjectStub<OpenClawAgent>` without a cast.
 */
export function getAgentStub(
  env: Cloudflare.Env,
): DurableObjectStub<OpenClawAgent> {
  const id = env.OpenClawAgent.idFromName(SINGLETON_NAME);
  return env.OpenClawAgent.get(id);
}
