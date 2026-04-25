import {
  CreateAgentRequestBodySchema,
  UpdateAgentRequestBodySchema,
} from "../../lib/api-schemas";
import {
  archiveAgent,
  createAgent,
  getAgent,
  listAgents,
  renameAgent,
  setAgentPrivate,
  unarchiveAgent,
} from "../db/profile";

const JSON_HEADERS = { "content-type": "application/json" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Routes:
 *   GET    /api/agents             — list active agents (?archived=1 lists archived)
 *   POST   /api/agents             — body { slug, displayName }
 *   GET    /api/agents/:slug       — single agent
 *   PATCH  /api/agents/:slug       — body { displayName?, isPrivate? }
 *   POST   /api/agents/:slug/archive
 *   POST   /api/agents/:slug/unarchive
 */
export async function handleAgentsRequest(
  request: Request,
  env: Cloudflare.Env,
): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.replace(/^\//, "").split("/");
  // ["api", "agents", slug?, action?]
  const slug = parts[2];
  const action = parts[3];

  try {
    if (slug === undefined) {
      if (request.method === "GET") {
        const includeArchived = url.searchParams.get("archived") === "1";
        const agents = await listAgents(env.DB, { includeArchived });
        return json({ agents });
      }
      if (request.method === "POST") {
        const raw: unknown = await request.json().catch(() => null);
        const parsed = CreateAgentRequestBodySchema.safeParse(raw);
        if (!parsed.success) {
          return json({ error: "Body must be { slug, displayName }" }, 400);
        }
        const agent = await createAgent(env.DB, parsed.data);
        return json({ agent }, 201);
      }
      return json({ error: "Method not allowed" }, 405);
    }

    if (action === undefined) {
      if (request.method === "GET") {
        const agent = await getAgent(env.DB, slug);
        if (!agent) return json({ error: "Not found" }, 404);
        return json({ agent });
      }
      if (request.method === "PATCH") {
        const raw: unknown = await request.json().catch(() => null);
        const parsed = UpdateAgentRequestBodySchema.safeParse(raw);
        if (!parsed.success) {
          return json(
            { error: "Body must be { displayName?, isPrivate? }" },
            400,
          );
        }
        let agent = await getAgent(env.DB, slug);
        if (!agent) return json({ error: "Not found" }, 404);
        if (parsed.data.displayName !== undefined) {
          agent = await renameAgent(env.DB, slug, parsed.data.displayName);
        }
        if (parsed.data.isPrivate !== undefined) {
          agent = await setAgentPrivate(env.DB, slug, parsed.data.isPrivate);
        }
        return json({ agent });
      }
      return json({ error: "Method not allowed" }, 405);
    }

    if (action === "archive" && request.method === "POST") {
      const agent = await archiveAgent(env.DB, slug);
      return json({ agent });
    }
    if (action === "unarchive" && request.method === "POST") {
      const agent = await unarchiveAgent(env.DB, slug);
      return json({ agent });
    }

    return json({ error: "Not found" }, 404);
  } catch (err) {
    console.error("[/api/agents] request failed", {
      method: request.method,
      path: url.pathname,
      error: errorMessage(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return json({ error: errorMessage(err) }, 500);
  }
}
