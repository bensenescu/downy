import { useAiProvider } from "../../lib/preferences";

// Cloudflare's dashboard resolves `:account` against the user's currently-
// selected account, so we don't need to know the account ID at build time.
const VPC_DASHBOARD_URL =
  "https://dash.cloudflare.com/?to=/:account/workers/vpc-services";

/**
 * Inline warning rendered in `ChatPage` whenever the AI SDK surfaces a
 * `VPC_UNREACHABLE` error from the worker. The matching server-side code
 * lives in `src/worker/agent/get-model.ts` (`pi-prod` provider) and prefixes
 * every connectivity failure with that sentinel string.
 */
export default function VpcConnectivityWarning() {
  const [aiProvider, setAiProvider] = useAiProvider();
  const canSwitch = aiProvider !== "kimi";

  return (
    <div
      role="alert"
      className="mb-2 flex flex-col items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-base-content/90 md:flex-row md:items-center md:justify-between"
    >
      <div className="flex flex-1 gap-3">
        <WarningIcon />
        <div>
          <div className="font-medium">
            Can&apos;t reach your Pi proxy through the Workers VPC binding.
          </div>
          <div className="mt-0.5 text-xs text-base-content/70">
            The most recent message timed out before any response. Check your
            VPC service + cloudflared tunnel in Cloudflare, or fall back to Kimi
            on Workers AI to keep working.
          </div>
        </div>
      </div>
      <div className="flex flex-shrink-0 items-center gap-2 self-end md:self-auto">
        <a
          href={VPC_DASHBOARD_URL}
          target="_blank"
          rel="noreferrer"
          className="btn btn-ghost btn-xs"
        >
          Check Workers VPC →
        </a>
        {canSwitch ? (
          <button
            type="button"
            className="btn btn-warning btn-xs"
            onClick={() => {
              setAiProvider("kimi");
            }}
          >
            Switch to Kimi
          </button>
        ) : null}
      </div>
    </div>
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
