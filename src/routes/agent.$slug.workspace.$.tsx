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
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-8">
      <Link to={back.href} className="btn btn-ghost btn-sm mb-4 gap-1 px-2">
        <ChevronLeft size={14} />
        Back to {back.label}
      </Link>

      {error ? (
        <div role="alert" className="alert alert-error mb-4">
          <span>{error}</span>
        </div>
      ) : null}

      {notFound ? (
        <div className="flex flex-col items-start gap-2 py-8">
          <p className="text-xs font-bold uppercase tracking-widest text-base-content/50">
            Not found
          </p>
          <h1 className="text-2xl font-bold tracking-tight">
            That file doesn&apos;t exist.
          </h1>
          <p className="text-sm text-base-content/65">
            <code className="rounded bg-base-200 px-1.5 py-0.5 font-mono text-[0.85em]">
              {path}
            </code>{" "}
            isn&apos;t in this workspace.
          </p>
          <Link
            to={back.href}
            className="link link-primary mt-2 text-sm font-medium"
          >
            ← Back to {back.label}
          </Link>
        </div>
      ) : null}

      {record ? (
        <>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="mb-1 text-xs font-bold uppercase tracking-widest text-primary">
                File
              </p>
              <h1 className="break-all font-mono text-base font-semibold">
                {path}
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-1">
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
                className="btn btn-ghost btn-sm gap-1.5 text-error/80 hover:bg-error/10 hover:text-error"
              >
                <Trash2 size={14} />
                Delete
              </button>
            </div>
          </div>

          <hr className="mb-8 border-0 border-t border-base-300/70" />

          {editing ? (
            <MarkdownEditor value={draft} onChange={setDraft} />
          ) : showMarkdown ? (
            record.content.trim() ? (
              <MarkdownPreview source={record.content} />
            ) : (
              <p className="text-sm italic text-base-content/55">Empty file.</p>
            )
          ) : (
            <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-sm leading-relaxed text-base-content/90">
              {record.content}
            </pre>
          )}
        </>
      ) : null}
    </main>
  );
}
