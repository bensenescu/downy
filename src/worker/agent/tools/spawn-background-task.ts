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
    description: `Dispatch work to a separate background worker (its own durable object, its own LLM loop, its own \`execute\` sandbox). The worker inherits your connected MCP tools via RPC. Returns immediately with \`{ taskId, status: "dispatched" }\`; when the worker finishes you get a new turn pointing at the saved file.

Dispatch when: the work needs more than 2–3 tool calls, the result wants to land in a file, or the user shouldn't have to sit waiting. Don't dispatch quick bounded queries ("what's X", "find the docs link for Y") — call \`execute\` inline and answer in the same turn.

Match the brief to what's actually being asked. A "how do I set up X" brief should ask for concise practical steps (install command, env vars, gotchas). A "scan the competitive landscape" brief can ask for a structured report. Don't auto-upgrade every research-flavored ask into a full report. If the brief depends on a specific MCP server (DataForSEO, Linear, PostHog), name it so the worker knows to use those tools.`,
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
