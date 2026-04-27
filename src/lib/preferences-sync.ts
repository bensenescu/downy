/**
 * Bridge between the localStorage-backed preference hooks (`theme.ts`,
 * `preferences.ts`) and D1. localStorage stays the read path so the existing
 * `useSyncExternalStore` hooks work unchanged and the inline theme bootstrap
 * script in `__root.tsx` keeps avoiding a flash. D1 is the source of truth
 * across devices: hydrate on first mount, write through on every change.
 */

const PREF_API = "/api/profile/preferences";

type PrefKey = "theme_id" | "color_scheme" | "show_thinking" | "ai_provider";

const PREF_TO_LOCAL_KEY: Record<PrefKey, string> = {
  theme_id: "downy:theme-id",
  color_scheme: "downy:color-scheme",
  show_thinking: "downy:show-thinking",
  ai_provider: "downy:ai-provider",
};

const PREF_KEYS = new Set<string>(Object.keys(PREF_TO_LOCAL_KEY));

function isPrefKey(value: string): value is PrefKey {
  return PREF_KEYS.has(value);
}

/**
 * Pull `[key, value]` pairs out of an unknown JSON body. Returns null when
 * the body doesn't match `{ preferences: Record<PrefKey, string> }` — the
 * caller skips rather than throwing so a transient API shape change can't
 * break hydration.
 */
function extractPreferences(body: unknown): [PrefKey, string][] | null {
  if (typeof body !== "object" || body === null) return null;
  if (!("preferences" in body)) return null;
  const prefs = body.preferences;
  if (typeof prefs !== "object" || prefs === null) return null;
  const out: [PrefKey, string][] = [];
  for (const [k, v] of Object.entries(prefs)) {
    if (typeof v === "string" && isPrefKey(k)) out.push([k, v]);
  }
  return out;
}

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
    const body: unknown = await res.json();
    const prefs = extractPreferences(body);
    if (!prefs) return;
    let changed = false;
    for (const [k, v] of prefs) {
      const localKey = PREF_TO_LOCAL_KEY[k];
      if (window.localStorage.getItem(localKey) !== v) {
        window.localStorage.setItem(localKey, v);
        changed = true;
      }
    }
    if (changed) {
      // Same fan-out the per-pref setters use, so subscribed components
      // re-render without a reload.
      window.dispatchEvent(new Event("downy:theme-change"));
      window.dispatchEvent(new Event("downy:preference-change"));
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
