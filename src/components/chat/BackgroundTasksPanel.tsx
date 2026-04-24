import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { listBackgroundTasks } from "../../lib/api-client";
import {
  BACKGROUND_TASK_UPDATED_TYPE,
  BackgroundTaskRecordSchema,
  type BackgroundTaskRecord,
} from "../../worker/agent/background-task-types";

// Minimal interface the panel needs from the parent agent socket — the real
// type comes from `agents/react`'s `useAgent` return; we depend on the
// structural shape so we can keep this file free of that dependency and make
// it easy to test.
type AgentSocket = {
  addEventListener(type: "message", listener: (e: MessageEvent) => void): void;
  removeEventListener(
    type: "message",
    listener: (e: MessageEvent) => void,
  ): void;
};

type Props = {
  agent: AgentSocket;
};

export default function BackgroundTasksPanel({ agent }: Props) {
  const [records, setRecords] = useState<Map<string, BackgroundTaskRecord>>(
    new Map(),
  );
  const [expanded, setExpanded] = useState(true);

  // Initial load from HTTP. Fire-and-forget; the socket broadcast keeps us
  // current after that.
  useEffect(() => {
    let cancelled = false;
    void listBackgroundTasks()
      .then((list) => {
        if (cancelled) return;
        setRecords((prev) => {
          const next = new Map(prev);
          for (const r of list) next.set(r.id, r);
          return next;
        });
      })
      .catch((err: unknown) => {
        console.warn("[background-tasks] initial list failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Live updates: the parent DO broadcasts `background_task_updated` on
  // dispatch and on completion. We merge into the map so late ids show up and
  // existing ones flip status.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (typeof e.data !== "string") return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(e.data);
      } catch {
        return;
      }
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        !("type" in parsed) ||
        parsed.type !== BACKGROUND_TASK_UPDATED_TYPE ||
        !("record" in parsed)
      ) {
        return;
      }
      const result = BackgroundTaskRecordSchema.safeParse(parsed.record);
      if (!result.success) return;
      const record = result.data;
      setRecords((prev) => {
        const next = new Map(prev);
        next.set(record.id, record);
        return next;
      });
    };
    agent.addEventListener("message", onMessage);
    return () => {
      agent.removeEventListener("message", onMessage);
    };
  }, [agent]);

  const sorted = useMemo(() => {
    const copy = [...records.values()];
    // eslint-disable-next-line unicorn/no-array-sort -- `copy` is a fresh array from the Map iterator, not a shared reference.
    copy.sort((a, b) => b.spawnedAt - a.spawnedAt);
    return copy;
  }, [records]);

  if (sorted.length === 0 && !expanded) return null;

  const runningCount = sorted.filter((r) => r.status === "running").length;

  return (
    <aside
      className={[
        "pointer-events-auto fixed right-4 top-20 z-30 w-72 rounded-lg border border-base-300 bg-base-100 shadow-md",
        expanded ? "" : "w-auto",
      ].join(" ")}
    >
      <header className="flex items-center justify-between gap-2 border-b border-base-300 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Background Tasks</span>
          {runningCount > 0 ? (
            <span className="flex items-center gap-1 text-xs text-base-content/70">
              <span className="loading loading-dots loading-xs text-primary" />
              {runningCount} running
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => {
            setExpanded((v) => !v);
          }}
          className="text-xs text-base-content/60 hover:text-base-content"
          aria-label={
            expanded
              ? "Collapse background tasks panel"
              : "Expand background tasks panel"
          }
        >
          {expanded ? "–" : "+"}
        </button>
      </header>

      {expanded ? (
        <ul className="max-h-[55vh] overflow-y-auto p-2">
          {sorted.length === 0 ? (
            <li className="px-2 py-6 text-center text-xs text-base-content/50">
              No background tasks yet.
            </li>
          ) : (
            sorted.map((r) => (
              <li key={r.id}>
                <Link
                  to="/background-tasks/$taskId"
                  params={{ taskId: r.id }}
                  className="mb-1 block rounded-md px-2 py-2 no-underline hover:bg-base-200"
                >
                  <div className="flex items-center gap-2">
                    <StatusDot status={r.status} />
                    <span className="truncate text-xs font-medium">
                      {r.kind}
                    </span>
                    <span className="ml-auto shrink-0 text-[10px] text-base-content/50">
                      {formatElapsed(r)}
                    </span>
                  </div>
                  <div className="mt-1 line-clamp-2 text-[11px] text-base-content/60">
                    {r.brief}
                  </div>
                </Link>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </aside>
  );
}

function StatusDot({ status }: { status: BackgroundTaskRecord["status"] }) {
  const cls =
    status === "running"
      ? "bg-warning animate-pulse"
      : status === "done"
        ? "bg-success"
        : "bg-error";
  return (
    <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${cls}`} />
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
