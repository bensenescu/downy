import type { MCPClientManager } from "agents/mcp/client";

export type StoredMcpServer = {
  id: string;
  name: string;
  url: string;
  transport?: "auto" | "streamable-http" | "sse";
  headers?: Record<string, string>;
};

// Recognize the agents-SDK signature for "401 with no usable OAuth provider":
// `connectToServer` returns either `{state: "authenticating"}` or
// `{state: "failed", error: "OAuth configuration incomplete: ..."}` and
// leaves `conn.connectionState` stuck at AUTHENTICATING. Callers must
// `removeServer` to clear the zombie before any later snapshot.
export function isCredentialsRejection(result: {
  state: string;
  error?: unknown;
}): boolean {
  if (result.state === "authenticating") return true;
  if (result.state !== "failed") return false;
  return (
    typeof result.error === "string" &&
    /OAuth configuration incomplete/i.test(result.error)
  );
}

function resultError(result: { state: string }): unknown {
  return "error" in result ? result.error : undefined;
}

export function buildHeaderTransport(
  type: "auto" | "streamable-http" | "sse",
  headers: Record<string, string>,
) {
  return {
    type,
    requestInit: { headers },
    eventSourceInit: {
      fetch: (u: string | URL | globalThis.Request, init?: RequestInit) => {
        const merged = new Headers(init?.headers);
        for (const [k, v] of Object.entries(headers)) merged.set(k, v);
        return fetch(u, { ...init, headers: merged });
      },
    },
  };
}

// Restore the header-auth half of a persisted MCP server registration. If
// the saved credentials are rejected (token expired/revoked), the underlying
// SDK connection lands in zombie AUTHENTICATING — we clean it up so UI and
// later restore passes don't see ghosts. The persisted config stays in
// storage so the user can see what was attempted; reconnecting through the
// chat tool overwrites it with fresh headers.
export async function restoreHeaderAuthServer(
  mcp: MCPClientManager,
  config: StoredMcpServer & { headers: Record<string, string> },
): Promise<boolean> {
  const type = config.transport ?? "auto";
  await mcp.registerServer(config.id, {
    url: config.url,
    name: config.name,
    transport: buildHeaderTransport(type, config.headers),
  });
  const result = await mcp.connectToServer(config.id);
  if (result.state === "connected") {
    const discovery = await mcp.discoverIfConnected(config.id);
    if (discovery && !discovery.success) {
      await mcp.removeServer(config.id).catch(() => undefined);
      throw new Error(
        `MCP server ${config.id} discovery failed: ${
          discovery.error ?? "unknown error"
        }`,
      );
    }
    return true;
  }
  if (
    isCredentialsRejection({
      state: result.state,
      error: resultError(result),
    })
  ) {
    await mcp.removeServer(config.id).catch(() => undefined);
  }
  return false;
}

export async function rebuildMcpServer(
  mcp: MCPClientManager,
  config: StoredMcpServer,
  addMcpServer: (
    name: string,
    url: string,
    options: { transport: { type: "auto" | "streamable-http" | "sse" } },
  ) => Promise<{ id: string }>,
): Promise<string | null> {
  await mcp.removeServer(config.id).catch(() => undefined);
  const type = config.transport ?? "auto";
  let id = config.id;
  if (config.headers) {
    const restored = await restoreHeaderAuthServer(mcp, {
      ...config,
      headers: config.headers,
    });
    if (!restored) return null;
  } else {
    const result = await addMcpServer(config.name, config.url, {
      transport: { type },
    });
    id = result.id;
  }
  await mcp.waitForConnections({ timeout: 10_000 });
  return id;
}
