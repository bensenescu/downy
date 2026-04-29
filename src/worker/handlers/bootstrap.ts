import { getActiveAgentStub } from "../lib/active-agent";
import { AgentSlugError } from "../lib/get-agent";

const JSON_HEADERS = { "content-type": "application/json" };

function json(body: unknown, status = 200): Response {
  let serialized: string;
  try {
    serialized = JSON.stringify(body);
  } catch (err) {
    console.error("[/api/bootstrap] failed to serialize response body", {
      status,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    serialized = JSON.stringify({ error: "Failed to serialize response" });
    status = 500;
  }
  return new Response(serialized, { status, headers: JSON_HEADERS });
}

// Dev-only endpoints are gated on the request hostname. In production this is
// a deployed worker and the hostname won't match; in `wrangler dev` it's
// always a `localhost` variant.
function isDevHost(url: URL): boolean {
  return url.hostname === "localhost" || url.hostname.endsWith(".localhost");
}

export async function handleBootstrapRequest(
  request: Request,
  env: Cloudflare.Env,
): Promise<Response> {
  const url = new URL(request.url);
  try {
    if (url.pathname === "/api/bootstrap/start") {
      if (request.method !== "POST")
        return json({ error: "Method not allowed" }, 405);
      const stub = await getActiveAgentStub(request, env);
      const result = await stub.startBootstrapIfPending();
      return json(result);
    }
    if (url.pathname === "/api/bootstrap/reset") {
      if (!isDevHost(url)) return json({ error: "Not found" }, 404);
      if (request.method !== "POST")
        return json({ error: "Method not allowed" }, 405);
      const stub = await getActiveAgentStub(request, env);
      await stub.devReset();
      return json({ ok: true });
    }
    return json({ error: "Not found" }, 404);
  } catch (err) {
    if (err instanceof AgentSlugError) {
      return json({ error: err.message, code: err.code }, err.status);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/bootstrap] request failed", {
      method: request.method,
      path: url.pathname,
      error: message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    return json({ error: message }, 500);
  }
}
