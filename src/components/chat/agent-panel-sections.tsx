import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  CornerDownLeft,
  FileText,
  IdCard,
  ListTodo,
  Lock,
  Plug,
  Plus,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { encodePath } from "../../lib/api-client";
import {
  useAgents,
  useCreateAgent,
  useCurrentAgentSlug,
} from "../../lib/agents";
import { withBack } from "../../lib/back-nav";
import {
  useAgentSkills,
  useBackgroundTasks,
  useMcpServers,
  useMcpServersLiveSync,
  useWorkspaceFiles,
} from "../../lib/queries";
import { queryKeys } from "../../lib/query-keys";
import {
  BACKGROUND_TASK_UPDATED_TYPE,
  BackgroundTaskRecordSchema,
  type BackgroundTaskRecord,
} from "../../worker/agent/background-task-types";

const SLUG_PATTERN = /^[a-z][a-z0-9-]{1,30}$/;

function deriveDisplayName(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

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
  const [draftSlug, setDraftSlug] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const draftRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const createMut = useCreateAgent();
  const busy = createMut.isPending;
  const trimmed = draftSlug.trim();
  const slugValid = SLUG_PATTERN.test(trimmed);

  useEffect(() => {
    if (creating) draftRef.current?.focus();
  }, [creating]);

  function startCreate() {
    setDraftSlug("");
    setCreateError(null);
    setCreating(true);
    // Drop dropdown focus so the menu doesn't stay open behind the form.
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }

  function cancelCreate() {
    setCreating(false);
    setDraftSlug("");
    setCreateError(null);
  }

  async function handleCreate() {
    if (!slugValid || busy) return;
    setCreateError(null);
    try {
      const created = await createMut.mutateAsync({
        slug: trimmed,
        displayName: deriveDisplayName(trimmed),
      });
      setCreating(false);
      setDraftSlug("");
      await navigate({
        to: "/agent/$slug",
        params: { slug: created.slug },
      });
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    }
  }

  if (creating) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleCreate();
        }}
        className="space-y-1"
      >
        <div className="flex h-8 items-center gap-2 rounded-btn border border-primary/50 bg-base-100 pl-3 pr-1 ring-2 ring-primary/15 focus-within:border-primary focus-within:ring-primary/30">
          <span className="size-2 shrink-0 rounded-full bg-primary" />
          <input
            ref={draftRef}
            type="text"
            value={draftSlug}
            onChange={(e) => {
              setDraftSlug(e.target.value.toLowerCase());
              setCreateError(null);
            }}
            placeholder="agent-slug"
            spellCheck={false}
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent font-mono text-sm outline-none placeholder:text-base-content/30"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                cancelCreate();
              }
            }}
            disabled={busy}
          />
          <button
            type="button"
            onClick={cancelCreate}
            disabled={busy}
            aria-label="Cancel"
            className="flex size-6 shrink-0 items-center justify-center rounded text-base-content/45 hover:bg-base-200 hover:text-base-content/85"
          >
            <X size={13} />
          </button>
          <button
            type="submit"
            disabled={!slugValid || busy}
            aria-label="Create agent"
            className="flex size-6 shrink-0 items-center justify-center rounded text-primary hover:bg-primary/10 disabled:text-base-content/25 disabled:hover:bg-transparent"
          >
            {busy ? (
              <span className="loading loading-spinner loading-xs" />
            ) : (
              <CornerDownLeft size={13} />
            )}
          </button>
        </div>
        {createError ? (
          <p className="px-2 text-[11px] text-error">{createError}</p>
        ) : trimmed.length > 0 && !slugValid ? (
          <p className="px-2 text-[11px] text-base-content/50">
            lowercase, digits, hyphens · starts with a letter
          </p>
        ) : (
          <p className="px-2 text-[11px] text-base-content/45">
            ↵ create · esc cancel
          </p>
        )}
      </form>
    );
  }

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
            {selected?.displayName ?? "No agents"}
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
          <button type="button" onClick={startCreate} className="text-primary">
            <Plus size={14} />
            New agent
          </button>
        </li>
      </ul>
    </div>
  );
}

type SectionTarget =
  | { kind: "identity" }
  | { kind: "workspace" }
  | { kind: "mcp" }
  | { kind: "skills" }
  | { kind: "background-tasks" }
  | { kind: "settings" };

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
    case "settings":
      return (
        <Link
          to="/agent/$slug/settings"
          params={{ slug }}
          onClick={onClick}
          className={linkClass}
        >
          {content}
        </Link>
      );
    default:
      return content;
  }
}

export function SettingsSection({ onNavigate }: { onNavigate?: () => void }) {
  const slug = useCurrentAgentSlug();
  return (
    <section className="flex flex-col gap-1">
      <SectionHeader
        icon={Settings}
        label="Agent settings"
        target={{ kind: "settings" }}
        slug={slug}
        onClick={onNavigate}
      />
    </section>
  );
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
  const { data: files } = useWorkspaceFiles(slug);

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
  const { data: skills } = useAgentSkills(slug);

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
                to="/agent/$slug/skills/$name"
                params={{ slug, name: s.name }}
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

export function McpSection({
  agent,
  onNavigate,
}: {
  agent: AgentSocket;
  onNavigate?: () => void;
}) {
  const slug = useCurrentAgentSlug();
  const { data: servers } = useMcpServers(slug);
  useMcpServersLiveSync(agent, slug);

  return (
    <section className="flex flex-col gap-1">
      <SectionHeader
        icon={Plug}
        label="MCP servers"
        target={{ kind: "mcp" }}
        slug={slug}
        onClick={onNavigate}
      />
      {servers === undefined ? (
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
  const { data: records } = useBackgroundTasks(slug);
  const qc = useQueryClient();

  // The agent's WebSocket pushes incremental updates as background tasks
  // run. There's no built-in WS adapter in TanStack Query — the canonical
  // pattern is to subscribe in a useEffect and write straight into the
  // cache via `setQueryData`. Other components reading the same key
  // (e.g. the full list page) pick up the change without their own socket.
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
      qc.setQueryData<BackgroundTaskRecord[]>(
        queryKeys.backgroundTasks(slug),
        (prev) => {
          const list = prev ?? [];
          const idx = list.findIndex((r) => r.id === record.id);
          if (idx === -1) return [...list, record];
          const next = list.slice();
          next[idx] = record;
          return next;
        },
      );
    };
    agent.addEventListener("message", onMessage);
    return () => {
      agent.removeEventListener("message", onMessage);
    };
  }, [agent, qc, slug]);

  const sorted = useMemo(() => {
    if (!records) return [];
    const copy = [...records];
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
