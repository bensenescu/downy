import type { MCPClientManager } from "agents/mcp/client";

// Serializable shape of one MCP tool, sent to a ChildAgent so it can
// wrap each entry in a `dynamicTool` proxy. The schema field matches
// MCP's `Tool.inputSchema` (always object-rooted) — structurally
// compatible with JSONSchema7 for use with `jsonSchema(...)`.
export type McpToolDescriptor = {
  serverId: string;
  name: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties?: { [key: string]: object };
    required?: string[];
    $schema?: string;
  };
};

// Snapshot the live tool list off a parent's MCPClientManager. Strips
// to a serializable shape so it can cross the DO-RPC boundary.
export function listMcpToolDescriptors(
  mcp: MCPClientManager,
): McpToolDescriptor[] {
  return mcp.listTools().map((t) => ({
    serverId: t.serverId,
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
  const argRecord =
    args && typeof args === "object" && !Array.isArray(args)
      ? // eslint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed above; MCP `arguments` is { [k: string]: unknown }.
        (args as Record<string, unknown>)
      : undefined;
  const result = await mcp.callTool({ serverId, name, arguments: argRecord });
  if ("isError" in result && result.isError) {
    throw new Error(extractMcpErrorText(result) ?? `MCP tool ${name} failed`);
  }
  return result;
}

function extractMcpErrorText(result: object): string | undefined {
  if (!("content" in result)) return undefined;
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content) || content.length === 0) return undefined;
  const first: unknown = content[0];
  if (typeof first !== "object" || first === null) return undefined;
  // eslint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed to non-null object; MCP content parts have optional type/text fields.
  const part = first as { type?: unknown; text?: unknown };
  return part.type === "text" && typeof part.text === "string"
    ? part.text
    : undefined;
}
