import tanstackEntry from "@tanstack/react-start/server-entry";
import { routeAgentRequest } from "agents";

import { handleFilesRequest } from "./worker/handlers/files";

export * from "@tanstack/react-start/server-entry";
export { OpenClawAgent } from "./worker/agent/OpenClawAgent";

export default {
  async fetch(request: Request, env: Cloudflare.Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/files/")) {
      return handleFilesRequest(request, env);
    }

    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) return agentResponse;

    return tanstackEntry.fetch(request);
  },
};
