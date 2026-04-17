import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";

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
    <main className="page-wrap px-4 pb-12 pt-8">
      <div className="mb-8">
        <p className="island-kicker mb-2">Settings</p>
        <h1 className="display-title text-3xl font-bold tracking-tight text-[var(--sea-ink)] sm:text-4xl">
          The four files that shape Claw.
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--sea-ink-soft)] sm:text-base">
          These are read fresh on every turn. Edits take effect on the next
          message. Claw also writes to these files — USER.md and MEMORY.md grow
          as the two of you work together.
        </p>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-300/40 bg-red-100/30 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {!files && !error ? (
        <p className="text-sm text-[var(--sea-ink-soft)]">Loading…</p>
      ) : null}

      {files ? (
        <ul className="grid gap-3">
          {files.map((file) => (
            <li key={file.path}>
              <Link
                to="/settings/$file"
                params={{ file: file.path }}
                className="island-shell flex items-start justify-between gap-4 rounded-2xl px-5 py-4 no-underline transition hover:-translate-y-0.5"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-[var(--sea-ink-soft)]">
                      {file.path}
                    </span>
                    <span className="text-[0.7rem] text-[var(--sea-ink-soft)]">
                      {formatTimestamp(file.updatedAt)}
                    </span>
                  </div>
                  <h2 className="mt-1 text-base font-semibold text-[var(--sea-ink)]">
                    {file.label}
                  </h2>
                  <p className="mt-1 text-sm text-[var(--sea-ink-soft)]">
                    {file.description}
                  </p>
                </div>
                <ChevronRight
                  size={18}
                  className="mt-1 flex-shrink-0 text-[var(--sea-ink-soft)]"
                />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </main>
  );
}
