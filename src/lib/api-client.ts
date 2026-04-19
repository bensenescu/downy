import type { z } from "zod";

import {
  type CoreFileRecord,
  ListCoreFilesResponseSchema,
  ListWorkspaceFilesResponseSchema,
  OkResponseSchema,
  ReadCoreFileResponseSchema,
  ReadWorkspaceFileResponseSchema,
  type WorkspaceFile,
} from "./api-schemas";

// `WorkspaceFile` is re-exported for route components; `CoreFileRecord` is
// already re-exported from `worker/agent/core-files` so consumers get it there.
export type { WorkspaceFile };

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

export async function listCoreFiles(): Promise<CoreFileRecord[]> {
  const data = await request("/api/files/core", ListCoreFilesResponseSchema);
  return data.files;
}

export async function readCoreFile(path: string): Promise<CoreFileRecord> {
  const data = await request(
    `/api/files/core/${encodePath(path)}`,
    ReadCoreFileResponseSchema,
  );
  return data.file;
}

export async function writeCoreFile(
  path: string,
  content: string,
): Promise<void> {
  await request(`/api/files/core/${encodePath(path)}`, OkResponseSchema, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  });
}

export async function listWorkspaceFiles(): Promise<
  z.infer<typeof ListWorkspaceFilesResponseSchema>["files"]
> {
  const data = await request(
    "/api/files/workspace",
    ListWorkspaceFilesResponseSchema,
  );
  return data.files;
}

export async function readWorkspaceFile(
  path: string,
): Promise<WorkspaceFile | null> {
  const data = await requestMaybe(
    `/api/files/workspace/${encodePath(path)}`,
    ReadWorkspaceFileResponseSchema,
  );
  return data ? data.file : null;
}

export async function writeWorkspaceFile(
  path: string,
  content: string,
): Promise<void> {
  await request(`/api/files/workspace/${encodePath(path)}`, OkResponseSchema, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  });
}

export async function deleteWorkspaceFile(path: string): Promise<void> {
  await request(`/api/files/workspace/${encodePath(path)}`, OkResponseSchema, {
    method: "DELETE",
  });
}
