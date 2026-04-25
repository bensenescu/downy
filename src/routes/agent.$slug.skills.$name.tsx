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

export const Route = createFileRoute("/agent/$slug/skills/$name")({
  component: SkillEditorPage,
});

/**
 * Skill editor — same shape as the workspace file editor, but the path is
 * fixed at `skills/<name>/SKILL.md`. Reads / writes / deletes go through
 * the existing workspace API; the model uses the same path when it edits a
 * skill via `edit_file`, so there's no divergent storage.
 *
 * The editor exposes the whole file including frontmatter. If the user
 * breaks the YAML, the loader will log a warning and skip the skill on the
 * next turn — the user can fix it here. Saves are not validated client-side
 * intentionally: the workspace API is the source of truth, and structured
 * tools are how the agent enforces shape on its own writes.
 */
function SkillEditorPage() {
  const { slug, name } = Route.useParams();
  const skillPath = `skills/${name}/SKILL.md`;
  const navigate = useNavigate();
  const back = useBackHint({
    href: `/agent/${slug}/skills`,
    label: "skills",
  });

  const fileQ = useWorkspaceFile(slug, skillPath);
  const writeMut = useWriteWorkspaceFile();
  const deleteMut = useDeleteWorkspaceFile();
  const record = fileQ.data;
  const notFound = fileQ.isFetched && record === null;

  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (record) setDraft(record.content);
  }, [record]);

  async function handleSave() {
    setActionError(null);
    try {
      await writeMut.mutateAsync({ slug, path: skillPath, content: draft });
      setEditing(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDelete() {
    const confirmed = window.confirm(`Delete skill ${name}? This can't be undone.`);
    if (!confirmed) return;
    setActionError(null);
    try {
      // Note: this only deletes SKILL.md. Companion files (skills/<name>/...)
      // would be left orphaned. The agent's `delete_skill` tool does a
      // recursive prefix delete; the UI doesn't yet — fine for v1 since
      // companions are rare. Upgrade to a /api/skills/$name DELETE endpoint
      // when companion files become common.
      await deleteMut.mutateAsync({ slug, path: skillPath });
      await navigate({ to: "/agent/$slug/skills", params: { slug } });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

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
        <div className="card border border-base-300 bg-base-100">
          <div className="card-body">
            <h1 className="card-title text-lg">Skill not found</h1>
            <p className="text-sm text-base-content/70">
              <code className="kbd kbd-sm">{name}</code> doesn&apos;t exist in
              this agent&apos;s workspace.
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
                Skill
              </p>
              <h1 className="break-all font-mono text-lg font-semibold">
                {name}
              </h1>
              <p className="mt-1 break-all text-xs text-base-content/60">
                <code>{skillPath}</code>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditing((e) => !e);
                }}
                className="btn btn-ghost btn-sm"
              >
                {editing ? "View" : "Edit"}
              </button>
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
          ) : (
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
          )}

          <p className="mt-3 text-xs text-base-content/60">
            Edits take effect on the next chat turn — Claw reads the skill
            catalog (frontmatter only) at the start of every turn and loads
            the body when a skill matches.
          </p>
        </>
      ) : null}
    </main>
  );
}
