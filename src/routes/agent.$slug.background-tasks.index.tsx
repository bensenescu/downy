import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";

import BackLink from "../components/ui/BackLink";
import ErrorAlert, { errorMessage } from "../components/ui/ErrorAlert";
import PageHeader from "../components/ui/PageHeader";
import PageShell from "../components/ui/PageShell";
import StatusDot from "../components/ui/StatusDot";
import { withBack } from "../lib/back-nav";
import { useBackgroundTasks } from "../lib/queries";
import type { BackgroundTaskRecord } from "../worker/agent/background-task-types";

export const Route = createFileRoute("/agent/$slug/background-tasks/")({
  component: BackgroundTasksIndex,
});

function statusToneFor(status: BackgroundTaskRecord["status"]): {
  tone: "success" | "warning" | "error";
  pulse: boolean;
} {
  if (status === "running") return { tone: "warning", pulse: true };
  if (status === "done") return { tone: "success", pulse: false };
  return { tone: "error", pulse: false };
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
  const error = errorMessage(queryError);

  const sorted = useMemo(() => {
    if (!tasks) return null;
    const copy = [...tasks];
    // eslint-disable-next-line unicorn/no-array-sort -- copy is local.
    copy.sort((a, b) => b.spawnedAt - a.spawnedAt);
    return copy;
  }, [tasks]);

  return (
    <PageShell width="wide">
      <BackLink to="/agent/$slug" params={{ slug }} label="chat" />
      <PageHeader kicker="Background tasks" title="Running tasks." />

      <ErrorAlert message={error} />

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
          {sorted.map((r) => {
            const { tone, pulse } = statusToneFor(r.status);
            return (
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
                    <StatusDot tone={tone} pulse={pulse} title={r.status} />
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
            );
          })}
        </ul>
      ) : null}
    </PageShell>
  );
}
