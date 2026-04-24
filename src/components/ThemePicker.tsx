import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  previewThemeId,
  restorePersistedTheme,
  setColorScheme,
  setThemeId,
  THEMES,
  useColorScheme,
  useThemeId,
  type ColorScheme,
} from "../lib/theme";

const SCHEME_OPTIONS: { value: ColorScheme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export default function ThemePicker() {
  const themeId = useThemeId();
  const colorScheme = useColorScheme();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const current = THEMES.find((t) => t.id === themeId) ?? THEMES[0];

  useEffect(() => {
    if (!open) return undefined;
    function onClickAway(event: MouseEvent) {
      const target = event.target;
      if (target instanceof Node && containerRef.current?.contains(target))
        return;
      setOpen(false);
      restorePersistedTheme();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        restorePersistedTheme();
      }
    }
    document.addEventListener("mousedown", onClickAway);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClickAway);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
      <div ref={containerRef} className="min-w-0">
        <label className="mb-1 block text-sm font-medium">Theme</label>
        <div className="relative">
          <button
            type="button"
            className="btn btn-outline w-full justify-between font-normal"
            onClick={() => setOpen((o) => !o)}
            aria-haspopup="listbox"
            aria-expanded={open}
          >
            <span className="truncate">{current.name}</span>
            <ChevronDown size={16} className="flex-shrink-0 opacity-60" />
          </button>
          {open ? (
            <ul
              role="listbox"
              className="absolute left-0 right-0 top-full z-10 mt-1 max-h-80 overflow-y-auto rounded-box border border-base-300 bg-base-100 p-1 shadow-lg"
              onMouseLeave={restorePersistedTheme}
            >
              {THEMES.map((theme) => {
                const selected = theme.id === themeId;
                return (
                  <li key={theme.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={`flex w-full items-center justify-between gap-2 rounded-field px-3 py-2 text-left text-sm hover:bg-base-200 ${
                        selected ? "bg-base-200 font-medium" : ""
                      }`}
                      onMouseEnter={() => previewThemeId(theme.id)}
                      onFocus={() => previewThemeId(theme.id)}
                      onClick={() => {
                        setThemeId(theme.id);
                        setOpen(false);
                      }}
                    >
                      <span className="truncate">{theme.name}</span>
                      {selected ? (
                        <Check size={14} className="flex-shrink-0 opacity-60" />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">Color scheme</label>
        <div role="radiogroup" className="join">
          {SCHEME_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={colorScheme === opt.value}
              className={`btn btn-sm join-item ${
                colorScheme === opt.value ? "btn-primary" : "btn-outline"
              }`}
              onClick={() => setColorScheme(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
