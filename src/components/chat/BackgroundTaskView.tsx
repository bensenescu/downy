import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { useEffect, useRef, useState } from "react";

import { listBackgroundTasks } from "../../lib/api-client";
import { useCurrentAgentSlug } from "../../lib/agents";
import type { BackgroundTaskRecord } from "../../worker/agent/background-task-types";
import MessageView from "./MessageView";

type Props = {
  taskId: string;
};

/**
 * Live observer for a single background task. The child DO extends `Think`
 * just like the main agent, so we connect with the exact same `useAgent` +
 * `useAgentChat` plumbing — same message protocol, same `UIMessage[]` shape,
 * same `MessageView` renderer. The only thing that differs is the DO name
 * (`ChildAgent` / `taskId` vs `DownyAgent` / agent slug) and a small
 * header showing the task's kind/brief/status.
 */
export default function BackgroundTaskView({ taskId }: Props) {
  const slug = useCurrentAgentSlug();
  const agent = useAgent({
    agent: "ChildAgent",
    name: taskId,
    protocol: window.location.protocol === "https:" ? "wss" : "ws",
  });

  const { messages, status, isStreaming } = useAgentChat({
    agent,
    getInitialMessages: null,
    // See ChatPage.tsx — throttling the messages callback prevents fast
    // streams from overwhelming React's per-fiber update-depth guard.
    experimental_throttle: 50,
  });

  // Record metadata lives on the parent DO (written by
  // `spawn_background_task`). Fetch it once to render the header.
  // `listBackgroundTasks` already exists and caches well enough — a dedicated
  // single-record endpoint is avoidable churn.
  const [record, setRecord] = useState<BackgroundTaskRecord | null>(null);
  useEffect(() => {
    let cancelled = false;
    void listBackgroundTasks(slug)
      .then((list) => {
        if (cancelled) return;
        setRecord(list.find((r) => r.id === taskId) ?? null);
      })
      .catch((err: unknown) => {
        console.warn("[background-task-view] record fetch failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [taskId, slug]);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, isStreaming]);

  const displayStatus: BackgroundTaskRecord["status"] =
    record?.status ?? "running";
  const running = displayStatus === "running";

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-base-300 bg-base-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <StatusDot status={displayStatus} />
          <span className="font-mono text-xs text-base-content/60">
            {record?.kind ?? "background task"}
          </span>
          {running ? (
            <span className="flex items-center gap-1 text-xs text-base-content/60">
              <span className="loading loading-dots loading-xs text-primary" />
              running
            </span>
          ) : record?.completedAt ? (
            <span className="text-xs text-base-content/60">
              finished in{" "}
              {formatElapsedBetween(record.spawnedAt, record.completedAt)}
            </span>
          ) : null}
          <span className="ml-auto font-mono text-[10px] text-base-content/40">
            {taskId}
          </span>
        </div>
        {record?.brief ? (
          <p className="mt-1 line-clamp-3 text-sm text-base-content/80">
            {record.brief}
          </p>
        ) : null}
      </header>

      <div
        ref={scrollRef}
        className="flex-1 space-y-5 overflow-y-auto px-4 py-4"
      >
        {messages.length === 0 ? (
          <div className="pt-8 text-center text-xs text-base-content/50">
            Waiting…
          </div>
        ) : (
          messages.map((message, idx) => {
            const isLast = idx === messages.length - 1;
            const turnEnded =
              !isLast || (!isStreaming && status !== "submitted");
            return (
              <MessageView
                key={message.id}
                message={message}
                turnEnded={turnEnded}
              />
            );
          })
        )}
      </div>
    </div>
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

function formatElapsedBetween(start: number, end: number): string {
  const ms = end - start;
  if (ms < 1000) return `${String(ms)}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${String(s)}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(m)}m${String(rem).padStart(2, "0")}s`;
}
