import type { OpenClawAgent } from "../agent/OpenClawAgent";

const SINGLETON_NAME = "singleton";

export function getAgentStub(
  env: Cloudflare.Env,
): DurableObjectStub<OpenClawAgent> {
  const id = env.OpenClawAgent.idFromName(SINGLETON_NAME);
  // eslint-disable-next-line typescript/no-unsafe-type-assertion -- wrangler types the namespace non-generically; we own the binding.
  return env.OpenClawAgent.get(id) as DurableObjectStub<OpenClawAgent>;
}
