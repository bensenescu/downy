/**
 * Bridge between the localStorage-backed preference hooks (`theme.ts`,
 * `preferences.ts`) and D1. localStorage stays the read path so the existing
 * `useSyncExternalStore` hooks work unchanged and the inline theme bootstrap
 * script in `__root.tsx` keeps avoiding a flash. D1 is the source of truth
 * across devices: hydrate on first mount, write through on every change.
 */

const PREF_API = "/api/profile/preferences";

export type PrefKey = "theme_id" | "color_scheme" | "show_thinking";

const PREF_TO_LOCAL_KEY: Record<PrefKey, string> = {
  theme_id: "openclaw:theme-id",
  color_scheme: "openclaw:color-scheme",
  show_thinking: "openclaw:show-thinking",
};

const LOCAL_KEY_TO_PREF: Record<string, PrefKey> = Object.fromEntries(
  Object.entries(PREF_TO_LOCAL_KEY).map(([k, v]) => [v, k as PrefKey]),
);

const CHANGE_EVENTS = new Set([
  "openclaw:theme-change",
  "openclaw:preference-change",
]);

let hydrated = false;

/**
 * One-shot fetch from D1 to localStorage. Idempotent — subsequent calls are
 * no-ops within the same isolate. Safe to call from any client component.
 */
export async function hydratePreferencesFromServer(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  if (typeof window === "undefined") return;
  try {
    const res = await fetch(PREF_API);
    if (!res.ok) return;
    const body = (await res.json()) as {
      preferences: Partial<Record<PrefKey, string>>;
    };
    const prefs = body.preferences;
    let changed = false;
    for (const [k, v] of Object.entries(prefs) as [PrefKey, string][]) {
      const localKey = PREF_TO_LOCAL_KEY[k];
      if (window.localStorage.getItem(localKey) !== v) {
        window.localStorage.setItem(localKey, v);
        changed = true;
      }
    }
    if (changed) {
      // Same fan-out the per-pref setters use, so subscribed components
      // re-render without a reload.
      window.dispatchEvent(new Event("openclaw:theme-change"));
      window.dispatchEvent(new Event("openclaw:preference-change"));
    }
  } catch (err) {
    // Hydration is best-effort — local values stay if the network fails.
    console.warn("[preferences] hydrate failed", err);
  }
}

let writeQueue: Promise<unknown> = Promise.resolve();

/**
 * Persist a preference change to D1. Serialized via a single in-memory queue
 * so two rapid setters don't race; chained on the same Promise so failures
 * don't poison subsequent writes (each call resets the catch).
 */
export function persistPreference(key: PrefKey, value: string): void {
  writeQueue = writeQueue.then(() =>
    fetch(PREF_API, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, value }),
    })
      .then((res) => {
        if (!res.ok) {
          console.warn("[preferences] persist failed", {
            key,
            status: res.status,
          });
        }
      })
      .catch((err: unknown) => {
        console.warn("[preferences] persist error", {
          key,
          error: err instanceof Error ? err.message : String(err),
        });
      }),
  );
}

/**
 * Convert a localStorage key (used by `theme.ts` / `preferences.ts`) back to
 * the canonical PrefKey D1 understands. Returns null if the key isn't a
 * tracked preference.
 */
export function prefKeyForLocalKey(localKey: string): PrefKey | null {
  return LOCAL_KEY_TO_PREF[localKey] ?? null;
}

export { CHANGE_EVENTS };
