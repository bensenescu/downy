import { useEffect, useRef, useSyncExternalStore } from "react";

import { useSystemStatusQuery } from "../lib/system-status";

const DISMISSED_KEY = "downy:dismissed-exa-warning";

function readDismissed(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(DISMISSED_KEY) === "true";
}

function subscribe(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener("storage", callback);
  };
}

/**
 * One-time warning modal shown when EXA_API_KEY isn't configured on the
 * Worker. Without it the agent's web_search and web_scrape tools return an
 * error mid-conversation — losing arguably the most useful capability —
 * so this nudges the user to set the key up before they hit that wall.
 *
 * Dismissal is local-only (per-device): if the user already chose to live
 * without EXA on a given browser, we don't keep nagging them. If they want
 * to see it again they can clear the key in localStorage.
 */
export default function ExaSetupWarning() {
  const dismissed = useSyncExternalStore(subscribe, readDismissed, () => true);
  const { data, isSuccess } = useSystemStatusQuery();
  const dialogRef = useRef<HTMLDialogElement>(null);

  const shouldShow = isSuccess && !data.exaConfigured && !dismissed;

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (shouldShow && !el.open) el.showModal();
    if (!shouldShow && el.open) el.close();
  }, [shouldShow]);

  if (!shouldShow) return null;

  function handleDismiss() {
    window.localStorage.setItem(DISMISSED_KEY, "true");
    dialogRef.current?.close();
  }

  return (
    <dialog ref={dialogRef} className="modal" onClose={handleDismiss}>
      <div className="modal-box max-w-lg border border-base-300 bg-base-100 shadow-2xl">
        <h3 className="text-base font-semibold">
          Web search &amp; scraping aren&apos;t set up
        </h3>

        <div
          role="alert"
          className="mt-3 flex gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-base-content/90"
        >
          <WarningIcon />
          <span>
            Without an Exa API key the{" "}
            <code className="rounded bg-base-200 px-1 py-0.5 text-[0.85em]">
              web_search
            </code>{" "}
            and{" "}
            <code className="rounded bg-base-200 px-1 py-0.5 text-[0.85em]">
              web_scrape
            </code>{" "}
            tools won&apos;t work — the agent loses one of its most powerful
            capabilities.
          </span>
        </div>

        <div className="mt-4 space-y-3 text-sm text-base-content/80">
          <p>
            <span className="font-medium text-base-content">Recommended:</span>{" "}
            create a free API key at{" "}
            <a
              href="https://exa.ai"
              target="_blank"
              rel="noreferrer"
              className="link link-primary"
            >
              exa.ai
            </a>{" "}
            and run:
          </p>
          <pre className="overflow-x-auto rounded-md border border-base-300 bg-base-200 px-3 py-2 text-xs">
            <code>npx wrangler secret put EXA_API_KEY</code>
          </pre>
          <p>The free plan is plenty for normal personal use.</p>
          <p className="text-xs text-base-content/60">
            Support for other search providers (Brave, Serper, Tavily…) is on
            the roadmap — this would be a great area to contribute. See the repo
            issues if you&apos;d like to pick it up.
          </p>
        </div>

        <div className="modal-action mt-5">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleDismiss}
            autoFocus
          >
            Got it
          </button>
        </div>
      </div>
      <form method="dialog" className="modal-backdrop bg-base-300/60">
        <button type="submit" aria-label="Close">
          close
        </button>
      </form>
    </dialog>
  );
}

function WarningIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning"
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
