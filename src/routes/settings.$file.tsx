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
    <main className="page-wrap px-4 pb-12 pt-8">
      <button
        type="button"
        onClick={() => void navigate({ to: "/settings" })}
        className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--sea-ink-soft)] hover:text-[var(--sea-ink)]"
      >
        <ChevronLeft size={14} />
        Back to settings
      </button>

      {error ? (
        <div className="mb-4 rounded-xl border border-red-300/40 bg-red-100/30 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {record ? (
        <>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="island-kicker mb-1">{record.path}</p>
              <h1 className="display-title text-2xl font-bold tracking-tight text-[var(--sea-ink)] sm:text-3xl">
                {record.label}
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-[var(--sea-ink-soft)]">
                {record.description}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {dirty ? (
                <button
                  type="button"
                  onClick={handleRevert}
                  className="rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-4 py-1.5 text-sm font-semibold text-[var(--sea-ink)] transition hover:-translate-y-0.5"
                >
                  Revert
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={!dirty || saving}
                className="inline-flex items-center gap-1.5 rounded-full bg-[var(--lagoon-deep)] px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 disabled:opacity-40 disabled:hover:translate-y-0"
              >
                <Save size={14} />
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>

          <MarkdownEditor value={draft} onChange={setDraft} />

          <p className="mt-3 text-xs text-[var(--sea-ink-soft)]">
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
              to="/"
              className="text-sm font-semibold text-[var(--lagoon-deep)]"
            >
              ← Back to chat
            </Link>
          </div>
        </>
      ) : !error ? (
        <p className="text-sm text-[var(--sea-ink-soft)]">Loading…</p>
      ) : null}
    </main>
  );
}
