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
      "Dispatch work to a separate background worker (its own durable object, its own LLM loop, its own web_search/web_scrape via execute). Returns immediately with a task id; when the worker finishes you get a new turn with a pointer to the saved file. Use this when the work would take more than a few seconds inline, when the user shouldn't have to wait on the same turn, or when you want a written artifact saved to the workspace. For quick lookups you can answer in the current turn, just call `execute` directly instead. The brief is self-contained — the worker has no chat history, no other tools beyond `execute`, and produces exactly one markdown file. Match the brief's shape to what's actually wanted: a setup/how-to brief should ask for concise practical steps, a market-scan brief can ask for a structured report. Do not pad short tasks into long reports.",
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
