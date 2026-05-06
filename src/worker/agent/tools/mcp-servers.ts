import { tool } from "ai";
import { z } from "zod";

import type { DownyAgent } from "../DownyAgent";
import { buildHeaderTransport, isCredentialsRejection } from "../mcp-reconnect";

const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

const headersSchema = z
  .record(z.string(), z.string())
  .optional()
  .describe(
    "Auth headers sent with every request. Covers any HTTP-header scheme — Bearer, Basic, X-API-Key, etc. Examples: { Authorization: 'Bearer sk_...' }, { Authorization: 'Basic <base64(user:pass)>' }, { 'X-API-Key': '...' }. Omit for OAuth servers.",
  );

const transportSchema = z
  .enum(["auto", "streamable-http", "sse"])
  .optional()
  .describe(
    "Transport. 'auto' (default) tries Streamable HTTP, then SSE. A 405 on 'auto' usually means the server rejected the SSE GET — retry with 'streamable-http'.",
  );

const connectInputSchema = z.object({
  name: z.string().min(1).describe("Label, e.g. 'sentry', 'dataforseo'."),
  url: z.string().url().describe("Hosted MCP endpoint URL."),
  transport: transportSchema,
  headers: headersSchema,
});

type ProbeResult =
  | {
      ok: true;
      status: number;
      statusText: string;
      contentType: string | null;
      bodyPreview: string;
      bodyTruncated: boolean;
    }
  | { ok: false; error: string };

async function probeMcpEndpoint(
  url: string,
  headers: Record<string, string> | undefined,
): Promise<ProbeResult> {
  // Streamable-HTTP MCP handshake is a POST with the JSON-RPC `initialize`
  // request. Doing it manually surfaces 401/403/404/405 from the actual server,
  // which the MCP client manager often hides behind `state: failed, error: null`.
  const initBody = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "downy-probe", version: "0.0.0" },
    },
  };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...headers,
      },
      body: JSON.stringify(initBody),
    });
    const contentType = res.headers.get("content-type");
    const text = await res.text();
    const MAX = 1000;
    return {
      ok: true,
      status: res.status,
      statusText: res.statusText,
      contentType,
      bodyPreview: text.slice(0, MAX),
      bodyTruncated: text.length > MAX,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function waitForSettled(
  agent: DownyAgent,
  id: string,
  timeoutMs = 4000,
): Promise<{
  state: string;
  error: string | null;
}> {
  const start = Date.now();
  while (true) {
    const server = agent.getMcpServers().servers[id];
    const state = server?.state ?? "unknown";
    const error = typeof server?.error === "string" ? server.error : null;
    if (state !== "connecting" && state !== "authenticating") {
      return { state, error };
    }
    if (Date.now() - start >= timeoutMs) {
      return { state, error };
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

function resultError(result: { state: string }): string | undefined {
  if (!("error" in result)) return undefined;
  return typeof result.error === "string" ? result.error : undefined;
}

function mcpServerIdBase(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return `mcp_${slug || "server"}`;
}

function mcpServerIdFor(agent: DownyAgent, name: string): string {
  const base = mcpServerIdBase(name);
  const used = new Set([
    ...agent.mcp.listServers().map((s) => s.id),
    ...Object.keys(agent.mcp.mcpConnections),
  ]);
  if (!used.has(base)) return base;

  for (let i = 2; i <= 50; i += 1) {
    const candidate = `${base}_${String(i)}`;
    if (!used.has(candidate)) return candidate;
  }

  return `${base}_${Math.random().toString(36).slice(2, 8)}`;
}

// Why this connect tool doesn't just call `addMcpServer`:
// In agents@0.11.x, `addMcpServer` auto-derives a `callbackUrl` from the inbound
// request URL and unconditionally installs an OAuth `authProvider` whenever
// that callbackUrl exists. The MCP SDK then converts ANY 401 during the
// handshake into `state: AUTHENTICATING`, leaving header-auth servers stuck
// in an OAuth flow that they don't actually need (DataForSEO, Linear, etc.).
//
// When the user supplies static `headers`, we want a header-auth path with no
// OAuth interference. So for that case we go directly through the lower-level
// MCPClientManager (`mcp.registerServer` + `mcp.connectToServer`) — which
// happily accepts a transport without an `authProvider`. No callback URL, no
// OAuth provider, no AUTHENTICATING-purgatory: a 401 lands as FAILED with the
// real error string, and a 200 lands as CONNECTED → READY after discovery.
//
// When no headers are supplied, we fall back to `addMcpServer` so OAuth-only
// servers (like Sentry's hosted MCP) still work.

const CREDENTIALS_REJECTED_MESSAGE =
  "Server returned 401 — credentials rejected. Verify the auth header value (correct token, not expired, required scopes) and retry. For Bearer tokens: confirm the token was issued for this server. For Basic: ensure the value is base64(login:password).";

async function connectWithStaticHeaders(
  agent: DownyAgent,
  params: {
    name: string;
    url: string;
    type: "auto" | "streamable-http" | "sse";
    headers: Record<string, string>;
  },
): Promise<{ id: string; state: string; error: string | null }> {
  const { name, url, type, headers } = params;
  const normalizedUrl = new URL(url).href;
  const existing = agent.mcp
    .listServers()
    .find(
      (s) => s.name === name && new URL(s.server_url).href === normalizedUrl,
    );
  const existingConn = existing ? agent.mcp.mcpConnections[existing.id] : null;
  const id = existing?.id ?? mcpServerIdFor(agent, name);
  if (existing || existingConn) {
    await agent.mcp.removeServer(id).catch(() => undefined);
  }
  await agent.mcp.registerServer(id, {
    url,
    name,
    // Intentionally NO authProvider — see top-of-section comment.
    transport: buildHeaderTransport(type, headers),
  });
  const result = await agent.mcp.connectToServer(id);
  if (result.state === "connected") {
    const discovery = await agent.mcp.discoverIfConnected(id);
    if (discovery && !discovery.success) {
      return {
        id,
        state: "failed",
        error: `Discovery failed: ${discovery.error ?? "unknown"}`,
      };
    }
    return { id, state: "ready", error: null };
  }
  const errorString = resultError(result);
  if (
    isCredentialsRejection({
      state: result.state,
      error: errorString,
    })
  ) {
    // Cleanly remove the zombie connection so downstream `waitForSettled`,
    // `getMcpServers()` snapshots, and the next restore pass don't see a
    // ghost in AUTHENTICATING state. We also intentionally don't persist
    // (gated by caller), so no harm leaving it gone.
    await agent.mcp.removeServer(id).catch(() => undefined);
    return { id, state: "failed", error: CREDENTIALS_REJECTED_MESSAGE };
  }
  if (result.state === "failed") {
    return {
      id,
      state: "failed",
      error: errorString ?? "Unknown connection error",
    };
  }
  return { id, state: result.state, error: null };
}

export function createConnectMcpServerTool(args: { agent: DownyAgent }) {
  return tool({
    description: `Attach a hosted MCP server. Its tools auto-merge into your tool set on the next turn. Returns \`{ id, state, error, toolNames, sentHeaderNames, probe? }\`. After a successful connect, list the discovered \`toolNames\` to the user so they know what's available.

Auth via the \`headers\` parameter — string→string map for any HTTP scheme:
- Bearer: \`{ Authorization: 'Bearer sk_...' }\`
- Basic (e.g. DataForSEO): \`{ Authorization: 'Basic <base64(login:password)>' }\`
- API-key: \`{ 'X-API-Key': '...' }\`

Confirm URL/headers/key with the user before calling — never invent them. If you propose a URL you didn't read from a doc this turn, flag it as a guess. OAuth servers return an \`authUrl\` but end-to-end OAuth isn't wired up yet.

**One \`state: 'failed'\` is data, not a verdict — work the problem before reporting failure.** Read \`error\` and \`probe\` (raw HTTP status + body from a manual JSON-RPC \`initialize\`) to see what the server actually said. \`sentHeaderNames\` confirms which headers were attached. Then make 2–3 more attempts varying what plausibly matters: \`transport\` (\`streamable-http\` ↔ \`sse\` ↔ \`auto\`), URL shape (trailing slash, \`/mcp\` vs \`/sse\` vs \`/v1/mcp\`), auth scheme (Bearer ↔ Basic ↔ X-API-Key per the docs), or base64 encoding for Basic. If you have a docs URL for the MCP, scrape it before giving up. Stop early only when the error is unambiguously credential-related (\`401 Invalid credentials\`) — at that point ask the user for the right secret rather than guessing further.

When you do report failure, say what you tried (transports, header schemes) and what the server returned (status + error). Never claim the tool lacks header support — it has a \`headers\` parameter.`,
    inputSchema: connectInputSchema,
    execute: async ({ name, url, transport, headers }) => {
      const headerNames = headers ? Object.keys(headers) : [];
      if (headers) {
        for (const key of Object.keys(headers)) {
          if (!HEADER_NAME.test(key)) {
            throw new Error(`Invalid header name: ${JSON.stringify(key)}`);
          }
        }
      }
      const type = transport ?? "auto";

      // Header-auth path: bypass addMcpServer to avoid the SDK installing an
      // OAuth authProvider that hijacks 401 responses into AUTHENTICATING.
      if (headers) {
        let connectResult: { id: string; state: string; error: string | null };
        try {
          connectResult = await connectWithStaticHeaders(args.agent, {
            name,
            url,
            type,
            headers,
          });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          const probeOnThrow = await probeMcpEndpoint(url, headers);
          return {
            id: null,
            state: "failed",
            error: errMsg,
            toolNames: [],
            sentHeaderNames: headerNames,
            probe: probeOnThrow,
          };
        }

        // Persist successful registrations so wake-from-hibernation can re-attach.
        if (connectResult.state !== "failed") {
          await args.agent.persistMcpServer({
            id: connectResult.id,
            name,
            url,
            transport: type,
            headers,
          });
        } else {
          // We already cleaned up the zombie SDK connection inside
          // `connectWithStaticHeaders`; running `waitForSettled` now would
          // either find the server gone (state "unknown") or — worse — see a
          // lingering authenticating zombie if cleanup raced. Short-circuit
          // with a probe so the caller sees the real HTTP status.
          const probeOnFail = await probeMcpEndpoint(url, headers);
          return {
            id: connectResult.id,
            state: "failed",
            error: connectResult.error,
            toolNames: [],
            sentHeaderNames: headerNames,
            probe: probeOnFail,
          };
        }

        const settled = await waitForSettled(args.agent, connectResult.id);
        const toolNames = args.agent.mcp
          .listTools()
          .filter((t) => t.serverId === connectResult.id)
          .map((t) => t.name);

        let probe: ProbeResult | null = null;
        if (settled.state === "failed") {
          probe = await probeMcpEndpoint(url, headers);
        }
        return {
          id: connectResult.id,
          state: settled.state,
          error: settled.error ?? connectResult.error,
          toolNames,
          sentHeaderNames: headerNames,
          probe,
        };
      }

      // No-headers path: defer to the SDK's addMcpServer, which handles the
      // OAuth dance for servers that need it.
      let result: { id: string; state: string };
      try {
        result = await args.agent.addMcpServer(name, url, {
          transport: { type },
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const probeOnThrow = await probeMcpEndpoint(url, undefined);
        return {
          id: null,
          state: "failed",
          error: errMsg,
          toolNames: [],
          sentHeaderNames: [],
          probe: probeOnThrow,
        };
      }
      await args.agent.persistMcpServer({
        id: result.id,
        name,
        url,
        transport: type,
        headers: undefined,
      });
      const settled = await waitForSettled(args.agent, result.id);
      const toolNames = args.agent.mcp
        .listTools()
        .filter((t) => t.serverId === result.id)
        .map((t) => t.name);
      let probe: ProbeResult | null = null;
      if (settled.state === "failed") {
        probe = await probeMcpEndpoint(url, undefined);
      }
      return {
        id: result.id,
        state: settled.state,
        error: settled.error,
        toolNames,
        sentHeaderNames: [],
        probe,
      };
    },
  });
}

export function createListMcpServersTool(args: { agent: DownyAgent }) {
  return tool({
    description: "List attached MCP servers with state and discovered tools.",
    inputSchema: z.object({}),
    execute: async () => {
      const state = args.agent.getMcpServers();
      const servers = Object.entries(state.servers).map(([id, s]) => ({
        id,
        name: s.name,
        url: s.server_url,
        state: s.state,
        error: s.error,
        toolNames: state.tools
          .filter((t) => t.serverId === id)
          .map((t) => t.name),
      }));
      return { servers };
    },
  });
}

export function createDisconnectMcpServerTool(args: { agent: DownyAgent }) {
  return tool({
    description: "Detach an MCP server by id.",
    inputSchema: z.object({ id: z.string().min(1) }),
    execute: async ({ id }) => {
      await args.agent.disconnectMcpServer(id);
      return { removed: true, id };
    },
  });
}
