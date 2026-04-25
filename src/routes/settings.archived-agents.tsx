import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, RefreshCw, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";

import {
  listAgents,
  refreshAgents,
  unarchiveAgent,
  type AgentRecord,
} from "../lib/agents";

export const Route = createFileRoute("/settings/archived-agents")({
  component: ArchivedAgentsPage,
});

function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function ArchivedAgentsPage() {
  const [agents, setAgents] = useState<AgentRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busySlug, setBusySlug] = useState<string | null>(null);

  const load = () => {
    listAgents({ archived: true })
      .then((rows) => {
        setAgents(rows.filter((a) => a.archivedAt !== null));
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-12 pt-8">
      <Link to="/settings" className="btn btn-ghost btn-sm mb-4 gap-1 px-2">
        <ChevronLeft size={14} />
        Back to settings
      </Link>

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-widest text-primary">
            Archived agents
          </p>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Past agents you can restore.
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-base-content/70 sm:text-base">
            Archived agents are hidden from the dropdown and from peer reads,
            but their workspace and identity files are kept.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="btn btn-ghost btn-sm gap-1.5"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {error ? (
        <div role="alert" className="alert alert-error mb-4">
          <span>{error}</span>
        </div>
      ) : null}

      {!agents && !error ? (
        <div className="flex items-center gap-2 text-sm text-base-content/60">
          <span className="loading loading-spinner loading-sm" />
          <span>Loading…</span>
        </div>
      ) : null}

      {agents && agents.length === 0 ? (
        <div className="card border border-base-300 bg-base-100">
          <div className="card-body items-center text-center text-sm text-base-content/70">
            No archived agents.
          </div>
        </div>
      ) : null}

      {agents && agents.length > 0 ? (
        <ul className="grid gap-2">
          {agents.map((a) => (
            <li
              key={a.slug}
              className="card card-compact border border-base-300 bg-base-100"
            >
              <div className="card-body flex-row items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="badge badge-ghost badge-sm font-mono text-xs">
                      {a.slug}
                    </span>
                    <span className="font-semibold">{a.displayName}</span>
                  </div>
                  <p className="mt-1 text-xs text-base-content/60">
                    archived {a.archivedAt ? formatDate(a.archivedAt) : ""}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-outline btn-sm gap-1.5"
                  disabled={busySlug === a.slug}
                  onClick={async () => {
                    setBusySlug(a.slug);
                    try {
                      await unarchiveAgent(a.slug);
                      await refreshAgents();
                      load();
                    } catch (err) {
                      setError(
                        err instanceof Error ? err.message : String(err),
                      );
                    } finally {
                      setBusySlug(null);
                    }
                  }}
                >
                  <RotateCcw size={14} />
                  Restore
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </main>
  );
}
