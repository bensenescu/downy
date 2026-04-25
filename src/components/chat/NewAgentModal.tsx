import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { createAgent } from "../../lib/agents";

export function NewAgentModal({ onClose }: { onClose: () => void }) {
  const [slug, setSlug] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const slugRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    slugRef.current?.focus();
  }, []);

  async function handleCreate() {
    setError(null);
    setBusy(true);
    try {
      const created = await createAgent({
        slug: slug.trim(),
        displayName: displayName.trim() || slug.trim(),
      });
      onClose();
      await navigate({
        to: "/agent/$slug",
        params: { slug: created.slug },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-md border border-base-300 bg-base-100 shadow-xl"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <div className="card-body gap-4">
          <h3 className="card-title text-base">New agent</h3>
          <p className="text-sm text-base-content/70">
            Each agent has its own workspace, identity files, MCP connections,
            and chat. USER.md is shared.
          </p>
          <label className="form-control gap-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-base-content/60">
              Slug
            </span>
            <input
              ref={slugRef}
              type="text"
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value.toLowerCase());
              }}
              placeholder="linkedin"
              pattern="[a-z][a-z0-9-]{1,30}"
              className="input input-bordered input-sm font-mono"
              disabled={busy}
            />
            <span className="text-xs text-base-content/50">
              2-31 chars, lowercase letters/digits/hyphens, must start with a
              letter.
            </span>
          </label>
          <label className="form-control gap-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-base-content/60">
              Display name
            </span>
            <input
              type="text"
              value={displayName}
              onChange={(e) => {
                setDisplayName(e.target.value);
              }}
              placeholder="LinkedIn agent"
              className="input input-bordered input-sm"
              disabled={busy}
            />
          </label>
          {error ? (
            <div role="alert" className="alert alert-error">
              <span className="text-sm">{error}</span>
            </div>
          ) : null}
          <div className="card-actions justify-end">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => void handleCreate()}
              disabled={busy || !slug.trim()}
            >
              {busy ? (
                <span className="loading loading-spinner loading-xs" />
              ) : null}
              Create
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
