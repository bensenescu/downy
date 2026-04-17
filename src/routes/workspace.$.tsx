import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import MarkdownEditor from "../components/markdown/MarkdownEditor";
import MarkdownPreview from "../components/markdown/MarkdownPreview";
import {
  deleteWorkspaceFile,
  readWorkspaceFile,
  writeWorkspaceFile,
  type WorkspaceFile,
} from "../lib/api-client";

export const Route = createFileRoute("/workspace/$")({
  component: WorkspaceFilePage,
});

function isMarkdown(path: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(path);
}

function WorkspaceFilePage() {
  const params = Route.useParams();
  const rawSplat = params._splat ?? "";
  const path = rawSplat
    .split("/")
    .map((s) => decodeURIComponent(s))
    .join("/");
  const navigate = useNavigate();

  const [record, setRecord] = useState<WorkspaceFile | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    readWorkspaceFile(path)
      .then((loaded) => {
        if (!loaded) {
          setNotFound(true);
          return;
        }
        setRecord(loaded);
        setDraft(loaded.content);
        setNotFound(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [path]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await writeWorkspaceFile(path, draft);
      setRecord((prev) =>
        prev ? { ...prev, content: draft } : { content: draft, stat: null },
      );
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    const confirmed = window.confirm(`Delete ${path}? This can't be undone.`);
    if (!confirmed) return;
    try {
      await deleteWorkspaceFile(path);
      await navigate({ to: "/workspace" });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const showMarkdown = isMarkdown(path);

  return (
    <main className="page-wrap px-4 pb-12 pt-8">
      <button
        type="button"
        onClick={() => void navigate({ to: "/workspace" })}
        className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--sea-ink-soft)] hover:text-[var(--sea-ink)]"
      >
        <ChevronLeft size={14} />
        Back to workspace
      </button>

      {error ? (
        <div className="mb-4 rounded-xl border border-red-300/40 bg-red-100/30 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {notFound ? (
        <div className="island-shell rounded-2xl px-6 py-8">
          <h1 className="text-lg font-semibold text-[var(--sea-ink)]">
            File not found
          </h1>
          <p className="mt-1 text-sm text-[var(--sea-ink-soft)]">
            <code>{path}</code> doesn&apos;t exist in the workspace.
          </p>
          <Link
            to="/workspace"
            className="mt-3 inline-block text-sm font-semibold text-[var(--lagoon-deep)]"
          >
            ← Back to workspace
          </Link>
        </div>
      ) : null}

      {record ? (
        <>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="island-kicker mb-1">File</p>
              <h1 className="font-mono break-all text-lg font-semibold text-[var(--sea-ink)]">
                {path}
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {showMarkdown ? (
                <button
                  type="button"
                  onClick={() => setEditing((e) => !e)}
                  className="rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-4 py-1.5 text-sm font-semibold text-[var(--sea-ink)] transition hover:-translate-y-0.5"
                >
                  {editing ? "View" : "Edit"}
                </button>
              ) : null}
              {editing ? (
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving || draft === record.content}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[var(--lagoon-deep)] px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 disabled:opacity-40 disabled:hover:translate-y-0"
                >
                  <Save size={14} />
                  {saving ? "Saving…" : "Save"}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void handleDelete()}
                className="inline-flex items-center gap-1.5 rounded-full border border-red-300/40 bg-red-100/30 px-4 py-1.5 text-sm font-semibold text-red-800 transition hover:-translate-y-0.5"
              >
                <Trash2 size={14} />
                Delete
              </button>
            </div>
          </div>

          {editing ? (
            <MarkdownEditor value={draft} onChange={setDraft} />
          ) : showMarkdown ? (
            <div className="island-shell rounded-2xl px-6 py-5">
              {record.content.trim() ? (
                <MarkdownPreview source={record.content} />
              ) : (
                <p className="text-sm italic text-[var(--sea-ink-soft)]">
                  Empty file.
                </p>
              )}
            </div>
          ) : (
            <pre className="island-shell overflow-x-auto whitespace-pre-wrap rounded-2xl px-5 py-4 font-mono text-sm text-[var(--sea-ink)]">
              {record.content}
            </pre>
          )}
        </>
      ) : null}
    </main>
  );
}
