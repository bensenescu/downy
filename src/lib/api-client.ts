import type { FileInfo } from "@cloudflare/shell";

import type { CoreFileRecord } from "../worker/agent/core-files";

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
 * Issue an API request that is expected to succeed. Throws on any non-2xx
 * response. Use this for endpoints that are guaranteed to resolve — lists,
 * writes, and reads of resources that always exist (like core files, which
 * always resolve to either a saved version or a bundled default).
 */
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw await failedRequest(res);
  // eslint-disable-next-line typescript/no-unsafe-type-assertion -- our own API; server owns the JSON contract.
  return (await res.json()) as T;
}

/**
 * Issue an API request where a 404 is an expected "not found" answer rather
 * than an error — returns `null` in that case. Use this only for resources
 * that genuinely might not exist, like arbitrary workspace files.
 */
async function requestMaybe<T>(
  url: string,
  init?: RequestInit,
): Promise<T | null> {
  const res = await fetch(url, init);
  if (res.status === 404) return null;
  if (!res.ok) throw await failedRequest(res);
  // eslint-disable-next-line typescript/no-unsafe-type-assertion -- our own API; server owns the JSON contract.
  return (await res.json()) as T;
}

export async function listCoreFiles(): Promise<CoreFileRecord[]> {
  const data = await request<{ files: CoreFileRecord[] }>("/api/files/core");
  return data.files;
}

export async function readCoreFile(path: string): Promise<CoreFileRecord> {
  const data = await request<{ file: CoreFileRecord }>(
    `/api/files/core/${encodePath(path)}`,
  );
  return data.file;
}

export async function writeCoreFile(
  path: string,
  content: string,
): Promise<void> {
  await request<{ ok: true }>(`/api/files/core/${encodePath(path)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  });
}

export async function listWorkspaceFiles(): Promise<FileInfo[]> {
  const data = await request<{ files: FileInfo[] }>("/api/files/workspace");
  return data.files;
}

export interface WorkspaceFile {
  content: string;
  stat: FileInfo | null;
}

export async function readWorkspaceFile(
  path: string,
): Promise<WorkspaceFile | null> {
  const data = await requestMaybe<{ file: WorkspaceFile }>(
    `/api/files/workspace/${encodePath(path)}`,
  );
  return data ? data.file : null;
}

export async function writeWorkspaceFile(
  path: string,
  content: string,
): Promise<void> {
  await request<{ ok: true }>(`/api/files/workspace/${encodePath(path)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  });
}

export async function deleteWorkspaceFile(path: string): Promise<void> {
  await request<{ ok: true }>(`/api/files/workspace/${encodePath(path)}`, {
    method: "DELETE",
  });
}
