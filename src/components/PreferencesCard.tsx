import {
  AI_PROVIDERS,
  isAiProvider,
  type AiProvider,
} from "../lib/ai-providers";
import { useAiProvider, useShowThinking } from "../lib/preferences";

const PROVIDER_LABELS: Record<AiProvider, string> = {
  kimi: "Kimi K2.6 (Workers AI, recommended)",
  "pi-local": "Pi proxy — local dev (127.0.0.1:8788)",
  "pi-prod": "Pi proxy — production VPC",
};

export default function PreferencesCard() {
  const [showThinking, setShowThinking] = useShowThinking();
  const [aiProvider, setAiProvider] = useAiProvider();

  return (
    <section className="card card-compact border border-base-300 bg-base-100 shadow-sm">
      <div className="card-body gap-4">
        <div>
          <h2 className="text-base font-semibold">Preferences</h2>
          <p className="text-sm text-base-content/70">
            How the chat interface behaves for you. Stored locally in this
            browser.
          </p>
        </div>

        <label className="flex cursor-pointer items-start justify-between gap-4">
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">Show thinking</span>
            <span className="mt-1 block text-xs text-base-content/70">
              Expand Downy's reasoning blocks by default. Off by default since
              they can clutter the chat — turn on if you want to watch how Downy
              is working.
            </span>
          </span>
          <input
            type="checkbox"
            className="toggle toggle-primary flex-shrink-0"
            checked={showThinking}
            onChange={(e) => {
              setShowThinking(e.target.checked);
            }}
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className="block text-sm font-medium">Model</span>
          <span className="block text-xs text-base-content/70">
            Which model the agents use. Kimi runs on Workers AI (the default).
            The pi-proxy options route through the local aisdk-pi-proxy or the
            production VPC connector — pick the one that matches where the
            Worker is running.
          </span>
          <select
            className="select select-bordered select-sm"
            value={aiProvider}
            onChange={(e) => {
              const next = e.target.value;
              if (isAiProvider(next)) setAiProvider(next);
            }}
          >
            {AI_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {PROVIDER_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}
