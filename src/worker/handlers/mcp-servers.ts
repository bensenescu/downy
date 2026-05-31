import { getActiveAgentStub } from "../lib/active-agent";
import { AgentSlugError } from "../lib/get-agent";

const JSON_HEADERS = { "content-type": "application/json" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export async function handleMcpServersRequest(
  request: Request,
  env: Cloudflare.Env,
): Promise<Response> {
  const url = new URL(request.url);
  // Path shape: `/api/mcp-servers` (list) or `/api/mcp-servers/{id}` (delete).
  const idFromPath = url.pathname.startsWith("/api/mcp-servers/")
    ? decodeURIComponent(url.pathname.slice("/api/mcp-servers/".length))
    : null;

  try {
    const stub = await getActiveAgentStub(request, env);

    if (request.method === "GET" && !idFromPath) {
      const servers = await stub.listMcpServers();
      return json({ servers });
    }

    if (request.method === "DELETE" && idFromPath) {
      await stub.disconnectMcpServer(idFromPath);
      return json({ ok: true });
    }

    if (request.method === "POST" && !idFromPath) {
      const body = (await request.json()) as {
        name: string;
        url: string;
        transport?: "auto" | "sse" | "streamable-http";
      };
      if (!body.name || !body.url) {
        return json({ error: "Missing name or url" }, 400);
      }
      const result = await stub.addMcpServer(body.name, body.url, {
        transport: { type: body.transport || "auto" },
      });
      // Persist it in the agent's DO storage so it reconnects on hibernate
      await stub.persistMcpServer({
        id: result.id,
        name: body.name,
        url: body.url,
        transport: body.transport || "auto",
      });
      return json({ ok: true, server: result });
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (err) {
    if (err instanceof AgentSlugError) {
      return json({ error: err.message, code: err.code }, err.status);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/mcp-servers] failed", {
      error: message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    return json({ error: message }, 500);
  }
}
