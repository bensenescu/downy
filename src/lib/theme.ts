import { useSyncExternalStore } from "react";

import { GENERATED_THEMES, type ThemeManifestEntry } from "./themes.generated";

export type ColorScheme = "system" | "light" | "dark";

const OPENCLAW: ThemeManifestEntry = { id: "openclaw", name: "OpenClaw" };

/** All themes available in the picker, with the built-in OpenClaw theme first. */
export const THEMES: readonly ThemeManifestEntry[] = [
  OPENCLAW,
  ...GENERATED_THEMES,
];

const DEFAULT_THEME_ID = OPENCLAW.id;
const DEFAULT_COLOR_SCHEME: ColorScheme = "system";

const THEME_ID_KEY = "openclaw:theme-id";
const COLOR_SCHEME_KEY = "openclaw:color-scheme";
const CHANGE_EVENT = "openclaw:theme-change";

const VALID_IDS = new Set(THEMES.map((t) => t.id));

function isColorScheme(value: string | null): value is ColorScheme {
  return value === "system" || value === "light" || value === "dark";
}

function readThemeId(): string {
  if (typeof window === "undefined") return DEFAULT_THEME_ID;
  const stored = window.localStorage.getItem(THEME_ID_KEY);
  return stored && VALID_IDS.has(stored) ? stored : DEFAULT_THEME_ID;
}

function readColorScheme(): ColorScheme {
  if (typeof window === "undefined") return DEFAULT_COLOR_SCHEME;
  const stored = window.localStorage.getItem(COLOR_SCHEME_KEY);
  return isColorScheme(stored) ? stored : DEFAULT_COLOR_SCHEME;
}

function resolveScheme(scheme: ColorScheme): "light" | "dark" {
  if (scheme !== "system") return scheme;
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyTheme(themeId: string, scheme: ColorScheme): void {
  if (typeof document === "undefined") return;
  const resolved = resolveScheme(scheme);
  const root = document.documentElement;
  root.setAttribute("data-theme", `${themeId}-${resolved}`);
  root.style.colorScheme = resolved;
}

function emitChange(): void {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGE_EVENT, callback);
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(CHANGE_EVENT, callback);
    media.removeEventListener("change", callback);
  };
}

export function setThemeId(id: string): void {
  if (!VALID_IDS.has(id)) return;
  window.localStorage.setItem(THEME_ID_KEY, id);
  applyTheme(id, readColorScheme());
  emitChange();
}

export function setColorScheme(scheme: ColorScheme): void {
  if (!isColorScheme(scheme)) return;
  window.localStorage.setItem(COLOR_SCHEME_KEY, scheme);
  applyTheme(readThemeId(), scheme);
  emitChange();
}

/** Apply a theme without persisting — used for hover-preview in the picker. */
export function previewThemeId(id: string): void {
  if (!VALID_IDS.has(id)) return;
  applyTheme(id, readColorScheme());
}

/** Re-apply the persisted theme. Used to revert after a hover-preview. */
export function restorePersistedTheme(): void {
  applyTheme(readThemeId(), readColorScheme());
}

export function useThemeId(): string {
  return useSyncExternalStore(subscribe, readThemeId, () => DEFAULT_THEME_ID);
}

export function useColorScheme(): ColorScheme {
  return useSyncExternalStore(
    subscribe,
    readColorScheme,
    () => DEFAULT_COLOR_SCHEME,
  );
}
