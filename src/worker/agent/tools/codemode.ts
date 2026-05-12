import { DynamicWorkerExecutor } from "@cloudflare/codemode";
import { createCodeTool } from "@cloudflare/codemode/ai";
import type { ToolSet } from "ai";

export function createCodeModeTool({
  loader,
  tools,
}: {
  loader: WorkerLoader;
  tools: ToolSet;
}) {
  const executor = new DynamicWorkerExecutor({
    loader,
    timeout: 30000,
    globalOutbound: null, // Block direct network access; use tools instead.
  });

  return createCodeTool({
    tools,
    executor,
  });
}
