import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, EyeOff, Sparkles } from "lucide-react";

import BackLink from "../components/ui/BackLink";
import ErrorAlert, { errorMessage } from "../components/ui/ErrorAlert";
import PageHeader from "../components/ui/PageHeader";
import PageShell from "../components/ui/PageShell";
import { useAgentSkills } from "../lib/queries";

export const Route = createFileRoute("/agent/$slug/skills/")({
  component: SkillsPage,
});

function formatTimestamp(ts: number): string {
  const date = new Date(ts);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function SkillsPage() {
  const { slug } = Route.useParams();
  const { data: skills, error: queryError } = useAgentSkills(slug);
  const error = errorMessage(queryError);

  return (
    <PageShell width="wide">
      <BackLink to="/agent/$slug" params={{ slug }} label="chat" />

      <PageHeader kicker="Skills" title="Reusable instructions." />

      <ErrorAlert message={error} />

      {skills === null && !error ? (
        <div className="flex items-center gap-2 text-sm text-base-content/60">
          <span className="loading loading-spinner loading-sm" />
          <span>Loading…</span>
        </div>
      ) : null}

      {skills && skills.length === 0 ? (
        <div className="card border border-base-300 bg-base-100">
          <div className="card-body items-center text-center">
            <Sparkles size={32} className="text-base-content/40" />
            <p className="text-sm font-semibold">No skills yet.</p>
            <p className="max-w-md text-sm text-base-content/70">
              Ask the agent to create one.
            </p>
          </div>
        </div>
      ) : null}

      {skills && skills.length > 0 ? (
        <ul className="grid gap-3">
          {skills.map((s) => (
            <li key={s.name}>
              <Link
                to="/agent/$slug/skills/$name"
                params={{ slug, name: s.name }}
                className="card card-compact group border border-base-300 bg-base-100 no-underline shadow-sm transition hover:border-primary/50 hover:shadow-md"
              >
                <div className="card-body flex-row items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold">
                        {s.name}
                      </span>
                      {s.hidden ? (
                        <span
                          className="badge badge-ghost badge-sm gap-1"
                          title="Hidden from the catalog"
                        >
                          <EyeOff size={10} /> hidden
                        </span>
                      ) : null}
                      <span className="ml-auto text-xs text-base-content/60">
                        edited {formatTimestamp(s.updatedAt)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-base-content/80">
                      {s.description}
                    </p>
                    <p className="mt-1 text-[11px] text-base-content/50">
                      <code>{s.path}</code>
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
    </PageShell>
  );
}
