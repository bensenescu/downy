import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo } from "react";

import { withBack } from "../lib/back-nav";
import { useBackgroundTasks } from "../lib/queries";
import type { BackgroundTaskRecord } from "../worker/agent/background-task-types";

export const Route = createFileRoute("/agent/$slug/background-tasks/")({
  component: BackgroundTasksIndex,
});

function statusClass(status: BackgroundTaskRecord["status"]): string {
  if (status === "running") return "bg-warning animate-pulse";
  if (status === "done") return "bg-success";
  return "bg-error";
}

function formatElapsed(r: BackgroundTaskRecord): string {
  const end = r.completedAt ?? Date.now();
  const ms = end - r.spawnedAt;
  if (ms < 1000) return `${String(ms)}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${String(s)}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(m)}m${String(rem).padStart(2, "0")}s`;
}

function BackgroundTasksIndex() {
  const { slug } = Route.useParams();
  // Same query key the sidebar's BackgroundTasksSection writes into via
  // setQueryData on every WebSocket message — so this list updates live
  // without us subscribing to the socket from here.
  const { data: tasks, error: queryError } = useBackgroundTasks(slug);
  const error = queryError
    ? queryError instanceof Error
      ? queryError.message
      : String(queryError)
    : null;

  const sorted = useMemo(() => {
    if (!tasks) return null;
    const copy = [...tasks];
    // eslint-disable-next-line unicorn/no-array-sort -- copy is local.
    copy.sort((a, b) => b.spawnedAt - a.spawnedAt);
    return copy;
  }, [tasks]);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-12 pt-8">
      <Link
        to="/agent/$slug"
        params={{ slug }}
        className="btn btn-ghost btn-sm mb-4 gap-1 px-2"
      >
        <ChevronLeft size={14} />
        Back to chat
      </Link>
      <div className="mb-6">
        <p className="mb-2 text-xs font-bold uppercase tracking-widest text-primary">
          Background tasks
        </p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Everything Claw is working on.
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-base-content/70 sm:text-base">
          Each task runs in its own child agent. Click any row to watch its
          messages live.
        </p>
      </div>

      {error ? (
        <div role="alert" className="alert alert-error mb-4">
          <span>{error}</span>
        </div>
      ) : null}

      {!sorted && !error ? (
        <div className="flex items-center gap-2 text-sm text-base-content/60">
          <span className="loading loading-spinner loading-sm" />
          <span>Loading…</span>
        </div>
      ) : null}

      {sorted && sorted.length === 0 ? (
        <div className="card border border-base-300 bg-base-100">
          <div className="card-body items-center text-center text-sm text-base-content/70">
            No background tasks yet.
          </div>
        </div>
      ) : null}

      {sorted && sorted.length > 0 ? (
        <ul className="grid gap-2">
          {sorted.map((r) => (
            <li key={r.id}>
              <Link
                to="/agent/$slug/background-tasks/$taskId"
                params={{ slug, taskId: r.id }}
                state={withBack({
                  href: `/agent/${slug}/background-tasks`,
                  label: "background tasks",
                })}
                className="card card-compact group border border-base-300 bg-base-100 no-underline shadow-sm transition hover:border-primary/50 hover:shadow-md"
              >
                <div className="card-body flex-row items-start justify-between gap-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-block h-2 w-2 shrink-0 rounded-full ${statusClass(r.status)}`}
                      />
                      <span className="truncate text-sm font-semibold">
                        {r.kind}
                      </span>
                      <span className="ml-auto shrink-0 text-xs text-base-content/60">
                        {formatElapsed(r)}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-base-content/70">
                      {r.brief}
                    </p>
                  </div>
                  <ChevronRight
                    size={18}
                    className="mt-1 flex-shrink-0 text-base-content/40 transition group-hover:translate-x-0.5 group-hover:text-primary"
                  />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </main>
  );
}
