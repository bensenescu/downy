import { z } from "zod";

/**
 * Zod schemas for the `/api/files` transport layer.
 *
 * Both the client (`api-client.ts`) and the worker handler (`handlers/files.ts`)
 * validate against these schemas, so the wire contract is honest on both sides
 * and we no longer need `as T` casts to smuggle in trust.
 */

/**
 * Mirrors `FileInfo` from `@cloudflare/shell`. We redeclare the shape so we can
 * validate incoming JSON — the library's type is a pure compile-time declaration.
 * Not exported: only composed into list/read schemas below.
 */
const FileInfoSchema = z.object({
  path: z.string(),
  name: z.string(),
  type: z.enum(["file", "directory", "symlink"]),
  mimeType: z.string(),
  size: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
  target: z.string().optional(),
});

export const CoreFileRecordSchema = z.object({
  path: z.string(),
  label: z.string(),
  description: z.string(),
  content: z.string(),
  /** `null` means the record is still serving the code default. */
  updatedAt: z.number().nullable(),
  /** `true` when `content` came from the bundled default rather than R2. */
  isDefault: z.boolean(),
});
export type CoreFileRecord = z.infer<typeof CoreFileRecordSchema>;

export const WorkspaceFileSchema = z.object({
  content: z.string(),
  stat: FileInfoSchema.nullable(),
});
export type WorkspaceFile = z.infer<typeof WorkspaceFileSchema>;

// ── Response envelopes ──────────────────────────────────────────────────────

export const ListCoreFilesResponseSchema = z.object({
  files: z.array(CoreFileRecordSchema),
});

export const ReadCoreFileResponseSchema = z.object({
  file: CoreFileRecordSchema,
});

export const ListWorkspaceFilesResponseSchema = z.object({
  files: z.array(FileInfoSchema),
});

export const ReadWorkspaceFileResponseSchema = z.object({
  file: WorkspaceFileSchema,
});

export const OkResponseSchema = z.object({ ok: z.literal(true) });

// ── Request bodies ──────────────────────────────────────────────────────────

export const WriteRequestBodySchema = z.object({ content: z.string() });
