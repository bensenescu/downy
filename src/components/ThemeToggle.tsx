import { Monitor, Moon, Sun } from "lucide-react";

import { setColorScheme, useColorScheme, type ColorScheme } from "../lib/theme";

const ICONS: Record<ColorScheme, typeof Monitor> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

const NEXT: Record<ColorScheme, ColorScheme> = {
  light: "dark",
  dark: "system",
  system: "light",
};

const LABELS: Record<ColorScheme, string> = {
  light: "Color scheme: light. Click to switch to dark.",
  dark: "Color scheme: dark. Click to switch to system.",
  system: "Color scheme: system. Click to switch to light.",
};

export default function ThemeToggle() {
  const scheme = useColorScheme();
  const Icon = ICONS[scheme];
  const label = LABELS[scheme];

  return (
    <button
      type="button"
      onClick={() => {
        setColorScheme(NEXT[scheme]);
      }}
      aria-label={label}
      title={label}
      className="btn btn-ghost btn-sm btn-square"
    >
      <Icon size={16} />
    </button>
  );
}
