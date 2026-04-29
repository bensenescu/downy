import tanstackEntry from "@tanstack/react-start/server-entry";
import { routeAgentRequest } from "agents";

import { verifyAccessJwt } from "./worker/auth/cloudflare-access";
import { handleAgentsRequest } from "./worker/handlers/agents";
import { handleBootstrapRequest } from "./worker/handlers/bootstrap";
import { handleFilesRequest } from "./worker/handlers/files";
import { handleBackgroundTasksRequest } from "./worker/handlers/background-tasks";
import { handleMcpServersRequest } from "./worker/handlers/mcp-servers";
import { handleMessagesRequest } from "./worker/handlers/messages";
import { handleProfileRequest } from "./worker/handlers/profile";
import { handleSkillsRequest } from "./worker/handlers/skills";
import { handleTranscribeRequest } from "./worker/handlers/transcribe";
import { getAgent, listAgents, seedDefaultAgent } from "./worker/db/profile";

export * from "@tanstack/react-start/server-entry";
export { DownyAgent } from "./worker/agent/DownyAgent";
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

function isApiOrSocketRequest(url: URL, request: Request): boolean {
  if (url.pathname.startsWith("/api/")) return true;
  if (request.headers.get("upgrade")?.toLowerCase() === "websocket")
    return true;
  const accept = request.headers.get("accept") ?? "";
  return accept.includes("application/json") && !accept.includes("text/html");
}

function isLocalDevHost(url: URL): boolean {
  return (
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1" ||
    url.hostname.endsWith(".localhost")
  );
}

const AGENT_PAGE_RE = /^\/agent\/([^/]+)(?:\/|$)/;

async function redirectInvalidAgentPage(
  request: Request,
  env: Cloudflare.Env,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (isApiOrSocketRequest(url, request)) return null;

  const match = AGENT_PAGE_RE.exec(url.pathname);
  if (!match) return null;

  let slug: string | null = null;
  try {
    slug = decodeURIComponent(match[1]);
  } catch {
    // Invalid percent-encoding is not a valid agent route.
  }

  const agent = slug ? await getAgent(env.DB, slug) : null;
  if (agent && agent.archivedAt === null) return null;

  const fallback = (await listAgents(env.DB))[0]?.slug;
  const pathname = fallback ? `/agent/${encodeURIComponent(fallback)}` : "/";
  return Response.redirect(new URL(pathname, request.url).toString(), 302);
}

export default {
  async fetch(request: Request, env: Cloudflare.Env): Promise<Response> {
    const url = new URL(request.url);

    // Cloudflare Access gate. Single chokepoint for every request — REST
    // handlers, the agent WebSocket, and TanStack SSR all flow through here.
    // Bypassed for `wrangler dev` (LOCAL_NOAUTH=1 in .env.local) since Access
    // doesn't run on localhost.
    const localNoAuth = env.LOCAL_NOAUTH === "1" && isLocalDevHost(url);
    if (env.LOCAL_NOAUTH === "1" && !localNoAuth) {
      console.warn("[entry.worker] ignoring LOCAL_NOAUTH on non-local host", {
        hostname: url.hostname,
      });
    }
    if (!localNoAuth) {
      const access = await verifyAccessJwt(request, env);
      if (url.pathname === "/unauthenticated") {
        // Bounce back to / once the user has actually signed in — otherwise
        // refreshing the unauth page strands them there even after Access
        // hands them a valid JWT.
        if (access.ok) {
          return Response.redirect(new URL("/", request.url).toString(), 302);
        }
      } else if (!access.ok) {
        if (isApiOrSocketRequest(url, request)) {
          return Response.json(
            { error: "unauthenticated", reason: access.reason },
            { status: 401 },
          );
        }
        // Redirect (not internal rewrite) so the browser's URL becomes
        // /unauthenticated. With a rewrite, SSR returns the unauth body but
        // window.location is still the original path — the client router
        // then hydrates the original route and the unauth page flashes away.
        return Response.redirect(
          new URL("/unauthenticated", request.url).toString(),
          302,
        );
      }
    }

    // Make sure the registry has the default agent before any handler runs.
    // Fire-and-forget on first request would race with /api/agents reads, so
    // we await — it's a single SQL upsert per isolate lifetime.
    await ensureProfileSeeded(env);

    const agentPageRedirect = await redirectInvalidAgentPage(request, env);
    if (agentPageRedirect) return agentPageRedirect;

    if (
      url.pathname === "/api/agents" ||
      url.pathname.startsWith("/api/agents/")
    ) {
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
