import {
  AI_PROVIDERS,
  isAiProvider,
  type AiProvider,
} from "../lib/ai-providers";
import {
  useAiProvider,
  useShowThinking,
  useTelegramBotToken,
  useTelegramWhitelist,
} from "../lib/preferences";

const PROVIDER_LABELS: Record<AiProvider, string> = {
  kimi: "Kimi K2.6 (Workers AI)",
  "pi-local": "Pi proxy (local)",
  "pi-prod": "Pi proxy (prod)",
  openrouter: "OpenRouter",
};

export default function PreferencesCard() {
  const [showThinking, setShowThinking] = useShowThinking();
  const [aiProvider, setAiProvider] = useAiProvider();
  const [telegramToken, setTelegramToken] = useTelegramBotToken();
  const [telegramWhitelist, setTelegramWhitelist] = useTelegramWhitelist();

  return (
    <div className="space-y-6">
      <section className="card card-compact border border-base-300 bg-base-100 shadow-sm">
        <div className="card-body gap-4">
          <h2 className="text-base font-semibold">General Preferences</h2>

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

      <section className="card card-compact border border-base-300 bg-base-100 shadow-sm">
        <div className="card-body gap-4">
          <h2 className="text-base font-semibold">Telegram Integration</h2>
          <p className="text-xs text-base-content/60">
            Configure your Telegram bot to interact with agents from anywhere.
          </p>

          <label className="flex flex-col gap-2">
            <span className="block text-sm font-medium">Bot API Token</span>
            <input
              type="password"
              className="input input-bordered input-sm"
              placeholder="1234567890:ABC..."
              value={telegramToken}
              onChange={(e) => setTelegramToken(e.target.value)}
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="block text-sm font-medium">
              Whitelisted Chat IDs
            </span>
            <input
              type="text"
              className="input input-bordered input-sm"
              placeholder="12345678, -987654321"
              value={telegramWhitelist}
              onChange={(e) => setTelegramWhitelist(e.target.value)}
            />
            <span className="text-[10px] opacity-50">
              Comma-separated IDs. Leave empty to allow any chat (not
              recommended).
            </span>
          </label>
        </div>
      </section>
    </div>
  );
}
