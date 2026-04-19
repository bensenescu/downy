import { getAgentStub } from "../lib/get-agent";

const JSON_HEADERS = { "content-type": "application/json" };

function json(body: unknown, status = 200): Response {
  let serialized: string;
  try {
    serialized = JSON.stringify(body);
  } catch (err) {
    console.error("[/api/chat] failed to serialize response body", {
      status,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    serialized = JSON.stringify({ error: "Failed to serialize response" });
    status = 500;
  }
  return new Response(serialized, { status, headers: JSON_HEADERS });
}

export async function handleChatRequest(
  request: Request,
  env: Cloudflare.Env,
): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.replace(/^\//, "").split("/");
  // parts: ["api", "chat", "messages", <id>]
  const section = parts[2];

  try {
    if (section === "messages") {
      const messageId = parts[3] ? decodeURIComponent(parts[3]) : "";
      if (!messageId) return json({ error: "Missing message id" }, 400);

      if (request.method === "DELETE") {
        const stub = await getAgentStub(env);
        const result = await stub.deleteChatMessage(messageId);
        if (!result.deleted) return json({ error: "Not found" }, 404);
        return json({ ok: true });
      }
      return json({ error: "Method not allowed" }, 405);
    }

    return json({ error: "Not found" }, 404);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/chat] request failed", {
      method: request.method,
      path: url.pathname,
      error: message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    return json({ error: message }, 500);
  }
}
