import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";

import AppearanceCard from "../components/AppearanceCard";
import PreferencesCard from "../components/PreferencesCard";
import { listCoreFiles } from "../lib/api-client";
import type { CoreFileRecord } from "../worker/agent/core-files";

export const Route = createFileRoute("/settings/")({ component: SettingsPage });

function formatTimestamp(updatedAt: number | null): string {
  if (!updatedAt) return "not yet edited";
  const date = new Date(updatedAt);
  return `edited ${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function SettingsPage() {
  const [files, setFiles] = useState<CoreFileRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listCoreFiles()
      .then((loaded) => {
        if (!cancelled) setFiles(loaded);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-12 pt-8">
      <div className="mb-8">
        <p className="mb-2 text-xs font-bold uppercase tracking-widest text-primary">
          Settings
        </p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          The four files that shape Claw.
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-base-content/70 sm:text-base">
          These are read fresh on every turn. Edits take effect on the next
          message. Claw also writes to these files — USER.md and MEMORY.md grow
          as the two of you work together.
        </p>
      </div>

      <div className="mb-8 grid gap-4">
        <AppearanceCard />
        <PreferencesCard />
      </div>

      <div className="mb-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-base-content/60">
          Identity files
        </h2>
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
                to="/settings/$file"
                params={{ file: file.path }}
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
    </main>
  );
}
