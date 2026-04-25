import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Archive, ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { useEffect, useState } from "react";

import { listCoreFiles, readUserFile } from "../lib/api-client";
import {
  archiveAgent,
  refreshAgents,
  setAgentPrivate,
  useAgents,
} from "../lib/agents";
import { withBack } from "../lib/back-nav";
import type { CoreFileRecord } from "../worker/agent/core-files";

export const Route = createFileRoute("/agent/$slug/identity/")({
  component: IdentityPage,
});

function formatTimestamp(updatedAt: number | null): string {
  if (!updatedAt) return "not yet edited";
  const date = new Date(updatedAt);
  return `edited ${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function IdentityPage() {
  const { slug } = Route.useParams();
  const agents = useAgents();
  const currentAgent = agents.find((a) => a.slug === slug) ?? null;
  const navigate = useNavigate();
  const [files, setFiles] = useState<CoreFileRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [visibilityBusy, setVisibilityBusy] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listCoreFiles(slug), readUserFile()])
      .then(([agentFiles, userFile]) => {
        if (cancelled) return;
        setFiles([...agentFiles, userFile]);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

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

      <div className="mb-8">
        <p className="mb-2 text-xs font-bold uppercase tracking-widest text-primary">
          Identity
        </p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          The four files that shape this agent.
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-base-content/70 sm:text-base">
          These are read fresh on every turn. Edits take effect on the next
          message. Claw also writes to these files — USER.md and MEMORY.md grow
          as the two of you work together.
        </p>
      </div>

      {error ? (
        <div role="alert" className="alert alert-error mb-4">
          <span>{error}</span>
        </div>
      ) : null}

      {!files && !error ? (
        <div className="flex items-center gap-2 text-sm text-base-content/60">
          <span className="loading loading-spinner loading-sm" />
          <span>Loading…</span>
        </div>
      ) : null}

      {files ? (
        <ul className="grid gap-3">
          {files.map((file) => (
            <li key={file.path}>
              <Link
                to="/agent/$slug/identity/$file"
                params={{ slug, file: file.path }}
                state={withBack({
                  href: `/agent/${slug}/identity`,
                  label: "identity",
                })}
                className="card card-compact group border border-base-300 bg-base-100 no-underline shadow-sm transition hover:border-primary/50 hover:shadow-md"
              >
                <div className="card-body flex-row items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="badge badge-ghost badge-sm font-mono text-xs">
                        {file.path}
                      </span>
                      <span className="text-xs text-base-content/60">
                        {formatTimestamp(file.updatedAt)}
                      </span>
                    </div>
                    <h2 className="mt-1 text-base font-semibold">
                      {file.label}
                    </h2>
                    <p className="mt-1 text-sm text-base-content/70">
                      {file.description}
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

      {currentAgent ? (
        <section className="mt-10 grid gap-4">
          <div>
            <p className="mb-1 text-xs font-bold uppercase tracking-widest text-base-content/60">
              Visibility
            </p>
            <div className="card card-compact border border-base-300 bg-base-100">
              <div className="card-body flex-row items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <Lock size={14} />
                    Hide from other agents
                  </h3>
                  <p className="mt-1 text-sm text-base-content/70">
                    When private, other agents can see this agent exists in the
                    dropdown but cannot read its workspace or identity files
                    via <code className="text-xs">read_peer_agent</code>.
                  </p>
                </div>
                <input
                  type="checkbox"
                  className="toggle toggle-primary"
                  checked={currentAgent.isPrivate}
                  disabled={visibilityBusy}
                  onChange={async (e) => {
                    setVisibilityBusy(true);
                    try {
                      await setAgentPrivate(slug, e.target.checked);
                    } catch (err) {
                      setError(
                        err instanceof Error ? err.message : String(err),
                      );
                    } finally {
                      setVisibilityBusy(false);
                    }
                  }}
                />
              </div>
            </div>
          </div>

          <div>
            <p className="mb-1 text-xs font-bold uppercase tracking-widest text-base-content/60">
              Danger zone
            </p>
            <div className="card card-compact border border-base-300 bg-base-100">
              <div className="card-body flex-row items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <Archive size={14} />
                    Archive this agent
                  </h3>
                  <p className="mt-1 text-sm text-base-content/70">
                    The agent disappears from the dropdown and from peer reads.
                    Its workspace and chat history are kept — restore from{" "}
                    <Link
                      to="/settings/archived-agents"
                      className="link link-primary"
                    >
                      archived agents
                    </Link>
                    .
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-outline btn-error btn-sm"
                  disabled={archiveBusy || slug === "default"}
                  onClick={async () => {
                    if (slug === "default") return;
                    const ok = window.confirm(
                      `Archive agent "${currentAgent.displayName}"? You can restore later.`,
                    );
                    if (!ok) return;
                    setArchiveBusy(true);
                    try {
                      await archiveAgent(slug);
                      await refreshAgents();
                      await navigate({
                        to: "/agent/$slug",
                        params: { slug: "default" },
                      });
                    } catch (err) {
                      setError(
                        err instanceof Error ? err.message : String(err),
                      );
                    } finally {
                      setArchiveBusy(false);
                    }
                  }}
                >
                  {slug === "default" ? "Default can't archive" : "Archive"}
                </button>
              </div>
            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
}
