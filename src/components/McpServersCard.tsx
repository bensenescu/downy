import { useAgent } from "agents/react";
import { useState } from "react";

import { useCurrentAgentSlug } from "../lib/agents";
import {
  useConnectMcpServer,
  useDeleteMcpServer,
  useMcpServers,
  useMcpServersLiveSync,
} from "../lib/queries";
import { alertDialog, confirmDialog } from "./ui/dialog";
import ErrorAlert, { errorMessage } from "./ui/ErrorAlert";
import StatusDot from "./ui/StatusDot";
import { Plus, X } from "lucide-react";

function statusToneFor(state: string): {
  tone: "success" | "warning" | "error" | "neutral";
  pulse: boolean;
} {
  switch (state) {
    case "ready":
      return { tone: "success", pulse: false };
    case "failed":
      return { tone: "error", pulse: false };
    case "authenticating":
    case "connecting":
    case "discovering":
    case "connected":
      return { tone: "warning", pulse: true };
    default:
      return { tone: "neutral", pulse: false };
  }
}

export default function McpServersCard() {
  const slug = useCurrentAgentSlug();
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newTransport, setNewTransport] = useState<
    "auto" | "sse" | "streamable-http"
  >("auto");

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
  const connectServer = useConnectMcpServer();
  const error = errorMessage(queryError);

  async function handleRemove(server: { id: string; name: string }) {
    const ok = await confirmDialog({
      title: "Remove server?",
      message: `Remove "${server.name}"?`,
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (!ok) return;
    deleteServer.mutate(
      { slug, id: server.id },
      {
        onError: (err) => {
          void alertDialog({
            title: "Failed",
            message: err instanceof Error ? err.message : String(err),
          });
        },
      },
    );
  }

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    connectServer.mutate(
      { slug, name: newName, url: newUrl, transport: newTransport },
      {
        onSuccess: () => {
          setShowAdd(false);
          setNewName("");
          setNewUrl("");
        },
        onError: (err) => {
          void alertDialog({
            title: "Failed to connect",
            message: err instanceof Error ? err.message : String(err),
          });
        },
      },
    );
  }

  if (error) {
    return <ErrorAlert message={error} className="mb-0" />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase opacity-50 tracking-wider">
          Connected Servers
        </h3>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="btn btn-xs btn-primary gap-1"
        >
          {showAdd ? <X size={12} /> : <Plus size={12} />}
          {showAdd ? "Cancel" : "Add Server"}
        </button>
      </div>

      {showAdd && (
        <form
          onSubmit={handleConnect}
          className="bg-base-200 p-4 rounded-lg space-y-3"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="form-control">
              <label className="label py-1 text-[10px] font-bold uppercase opacity-50">
                Name
              </label>
              <input
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="My Server"
                className="input input-bordered input-sm"
              />
            </div>
            <div className="form-control">
              <label className="label py-1 text-[10px] font-bold uppercase opacity-50">
                Transport
              </label>
              <select
                value={newTransport}
                onChange={(e) => setNewTransport(e.target.value as any)}
                className="select select-bordered select-sm"
              >
                <option value="auto">Auto</option>
                <option value="sse">SSE</option>
                <option value="streamable-http">HTTP</option>
              </select>
            </div>
            <div className="form-control md:col-span-2">
              <label className="label py-1 text-[10px] font-bold uppercase opacity-50">
                Server URL
              </label>
              <input
                required
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="https://..."
                className="input input-bordered input-sm"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={connectServer.isPending}
              className="btn btn-sm btn-primary"
            >
              {connectServer.isPending ? "Connecting..." : "Connect Server"}
            </button>
          </div>
        </form>
      )}

      {!servers ? (
        <div className="flex items-center gap-2 py-6 text-sm text-base-content/60">
          <span className="loading loading-spinner loading-sm" />
          <span>Loading…</span>
        </div>
      ) : servers.length === 0 ? (
        <p className="py-6 text-sm text-base-content/55">
          None connected.{" "}
          {showAdd ? "" : "Add one above or ask the agent to connect one."}
        </p>
      ) : (
        <ul className="-mx-1 divide-y divide-base-300/70 border-y border-base-300/70">
          {servers.map((server) => {
            const removingThis =
              deleteServer.isPending &&
              deleteServer.variables?.id === server.id;
            return (
              <li key={server.id} className="px-3 py-4">
                <div className="flex items-center gap-3">
                  <StatusDot
                    tone={statusToneFor(server.state).tone}
                    pulse={statusToneFor(server.state).pulse}
                    title={server.state}
                  />
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
                    onClick={() => void handleRemove(server)}
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
      )}
    </div>
  );
}
