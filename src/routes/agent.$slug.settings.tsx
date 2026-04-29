import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Archive, ChevronLeft, Lock } from "lucide-react";
import { useState } from "react";

import { useAgents, useArchiveAgent, useSetAgentPrivate } from "../lib/agents";

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
  const [error, setError] = useState<string | null>(null);
  const visibilityBusy = setPrivateMut.isPending;
  const archiveBusy = archiveMut.isPending;

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
          Settings
        </p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          {currentAgent?.displayName ?? slug}
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-base-content/70 sm:text-base">
          Visibility and lifecycle for this agent.
        </p>
      </div>

      {error ? (
        <div role="alert" className="alert alert-error mb-4">
          <span>{error}</span>
        </div>
      ) : null}

      {currentAgent ? (
        <>
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
              disabled={archiveBusy || slug === "default"}
              onClick={async () => {
                if (slug === "default") return;
                const ok = window.confirm(
                  `Archive "${currentAgent.displayName}"?`,
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
              {slug === "default" ? "Can't archive default" : "Archive"}
            </button>
          </div>
        </>
      ) : null}
    </main>
  );
}
