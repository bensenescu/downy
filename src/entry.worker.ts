import tanstackEntry from "@tanstack/react-start/server-entry";
import { routeAgentRequest } from "agents";

import { handleBootstrapRequest } from "./worker/handlers/bootstrap";
import { handleChatRequest } from "./worker/handlers/chat";
import { handleFilesRequest } from "./worker/handlers/files";
import { handleTranscribeRequest } from "./worker/handlers/transcribe";

export * from "@tanstack/react-start/server-entry";
export { OpenClawAgent } from "./worker/agent/OpenClawAgent";

export default {
  async fetch(request: Request, env: Cloudflare.Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/bootstrap/")) {
      return handleBootstrapRequest(request, env);
    }

    if (url.pathname.startsWith("/api/chat/")) {
      return handleChatRequest(request, env);
    }

    if (url.pathname.startsWith("/api/files/")) {
      return handleFilesRequest(request, env);
    }

    if (url.pathname === "/api/transcribe") {
      return handleTranscribeRequest(request, env);
    }

    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) return agentResponse;

    return tanstackEntry.fetch(request);
  },
};
