import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, EyeOff, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { listSkills, type SkillSummary } from "../lib/api-client";

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
  const [skills, setSkills] = useState<SkillSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listSkills(slug)
      .then((list) => {
        if (!cancelled) setSkills(list);
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

      <div className="mb-6">
        <p className="mb-2 text-xs font-bold uppercase tracking-widest text-primary">
          Skills
        </p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Reusable instruction packs.
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-base-content/70 sm:text-base">
          Each skill lives at <code>skills/&lt;name&gt;/SKILL.md</code> in this
          agent's workspace. Ask Claw to create, edit, or delete one — or edit
          the file directly via the workspace tools. The catalog (name +
          description) is injected into every system prompt so the model
          knows what's available.
        </p>
      </div>

      {error ? (
        <div role="alert" className="alert alert-error mb-4">
          <span>{error}</span>
        </div>
      ) : null}

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
              Ask Claw something like &ldquo;make me a skill for drafting
              weekly status updates&rdquo; — it'll save a SKILL.md to the
              workspace and the catalog will pick it up automatically.
            </p>
          </div>
        </div>
      ) : null}

      {skills && skills.length > 0 ? (
        <ul className="grid gap-3">
          {skills.map((s) => (
            <li
              key={s.name}
              className="card card-compact border border-base-300 bg-base-100 shadow-sm"
            >
              <div className="card-body gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold">
                    {s.name}
                  </span>
                  {s.hidden ? (
                    <span
                      className="badge badge-ghost badge-sm gap-1"
                      title="Hidden from the prompt catalog (still readable via tools)."
                    >
                      <EyeOff size={10} /> hidden
                    </span>
                  ) : null}
                  <span className="ml-auto text-xs text-base-content/60">
                    edited {formatTimestamp(s.updatedAt)}
                  </span>
                </div>
                <p className="text-sm text-base-content/80">{s.description}</p>
                <p className="text-[11px] text-base-content/50">
                  <code>{s.path}</code>
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </main>
  );
}
