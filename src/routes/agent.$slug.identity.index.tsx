import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Archive, ChevronLeft, Lock } from "lucide-react";
import { useMemo, useState } from "react";

import { useAgents, useArchiveAgent, useSetAgentPrivate } from "../lib/agents";
import { withBack } from "../lib/back-nav";
import { useCoreFiles, useUserFile } from "../lib/queries";

export const Route = createFileRoute("/agent/$slug/identity/")({
  component: IdentityPage,
});

function formatTimestamp(updatedAt: number | null): string {
  if (!updatedAt) return "";
  const date = new Date(updatedAt);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  const datePart = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  const timePart = date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  return `edited ${datePart} · ${timePart}`;
}

function contentPeek(content: string, maxChars = 200): string {
  // Skip leading headings — they usually echo the file's label and don't
  // tell the user what the actual body is about. Grab the first prose line.
  const lines = content.split("\n").map((l) => l.trim());
  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith("#")) continue;
    const cleaned = line.replace(/^[>\-*]+\s*/, "").trim();
    if (!cleaned) continue;
    if (cleaned.length <= maxChars) return cleaned;
    return cleaned.slice(0, maxChars - 1).trimEnd() + "…";
  }
  return "";
}

function IdentityPage() {
  const { slug } = Route.useParams();
  const agents = useAgents();
  const currentAgent = agents.find((a) => a.slug === slug) ?? null;
  const navigate = useNavigate();
  const coreFilesQ = useCoreFiles(slug);
  const userFileQ = useUserFile();
  const setPrivateMut = useSetAgentPrivate();
  const archiveMut = useArchiveAgent();
  const [error, setError] = useState<string | null>(null);
  const visibilityBusy = setPrivateMut.isPending;
  const archiveBusy = archiveMut.isPending;

  // Identity-page list = the four agent core files + USER.md (which lives at
  // the user level). Both queries are independently cached, so re-visits are
  // instant; we just compose the results here.
  const files = useMemo(() => {
    if (!coreFilesQ.data || !userFileQ.data) return null;
    return [...coreFilesQ.data, userFileQ.data];
  }, [coreFilesQ.data, userFileQ.data]);

  const fetchError = coreFilesQ.error ?? userFileQ.error;
  const displayError =
    error ??
    (fetchError
      ? fetchError instanceof Error
        ? fetchError.message
        : String(fetchError)
      : null);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-8">
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

      {displayError ? (
        <div role="alert" className="alert alert-error mb-4">
          <span>{displayError}</span>
        </div>
      ) : null}

      {!files && !displayError ? (
        <div className="flex items-center gap-2 text-sm text-base-content/60">
          <span className="loading loading-spinner loading-sm" />
          <span>Loading…</span>
        </div>
      ) : null}

      {files ? (
        <ul className="-mx-1 divide-y divide-base-300/70 border-y border-base-300/70">
          {files.map((file) => {
            const peek = file.isDefault ? "" : contentPeek(file.content);
            const stamp = formatTimestamp(file.updatedAt);
            return (
              <li key={file.path}>
                <Link
                  to="/agent/$slug/identity/$file"
                  params={{ slug, file: file.path }}
                  state={withBack({
                    href: `/agent/${slug}/identity`,
                    label: "identity",
                  })}
                  className="group block px-3 py-5 no-underline transition-colors hover:bg-base-200"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-mono text-xs text-base-content/60 transition-colors group-hover:text-base-content/85">
                      {file.path}
                    </span>
                    <span className="font-mono text-[11px] tabular-nums text-base-content/40">
                      {file.isDefault ? "default" : stamp}
                    </span>
                  </div>
                  <h2 className="mt-2 text-base font-semibold tracking-tight">
                    {file.label}
                  </h2>
                  <p className="mt-1 text-sm text-base-content/65">
                    {file.description}
                  </p>
                  {peek ? (
                    <p className="mt-3 line-clamp-2 text-[12.5px] italic leading-relaxed text-base-content/45">
                      {peek}
                    </p>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}

      {currentAgent ? (
        <section className="mt-12">
          <p className="mb-3 text-xs font-bold uppercase tracking-widest text-base-content/55">
            Visibility
          </p>
          <label className="flex cursor-pointer items-start justify-between gap-6 border-t border-base-300/70 py-5">
            <div className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-sm font-semibold">
                <Lock size={14} className="text-base-content/60" />
                Hide from other agents
              </span>
              <span className="mt-1 block text-sm text-base-content/65">
                When private, other agents can see this agent exists in the
                dropdown but cannot read its workspace or identity files via{" "}
                <code className="rounded bg-base-200 px-1 py-0.5 font-mono text-[0.85em]">
                  read_peer_agent
                </code>
                .
              </span>
            </div>
            <input
              type="checkbox"
              className="toggle toggle-primary mt-0.5 flex-shrink-0"
              checked={currentAgent.isPrivate}
              disabled={visibilityBusy}
              onChange={async (e) => {
                try {
                  await setPrivateMut.mutateAsync({
                    slug,
                    isPrivate: e.target.checked,
                  });
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err));
                }
              }}
            />
          </label>

          <p className="mb-3 mt-12 text-xs font-bold uppercase tracking-widest text-base-content/55">
            Danger zone
          </p>
          <div className="flex items-start justify-between gap-6 border-t border-base-300/70 py-5">
            <div className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-sm font-semibold">
                <Archive size={14} className="text-base-content/60" />
                Archive this agent
              </span>
              <span className="mt-1 block text-sm text-base-content/65">
                The agent disappears from the dropdown and from peer reads. Its
                workspace and chat history are kept — restore from{" "}
                <Link
                  to="/settings/archived-agents"
                  className="link link-primary"
                >
                  archived agents
                </Link>
                .
              </span>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm flex-shrink-0 gap-1.5 text-error/85 hover:bg-error/10 hover:text-error disabled:text-base-content/30"
              disabled={archiveBusy || slug === "default"}
              onClick={async () => {
                if (slug === "default") return;
                const ok = window.confirm(
                  `Archive agent "${currentAgent.displayName}"? You can restore later.`,
                );
                if (!ok) return;
                try {
                  await archiveMut.mutateAsync(slug);
                  await navigate({
                    to: "/agent/$slug",
                    params: { slug: "default" },
                  });
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err));
                }
              }}
            >
              <Archive size={14} />
              {slug === "default" ? "Default can't archive" : "Archive"}
            </button>
          </div>
        </section>
      ) : null}
    </main>
  );
}
