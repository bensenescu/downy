import { useSyncExternalStore } from "react";

/**
 * Small localStorage-backed preference system. Values persist across reloads
 * and sync across tabs via the `storage` event; same-tab updates broadcast a
 * custom event so React subscribers re-render immediately after a write.
 */

const SHOW_THINKING_KEY = "openclaw:show-thinking";
const CHANGE_EVENT = "openclaw:preference-change";

function readBool(key: string): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(key) === "true";
}

function writeBool(key: string, value: boolean): void {
  window.localStorage.setItem(key, String(value));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}

export function useShowThinking(): [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => readBool(SHOW_THINKING_KEY),
    () => false,
  );
  const set = (next: boolean) => {
    writeBool(SHOW_THINKING_KEY, next);
  };
  return [value, set];
}
