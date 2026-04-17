import { createFileRoute, Link } from "@tanstack/react-router";
import type { FileInfo } from "@cloudflare/shell";
import { FileText, FolderOpen } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { encodePath, listWorkspaceFiles } from "../lib/api-client";

export const Route = createFileRoute("/workspace")({
  component: WorkspacePage,
});

function formatBytes(size: number): string {
  if (size < 1024) return `${String(size)} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDate(ts: number): string {
  const date = new Date(ts);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function WorkspacePage() {
  const [files, setFiles] = useState<FileInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    listWorkspaceFiles()
      .then(setFiles)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const empty = files?.length === 0;

  return (
    <main className="page-wrap px-4 pb-12 pt-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="island-kicker mb-2">Workspace</p>
          <h1 className="display-title text-3xl font-bold tracking-tight text-[var(--sea-ink)] sm:text-4xl">
            Everything Claw has produced.
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-[var(--sea-ink-soft)] sm:text-base">
            Research memos, notes, structured outputs. You can open, edit, and
            delete any of them. The four identity files live in{" "}
            <Link to="/settings" className="font-semibold">
              Settings
            </Link>
            .
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          className="flex-shrink-0 rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-4 py-1.5 text-sm font-semibold text-[var(--sea-ink)] transition hover:-translate-y-0.5"
        >
          Refresh
        </button>
      </div>

      {error ? (
        <div className="mb-4 rounded-xl border border-red-300/40 bg-red-100/30 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {!files && !error ? (
        <p className="text-sm text-[var(--sea-ink-soft)]">Loading…</p>
      ) : null}

      {empty ? (
        <div className="island-shell rounded-2xl px-6 py-10 text-center">
          <FolderOpen
            size={32}
            className="mx-auto mb-3 text-[var(--sea-ink-soft)]"
          />
          <p className="text-sm font-semibold text-[var(--sea-ink)]">
            No files yet.
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm text-[var(--sea-ink-soft)]">
            Ask Claw to research something, take notes, or save a summary — the
            files will show up here.
          </p>
        </div>
      ) : null}

      {files && files.length > 0 ? (
        <ul className="grid gap-2">
          {files.map((file) => (
            <li key={file.path}>
              <Link
                to="/workspace/$"
                params={{ _splat: encodePath(file.path.replace(/^\/+/, "")) }}
                className="island-shell flex items-center justify-between gap-4 rounded-xl px-4 py-3 no-underline transition hover:-translate-y-0.5"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <FileText
                    size={14}
                    className="flex-shrink-0 text-[var(--sea-ink-soft)]"
                  />
                  <span className="truncate font-mono text-sm text-[var(--sea-ink)]">
                    {file.path.replace(/^\//, "")}
                  </span>
                </div>
                <div className="flex flex-shrink-0 items-center gap-3 text-[0.7rem] text-[var(--sea-ink-soft)]">
                  <span>{formatBytes(file.size)}</span>
                  <span>{formatDate(file.updatedAt)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </main>
  );
}
