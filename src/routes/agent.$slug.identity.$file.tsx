import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, Save } from "lucide-react";
import { useEffect, useState } from "react";

import MarkdownEditor from "../components/markdown/MarkdownEditor";
import {
  readCoreFile,
  readUserFile,
  writeCoreFile,
  writeUserFile,
} from "../lib/api-client";
import { useBackHint } from "../lib/back-nav";
import { USER_PATH, type CoreFileRecord } from "../worker/agent/core-files";

export const Route = createFileRoute("/agent/$slug/identity/$file")({
  component: IdentityDetail,
});

function IdentityDetail() {
  const { slug, file: filePath } = Route.useParams();
  const back = useBackHint({
    href: `/agent/${slug}/identity`,
    label: "identity",
  });

  const [record, setRecord] = useState<CoreFileRecord | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    // USER.md is shared at the user level — fetch from /api/profile/user-file
    // instead of the per-agent core-file endpoint.
    const fetcher =
      filePath === USER_PATH ? readUserFile() : readCoreFile(slug, filePath);
    fetcher
      .then((loaded) => {
        if (cancelled) return;
        setRecord(loaded);
        setDraft(loaded.content);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [filePath, slug]);

  async function handleSave() {
    if (!record) return;
    setSaving(true);
    setError(null);
    try {
      if (filePath === USER_PATH) {
        await writeUserFile(draft);
      } else {
        await writeCoreFile(slug, filePath, draft);
      }
      setSavedAt(Date.now());
      setRecord({ ...record, content: draft });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function handleRevert() {
    if (!record) return;
    setDraft(record.content);
  }

  const dirty = record ? draft !== record.content : false;

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

      {record ? (
        <>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="mb-1 text-xs font-bold uppercase tracking-widest text-primary">
                {record.path}
              </p>
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
                {record.label}
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-base-content/70">
                {record.description}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {dirty ? (
                <button
                  type="button"
                  onClick={handleRevert}
                  className="btn btn-ghost btn-sm"
                >
                  Revert
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={!dirty || saving}
                className="btn btn-primary btn-sm gap-1.5"
              >
                {saving ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : (
                  <Save size={14} />
                )}
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>

          <MarkdownEditor value={draft} onChange={setDraft} />

          <p className="mt-3 text-xs text-base-content/60">
            {dirty
              ? "Unsaved changes. Next chat turn picks up the latest saved version."
              : savedAt
                ? `Saved ${new Date(savedAt).toLocaleTimeString()}. Also available in the agent's next turn.`
                : record.isDefault
                  ? "Using the bundled default. Edit and save to customize."
                  : "Read fresh on every chat turn."}
          </p>
          <div className="mt-4">
            <Link
              to="/agent/$slug"
              params={{ slug }}
              className="link link-primary text-sm font-semibold"
            >
              ← Back to chat
            </Link>
          </div>
        </>
      ) : !error ? (
        <div className="flex items-center gap-2 text-sm text-base-content/60">
          <span className="loading loading-spinner loading-sm" />
          <span>Loading…</span>
        </div>
      ) : null}
    </main>
  );
}
