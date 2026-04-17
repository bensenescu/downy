import { createFileRoute, Link } from "@tanstack/react-router";
import type { FileInfo } from "@cloudflare/shell";
import { FileText, FolderOpen, RefreshCw } from "lucide-react";
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
    <main className="mx-auto w-full max-w-5xl px-4 pb-12 pt-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-widest text-primary">
            Workspace
          </p>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Everything Claw has produced.
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-base-content/70 sm:text-base">
            Research memos, notes, structured outputs. You can open, edit, and
            delete any of them. The four identity files live in{" "}
            <Link to="/settings" className="link link-primary font-semibold">
              Settings
            </Link>
            .
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          className="btn btn-ghost btn-sm gap-1.5"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
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

      {empty ? (
        <div className="card border border-base-300 bg-base-100">
          <div className="card-body items-center text-center">
            <FolderOpen size={32} className="text-base-content/40" />
            <p className="text-sm font-semibold">No files yet.</p>
            <p className="max-w-md text-sm text-base-content/70">
              Ask Claw to research something, take notes, or save a summary —
              the files will show up here.
            </p>
          </div>
        </div>
      ) : null}

      {files && files.length > 0 ? (
        <ul className="grid gap-2">
          {files.map((file) => (
            <li key={file.path}>
              <Link
                to="/workspace/$"
                params={{ _splat: encodePath(file.path.replace(/^\/+/, "")) }}
                className="card card-compact group border border-base-300 bg-base-100 no-underline shadow-sm transition hover:border-primary/50 hover:shadow-md"
              >
                <div className="card-body flex-row items-center justify-between gap-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <FileText
                      size={14}
                      className="flex-shrink-0 text-base-content/50"
                    />
                    <span className="truncate font-mono text-sm">
                      {file.path.replace(/^\//, "")}
                    </span>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-3 text-xs text-base-content/60">
                    <span>{formatBytes(file.size)}</span>
                    <span>{formatDate(file.updatedAt)}</span>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </main>
  );
}
