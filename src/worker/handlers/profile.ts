import { WriteRequestBodySchema } from "../../lib/api-schemas";
import { userFileRecord } from "../agent/core-files";
import {
  isPrefKey,
  readPreferences,
  readUserFile,
  writePreference,
  writeUserFile,
} from "../db/profile";

const JSON_HEADERS = { "content-type": "application/json" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * USER.md is user-level state (one human → all agents share it). It lives in
 * D1 (user_profile_kv table), not in any agent's workspace. This handler is
 * the only place it can be read/written from the client.
 *
 * Routes:
 *   GET /api/profile/user-file
 *   PUT /api/profile/user-file   body { content }
 */
export async function handleProfileRequest(
  request: Request,
  env: Cloudflare.Env,
): Promise<Response> {
  const url = new URL(request.url);
  try {
    if (url.pathname === "/api/profile/user-file") {
      if (request.method === "GET") {
        const { content, isDefault } = await readUserFile(env.DB);
        return json({ file: userFileRecord(content, isDefault) });
      }
      if (request.method === "PUT") {
        const raw: unknown = await request.json().catch(() => null);
        const parsed = WriteRequestBodySchema.safeParse(raw);
        if (!parsed.success) {
          return json({ error: "Missing `content` string" }, 400);
        }
        await writeUserFile(env.DB, parsed.data.content);
        return json({ ok: true });
      }
      return json({ error: "Method not allowed" }, 405);
    }
    if (url.pathname === "/api/profile/preferences") {
      if (request.method === "GET") {
        const preferences = await readPreferences(env.DB);
        return json({ preferences });
      }
      if (request.method === "PUT") {
        const raw: unknown = await request.json().catch(() => null);
        if (
          typeof raw !== "object" ||
          raw === null ||
          !("key" in raw) ||
          !("value" in raw) ||
          typeof raw.key !== "string" ||
          typeof raw.value !== "string"
        ) {
          return json(
            { error: "Body must be { key: string, value: string }" },
            400,
          );
        }
        const { key, value } = raw;
        if (!isPrefKey(key)) {
          return json({ error: `Unknown preference key: ${key}` }, 400);
        }
        await writePreference(env.DB, key, value);
        return json({ ok: true });
      }
      return json({ error: "Method not allowed" }, 405);
    }
    return json({ error: "Not found" }, 404);
  } catch (err) {
    console.error("[/api/profile] request failed", {
      method: request.method,
      path: url.pathname,
      error: errorMessage(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return json({ error: errorMessage(err) }, 500);
  }
}
