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
    description: `Dispatch work to a separate background worker (its own durable object, its own LLM loop, its own web_search/web_scrape via execute). The worker also inherits your connected MCP tools — they round-trip back through this agent over RPC, so anything you can do via \`connect_mcp_server\` is available to the worker too. Returns immediately with \`{ taskId, status: "dispatched" }\`; when the worker finishes you get a new turn pointing at the saved file.

When to dispatch:
- The work needs more than two or three tool calls (multi-source fanout, search → scrape → scrape → scrape).
- The result wants to land in a file (memo, brief, plan, map, report, list — anything with a name).
- The work would take noticeably more than a few seconds, or the user shouldn't have to sit there waiting.

When NOT to dispatch:
- Quick, bounded queries: "what's X", "find me the docs link for Y", small how-tos. Just call \`execute\` and answer in the same turn.
- Anything you can answer from the workspace, identity files, or the chat already.

Brief shape — match it to what's actually being asked. A "how do I set up X" brief should ask for concise practical steps (install command, env vars, gotchas) — a few hundred words. A "scan the competitive landscape" brief can ask for a structured report. Don't auto-upgrade every research-flavored question into a full report. Don't pad short tasks. If the brief depends on a specific MCP server (DataForSEO, Linear, PostHog), name it in the brief so the worker knows to use those tools.

After dispatch: acknowledge briefly ("on it — running this in the background") and **end your turn**. Don't keep working on the same problem inline; the worker is doing it. When the worker finishes you'll get a synthetic user-role turn beginning with \`<background_task {id} ({kind}) completed — findings saved to {path}>\` (or \`... failed\`). **Read the file before replying** so you can speak to its contents, but **do not paste the file back into chat** — the user opens it in the Workspace tab. Reply with a short summary plus the path. If the task failed, the error is inline; say so honestly, don't fabricate success.`,
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
