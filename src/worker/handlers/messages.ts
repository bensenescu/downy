import { getAgentStub, slugFromRequest } from "../lib/get-agent";

const JSON_HEADERS = { "content-type": "application/json" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export async function handleMessagesRequest(
  request: Request,
  env: Cloudflare.Env,
): Promise<Response> {
  const url = new URL(request.url);
  try {
    if (url.pathname === "/api/messages/revert") {
      if (request.method !== "POST")
        return json({ error: "Method not allowed" }, 405);
      const stub = await getAgentStub(env, slugFromRequest(request));
      const result = await stub.revertLastTurn();
      return json(result);
    }
    if (url.pathname === "/api/messages/edit") {
      if (request.method !== "POST")
        return json({ error: "Method not allowed" }, 405);
      const body: unknown = await request.json().catch(() => null);
      const text =
        body !== null &&
        typeof body === "object" &&
        "text" in body &&
        typeof body.text === "string"
          ? body.text
          : "";
      if (!text.trim()) {
        return json({ error: "Missing or empty `text`" }, 400);
      }
      const stub = await getAgentStub(env, slugFromRequest(request));
      const result = await stub.editLastUserMessage(text);
      return json(result);
    }
    return json({ error: "Not found" }, 404);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/messages] request failed", {
      method: request.method,
      path: url.pathname,
      error: message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    return json({ error: message }, 500);
  }
}
