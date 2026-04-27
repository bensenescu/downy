import { z } from "zod";

export const BackgroundTaskRecordSchema = z.object({
  id: z.string(),
  kind: z.string(),
  brief: z.string(),
  status: z.enum(["running", "done", "error"]),
  spawnedAt: z.number(),
  completedAt: z.number().optional(),
  artifactPath: z.string().optional(),
});
export type BackgroundTaskRecord = z.infer<typeof BackgroundTaskRecordSchema>;

// WebSocket frame type for the parent agent's side-panel — broadcast on
// dispatch (from `spawn_background_task`) and on completion (from
// `onBackgroundTaskComplete`). Namespaced to avoid colliding with the
// ai-chat / Think protocol frames on the same socket.
export const BACKGROUND_TASK_UPDATED_TYPE =
  "downy.background_task_updated" as const;
