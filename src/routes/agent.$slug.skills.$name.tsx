import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import MarkdownEditor from "../components/markdown/MarkdownEditor";
import MarkdownPreview from "../components/markdown/MarkdownPreview";
import BackLink from "../components/ui/BackLink";
import { confirmDialog } from "../components/ui/dialog";
import ErrorAlert, { errorMessage } from "../components/ui/ErrorAlert";
import PageShell from "../components/ui/PageShell";
import { useBackHint } from "../lib/back-nav";
import {
  useDeleteWorkspaceFile,
  useWorkspaceFile,
  useWriteWorkspaceFile,
} from "../lib/queries";
import { parseSkillFile } from "../worker/agent/skills/frontmatter";

export const Route = createFileRoute("/agent/$slug/skills/$name")({
  component: SkillEditorPage,
});

/**
 * Skill editor — same shape as the workspace file editor, but the path is
 * fixed at `skills/<name>/SKILL.md`. Reads / writes / deletes go through
 * the existing workspace API; the model uses the same path when it edits a
 * skill via `edit_file`, so there's no divergent storage.
 *
 * The editor exposes the whole file including frontmatter. Saves are blocked
 * if the frontmatter doesn't parse — without it the loader silently drops
 * the skill from the catalog and the agent can never trigger it, so saving
 * a broken file is never what the user wants.
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

  const validationError = useMemo(() => {
    if (!editing) return null;
    const parsed = parseSkillFile(draft);
    return parsed.ok ? null : parsed.error;
  }, [draft, editing]);

  async function handleSave() {
    setActionError(null);
    if (validationError) {
      setActionError(validationError);
      return;
    }
    try {
      await writeMut.mutateAsync({ slug, path: skillPath, content: draft });
      setEditing(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDelete() {
    const confirmed = await confirmDialog({
      title: "Delete skill?",
      message: `Delete skill ${name}?`,
      confirmLabel: "Delete",
      tone: "danger",
    });
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

  const error = actionError ?? errorMessage(fileQ.error);
  const saving = writeMut.isPending;

  return (
    <PageShell>
      <BackLink to={back.href} label={back.label} variant="chip" />

      <ErrorAlert message={error} />

      {editing && validationError ? (
        <ErrorAlert
          message={`Frontmatter invalid — ${validationError}`}
          tone="warning"
        />
      ) : null}

      {notFound ? (
        <div className="flex flex-col items-start gap-2 py-8">
          <p className="text-xs font-bold uppercase tracking-widest text-base-content/50">
            Not found
          </p>
          <h1 className="text-2xl font-bold tracking-tight">
            Skill not found.
          </h1>
          <p className="text-sm text-base-content/65">
            <code className="rounded bg-base-200 px-1.5 py-0.5 font-mono text-[0.85em]">
              {name}
            </code>
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
                Skill
              </p>
              <h1 className="break-all font-mono text-base font-semibold">
                {name}
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-1">
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
                  disabled={
                    saving ||
                    draft === record.content ||
                    validationError !== null
                  }
                  title={validationError ?? undefined}
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
          ) : record.content.trim() ? (
            <MarkdownPreview source={record.content} />
          ) : (
            <p className="text-sm italic text-base-content/55">Empty file.</p>
          )}
        </>
      ) : null}
    </PageShell>
  );
}
