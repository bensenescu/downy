import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, Save } from "lucide-react";
import { useEffect, useState } from "react";

import MarkdownEditor from "../components/markdown/MarkdownEditor";
import { useBackHint } from "../lib/back-nav";
import {
  useCoreFile,
  useUserFile,
  useWriteCoreFile,
  useWriteUserFile,
} from "../lib/queries";
import { USER_PATH } from "../worker/agent/core-files";

export const Route = createFileRoute("/agent/$slug/identity/$")({
  component: IdentityDetail,
});

function IdentityDetail() {
  const params = Route.useParams();
  const { slug } = params;
  // Splat captures the rest of the URL ("identity/IDENTITY.md") and
  // round-trips through URL encoding so paths-with-slashes survive a reload.
  const rawSplat = params._splat ?? "";
  const filePath = rawSplat
    .split("/")
    .map((s) => decodeURIComponent(s))
    .join("/");
  const back = useBackHint({
    href: `/agent/${slug}/identity`,
    label: "identity",
  });

  // USER.md is user-level (D1, not per-agent R2). Pick the right query.
  const isUserFile = filePath === USER_PATH;
  const userQ = useUserFile();
  const coreQ = useCoreFile(slug, filePath);
  const record = isUserFile ? userQ.data : coreQ.data;
  const queryError = isUserFile ? userQ.error : coreQ.error;

  const writeUser = useWriteUserFile();
  const writeCore = useWriteCoreFile();

  const [draft, setDraft] = useState("");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Seed the draft when the record first loads (or changes — file path
  // switches, agent switches, etc.). We track by content + path so saving
  // doesn't reset the draft on the optimistic update.
  useEffect(() => {
    if (record) setDraft(record.content);
  }, [record]);

  async function handleSave() {
    if (!record) return;
    setSaveError(null);
    try {
      if (isUserFile) {
        await writeUser.mutateAsync(draft);
      } else {
        await writeCore.mutateAsync({ slug, path: filePath, content: draft });
      }
      setSavedAt(Date.now());
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleRevert() {
    if (!record) return;
    setDraft(record.content);
  }

  const dirty = record ? draft !== record.content : false;
  const saving = isUserFile ? writeUser.isPending : writeCore.isPending;
  const displayError =
    saveError ??
    (queryError
      ? queryError instanceof Error
        ? queryError.message
        : String(queryError)
      : null);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-12 pt-8">
      <Link to={back.href} className="btn btn-ghost btn-sm mb-4 gap-1 px-2">
        <ChevronLeft size={14} />
        Back to {back.label}
      </Link>

      {displayError ? (
        <div role="alert" className="alert alert-error mb-4">
          <span>{displayError}</span>
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
              ? "Unsaved changes."
              : savedAt
                ? `Saved ${new Date(savedAt).toLocaleTimeString()}.`
                : record.isDefault
                  ? "Using default. Edit and save to customize."
                  : "Read on every turn."}
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
      ) : !displayError ? (
        <div className="flex items-center gap-2 text-sm text-base-content/60">
          <span className="loading loading-spinner loading-sm" />
          <span>Loading…</span>
        </div>
      ) : null}
    </main>
  );
}
