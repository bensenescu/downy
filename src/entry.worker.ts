import tanstackEntry from "@tanstack/react-start/server-entry";
import { routeAgentRequest } from "agents";

import { handleBootstrapRequest } from "./worker/handlers/bootstrap";
import { handleFilesRequest } from "./worker/handlers/files";
import { handleBackgroundTasksRequest } from "./worker/handlers/background-tasks";
import { handleMcpServersRequest } from "./worker/handlers/mcp-servers";
import { handleTranscribeRequest } from "./worker/handlers/transcribe";

export * from "@tanstack/react-start/server-entry";
export { OpenClawAgent } from "./worker/agent/OpenClawAgent";
export { ChildAgent } from "./worker/agent/ChildAgent";

export default {
  async fetch(request: Request, env: Cloudflare.Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/bootstrap/")) {
      return handleBootstrapRequest(request, env);
    }

    if (url.pathname.startsWith("/api/files/")) {
      return handleFilesRequest(request, env);
    }

    if (url.pathname === "/api/transcribe") {
      return handleTranscribeRequest(request, env);
    }

    if (url.pathname === "/api/background-tasks") {
      return handleBackgroundTasksRequest(request, env);
    }

    if (url.pathname === "/api/mcp-servers") {
      return handleMcpServersRequest(request, env);
    }

    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) return agentResponse;

    return tanstackEntry.fetch(request);
  },
};
