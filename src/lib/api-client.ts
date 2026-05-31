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
  SystemStatusResponseSchema,
  type SystemStatus,
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

function withHeaders(
  slug: string,
  sessionId?: string,
  init?: RequestInit,
): RequestInit {
  const merged = new Headers(init?.headers);
  merged.set("X-Agent-Slug", slug);
  if (sessionId) {
    merged.set("X-Session-Id", sessionId);
  }
  return { ...init, headers: merged };
}

async function request<S extends z.ZodType>(
  url: string,
  schema: S,
  init?: RequestInit,
): Promise<z.infer<S>> {
  const res = await fetch(url, init);
  if (!res.ok) throw await failedRequest(res);
  return schema.parse(await res.json());
}

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
    withHeaders(slug),
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
    withHeaders(slug),
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
    withHeaders(slug, undefined, {
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
    withHeaders(slug),
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
    withHeaders(slug),
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
    withHeaders(slug, undefined, {
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
    withHeaders(slug, undefined, { method: "DELETE" }),
  );
}

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
    let message = `Transcription failed (${String(res.status)})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {}
    throw new Error(message);
  }

  const data = (await res.json()) as { text: string };
  return data.text;
}

export async function startBootstrap(
  slug: string,
): Promise<{ started: boolean }> {
  return request(
    "/api/bootstrap/start",
    BootstrapStartResponseSchema,
    withHeaders(slug, undefined, { method: "POST" }),
  );
}

export async function devResetDO(slug: string): Promise<void> {
  await request(
    "/api/bootstrap/reset",
    OkResponseSchema,
    withHeaders(slug, undefined, { method: "POST" }),
  );
}

export async function listBackgroundTasks(
  slug: string,
): Promise<BackgroundTaskRecord[]> {
  const data = await request(
    "/api/background-tasks",
    ListBackgroundTasksResponseSchema,
    withHeaders(slug),
  );
  return data.backgroundTasks;
}

export async function listMcpServers(
  slug: string,
): Promise<McpServerSummary[]> {
  const data = await request(
    "/api/mcp-servers",
    ListMcpServersResponseSchema,
    withHeaders(slug),
  );
  return data.servers;
}

export async function connectMcpServer(
  slug: string,
  config: { name: string; url: string; transport?: string },
): Promise<void> {
  await request(
    "/api/mcp-servers",
    OkResponseSchema,
    withHeaders(slug, undefined, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(config),
    }),
  );
}

export async function deleteMcpServer(slug: string, id: string): Promise<void> {
  await request(
    `/api/mcp-servers/${encodeURIComponent(id)}`,
    OkResponseSchema,
    withHeaders(slug, undefined, { method: "DELETE" }),
  );
}

export async function listSkills(slug: string): Promise<SkillSummary[]> {
  const data = await request(
    "/api/skills",
    ListSkillsResponseSchema,
    withHeaders(slug),
  );
  return data.skills;
}

export async function revertLastMessage(
  slug: string,
  sessionId?: string,
): Promise<{ deletedCount: number }> {
  return request(
    "/api/messages/revert",
    RevertLastTurnResponseSchema,
    withHeaders(slug, sessionId, { method: "POST" }),
  );
}

export async function getSystemStatus(): Promise<SystemStatus> {
  return request("/api/system-status", SystemStatusResponseSchema);
}

export async function editLastMessage(
  slug: string,
  text: string,
  sessionId?: string,
): Promise<{ replaced: boolean }> {
  return request(
    "/api/messages/edit",
    EditLastMessageResponseSchema,
    withHeaders(slug, sessionId, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    }),
  );
}

// Session Management
export async function listSessions(slug: string): Promise<any[]> {
  const res = await fetch(`/api/agents/${slug}/sessions`);
  const data = await res.json();
  return (data as any).sessions;
}

export async function createSession(slug: string, title: string): Promise<any> {
  const res = await fetch(`/api/agents/${slug}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  });
  const data = await res.json();
  return (data as any).session;
}

export async function deleteSession(id: string): Promise<void> {
  await fetch(`/api/sessions/${id}`, { method: "DELETE" });
}

// Provider Management
export async function listProviders(): Promise<any[]> {
  const res = await fetch("/api/providers");
  const data = await res.json();
  return (data as any).providers;
}

export async function createProvider(provider: any): Promise<any> {
  const res = await fetch("/api/providers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(provider),
  });
  const data = await res.json();
  return (data as any).provider;
}

export async function updateProvider(id: string, provider: any): Promise<void> {
  await fetch(`/api/providers/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(provider),
  });
}

export async function deleteProvider(id: string): Promise<void> {
  await fetch(`/api/providers/${id}`, { method: "DELETE" });
}

export async function fetchProviderModels(id: string): Promise<string[]> {
  const res = await fetch(`/api/providers/${id}/fetch-models`, {
    method: "POST",
  });
  const data = await res.json();
  return (data as any).models;
}
