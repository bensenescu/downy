import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useMemo } from "react";

import { withBack } from "../lib/back-nav";
import { useBackgroundTasks } from "../lib/queries";
import type { BackgroundTaskRecord } from "../worker/agent/background-task-types";

export const Route = createFileRoute("/agent/$slug/background-tasks/")({
  component: BackgroundTasksIndex,
});

function StatusDot({ status }: { status: BackgroundTaskRecord["status"] }) {
  const colorClass =
    status === "running"
      ? "bg-warning"
      : status === "done"
        ? "bg-success"
        : "bg-error";
  return (
    <span className="relative inline-flex h-2 w-2 flex-shrink-0 items-center justify-center">
      {status === "running" ? (
        <span
          className={`absolute inline-flex h-full w-full animate-ping rounded-full ${colorClass} opacity-60`}
        />
      ) : null}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${colorClass}`} />
    </span>
  );
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
        className="link link-hover mb-4 inline-flex items-center gap-1 text-sm text-base-content/70 hover:text-base-content"
      >
        <ChevronLeft size={14} />
        Back to chat
      </Link>
      <div className="mb-6">
        <p className="mb-2 text-xs font-bold uppercase tracking-widest text-primary">
          Background tasks
        </p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Running tasks.
        </h1>
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
        <p className="py-12 text-center text-sm text-base-content/55">
          No background tasks yet.
        </p>
      ) : null}

      {sorted && sorted.length > 0 ? (
        <ul className="-mx-2 divide-y divide-base-300/70 border-y border-base-300/70">
          {sorted.map((r) => (
            <li key={r.id}>
              <Link
                to="/agent/$slug/background-tasks/$taskId"
                params={{ slug, taskId: r.id }}
                state={withBack({
                  href: `/agent/${slug}/background-tasks`,
                  label: "background tasks",
                })}
                className="group block px-3 py-4 no-underline transition-colors hover:bg-base-200"
              >
                <div className="flex items-center gap-3">
                  <StatusDot status={r.status} />
                  <span className="truncate text-sm font-semibold tracking-tight">
                    {r.kind}
                  </span>
                  <span className="font-mono text-[11px] uppercase tracking-wider text-base-content/40">
                    {r.status}
                  </span>
                  <span className="ml-auto flex-shrink-0 font-mono text-[11px] tabular-nums text-base-content/45">
                    {formatElapsed(r)}
                  </span>
                </div>
                <p className="mt-1.5 line-clamp-2 pl-5 text-[13px] leading-relaxed text-base-content/65">
                  {r.brief}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </main>
  );
}
