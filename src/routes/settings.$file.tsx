import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Save } from "lucide-react";
import { useEffect, useState } from "react";

import MarkdownEditor from "../components/markdown/MarkdownEditor";
import { readCoreFile, writeCoreFile } from "../lib/api-client";
import type { CoreFileRecord } from "../worker/agent/core-files";

export const Route = createFileRoute("/settings/$file")({
  component: SettingsDetail,
});

function SettingsDetail() {
  const { file: filePath } = Route.useParams();
  const navigate = useNavigate();

  const [record, setRecord] = useState<CoreFileRecord | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    readCoreFile(filePath)
      .then((loaded) => {
        if (cancelled) return;
        if (!loaded) {
          setError("That identity file doesn't exist.");
          return;
        }
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
  }, [filePath]);

  async function handleSave() {
    if (!record) return;
    setSaving(true);
    setError(null);
    try {
      await writeCoreFile(filePath, draft);
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
      <button
        type="button"
        onClick={() => void navigate({ to: "/settings" })}
        className="btn btn-ghost btn-sm mb-4 gap-1 px-2"
      >
        <ChevronLeft size={14} />
        Back to settings
      </button>

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
                : "Read fresh on every chat turn."}
          </p>
          <div className="mt-4">
            <Link to="/" className="link link-primary text-sm font-semibold">
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
