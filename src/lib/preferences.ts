import { useSyncExternalStore } from "react";

import {
  DEFAULT_AI_PROVIDER,
  isAiProvider,
  type AiProvider,
} from "./ai-providers";
import { persistPreference } from "./preferences-sync";

/**
 * Small localStorage-backed preference system. Values persist across reloads
 * and sync across tabs via the `storage` event; same-tab updates broadcast a
 * custom event so React subscribers re-render immediately after a write.
 *
 * D1 is the durable backing store: writes go to localStorage first (so the
 * existing useSyncExternalStore hook re-renders synchronously) and are then
 * persisted via `persistPreference`. Hydration happens once at app mount —
 * see `preferences-sync.ts`.
 */

const SHOW_THINKING_KEY = "openclaw:show-thinking";
const AI_PROVIDER_KEY = "openclaw:ai-provider";
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
    persistPreference("show_thinking", String(next));
  };
  return [value, set];
}

function readAiProvider(): AiProvider {
  if (typeof window === "undefined") return DEFAULT_AI_PROVIDER;
  const stored = window.localStorage.getItem(AI_PROVIDER_KEY);
  return isAiProvider(stored) ? stored : DEFAULT_AI_PROVIDER;
}

export function useAiProvider(): [AiProvider, (value: AiProvider) => void] {
  const value = useSyncExternalStore(
    subscribe,
    readAiProvider,
    () => DEFAULT_AI_PROVIDER,
  );
  const set = (next: AiProvider) => {
    if (!isAiProvider(next)) return;
    window.localStorage.setItem(AI_PROVIDER_KEY, next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
    persistPreference("ai_provider", next);
  };
  return [value, set];
}
