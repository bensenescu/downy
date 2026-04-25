import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import MarkdownEditor from "../components/markdown/MarkdownEditor";
import MarkdownPreview from "../components/markdown/MarkdownPreview";
import { useBackHint } from "../lib/back-nav";
import {
  useDeleteWorkspaceFile,
  useWorkspaceFile,
  useWriteWorkspaceFile,
} from "../lib/queries";

export const Route = createFileRoute("/agent/$slug/workspace/$")({
  component: WorkspaceFilePage,
});

function isMarkdown(path: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(path);
}

function WorkspaceFilePage() {
  const { slug } = Route.useParams();
  const params = Route.useParams();
  const rawSplat = params._splat ?? "";
  const path = rawSplat
    .split("/")
    .map((s) => decodeURIComponent(s))
    .join("/");
  const navigate = useNavigate();
  const back = useBackHint({
    href: `/agent/${slug}/workspace`,
    label: "workspace",
  });

  const fileQ = useWorkspaceFile(slug, path);
  const writeMut = useWriteWorkspaceFile();
  const deleteMut = useDeleteWorkspaceFile();
  const record = fileQ.data;
  // `useQuery` returns `data: null` when readWorkspaceFile resolves to null
  // (404). Distinguish "still loading" from "loaded but missing" via fetchStatus.
  const notFound = fileQ.isFetched && record === null;

  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Re-seed the draft whenever the underlying record changes (file reloads,
  // mutation invalidates cache + refetches, etc.).
  useEffect(() => {
    if (record) setDraft(record.content);
  }, [record]);

  async function handleSave() {
    setActionError(null);
    try {
      await writeMut.mutateAsync({ slug, path, content: draft });
      setEditing(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDelete() {
    const confirmed = window.confirm(`Delete ${path}? This can't be undone.`);
    if (!confirmed) return;
    setActionError(null);
    try {
      await deleteMut.mutateAsync({ slug, path });
      await navigate({ to: "/agent/$slug/workspace", params: { slug } });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  const showMarkdown = isMarkdown(path);
  const queryError = fileQ.error;
  const error =
    actionError ??
    (queryError
      ? queryError instanceof Error
        ? queryError.message
        : String(queryError)
      : null);
  const saving = writeMut.isPending;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-12 pt-8">
      <Link
        to={back.href}
        className="btn btn-ghost btn-sm mb-4 gap-1 px-2"
      >
        <ChevronLeft size={14} />
        Back to {back.label}
      </Link>

      {error ? (
        <div role="alert" className="alert alert-error mb-4">
          <span>{error}</span>
        </div>
      ) : null}

      {notFound ? (
        <div className="card border border-base-300 bg-base-100">
          <div className="card-body">
            <h1 className="card-title text-lg">File not found</h1>
            <p className="text-sm text-base-content/70">
              <code className="kbd kbd-sm">{path}</code> doesn&apos;t exist in
              the workspace.
            </p>
            <div className="card-actions mt-2">
              <Link to={back.href} className="link link-primary text-sm">
                ← Back to {back.label}
              </Link>
            </div>
          </div>
        </div>
      ) : null}

      {record ? (
        <>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="mb-1 text-xs font-bold uppercase tracking-widest text-primary">
                File
              </p>
              <h1 className="break-all font-mono text-lg font-semibold">
                {path}
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {showMarkdown ? (
                <button
                  type="button"
                  onClick={() => {
                    setEditing((e) => !e);
                  }}
                  className="btn btn-ghost btn-sm"
                >
                  {editing ? "View" : "Edit"}
                </button>
              ) : null}
              {editing ? (
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving || draft === record.content}
                  className="btn btn-primary btn-sm gap-1.5"
                >
                  {saving ? (
                    <span className="loading loading-spinner loading-xs" />
                  ) : (
                    <Save size={14} />
                  )}
                  {saving ? "Saving…" : "Save"}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void handleDelete()}
                className="btn btn-outline btn-error btn-sm gap-1.5"
              >
                <Trash2 size={14} />
                Delete
              </button>
            </div>
          </div>

          {editing ? (
            <MarkdownEditor value={draft} onChange={setDraft} />
          ) : showMarkdown ? (
            <div className="card border border-base-300 bg-base-100">
              <div className="card-body">
                {record.content.trim() ? (
                  <MarkdownPreview source={record.content} />
                ) : (
                  <p className="text-sm italic text-base-content/60">
                    Empty file.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <pre className="overflow-x-auto whitespace-pre-wrap rounded-box border border-base-300 bg-base-100 px-5 py-4 font-mono text-sm">
              {record.content}
            </pre>
          )}
        </>
      ) : null}
    </main>
  );
}
