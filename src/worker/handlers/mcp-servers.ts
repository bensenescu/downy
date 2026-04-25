import { getAgentStub, slugFromRequest } from "../lib/get-agent";

const JSON_HEADERS = { "content-type": "application/json" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export async function handleMcpServersRequest(
  request: Request,
  env: Cloudflare.Env,
): Promise<Response> {
  if (request.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }
  try {
    const stub = await getAgentStub(env, slugFromRequest(request));
    const servers = await stub.listMcpServers();
    return json({ servers });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/mcp-servers] failed", {
      error: message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    return json({ error: message }, 500);
  }
}
