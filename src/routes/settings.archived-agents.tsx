import { createFileRoute } from "@tanstack/react-router";
import { RefreshCw, RotateCcw } from "lucide-react";
import { useState } from "react";

import BackLink from "../components/ui/BackLink";
import ErrorAlert, { errorMessage } from "../components/ui/ErrorAlert";
import PageHeader from "../components/ui/PageHeader";
import PageShell from "../components/ui/PageShell";
import { useArchivedAgents, useUnarchiveAgent } from "../lib/agents";

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
  const archivedQ = useArchivedAgents();
  const unarchiveMut = useUnarchiveAgent();
  const [error, setError] = useState<string | null>(null);
  const [busySlug, setBusySlug] = useState<string | null>(null);

  // Server endpoint may include non-archived rows when called with the
  // `archived` flag; filter to be safe.
  const agents = archivedQ.data?.filter((a) => a.archivedAt !== null) ?? null;
  const displayError = error ?? errorMessage(archivedQ.error);
  const load = () => {
    void archivedQ.refetch();
  };

  return (
    <PageShell>
      <BackLink to="/settings" label="settings" variant="chip" />

      <PageHeader
        kicker="Archived agents"
        title="Archived agents."
        right={
          <button
            type="button"
            onClick={load}
            className="btn btn-ghost btn-sm gap-1.5"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        }
      />

      <ErrorAlert message={displayError} />

      {!agents && !displayError ? (
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
                      await unarchiveMut.mutateAsync(a.slug);
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
    </PageShell>
  );
}
