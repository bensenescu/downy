import { getAgentStub } from "../lib/get-agent";

const JSON_HEADERS = { "content-type": "application/json" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function readJsonBody<T>(request: Request): Promise<T> {
  const text = await request.text();
  // eslint-disable-next-line typescript/no-unsafe-type-assertion -- internal endpoint; validated at the call site.
  return JSON.parse(text) as T;
}

interface WriteBody {
  content?: string;
}

async function handleCoreFiles(
  request: Request,
  env: Cloudflare.Env,
  path: string,
): Promise<Response> {
  const stub = getAgentStub(env);

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
    const body = await readJsonBody<WriteBody>(request);
    if (typeof body.content !== "string") {
      return json({ error: "Missing `content` string" }, 400);
    }
    await stub.writeCoreFile(path, body.content);
    return json({ ok: true });
  }

  return json({ error: "Method not allowed" }, 405);
}

async function handleWorkspaceFiles(
  request: Request,
  env: Cloudflare.Env,
  path: string,
): Promise<Response> {
  const stub = getAgentStub(env);

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
    const body = await readJsonBody<WriteBody>(request);
    if (typeof body.content !== "string") {
      return json({ error: "Missing `content` string" }, 400);
    }
    await stub.writeWorkspaceFile(path, body.content);
    return json({ ok: true });
  }

  if (request.method === "DELETE") {
    await stub.deleteWorkspaceFile(path);
    return json({ ok: true });
  }

  return json({ error: "Method not allowed" }, 405);
}

export async function handleFilesRequest(
  request: Request,
  env: Cloudflare.Env,
): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.replace(/^\//, "").split("/");
  // parts: ["api", "files", "core" | "workspace", ...path]
  const kind = parts[2];
  const path = parts.slice(3).map(decodeURIComponent).join("/");

  try {
    if (kind === "core") return await handleCoreFiles(request, env, path);
    if (kind === "workspace")
      return await handleWorkspaceFiles(request, env, path);
    return json({ error: "Not found" }, 404);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }
}
