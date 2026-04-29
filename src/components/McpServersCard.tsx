import { useAgent } from "agents/react";

import { useCurrentAgentSlug } from "../lib/agents";
import {
  useDeleteMcpServer,
  useMcpServers,
  useMcpServersLiveSync,
} from "../lib/queries";

type DotKind = "ready" | "in-flight" | "failed" | "neutral";

function dotKindFor(state: string): DotKind {
  switch (state) {
    case "ready":
      return "ready";
    case "failed":
      return "failed";
    case "authenticating":
    case "connecting":
    case "discovering":
    case "connected":
      return "in-flight";
    default:
      return "neutral";
  }
}

function StatusDot({ state }: { state: string }) {
  const kind = dotKindFor(state);
  const colorClass =
    kind === "ready"
      ? "bg-success"
      : kind === "failed"
        ? "bg-error"
        : kind === "in-flight"
          ? "bg-warning"
          : "bg-base-content/40";
  return (
    <span
      title={state}
      className="relative inline-flex h-2 w-2 flex-shrink-0 items-center justify-center"
    >
      {kind === "in-flight" ? (
        <span
          className={`absolute inline-flex h-full w-full animate-ping rounded-full ${colorClass} opacity-60`}
        />
      ) : null}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${colorClass}`} />
    </span>
  );
}

export default function McpServersCard() {
  const slug = useCurrentAgentSlug();
  // Open our own socket to the agent so connect/disconnect events broadcast
  // by the agents SDK invalidate the mcpServers query and re-render live —
  // this page lives outside the chat tree and so doesn't share its socket.
  const agent = useAgent({
    agent: "DownyAgent",
    name: slug,
    protocol: window.location.protocol === "https:" ? "wss" : "ws",
  });
  useMcpServersLiveSync(agent, slug);
  const { data: servers, error: queryError } = useMcpServers(slug);
  const deleteServer = useDeleteMcpServer();
  const error = queryError
    ? queryError instanceof Error
      ? queryError.message
      : String(queryError)
    : null;

  function handleRemove(server: { id: string; name: string }) {
    const ok = window.confirm(`Remove "${server.name}"?`);
    if (!ok) return;
    deleteServer.mutate(
      { slug, id: server.id },
      {
        onError: (err) => {
          window.alert(
            `Failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        },
      },
    );
  }

  if (error) {
    return (
      <div role="alert" className="alert alert-error">
        <span>{error}</span>
      </div>
    );
  }

  if (!servers) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-base-content/60">
        <span className="loading loading-spinner loading-sm" />
        <span>Loading…</span>
      </div>
    );
  }

  if (servers.length === 0) {
    return (
      <p className="py-6 text-sm text-base-content/55">
        None connected. Ask the agent to connect one.
      </p>
    );
  }

  return (
    <ul className="-mx-1 divide-y divide-base-300/70 border-y border-base-300/70">
      {servers.map((server) => {
        const removingThis =
          deleteServer.isPending && deleteServer.variables?.id === server.id;
        return (
          <li key={server.id} className="px-3 py-4">
            <div className="flex items-center gap-3">
              <StatusDot state={server.state} />
              <span className="text-sm font-semibold tracking-tight">
                {server.name}
              </span>
              <span className="font-mono text-[11px] tabular-nums text-base-content/45">
                {server.toolNames.length}{" "}
                {server.toolNames.length === 1 ? "tool" : "tools"}
              </span>
              <span className="font-mono text-[11px] uppercase tracking-wider text-base-content/40">
                {server.state}
              </span>
              <button
                type="button"
                onClick={() => handleRemove(server)}
                disabled={removingThis}
                className="btn btn-ghost btn-xs ml-auto text-error/75 hover:bg-error/10 hover:text-error"
              >
                {removingThis ? "Removing…" : "Remove"}
              </button>
            </div>

            <div className="mt-1.5 truncate pl-5 font-mono text-[11.5px] text-base-content/45">
              {server.url}
            </div>

            {server.error ? (
              <div className="mt-2 pl-5 text-xs text-error/85">
                {server.error}
              </div>
            ) : null}

            {server.toolNames.length > 0 ? (
              <details className="group/tools mt-2 pl-5">
                <summary className="cursor-pointer list-none text-[11.5px] font-medium text-base-content/55 hover:text-base-content/85">
                  <span className="group-open/tools:hidden">
                    Show tools ▸
                  </span>
                  <span className="hidden group-open/tools:inline">
                    Hide tools ▾
                  </span>
                </summary>
                <div className="mt-2 flex max-h-64 flex-wrap gap-1 overflow-y-auto">
                  {server.toolNames.map((name) => (
                    <span
                      key={name}
                      className="rounded bg-base-200 px-2 py-0.5 font-mono text-[11px] text-base-content/75"
                    >
                      {name}
                    </span>
                  ))}
                </div>
              </details>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
