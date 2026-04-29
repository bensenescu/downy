import { WriteRequestBodySchema } from "../../lib/api-schemas";
import { isAgentManagedPath } from "../agent/core-files";
import { getActiveAgentStub } from "../lib/active-agent";
import { AgentSlugError } from "../lib/get-agent";

class WorkspacePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspacePathError";
  }
}

const JSON_HEADERS = { "content-type": "application/json" };

function json(body: unknown, status = 200): Response {
  let serialized: string;
  try {
    serialized = JSON.stringify(body);
  } catch (err) {
    console.error("[/api/files] failed to serialize response body", {
      status,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    serialized = JSON.stringify({ error: "Failed to serialize response" });
    status = 500;
  }
  return new Response(serialized, { status, headers: JSON_HEADERS });
}

/**
 * Parse and validate a JSON request body against a Zod schema. Returns
 * `{ ok: true, data }` on success or `{ ok: false, response }` where
 * `response` is a ready-to-return 400.
 */
async function parseWriteBody(
  request: Request,
): Promise<{ ok: true; content: string } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: json({ error: "Invalid JSON body" }, 400) };
  }
  const parsed = WriteRequestBodySchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: json({ error: "Missing `content` string" }, 400),
    };
  }
  return { ok: true, content: parsed.data.content };
}

async function handleCoreFiles(
  request: Request,
  env: Cloudflare.Env,
  path: string,
): Promise<Response> {
  const stub = await getActiveAgentStub(request, env);

  if (path === "") {
    if (request.method !== "GET")
      return json({ error: "Method not allowed" }, 405);
    const files = await stub.listCoreFiles();
    return json({ files });
  }

  if (request.method === "GET") {
    const file = await stub.readCoreFile(path);
    // Core files are a fixed set defined in code and always resolvable —
    // either from R2 or a bundled default. A null here means the client
    // asked for an unknown path, which is a client error, not "not found".
    if (!file) return json({ error: "Unknown core file path" }, 400);
    return json({ file });
  }

  if (request.method === "PUT") {
    const parsed = await parseWriteBody(request);
    if (!parsed.ok) return parsed.response;
    await stub.writeCoreFile(path, parsed.content);
    return json({ ok: true });
  }

  return json({ error: "Method not allowed" }, 405);
}

async function handleWorkspaceFiles(
  request: Request,
  env: Cloudflare.Env,
  path: string,
): Promise<Response> {
  const stub = await getActiveAgentStub(request, env);

  if (path === "") {
    if (request.method !== "GET")
      return json({ error: "Method not allowed" }, 405);
    const files = await stub.listWorkspaceFiles();
    return json({ files });
  }

  if (request.method === "GET") {
    const file = await stub.readWorkspaceFile(path);
    if (!file) return json({ error: "Not found" }, 404);
    return json({ file });
  }

  if (request.method === "PUT") {
    const parsed = await parseWriteBody(request);
    if (!parsed.ok) return parsed.response;
    await stub.writeWorkspaceFile(path, parsed.content);
    return json({ ok: true });
  }

  if (request.method === "DELETE") {
    await stub.deleteWorkspaceFile(path);
    return json({ ok: true });
  }

  return json({ error: "Method not allowed" }, 405);
}

function normalizeWorkspacePath(path: string): string {
  const normalized = path.replace(/\\+/g, "/").replace(/^\/+/, "");
  if (normalized === "") return "";
  const parts = normalized.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new WorkspacePathError("Invalid workspace path");
  }
  // Core and bootstrap files have their own endpoint (`/api/files/core/...`)
  // with stricter handling — reject them here so the workspace API can't be
  // used to read/write/delete them through the back door.
  if (isAgentManagedPath(normalized)) {
    throw new WorkspacePathError(
      "Use the core file API for identity and bootstrap files",
    );
  }
  return normalized;
}

export async function handleFilesRequest(
  request: Request,
  env: Cloudflare.Env,
): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.replace(/^\//, "").split("/");
  // parts: ["api", "files", "core" | "workspace", ...path]
  const kind = parts[2];

  try {
    const rawPath = parts.slice(3).map(decodeURIComponent).join("/");
    const path =
      kind === "workspace" ? normalizeWorkspacePath(rawPath) : rawPath;
    if (kind === "core") return await handleCoreFiles(request, env, path);
    if (kind === "workspace")
      return await handleWorkspaceFiles(request, env, path);
    return json({ error: "Not found" }, 404);
  } catch (err) {
    if (err instanceof AgentSlugError) {
      return json({ error: err.message, code: err.code }, err.status);
    }
    if (err instanceof WorkspacePathError) {
      return json({ error: err.message }, 400);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/files] request failed", {
      method: request.method,
      path: url.pathname,
      kind,
      error: message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    return json({ error: message }, 500);
  }
}
