import type { z } from "zod";

import {
  BootstrapStartResponseSchema,
  type CoreFileRecord,
  EditLastMessageResponseSchema,
  ListCoreFilesResponseSchema,
  ListBackgroundTasksResponseSchema,
  ListMcpServersResponseSchema,
  ListSkillsResponseSchema,
  ListWorkspaceFilesResponseSchema,
  OkResponseSchema,
  ReadCoreFileResponseSchema,
  ReadUserFileResponseSchema,
  ReadWorkspaceFileResponseSchema,
  RevertLastTurnResponseSchema,
  type BackgroundTaskRecord,
  type McpServerSummary,
  type SkillSummary,
  type WorkspaceFile,
} from "./api-schemas";

export function encodePath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

async function failedRequest(res: Response): Promise<Error> {
  let detail = res.statusText;
  try {
    const text = await res.text();
    if (text) detail = text;
  } catch {
    // ignore
  }
  return new Error(`Request failed (${String(res.status)}): ${detail}`);
}

/**
 * Merge the X-Agent-Slug header into init.headers, preserving any other
 * headers the caller passed (e.g. content-type for writes).
 */
function withSlugHeader(slug: string, init?: RequestInit): RequestInit {
  const merged = new Headers(init?.headers);
  merged.set("X-Agent-Slug", slug);
  return { ...init, headers: merged };
}

/**
 * Issue an API request that is expected to succeed. Throws on any non-2xx
 * response. Use this for endpoints that are guaranteed to resolve — lists,
 * writes, and reads of resources that always exist (like core files, which
 * always resolve to either a saved version or a bundled default).
 */
async function request<S extends z.ZodType>(
  url: string,
  schema: S,
  init?: RequestInit,
): Promise<z.infer<S>> {
  const res = await fetch(url, init);
  if (!res.ok) throw await failedRequest(res);
  return schema.parse(await res.json());
}

/**
 * Issue an API request where a 404 is an expected "not found" answer rather
 * than an error — returns `null` in that case. Use this only for resources
 * that genuinely might not exist, like arbitrary workspace files.
 */
async function requestMaybe<S extends z.ZodType>(
  url: string,
  schema: S,
  init?: RequestInit,
): Promise<z.infer<S> | null> {
  const res = await fetch(url, init);
  if (res.status === 404) return null;
  if (!res.ok) throw await failedRequest(res);
  return schema.parse(await res.json());
}

/**
 * Read the user-level USER.md from D1. No slug — USER.md is shared across
 * every agent the user has.
 */
export async function readUserFile(): Promise<CoreFileRecord> {
  const data = await request(
    "/api/profile/user-file",
    ReadUserFileResponseSchema,
  );
  return data.file;
}

export async function writeUserFile(content: string): Promise<void> {
  await request("/api/profile/user-file", OkResponseSchema, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  });
}

export async function listCoreFiles(slug: string): Promise<CoreFileRecord[]> {
  const data = await request(
    "/api/files/core",
    ListCoreFilesResponseSchema,
    withSlugHeader(slug),
  );
  return data.files;
}

export async function readCoreFile(
  slug: string,
  path: string,
): Promise<CoreFileRecord> {
  const data = await request(
    `/api/files/core/${encodePath(path)}`,
    ReadCoreFileResponseSchema,
    withSlugHeader(slug),
  );
  return data.file;
}

export async function writeCoreFile(
  slug: string,
  path: string,
  content: string,
): Promise<void> {
  await request(
    `/api/files/core/${encodePath(path)}`,
    OkResponseSchema,
    withSlugHeader(slug, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    }),
  );
}

export async function listWorkspaceFiles(
  slug: string,
): Promise<z.infer<typeof ListWorkspaceFilesResponseSchema>["files"]> {
  const data = await request(
    "/api/files/workspace",
    ListWorkspaceFilesResponseSchema,
    withSlugHeader(slug),
  );
  return data.files;
}

export async function readWorkspaceFile(
  slug: string,
  path: string,
): Promise<WorkspaceFile | null> {
  const data = await requestMaybe(
    `/api/files/workspace/${encodePath(path)}`,
    ReadWorkspaceFileResponseSchema,
    withSlugHeader(slug),
  );
  return data ? data.file : null;
}

export async function writeWorkspaceFile(
  slug: string,
  path: string,
  content: string,
): Promise<void> {
  await request(
    `/api/files/workspace/${encodePath(path)}`,
    OkResponseSchema,
    withSlugHeader(slug, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    }),
  );
}

export async function deleteWorkspaceFile(
  slug: string,
  path: string,
): Promise<void> {
  await request(
    `/api/files/workspace/${encodePath(path)}`,
    OkResponseSchema,
    withSlugHeader(slug, { method: "DELETE" }),
  );
}

/**
 * Upload a recorded audio blob to the Whisper-backed transcription endpoint
 * and return the transcribed text. The blob is sent as the raw request body
 * (Content-Type derived from the Blob itself, e.g. `audio/webm`).
 *
 * Transcription is user-level, not agent-scoped — no slug needed.
 */
export async function transcribeAudio(
  audio: Blob,
  options?: { language?: string },
): Promise<string> {
  const params = new URLSearchParams();
  if (options?.language) params.set("language", options.language);
  const query = params.toString();
  const url = query ? `/api/transcribe?${query}` : "/api/transcribe";

  const res = await fetch(url, {
    method: "POST",
    headers: audio.type ? { "content-type": audio.type } : undefined,
    body: audio,
  });

  if (!res.ok) {
    // Try to surface the server's error message when we can.
    let message = `Transcription failed (${String(res.status)})`;
    try {
      // eslint-disable-next-line typescript/no-unsafe-type-assertion -- our own API; server owns the JSON contract.
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // fall through to the default message
    }
    throw new Error(message);
  }

  // eslint-disable-next-line typescript/no-unsafe-type-assertion -- our own API; server owns the JSON contract.
  const data = (await res.json()) as { text: string };
  return data.text;
}

/**
 * Ask the server to kick off the bootstrap onboarding ritual. The server
 * no-ops (returns `{ started: false }`) if the chat already has messages or
 * bootstrap is already complete, so this is safe to call on every mount.
 */
export async function startBootstrap(
  slug: string,
): Promise<{ started: boolean }> {
  return request(
    "/api/bootstrap/start",
    BootstrapStartResponseSchema,
    withSlugHeader(slug, { method: "POST" }),
  );
}

/**
 * Dev-only: wipe DO messages and re-seed BOOTSTRAP.md. The server also gates
 * this endpoint on the request hostname, so it 404s in production even if the
 * client somehow ships the button.
 */
export async function devResetDO(slug: string): Promise<void> {
  await request(
    "/api/bootstrap/reset",
    OkResponseSchema,
    withSlugHeader(slug, { method: "POST" }),
  );
}

export async function listBackgroundTasks(
  slug: string,
): Promise<BackgroundTaskRecord[]> {
  const data = await request(
    "/api/background-tasks",
    ListBackgroundTasksResponseSchema,
    withSlugHeader(slug),
  );
  return data.backgroundTasks;
}

export async function listMcpServers(
  slug: string,
): Promise<McpServerSummary[]> {
  const data = await request(
    "/api/mcp-servers",
    ListMcpServersResponseSchema,
    withSlugHeader(slug),
  );
  return data.servers;
}

export async function deleteMcpServer(slug: string, id: string): Promise<void> {
  await request(
    `/api/mcp-servers/${encodeURIComponent(id)}`,
    OkResponseSchema,
    withSlugHeader(slug, { method: "DELETE" }),
  );
}

export async function listSkills(slug: string): Promise<SkillSummary[]> {
  const data = await request(
    "/api/skills",
    ListSkillsResponseSchema,
    withSlugHeader(slug),
  );
  return data.skills;
}

/**
 * Drop the last user-initiated turn (user message + every assistant/tool
 * message that followed). Side effects (file writes, MCP calls, spawned
 * tasks) are not rolled back — callers should warn the user when relevant.
 */
export async function revertLastMessage(
  slug: string,
): Promise<{ deletedCount: number }> {
  return request(
    "/api/messages/revert",
    RevertLastTurnResponseSchema,
    withSlugHeader(slug, { method: "POST" }),
  );
}

/**
 * Replace the last user message with `text` and start a fresh turn from it.
 * Same side-effect caveats as `revertLastMessage`.
 */
export async function editLastMessage(
  slug: string,
  text: string,
): Promise<{ replaced: boolean }> {
  return request(
    "/api/messages/edit",
    EditLastMessageResponseSchema,
    withSlugHeader(slug, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    }),
  );
}
