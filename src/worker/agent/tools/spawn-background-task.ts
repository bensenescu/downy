import { getAgentByName } from "agents";
import { tool } from "ai";
import { z } from "zod";

import type { ChildAgent } from "../ChildAgent";
import type { BackgroundTaskRecord } from "../background-task-types";

const inputSchema = z.object({
  kind: z
    .string()
    .min(1)
    .describe(
      "Short category tag for the background task, e.g. 'research', 'scrape-batch', 'summarize-feed'.",
    ),
  brief: z
    .string()
    .min(10)
    .describe(
      "Self-contained instructions the background task worker will execute. Must be specific — the worker has no conversation history. Include the goal, any URLs or topics, and the desired output shape.",
    ),
});

export function createSpawnBackgroundTaskTool(args: {
  namespace: DurableObjectNamespace<ChildAgent>;
  parentName: string;
  putRecord: (taskId: string, record: BackgroundTaskRecord) => Promise<void>;
  broadcastUpdate: (record: BackgroundTaskRecord) => void;
}) {
  return tool({
    description:
      "Dispatch a long-running background task to a dedicated worker. The worker runs independently in its own durable object with its own LLM loop and reports results back as a new turn. THIS IS THE DEFAULT FOR RESEARCH. Use it whenever the work involves more than one web_search, more than one web_scrape, or any multi-step gather-and-synthesize loop — inline web_search/web_scrape are for single-shot lookups only. Returns immediately with a task id — acknowledge the user ('on it, I'll report back') and end your turn; do not run the research yourself in parallel.",
    inputSchema,
    execute: async ({ kind, brief }) => {
      const taskId = crypto.randomUUID();
      const record: BackgroundTaskRecord = {
        id: taskId,
        kind,
        brief,
        status: "running",
        spawnedAt: Date.now(),
      };
      await args.putRecord(taskId, record);
      args.broadcastUpdate(record);
      const stub = await getAgentByName(args.namespace, taskId);
      await stub.startTask({
        parentName: args.parentName,
        taskId,
        kind,
        brief,
      });
      return { taskId, status: "dispatched" as const };
    },
  });
}
