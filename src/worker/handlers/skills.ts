import { getActiveAgentStub } from "../lib/active-agent";
import { AgentSlugError } from "../lib/get-agent";

const JSON_HEADERS = { "content-type": "application/json" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/**
 * GET /api/skills — list the calling agent's skills (one entry per
 * `skills/<name>/SKILL.md` whose frontmatter parses cleanly). The slug
 * comes from the `X-Agent-Slug` header (same as every other per-agent API).
 *
 * Read-only for v1: the model creates / updates / deletes skills via tool
 * calls. The UI editor can land later; this endpoint is just what the
 * sidebar + index page need.
 */
export async function handleSkillsRequest(
  request: Request,
  env: Cloudflare.Env,
): Promise<Response> {
  if (request.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }
  try {
    const stub = await getActiveAgentStub(request, env);
    const skills = await stub.listAgentSkills();
    return json({ skills });
  } catch (err) {
    if (err instanceof AgentSlugError) {
      return json({ error: err.message, code: err.code }, err.status);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/skills] request failed", {
      method: request.method,
      error: message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    return json({ error: message }, 500);
  }
}
