import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, FileText, FolderOpen, RefreshCw } from "lucide-react";

import { encodePath } from "../lib/api-client";
import { withBack } from "../lib/back-nav";
import { useWorkspaceFiles } from "../lib/queries";

export const Route = createFileRoute("/agent/$slug/workspace/")({
  component: WorkspacePage,
});

function formatBytes(size: number): string {
  if (size < 1024) return `${String(size)} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDate(ts: number): string {
  const date = new Date(ts);
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
  return `${datePart} · ${timePart}`;
}

function splitPath(path: string): { folder: string; name: string } {
  const cleaned = path.replace(/^\/+/, "");
  const lastSlash = cleaned.lastIndexOf("/");
  if (lastSlash < 0) return { folder: "", name: cleaned };
  return {
    folder: cleaned.slice(0, lastSlash + 1),
    name: cleaned.slice(lastSlash + 1),
  };
}

function WorkspacePage() {
  const { slug } = Route.useParams();
  const { data: files, error: queryError, refetch } = useWorkspaceFiles(slug);
  const refresh = () => {
    void refetch();
  };
  const error = queryError
    ? queryError instanceof Error
      ? queryError.message
      : String(queryError)
    : null;
  const empty = files?.length === 0;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-12 pt-8">
      <Link
        to="/agent/$slug"
        params={{ slug }}
        className="link link-hover mb-4 inline-flex items-center gap-1 text-sm text-base-content/70 hover:text-base-content"
      >
        <ChevronLeft size={14} />
        Back to chat
      </Link>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-widest text-primary">
            Workspace
          </p>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Files.
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-base-content/70 sm:text-base">
            Identity files live in{" "}
            <Link
              to="/agent/$slug/identity"
              params={{ slug }}
              className="link link-primary font-semibold"
            >
              Identity
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
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <FolderOpen
            size={28}
            strokeWidth={1.5}
            className="text-base-content/30"
          />
          <p className="text-sm font-medium text-base-content/80">
            No files yet.
          </p>
        </div>
      ) : null}

      {files && files.length > 0 ? (
        <ul className="-mx-2 divide-y divide-base-300/70 border-y border-base-300/70">
          {files.map((file) => {
            const { folder, name } = splitPath(file.path);
            return (
              <li key={file.path}>
                <Link
                  to="/agent/$slug/workspace/$"
                  params={{
                    slug,
                    _splat: encodePath(file.path.replace(/^\/+/, "")),
                  }}
                  state={withBack({
                    href: `/agent/${slug}/workspace`,
                    label: "workspace",
                  })}
                  className="group flex items-center gap-3 px-3 py-3 no-underline transition-colors hover:bg-base-200"
                >
                  <FileText
                    size={14}
                    strokeWidth={1.75}
                    className="flex-shrink-0 text-base-content/35 transition-colors group-hover:text-base-content/65"
                  />
                  <span className="min-w-0 flex-1 truncate font-mono text-sm">
                    {folder ? (
                      <span className="text-base-content/40 transition-colors group-hover:text-base-content/55">
                        {folder}
                      </span>
                    ) : null}
                    <span className="font-medium text-base-content">
                      {name}
                    </span>
                  </span>
                  <span className="flex flex-shrink-0 items-center gap-4 font-mono text-[11px] tabular-nums text-base-content/45">
                    <span>{formatBytes(file.size)}</span>
                    <span>{formatDate(file.updatedAt)}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </main>
  );
}
