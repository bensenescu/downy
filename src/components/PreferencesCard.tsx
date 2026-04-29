import {
  AI_PROVIDERS,
  isAiProvider,
  type AiProvider,
} from "../lib/ai-providers";
import { useAiProvider, useShowThinking } from "../lib/preferences";

const PROVIDER_LABELS: Record<AiProvider, string> = {
  kimi: "Kimi K2.6 (Workers AI)",
  "pi-local": "Pi proxy (local)",
  "pi-prod": "Pi proxy (prod)",
};

export default function PreferencesCard() {
  const [showThinking, setShowThinking] = useShowThinking();
  const [aiProvider, setAiProvider] = useAiProvider();

  return (
    <section className="card card-compact border border-base-300 bg-base-100 shadow-sm">
      <div className="card-body gap-4">
        <h2 className="text-base font-semibold">Preferences</h2>

        <label className="flex cursor-pointer items-start justify-between gap-4">
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">Show thinking</span>
            <span className="mt-1 block text-xs text-base-content/70">
              Expand reasoning blocks by default.
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
