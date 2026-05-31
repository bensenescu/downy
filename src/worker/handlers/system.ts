import { readPreferences, listAiProviders, listAgents } from "../db/profile";
import { getAgentStub } from "../lib/get-agent";

const JSON_HEADERS = { "content-type": "application/json" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/**
 * Surface server-side configuration that the client needs to know about so it
 * can show setup nudges.
 *
 * Routes:
 *   GET /api/system-status
 */
export async function handleSystemStatusRequest(
  request: Request,
  env: Cloudflare.Env,
): Promise<Response> {
  if (request.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  const [prefs, providers, agents] = await Promise.all([
    readPreferences(env.DB),
    listAiProviders(env.DB),
    listAgents(env.DB),
  ]);

  const agentStats = await Promise.all(
    agents.map(async (a) => {
      try {
        const stub = await getAgentStub(env, `${a.slug}:default`);
        return await stub.getStatus();
      } catch (err) {
        return { slug: a.slug, error: String(err) };
      }
    }),
  );

  return json({
    exaConfigured: !!env.EXA_API_KEY,
    telegramConfigured:
      !!(prefs as any).telegram_bot_token || !!(env as any).TELEGRAM_BOT_TOKEN,
    vpcTunnelConfigured: !!(env as any).PI_RELAY_VPC,
    aiProvidersCount: providers.length,
    telegramWhitelist: (prefs as any).telegram_whitelist || "",
    agentStats,
  });
}
