import type { MCPClientManager } from "agents/mcp/client";
import type { jsonSchema } from "ai";

const RECONNECTABLE_MCP_ERROR =
  /not initialized|disconnected|invalid state|connection.*closed|connection.*not.*open/i;

// Serializable shape of one MCP tool, sent to a ChildAgent so it can
// wrap each entry in a `dynamicTool` proxy. The schema field matches
// MCP's `Tool.inputSchema` (always object-rooted) — structurally
// compatible with JSONSchema7 for use with `jsonSchema(...)`.
export type McpToolDescriptor = {
  serverId: string;
  serverName: string;
  name: string;
  description?: string;
  inputSchema: Parameters<typeof jsonSchema>[0];
};

// Snapshot the live tool list off a parent's MCPClientManager. Strips
// to a serializable shape so it can cross the DO-RPC boundary.
export function listMcpToolDescriptors(
  mcp: MCPClientManager,
): McpToolDescriptor[] {
  const serverNames = new Map(mcp.listServers().map((s) => [s.id, s.name]));
  return mcp.listTools().map((t) => ({
    serverId: t.serverId,
    serverName: serverNames.get(t.serverId) ?? t.serverId,
    name: t.name,
    description: t.description,
    // Some MCP servers omit the schema; fall back to an empty object
    // schema so the child can still construct a tool wrapper.
    inputSchema: t.inputSchema ?? { type: "object" as const },
  }));
}

// Invoke an MCP tool over the parent's live connection and convert
// MCP's `isError` result shape into a thrown Error — the AI SDK on the
// child expects exceptions so the model sees a clean error in the next
// step.
export async function callMcpToolViaParent(
  mcp: MCPClientManager,
  serverId: string,
  name: string,
  args: unknown,
): Promise<unknown> {
  await ensureMcpServerReady(mcp, serverId);
  try {
    return await callMcpToolOnce(mcp, serverId, name, args);
  } catch (err) {
    if (!isReconnectableMcpError(err)) throw err;
    await ensureMcpServerReady(mcp, serverId, { force: true });
    return callMcpToolOnce(mcp, serverId, name, args);
  }
}

async function ensureMcpServerReady(
  mcp: MCPClientManager,
  serverId: string,
  options: { force?: boolean } = {},
): Promise<void> {
  const conn = mcp.mcpConnections[serverId];
  if (!options.force && conn?.connectionState === "ready") return;

  const result = await mcp.connectToServer(serverId);
  if (result.state === "authenticating") {
    throw new Error(
      `MCP server ${serverId} requires authentication before tools can be called`,
    );
  }
  if (result.state === "failed") {
    throw new Error(
      `MCP server ${serverId} failed to reconnect: ${
        "error" in result && result.error ? result.error : "unknown error"
      }`,
    );
  }
  const discovery = await mcp.discoverIfConnected(serverId);
  if (discovery && !discovery.success) {
    throw new Error(
      `MCP server ${serverId} discovery failed: ${
        discovery.error ?? "unknown error"
      }`,
    );
  }
  await mcp.waitForConnections({ timeout: 10_000 });
}

async function callMcpToolOnce(
  mcp: MCPClientManager,
  serverId: string,
  name: string,
  args: unknown,
): Promise<unknown> {
  const argRecord = toRecord(args);
  const result = await mcp.callTool({ serverId, name, arguments: argRecord });
  if ("isError" in result && result.isError) {
    throw new Error(extractMcpErrorText(result) ?? `MCP tool ${name} failed`);
  }
  return result;
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return Object.fromEntries(Object.entries(value));
}

export function isReconnectableMcpError(err: unknown): boolean {
  return RECONNECTABLE_MCP_ERROR.test(
    err instanceof Error ? err.message : String(err),
  );
}

function extractMcpErrorText(result: object): string | undefined {
  if (!("content" in result)) return undefined;
  const content = result.content;
  if (!Array.isArray(content) || content.length === 0) return undefined;
  const first: unknown = content[0];
  if (typeof first !== "object" || first === null) return undefined;
  if (!("type" in first) || first.type !== "text") return undefined;
  if (!("text" in first) || typeof first.text !== "string") return undefined;
  return first.text;
}
