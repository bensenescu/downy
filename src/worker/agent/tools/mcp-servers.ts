import { tool } from "ai";
import { z } from "zod";

import type { OpenClawAgent } from "../OpenClawAgent";

const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

const headersSchema = z
  .record(z.string(), z.string())
  .optional()
  .describe(
    "Optional raw HTTP headers sent with every MCP request. Use for ANY auth scheme that's just an HTTP header — Bearer tokens, Basic auth, custom API-key headers. Examples: { 'Authorization': 'Bearer sk_...' }, { 'Authorization': 'Basic <base64(user:pass)>' } (e.g. DataForSEO), { 'X-API-Key': '...' }. Do NOT use for OAuth (omit headers and the result will include an authUrl).",
  );

const transportSchema = z
  .enum(["auto", "streamable-http", "sse"])
  .optional()
  .describe(
    "MCP transport. Default 'auto' tries Streamable HTTP first, then falls back to SSE. Set explicitly when the server documents a specific transport — e.g. 'streamable-http' for vendors that publish a Streamable-HTTP endpoint (a 405 on 'auto' is a strong signal the server is rejecting the SSE fallback's GET).",
  );

const connectInputSchema = z.object({
  name: z
    .string()
    .min(1)
    .describe(
      "Human-readable label for the server, e.g. 'sentry', 'linear', 'dataforseo'.",
    ),
  url: z
    .string()
    .url()
    .describe(
      "Full URL of a remote MCP endpoint (Streamable HTTP or SSE). This app cannot run local stdio MCP servers — only hosted ones. If the user only has a local stdio MCP, tell them they need to host it (e.g. as a Worker) first.",
    ),
  transport: transportSchema,
  headers: headersSchema,
});

const disconnectInputSchema = z.object({
  id: z.string().min(1).describe("The id returned by connect_mcp_server."),
});

const listInputSchema = z.object({}).describe("No arguments.");

export function createConnectMcpServerTool(args: {
  agent: OpenClawAgent;
}) {
  return tool({
    description:
      "Connect a remote MCP server to this agent. Once connected, its tools are auto-merged into the agent's tool set on subsequent turns. Use `headers` for any HTTP-header auth scheme (Bearer, Basic, X-API-Key, etc.) — the schema explains the encoding. Use `transport` to override the default 'auto' fallback chain when the vendor documents a specific transport. Returns the server id, state, and the discovered tool names. Tell the user which tools are now available. For OAuth-protected servers, omit `headers` — the result will include an `authUrl` the user must visit; we don't yet handle OAuth callbacks end-to-end.",
    inputSchema: connectInputSchema,
    execute: async ({ name, url, transport, headers }) => {
      if (headers) {
        for (const key of Object.keys(headers)) {
          if (!HEADER_NAME.test(key)) {
            throw new Error(`Invalid header name: ${JSON.stringify(key)}`);
          }
        }
      }
      const transportType = transport ?? "auto";
      const result = await args.agent.addMcpServer(name, url, {
        transport: headers
          ? { type: transportType, headers }
          : { type: transportType },
      });
      const toolNames = args.agent.mcp
        .listTools()
        .filter((t) => t.serverId === result.id)
        .map((t) => t.name);
      return { id: result.id, state: result.state, toolNames };
    },
  });
}

export function createListMcpServersTool(args: {
  agent: OpenClawAgent;
}) {
  return tool({
    description:
      "List MCP servers currently registered to this agent, with their connection state and the tools each one exposes. Use this when the user asks 'what MCP servers do I have', or before connecting to check whether the server is already attached.",
    inputSchema: listInputSchema,
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

export function createDisconnectMcpServerTool(args: {
  agent: OpenClawAgent;
}) {
  return tool({
    description:
      "Disconnect and remove an MCP server by id (use list_mcp_servers to find ids). Removes its tools from the next turn's tool set.",
    inputSchema: disconnectInputSchema,
    execute: async ({ id }) => {
      await args.agent.removeMcpServer(id);
      return { removed: true, id };
    },
  });
}
