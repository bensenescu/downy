import { tool } from "ai";
import { z } from "zod";

import type { OpenClawAgent } from "../OpenClawAgent";

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
      clientInfo: { name: "openclaw-probe", version: "0.0.0" },
    },
  };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(headers ?? {}),
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
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function waitForSettled(
  agent: OpenClawAgent,
  id: string,
  timeoutMs = 4000,
): Promise<{
  state: string;
  error: string | null;
  transitions: Array<{ atMs: number; state: string; error: string | null }>;
}> {
  const start = Date.now();
  const transitions: Array<{ atMs: number; state: string; error: string | null }> = [];
  let lastState: string | null = null;
  let lastError: string | null = null;
  while (true) {
    const server = agent.getMcpServers().servers[id];
    const state = server?.state ?? "unknown";
    const error = (server?.error as string | undefined) ?? null;
    if (state !== lastState || error !== lastError) {
      transitions.push({ atMs: Date.now() - start, state, error });
      lastState = state;
      lastError = error;
    }
    if (state !== "connecting" && state !== "authenticating") {
      return { state, error, transitions };
    }
    if (Date.now() - start >= timeoutMs) {
      return { state, error, transitions };
    }
    await new Promise((r) => setTimeout(r, 100));
  }
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

async function connectWithStaticHeaders(
  agent: OpenClawAgent,
  params: {
    name: string;
    url: string;
    type: "auto" | "streamable-http" | "sse";
    headers: Record<string, string>;
  },
): Promise<{ id: string; state: string; error: string | null }> {
  const { name, url, type, headers } = params;
  // Use the same id space as nanoid(8) elsewhere in the SDK; crypto.randomUUID
  // would also work but is longer than necessary.
  const id = `mcp_${Math.random().toString(36).slice(2, 10)}`;
  const transportOptions = {
    type,
    requestInit: { headers },
    eventSourceInit: {
      fetch: (u: string | URL | globalThis.Request, init?: RequestInit) =>
        fetch(u, { ...init, headers: { ...(init?.headers ?? {}), ...headers } }),
    },
    // Intentionally NO authProvider — see top-of-section comment.
  };
  await agent.mcp.registerServer(id, {
    url,
    name,
    transport: transportOptions,
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
  if (result.state === "failed") {
    return { id, state: "failed", error: ("error" in result && result.error) ? result.error : "Unknown connection error" };
  }
  if (result.state === "authenticating") {
    // Without an authProvider this means the server returned 401 and the SDK
    // tried to start an OAuth flow it can't complete. Surface as a clear
    // credentials error so the user/model can correct the header value.
    return {
      id,
      state: "failed",
      error: "Server returned 401 — credentials rejected. Verify the auth header value (e.g. base64 of login:password for Basic auth) and retry.",
    };
  }
  // All known states handled above; if the SDK adds a new one, surface it raw.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion -- forward-compat over an exhausted union.
  const fallback = result as { state: string };
  return { id, state: fallback.state, error: null };
}

export function createConnectMcpServerTool(args: { agent: OpenClawAgent }) {
  return tool({
    description:
      "Attach a remote MCP server. Its tools auto-merge into your tool set on the next turn. Returns the server id, final state, any error message, and discovered tool names. If state is 'failed', read the error and address it (bad creds, wrong header, wrong URL) — do NOT claim the tool lacks header support; it has a `headers` parameter.",
    inputSchema: connectInputSchema,
    execute: async ({ name, url, transport, headers }) => {
      const headerNames = headers ? Object.keys(headers) : [];
      console.log("[mcp.connect] called", {
        name,
        url,
        transport: transport ?? "auto",
        headerNames,
        headerCount: headerNames.length,
      });
      if (headers) {
        for (const key of Object.keys(headers)) {
          if (!HEADER_NAME.test(key)) {
            console.warn("[mcp.connect] invalid header name", { key });
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
          console.log("[mcp.connect] direct register/connect returned", {
            ...connectResult,
            name,
            url,
            transport: type,
            headerNames,
          });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error("[mcp.connect] direct register/connect threw", {
            name,
            url,
            transport: type,
            headerNames,
            error: errMsg,
            stack: err instanceof Error ? err.stack : undefined,
          });
          const probeOnThrow = await probeMcpEndpoint(url, headers);
          console.warn("[mcp.connect] failure probe (after throw)", {
            name,
            url,
            transport: type,
            headerNames,
            probe: probeOnThrow,
          });
          return {
            id: null,
            state: "failed",
            error: errMsg,
            toolNames: [],
            sentHeaderNames: headerNames,
            debug: {
              transport: type,
              transitions: [],
              probe: probeOnThrow,
              path: "direct",
              threw: true,
            },
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
        }

        const settled = await waitForSettled(args.agent, connectResult.id);
        const toolNames = args.agent.mcp
          .listTools()
          .filter((t) => t.serverId === connectResult.id)
          .map((t) => t.name);

        let probe: ProbeResult | null = null;
        if (settled.state === "failed") {
          probe = await probeMcpEndpoint(url, headers);
          console.warn("[mcp.connect] failure probe", {
            id: connectResult.id,
            name,
            url,
            transport: type,
            headerNames,
            probe,
          });
        }
        console.log("[mcp.connect] settled", {
          id: connectResult.id,
          name,
          url,
          transport: type,
          headerNames,
          finalState: settled.state,
          error: settled.error ?? connectResult.error,
          transitions: settled.transitions,
          toolCount: toolNames.length,
          toolNames,
          path: "direct",
        });
        return {
          id: connectResult.id,
          state: settled.state,
          error: settled.error ?? connectResult.error,
          toolNames,
          sentHeaderNames: headerNames,
          debug: {
            transport: type,
            transitions: settled.transitions,
            probe,
            path: "direct",
          },
        };
      }

      // No-headers path: defer to the SDK's addMcpServer, which handles the
      // OAuth dance for servers that need it.
      let result: { id: string; state: string };
      try {
        result = await args.agent.addMcpServer(name, url, { transport: { type } });
        console.log("[mcp.connect] addMcpServer returned", {
          id: result.id,
          state: result.state,
          name,
          url,
          transport: type,
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error("[mcp.connect] addMcpServer threw", {
          name,
          url,
          transport: type,
          error: errMsg,
          stack: err instanceof Error ? err.stack : undefined,
        });
        const probeOnThrow = await probeMcpEndpoint(url, undefined);
        console.warn("[mcp.connect] failure probe (after throw)", {
          name,
          url,
          transport: type,
          probe: probeOnThrow,
        });
        return {
          id: null,
          state: "failed",
          error: errMsg,
          toolNames: [],
          sentHeaderNames: [],
          debug: {
            transport: type,
            transitions: [],
            probe: probeOnThrow,
            path: "addMcpServer",
            threw: true,
          },
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
      console.log("[mcp.connect] settled", {
        id: result.id,
        name,
        url,
        transport: type,
        finalState: settled.state,
        error: settled.error,
        transitions: settled.transitions,
        toolCount: toolNames.length,
        toolNames,
        path: "addMcpServer",
      });
      return {
        id: result.id,
        state: settled.state,
        error: settled.error,
        toolNames,
        sentHeaderNames: [],
        debug: {
          transport: type,
          transitions: settled.transitions,
          probe,
          path: "addMcpServer",
        },
      };
    },
  });
}

export function createListMcpServersTool(args: { agent: OpenClawAgent }) {
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

export function createDisconnectMcpServerTool(args: { agent: OpenClawAgent }) {
  return tool({
    description: "Detach an MCP server by id.",
    inputSchema: z.object({ id: z.string().min(1) }),
    execute: async ({ id }) => {
      await args.agent.disconnectMcpServer(id);
      return { removed: true, id };
    },
  });
}
