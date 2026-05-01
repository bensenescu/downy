const JSON_HEADERS = { "content-type": "application/json" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/**
 * Surface server-side configuration that the client needs to know about so it
 * can show setup nudges. EXA_API_KEY is a Worker secret — the client can't see
 * it directly, only whether it's configured. Cloudflare Access already gates
 * this route, so leaking a single boolean is fine.
 *
 * Routes:
 *   GET /api/system-status
 */
export function handleSystemStatusRequest(
  request: Request,
  env: Cloudflare.Env,
): Response {
  if (request.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }
  return json({ exaConfigured: !!env.EXA_API_KEY });
}
