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

function buildHeaderTransport(
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
): Promise<void> {
  const type = config.transport ?? "auto";
  await mcp.registerServer(config.id, {
    url: config.url,
    name: config.name,
    transport: buildHeaderTransport(type, config.headers),
  });
  const result = await mcp.connectToServer(config.id);
  if (result.state === "connected") {
    await mcp.discoverIfConnected(config.id);
    return;
  }
  if (
    isCredentialsRejection({
      state: result.state,
      // eslint-disable-next-line typescript/no-unsafe-type-assertion -- shape across SDK union variants; we only read `error` if present.
      error: (result as { error?: unknown }).error,
    })
  ) {
    await mcp.removeServer(config.id).catch(() => undefined);
    console.warn("[agent] restoreMcpServer credentials rejected", {
      id: config.id,
      name: config.name,
      state: result.state,
    });
  }
}

export async function rebuildMcpServer(
  mcp: MCPClientManager,
  config: StoredMcpServer,
  addMcpServer: (
    name: string,
    url: string,
    options: { transport: { type: "auto" | "streamable-http" | "sse" } },
  ) => Promise<unknown>,
): Promise<void> {
  await mcp.removeServer(config.id).catch(() => undefined);
  const type = config.transport ?? "auto";
  if (config.headers) {
    await restoreHeaderAuthServer(mcp, {
      ...config,
      headers: config.headers,
    });
  } else {
    await addMcpServer(config.name, config.url, { transport: { type } });
  }
  await mcp.waitForConnections({ timeout: 10_000 });
}
