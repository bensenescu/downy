import { Link } from "@tanstack/react-router";
import type { FileInfo } from "@cloudflare/shell";
import { ChevronRight, FileText, IdCard, Plug, ListTodo } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  encodePath,
  listBackgroundTasks,
  listMcpServers,
  listWorkspaceFiles,
  type McpServerSummary,
} from "../../lib/api-client";
import {
  setSelectedAgentId,
  useAgents,
  useSelectedAgentId,
} from "../../lib/agents-stub";
import {
  BACKGROUND_TASK_UPDATED_TYPE,
  BackgroundTaskRecordSchema,
  type BackgroundTaskRecord,
} from "../../worker/agent/background-task-types";

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

const PREVIEW_LIMIT = 3;

export default function AgentPanel({ agent }: Props) {
  return (
    <aside className="flex w-72 shrink-0 flex-col gap-4 border-r border-base-300 bg-base-100/40 p-4">
      <AgentSelector />
      <IdentitySection />
      <WorkspaceSection />
      <McpSection />
      <BackgroundTasksSection agent={agent} />
    </aside>
  );
}

function AgentSelector() {
  const agents = useAgents();
  const selectedId = useSelectedAgentId();
  const selected = agents.find((a) => a.id === selectedId) ?? agents[0];

  return (
    <div className="dropdown w-full">
      <div
        tabIndex={0}
        role="button"
        className="btn btn-sm btn-block justify-between border-base-300 bg-base-100 font-semibold normal-case"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="size-2 shrink-0 rounded-full bg-primary" />
          <span className="truncate">{selected?.name ?? "Default agent"}</span>
        </span>
        <ChevronRight size={14} className="rotate-90 text-base-content/60" />
      </div>
      <ul
        tabIndex={0}
        className="menu dropdown-content z-30 mt-1 w-64 rounded-box border border-base-300 bg-base-100 p-2 shadow-lg"
      >
        {agents.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              onClick={() => {
                setSelectedAgentId(a.id);
              }}
              className={a.id === selectedId ? "active" : ""}
            >
              {a.name}
            </button>
          </li>
        ))}
        <li className="menu-title pt-2 text-[10px] uppercase">Coming soon</li>
        <li>
          <span className="cursor-not-allowed text-base-content/40">
            + New agent
          </span>
        </li>
      </ul>
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  label,
  to,
}: {
  icon: typeof IdCard;
  label: string;
  to?: string;
}) {
  const content = (
    <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-base-content/60">
      <span className="flex items-center gap-1.5">
        <Icon size={12} />
        {label}
      </span>
      {to ? <ChevronRight size={12} /> : null}
    </div>
  );
  if (!to) return content;
  return (
    <Link
      to={to}
      className="block rounded-md px-1.5 py-1 hover:bg-base-200 hover:text-base-content"
    >
      {content}
    </Link>
  );
}

function IdentitySection() {
  return (
    <section className="flex flex-col gap-1">
      <SectionHeader icon={IdCard} label="Identity" to="/identity" />
      <Link
        to="/identity"
        className="rounded-md px-2 py-1.5 text-xs text-base-content/70 hover:bg-base-200 hover:text-base-content"
      >
        SOUL · IDENTITY · USER · MEMORY
      </Link>
    </section>
  );
}

function WorkspaceSection() {
  const [files, setFiles] = useState<FileInfo[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listWorkspaceFiles()
      .then((list) => {
        if (cancelled) return;
        setFiles(list);
      })
      .catch(() => {
        if (!cancelled) setFiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const preview = useMemo(() => {
    if (!files) return null;
    const sorted = [...files];
    // eslint-disable-next-line unicorn/no-array-sort -- copy is local, mutation is fine.
    sorted.sort((a, b) => b.updatedAt - a.updatedAt);
    return sorted.slice(0, PREVIEW_LIMIT);
  }, [files]);

  return (
    <section className="flex flex-col gap-1">
      <SectionHeader icon={FileText} label="Workspace" to="/workspace" />
      {preview === null ? (
        <div className="px-2 py-1.5 text-xs text-base-content/40">Loading…</div>
      ) : preview.length === 0 ? (
        <div className="px-2 py-1.5 text-xs text-base-content/40">
          No files yet.
        </div>
      ) : (
        <ul className="flex flex-col">
          {preview.map((file) => {
            const display = file.path.replace(/^\/+/, "");
            return (
              <li key={file.path}>
                <Link
                  to="/workspace/$"
                  params={{ _splat: encodePath(display) }}
                  className="block truncate rounded-md px-2 py-1 font-mono text-[11px] text-base-content/70 hover:bg-base-200 hover:text-base-content"
                  title={display}
                >
                  {display}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function McpSection() {
  const [servers, setServers] = useState<McpServerSummary[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listMcpServers()
      .then((list) => {
        if (!cancelled) setServers(list);
      })
      .catch(() => {
        if (!cancelled) setServers([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="flex flex-col gap-1">
      <SectionHeader icon={Plug} label="MCP servers" to="/mcp" />
      {servers === null ? (
        <div className="px-2 py-1.5 text-xs text-base-content/40">Loading…</div>
      ) : servers.length === 0 ? (
        <div className="px-2 py-1.5 text-xs text-base-content/40">
          None connected.
        </div>
      ) : (
        <ul className="flex flex-col gap-1">
          {servers.slice(0, PREVIEW_LIMIT).map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between rounded-md px-2 py-1 text-xs"
            >
              <span className="flex items-center gap-1.5 truncate">
                <McpStatusDot state={s.state} />
                <span className="truncate">{s.name}</span>
              </span>
              <span className="shrink-0 text-[10px] text-base-content/50">
                {s.toolNames.length}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function McpStatusDot({ state }: { state: string }) {
  const cls =
    state === "ready"
      ? "bg-success"
      : state === "failed"
        ? "bg-error"
        : "bg-warning animate-pulse";
  return (
    <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${cls}`} />
  );
}

function BackgroundTasksSection({ agent }: { agent: AgentSocket }) {
  const [records, setRecords] = useState<Map<string, BackgroundTaskRecord>>(
    new Map(),
  );

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
      .catch(() => {
        // ignore — live updates will fill in
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
    // eslint-disable-next-line unicorn/no-array-sort -- copy is a fresh array.
    copy.sort((a, b) => b.spawnedAt - a.spawnedAt);
    return copy;
  }, [records]);

  const preview = sorted.slice(0, PREVIEW_LIMIT);
  const runningCount = sorted.filter((r) => r.status === "running").length;

  return (
    <section className="flex flex-col gap-1">
      <SectionHeader
        icon={ListTodo}
        label={`Background tasks${runningCount > 0 ? ` · ${String(runningCount)} running` : ""}`}
        to="/background-tasks"
      />
      {preview.length === 0 ? (
        <div className="px-2 py-1.5 text-xs text-base-content/40">
          No tasks yet.
        </div>
      ) : (
        <ul className="flex flex-col">
          {preview.map((r) => (
            <li key={r.id}>
              <Link
                to="/background-tasks/$taskId"
                params={{ taskId: r.id }}
                className="block rounded-md px-2 py-1.5 hover:bg-base-200"
              >
                <div className="flex items-center gap-2">
                  <TaskStatusDot status={r.status} />
                  <span className="truncate text-xs font-medium">{r.kind}</span>
                  <span className="ml-auto shrink-0 text-[10px] text-base-content/50">
                    {formatElapsed(r)}
                  </span>
                </div>
                <div className="mt-0.5 line-clamp-1 text-[11px] text-base-content/60">
                  {r.brief}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {sorted.length > PREVIEW_LIMIT ? (
        <Link
          to="/background-tasks"
          className="px-2 py-1 text-[11px] font-medium text-primary hover:underline"
        >
          View all ({sorted.length}) →
        </Link>
      ) : null}
    </section>
  );
}

function TaskStatusDot({ status }: { status: BackgroundTaskRecord["status"] }) {
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
