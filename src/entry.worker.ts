import tanstackEntry from "@tanstack/react-start/server-entry";
import { routeAgentRequest } from "agents";

import { handleAgentsRequest } from "./worker/handlers/agents";
import { handleBootstrapRequest } from "./worker/handlers/bootstrap";
import { handleFilesRequest } from "./worker/handlers/files";
import { handleBackgroundTasksRequest } from "./worker/handlers/background-tasks";
import { handleMcpServersRequest } from "./worker/handlers/mcp-servers";
import { handleMessagesRequest } from "./worker/handlers/messages";
import { handleProfileRequest } from "./worker/handlers/profile";
import { handleSkillsRequest } from "./worker/handlers/skills";
import { handleTranscribeRequest } from "./worker/handlers/transcribe";
import { seedDefaultAgent } from "./worker/db/profile";

export * from "@tanstack/react-start/server-entry";
export { OpenClawAgent } from "./worker/agent/OpenClawAgent";
export { ChildAgent } from "./worker/agent/ChildAgent";

// Worker-global one-shot guard. Each isolate calls `seedDefaultAgent` once on
// its first request; subsequent requests skip the round trip. Idempotent at
// the SQL level (ON CONFLICT DO NOTHING) so two parallel isolates is fine.
let profileSeeded: Promise<void> | null = null;
function ensureProfileSeeded(env: Cloudflare.Env): Promise<void> {
  if (!profileSeeded) {
    profileSeeded = seedDefaultAgent(env.DB).catch((err: unknown) => {
      // Reset on failure so the next request retries instead of memoizing the
      // error forever. Common cause locally: D1 migrations not applied yet.
      profileSeeded = null;
      console.error("[entry.worker] seedDefaultAgent failed", err);
      throw err;
    });
  }
  return profileSeeded;
}

export default {
  async fetch(request: Request, env: Cloudflare.Env): Promise<Response> {
    const url = new URL(request.url);

    // Make sure the registry has the default agent before any handler runs.
    // Fire-and-forget on first request would race with /api/agents reads, so
    // we await — it's a single SQL upsert per isolate lifetime.
    await ensureProfileSeeded(env);

    if (url.pathname === "/api/agents" || url.pathname.startsWith("/api/agents/")) {
      return handleAgentsRequest(request, env);
    }

    if (url.pathname.startsWith("/api/profile/")) {
      return handleProfileRequest(request, env);
    }

    if (url.pathname.startsWith("/api/bootstrap/")) {
      return handleBootstrapRequest(request, env);
    }

    if (url.pathname.startsWith("/api/files/")) {
      return handleFilesRequest(request, env);
    }

    if (url.pathname.startsWith("/api/messages/")) {
      return handleMessagesRequest(request, env);
    }

    if (url.pathname === "/api/transcribe") {
      return handleTranscribeRequest(request, env);
    }

    if (url.pathname === "/api/background-tasks") {
      return handleBackgroundTasksRequest(request, env);
    }

    if (
      url.pathname === "/api/mcp-servers" ||
      url.pathname.startsWith("/api/mcp-servers/")
    ) {
      return handleMcpServersRequest(request, env);
    }

    if (url.pathname === "/api/skills") {
      return handleSkillsRequest(request, env);
    }

    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) return agentResponse;

    return tanstackEntry.fetch(request);
  },
};
