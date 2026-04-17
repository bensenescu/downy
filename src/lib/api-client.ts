import type { FileInfo } from "@cloudflare/shell";

import type { CoreFileRecord } from "../worker/agent/core-files";

export function encodePath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

async function request<T>(
  url: string,
  init?: RequestInit & { nullable?: boolean },
): Promise<T | null> {
  const res = await fetch(url, init);
  if (init?.nullable && res.status === 404) return null;
  if (!res.ok) {
    throw new Error(
      `Request failed (${String(res.status)}): ${res.statusText}`,
    );
  }
  // eslint-disable-next-line typescript/no-unsafe-type-assertion -- our own API; server owns the JSON contract.
  return (await res.json()) as T;
}

export async function listCoreFiles(): Promise<CoreFileRecord[]> {
  const data = await request<{ files: CoreFileRecord[] }>("/api/files/core");
  return data?.files ?? [];
}

export async function readCoreFile(
  path: string,
): Promise<CoreFileRecord | null> {
  const data = await request<{ file: CoreFileRecord }>(
    `/api/files/core/${encodePath(path)}`,
    { nullable: true },
  );
  return data ? data.file : null;
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
  return data?.files ?? [];
}

export interface WorkspaceFile {
  content: string;
  stat: FileInfo | null;
}

export async function readWorkspaceFile(
  path: string,
): Promise<WorkspaceFile | null> {
  const data = await request<{ file: WorkspaceFile }>(
    `/api/files/workspace/${encodePath(path)}`,
    { nullable: true },
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
