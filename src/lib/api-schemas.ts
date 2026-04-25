import { z } from "zod";

import { BackgroundTaskRecordSchema } from "../worker/agent/background-task-types";

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

export const BootstrapStartResponseSchema = z.object({
  started: z.boolean(),
});

export type { BackgroundTaskRecord } from "../worker/agent/background-task-types";

export const ListBackgroundTasksResponseSchema = z.object({
  backgroundTasks: z.array(BackgroundTaskRecordSchema),
});

export const McpServerSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  state: z.string(),
  error: z.string().nullable(),
  toolNames: z.array(z.string()),
});
export type McpServerSummary = z.infer<typeof McpServerSummarySchema>;

export const ListMcpServersResponseSchema = z.object({
  servers: z.array(McpServerSummarySchema),
});

// ── Skills ──────────────────────────────────────────────────────────────────

export const SkillSummarySchema = z.object({
  name: z.string(),
  description: z.string(),
  hidden: z.boolean(),
  path: z.string(),
  bytes: z.number(),
  updatedAt: z.number(),
});
export type SkillSummary = z.infer<typeof SkillSummarySchema>;

export const ListSkillsResponseSchema = z.object({
  skills: z.array(SkillSummarySchema),
});

// ── Agent registry ──────────────────────────────────────────────────────────

export const AgentRecordSchema = z.object({
  slug: z.string(),
  displayName: z.string(),
  isPrivate: z.boolean(),
  archivedAt: z.number().nullable(),
  createdAt: z.number(),
});
export type AgentRecord = z.infer<typeof AgentRecordSchema>;

export const ListAgentsResponseSchema = z.object({
  agents: z.array(AgentRecordSchema),
});

export const CreateAgentRequestBodySchema = z.object({
  slug: z.string(),
  displayName: z.string(),
});

export const CreateAgentResponseSchema = z.object({
  agent: AgentRecordSchema,
});

export const UpdateAgentRequestBodySchema = z.object({
  displayName: z.string().optional(),
  isPrivate: z.boolean().optional(),
});

export const UpdateAgentResponseSchema = z.object({
  agent: AgentRecordSchema,
});

// ── Profile (USER.md) ───────────────────────────────────────────────────────

// Response shape mirrors `ReadCoreFileResponseSchema` so the Identity UI can
// render USER.md alongside SOUL/IDENTITY/MEMORY without special-casing.
export const ReadUserFileResponseSchema = z.object({
  file: CoreFileRecordSchema,
});

// ── Request bodies ──────────────────────────────────────────────────────────

export const WriteRequestBodySchema = z.object({ content: z.string() });

// ── Message mutation ────────────────────────────────────────────────────────

export const RevertLastTurnResponseSchema = z.object({
  deletedCount: z.number(),
});

export const EditLastMessageResponseSchema = z.object({
  replaced: z.boolean(),
});

export const EditLastMessageRequestBodySchema = z.object({
  text: z.string().min(1),
});
