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

export function createConnectMcpServerTool(args: { agent: OpenClawAgent }) {
  return tool({
    description:
      "Attach a remote MCP server. Its tools auto-merge into your tool set on the next turn. Returns the server id, state, and discovered tool names — tell the user what's now available.",
    inputSchema: connectInputSchema,
    execute: async ({ name, url, transport, headers }) => {
      if (headers) {
        for (const key of Object.keys(headers)) {
          if (!HEADER_NAME.test(key)) {
            throw new Error(`Invalid header name: ${JSON.stringify(key)}`);
          }
        }
      }
      const type = transport ?? "auto";
      const result = await args.agent.addMcpServer(name, url, {
        transport: headers ? { type, headers } : { type },
      });
      const toolNames = args.agent.mcp
        .listTools()
        .filter((t) => t.serverId === result.id)
        .map((t) => t.name);
      return { id: result.id, state: result.state, toolNames };
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
      await args.agent.removeMcpServer(id);
      return { removed: true, id };
    },
  });
}
