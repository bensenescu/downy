import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Archive, Lock } from "lucide-react";
import { useEffect, useState } from "react";

import BackLink from "../components/ui/BackLink";
import { confirmDialog } from "../components/ui/dialog";
import ErrorAlert from "../components/ui/ErrorAlert";
import PageHeader from "../components/ui/PageHeader";
import PageShell from "../components/ui/PageShell";
import {
  useAgents,
  useArchiveAgent,
  useRenameAgent,
  useSetAgentPrivate,
} from "../lib/agents";

export const Route = createFileRoute("/agent/$slug/settings")({
  component: AgentSettingsPage,
});

function AgentSettingsPage() {
  const { slug } = Route.useParams();
  const agents = useAgents();
  const currentAgent = agents.find((a) => a.slug === slug) ?? null;
  const navigate = useNavigate();
  const setPrivateMut = useSetAgentPrivate();
  const archiveMut = useArchiveAgent();
  const renameMut = useRenameAgent();
  const [error, setError] = useState<string | null>(null);
  const [draftName, setDraftName] = useState(currentAgent?.displayName ?? "");
  const visibilityBusy = setPrivateMut.isPending;
  const archiveBusy = archiveMut.isPending;
  const renameBusy = renameMut.isPending;

  // Rehydrate the draft when the loaded agent changes (route param swap, or
  // initial fetch resolving). Without this, switching agents shows the prior
  // name in the input.
  useEffect(() => {
    if (currentAgent) setDraftName(currentAgent.displayName);
  }, [currentAgent]);

  const trimmedName = draftName.trim();
  const nameDirty =
    currentAgent !== null && trimmedName !== currentAgent.displayName;
  const nameValid = trimmedName.length > 0 && trimmedName.length <= 64;

  return (
    <PageShell>
      <BackLink to="/agent/$slug" params={{ slug }} label="chat" />

      <PageHeader
        kicker="Settings"
        title={currentAgent?.displayName ?? slug}
        description="Visibility and lifecycle for this agent."
      />

      <ErrorAlert message={error} />

      {currentAgent ? (
        <>
          <p className="mb-3 text-xs font-bold uppercase tracking-widest text-base-content/55">
            Name
          </p>
          <form
            className="flex items-center gap-3 border-t border-base-300/70 py-5"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!nameDirty || !nameValid || renameBusy) return;
              setError(null);
              try {
                await renameMut.mutateAsync({
                  slug,
                  displayName: trimmedName,
                });
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              }
            }}
          >
            <input
              type="text"
              value={draftName}
              onChange={(e) => {
                setDraftName(e.target.value);
              }}
              maxLength={64}
              placeholder="Display name"
              className="input input-bordered input-sm flex-1"
              disabled={renameBusy}
            />
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={!nameDirty || !nameValid || renameBusy}
            >
              {renameBusy ? "Saving…" : "Save"}
            </button>
          </form>

          <p className="mb-3 mt-12 text-xs font-bold uppercase tracking-widest text-base-content/55">
            Visibility
          </p>
          <label className="flex cursor-pointer items-start justify-between gap-6 border-t border-base-300/70 py-5">
            <div className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-sm font-semibold">
                <Lock size={14} className="text-base-content/60" />
                Hide from other agents
              </span>
              <span className="mt-1 block text-sm text-base-content/65">
                Other agents can see it exists but can&apos;t read its files.
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
                Hides it from the dropdown. Files are kept and can be{" "}
                <Link
                  to="/settings/archived-agents"
                  className="link link-primary"
                >
                  restored
                </Link>
                .
              </span>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm flex-shrink-0 gap-1.5 text-error/85 hover:bg-error/10 hover:text-error disabled:text-base-content/30"
              disabled={archiveBusy}
              onClick={async () => {
                const ok = await confirmDialog({
                  title: "Archive agent?",
                  message: `Archive "${currentAgent.displayName}"?`,
                  confirmLabel: "Archive",
                  tone: "danger",
                });
                if (!ok) return;
                try {
                  await archiveMut.mutateAsync(slug);
                  // Land on whichever agent is now top of the list. The cache
                  // was already invalidated by the mutation, but our local
                  // `agents` snapshot is from before — recompute by filtering.
                  const next = agents.find((a) => a.slug !== slug) ?? null;
                  await navigate(
                    next
                      ? { to: "/agent/$slug", params: { slug: next.slug } }
                      : { to: "/" },
                  );
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err));
                }
              }}
            >
              <Archive size={14} />
              Archive
            </button>
          </div>
        </>
      ) : null}
    </PageShell>
  );
}
