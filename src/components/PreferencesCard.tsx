import { useShowThinking } from "../lib/preferences";

export default function PreferencesCard() {
  const [showThinking, setShowThinking] = useShowThinking();

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
              Expand Claw's reasoning blocks by default. Off by default since
              they can clutter the chat — turn on if you want to watch how Claw
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
      </div>
    </section>
  );
}
