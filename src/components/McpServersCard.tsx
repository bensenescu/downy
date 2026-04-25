import { useCurrentAgentSlug } from "../lib/agents";
import { useMcpServers } from "../lib/queries";

// Map the agent's MCPConnectionState values to a daisyUI badge variant. "ready"
// is the only fully-good state; everything in-flight is neutral; the failed
// terminal state is the only one that should look alarming.
function stateBadgeClass(state: string): string {
  switch (state) {
    case "ready":
      return "badge-success";
    case "failed":
      return "badge-error";
    case "authenticating":
    case "connecting":
    case "discovering":
    case "connected":
      return "badge-warning";
    default:
      return "badge-ghost";
  }
}

export default function McpServersCard() {
  const slug = useCurrentAgentSlug();
  const { data: servers, error: queryError } = useMcpServers(slug);
  const error = queryError
    ? queryError instanceof Error
      ? queryError.message
      : String(queryError)
    : null;

  return (
    <section className="card card-compact border border-base-300 bg-base-100 shadow-sm">
      <div className="card-body gap-4">
        <div>
          <h2 className="text-base font-semibold">Connected MCP servers</h2>
          <p className="text-sm text-base-content/70">
            Remote tool servers Claw has attached this session. Ask Claw to
            connect or disconnect a server in chat.
          </p>
        </div>

        {error ? (
          <div role="alert" className="alert alert-error">
            <span>{error}</span>
          </div>
        ) : null}

        {!servers && !error ? (
          <div className="flex items-center gap-2 text-sm text-base-content/60">
            <span className="loading loading-spinner loading-sm" />
            <span>Loading…</span>
          </div>
        ) : null}

        {servers && servers.length === 0 ? (
          <p className="text-sm text-base-content/60">
            No MCP servers connected. Ask Claw to connect one — for example,
            "connect the Sentry MCP server."
          </p>
        ) : null}

        {servers && servers.length > 0 ? (
          <ul className="grid gap-3">
            {servers.map((server) => (
              <li
                key={server.id}
                className="rounded-box border border-base-300 bg-base-200/40 p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{server.name}</span>
                  <span
                    className={`badge badge-sm ${stateBadgeClass(server.state)}`}
                  >
                    {server.state}
                  </span>
                  <span className="text-xs text-base-content/60">
                    {server.toolNames.length}{" "}
                    {server.toolNames.length === 1 ? "tool" : "tools"}
                  </span>
                </div>

                <div className="mt-1 truncate text-xs text-base-content/60">
                  {server.url}
                </div>

                {server.error ? (
                  <div className="mt-2 text-xs text-error">{server.error}</div>
                ) : null}

                {server.toolNames.length > 0 ? (
                  <details className="group/tools mt-2">
                    <summary className="cursor-pointer list-none text-xs text-base-content/70 hover:text-base-content">
                      <span className="group-open/tools:hidden">
                        Show tools ▸
                      </span>
                      <span className="hidden group-open/tools:inline">
                        Hide tools ▾
                      </span>
                    </summary>
                    <div className="mt-2 max-h-64 overflow-y-auto rounded-box border border-base-300 bg-base-100 p-2">
                      <div className="flex flex-wrap gap-1">
                        {server.toolNames.map((name) => (
                          <span
                            key={name}
                            className="badge badge-ghost badge-sm font-mono text-xs"
                          >
                            {name}
                          </span>
                        ))}
                      </div>
                    </div>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
