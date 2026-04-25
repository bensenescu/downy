import { Link, useNavigate } from "@tanstack/react-router";
import type { FileInfo } from "@cloudflare/shell";
import {
  ChevronRight,
  FileText,
  IdCard,
  ListTodo,
  Lock,
  Plug,
  Plus,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  encodePath,
  listBackgroundTasks,
  listMcpServers,
  listSkills,
  listWorkspaceFiles,
  type McpServerSummary,
  type SkillSummary,
} from "../../lib/api-client";
import { useAgents, useCurrentAgentSlug } from "../../lib/agents";
import { withBack } from "../../lib/back-nav";
import { NewAgentModal } from "./NewAgentModal";
import {
  BACKGROUND_TASK_UPDATED_TYPE,
  BackgroundTaskRecordSchema,
  type BackgroundTaskRecord,
} from "../../worker/agent/background-task-types";

export type AgentSocket = {
  addEventListener(type: "message", listener: (e: MessageEvent) => void): void;
  removeEventListener(
    type: "message",
    listener: (e: MessageEvent) => void,
  ): void;
};

const PREVIEW_LIMIT = 3;

export function AgentSelector() {
  const agents = useAgents();
  const selectedSlug = useCurrentAgentSlug();
  const selected =
    agents.find((a) => a.slug === selectedSlug) ?? agents[0] ?? null;
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  return (
    <div className="dropdown w-full">
      <div
        tabIndex={0}
        role="button"
        className="btn btn-sm btn-block justify-between border-base-300 bg-base-100 font-semibold normal-case"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="size-2 shrink-0 rounded-full bg-primary" />
          <span className="truncate">
            {selected?.displayName ?? "Default agent"}
          </span>
          {selected?.isPrivate ? (
            <Lock size={11} className="shrink-0 text-base-content/60" />
          ) : null}
        </span>
        <ChevronRight size={14} className="rotate-90 text-base-content/60" />
      </div>
      <ul
        tabIndex={0}
        className="menu dropdown-content z-30 mt-1 w-64 rounded-box border border-base-300 bg-base-100 p-2 shadow-lg"
      >
        {agents.map((a) => (
          <li key={a.slug}>
            <button
              type="button"
              onClick={() => {
                void navigate({
                  to: "/agent/$slug",
                  params: { slug: a.slug },
                });
              }}
              className={a.slug === selectedSlug ? "active" : ""}
            >
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span className="truncate">{a.displayName}</span>
                {a.isPrivate ? (
                  <Lock size={11} className="shrink-0 text-base-content/60" />
                ) : null}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-base-content/40">
                {a.slug}
              </span>
            </button>
          </li>
        ))}
        <li className="border-t border-base-300 pt-1">
          <button
            type="button"
            onClick={() => {
              setCreating(true);
            }}
            className="text-primary"
          >
            <Plus size={14} />
            New agent
          </button>
        </li>
      </ul>
      {creating ? (
        <NewAgentModal
          onClose={() => {
            setCreating(false);
          }}
        />
      ) : null}
    </div>
  );
}


type SectionTarget =
  | { kind: "identity" }
  | { kind: "workspace" }
  | { kind: "mcp" }
  | { kind: "skills" }
  | { kind: "background-tasks" };

function SectionHeader({
  icon: Icon,
  label,
  target,
  slug,
  onClick,
}: {
  icon: typeof IdCard;
  label: string;
  target?: SectionTarget;
  slug?: string;
  onClick?: () => void;
}) {
  const content = (
    <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-base-content/60">
      <span className="flex items-center gap-1.5">
        <Icon size={12} />
        {label}
      </span>
      {target ? <ChevronRight size={12} /> : null}
    </div>
  );
  if (!target || !slug) return content;
  const linkClass =
    "block rounded-md px-1.5 py-1 hover:bg-base-200 hover:text-base-content";
  switch (target.kind) {
    case "identity":
      return (
        <Link
          to="/agent/$slug/identity"
          params={{ slug }}
          onClick={onClick}
          className={linkClass}
        >
          {content}
        </Link>
      );
    case "workspace":
      return (
        <Link
          to="/agent/$slug/workspace"
          params={{ slug }}
          onClick={onClick}
          className={linkClass}
        >
          {content}
        </Link>
      );
    case "mcp":
      return (
        <Link
          to="/agent/$slug/mcp"
          params={{ slug }}
          onClick={onClick}
          className={linkClass}
        >
          {content}
        </Link>
      );
    case "skills":
      return (
        <Link
          to="/agent/$slug/skills"
          params={{ slug }}
          onClick={onClick}
          className={linkClass}
        >
          {content}
        </Link>
      );
    case "background-tasks":
      return (
        <Link
          to="/agent/$slug/background-tasks"
          params={{ slug }}
          onClick={onClick}
          className={linkClass}
        >
          {content}
        </Link>
      );
  }
}

export function IdentitySection({ onNavigate }: { onNavigate?: () => void }) {
  const slug = useCurrentAgentSlug();
  return (
    <section className="flex flex-col gap-1">
      <SectionHeader
        icon={IdCard}
        label="Identity"
        target={{ kind: "identity" }}
        slug={slug}
        onClick={onNavigate}
      />
      <Link
        to="/agent/$slug/identity"
        params={{ slug }}
        onClick={onNavigate}
        className="rounded-md px-2 py-1.5 text-xs text-base-content/70 hover:bg-base-200 hover:text-base-content"
      >
        SOUL · IDENTITY · USER · MEMORY
      </Link>
    </section>
  );
}

export function WorkspaceSection({ onNavigate }: { onNavigate?: () => void }) {
  const slug = useCurrentAgentSlug();
  const [files, setFiles] = useState<FileInfo[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listWorkspaceFiles(slug)
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
  }, [slug]);

  const preview = useMemo(() => {
    if (!files) return null;
    const sorted = [...files];
    // eslint-disable-next-line unicorn/no-array-sort -- copy is local.
    sorted.sort((a, b) => b.updatedAt - a.updatedAt);
    return sorted.slice(0, PREVIEW_LIMIT);
  }, [files]);

  return (
    <section className="flex flex-col gap-1">
      <SectionHeader
        icon={FileText}
        label="Workspace"
        target={{ kind: "workspace" }}
        slug={slug}
        onClick={onNavigate}
      />
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
                  to="/agent/$slug/workspace/$"
                  params={{ slug, _splat: encodePath(display) }}
                  state={withBack({ href: `/agent/${slug}`, label: "chat" })}
                  onClick={onNavigate}
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

export function SkillsSection({ onNavigate }: { onNavigate?: () => void }) {
  const slug = useCurrentAgentSlug();
  const [skills, setSkills] = useState<SkillSummary[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listSkills(slug)
      .then((list) => {
        if (!cancelled) setSkills(list);
      })
      .catch(() => {
        if (!cancelled) setSkills([]);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Hidden skills are still listed in the UI sidebar — they're "hidden from
  // the prompt catalog," not from the user. The user authored them and
  // should be able to see and edit them.
  const preview = skills?.slice(0, PREVIEW_LIMIT) ?? null;

  return (
    <section className="flex flex-col gap-1">
      <SectionHeader
        icon={Sparkles}
        label="Skills"
        target={{ kind: "skills" }}
        slug={slug}
        onClick={onNavigate}
      />
      {preview === null ? (
        <div className="px-2 py-1.5 text-xs text-base-content/40">Loading…</div>
      ) : preview.length === 0 ? (
        <div className="px-2 py-1.5 text-xs text-base-content/40">
          No skills yet.
        </div>
      ) : (
        <ul className="flex flex-col">
          {preview.map((s) => (
            <li key={s.name}>
              <Link
                to="/agent/$slug/skills"
                params={{ slug }}
                onClick={onNavigate}
                className="block rounded-md px-2 py-1 hover:bg-base-200"
                title={s.description}
              >
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-xs font-medium">{s.name}</span>
                  {s.hidden ? (
                    <span className="shrink-0 text-[10px] text-base-content/40">
                      hidden
                    </span>
                  ) : null}
                </div>
                <div className="mt-0.5 line-clamp-1 text-[11px] text-base-content/60">
                  {s.description}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function McpSection({ onNavigate }: { onNavigate?: () => void }) {
  const slug = useCurrentAgentSlug();
  const [servers, setServers] = useState<McpServerSummary[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listMcpServers(slug)
      .then((list) => {
        if (!cancelled) setServers(list);
      })
      .catch(() => {
        if (!cancelled) setServers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  return (
    <section className="flex flex-col gap-1">
      <SectionHeader
        icon={Plug}
        label="MCP servers"
        target={{ kind: "mcp" }}
        slug={slug}
        onClick={onNavigate}
      />
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

export function BackgroundTasksSection({
  agent,
  onNavigate,
}: {
  agent: AgentSocket;
  onNavigate?: () => void;
}) {
  const slug = useCurrentAgentSlug();
  const [records, setRecords] = useState<Map<string, BackgroundTaskRecord>>(
    new Map(),
  );

  useEffect(() => {
    let cancelled = false;
    void listBackgroundTasks(slug)
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
  }, [slug]);

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
        target={{ kind: "background-tasks" }}
        slug={slug}
        onClick={onNavigate}
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
                to="/agent/$slug/background-tasks/$taskId"
                params={{ slug, taskId: r.id }}
                state={withBack({ href: `/agent/${slug}`, label: "chat" })}
                onClick={onNavigate}
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
          to="/agent/$slug/background-tasks"
          params={{ slug }}
          onClick={onNavigate}
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
