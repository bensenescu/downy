import { Eye, Pencil } from "lucide-react";
import { useState } from "react";

import MarkdownPreview from "./MarkdownPreview";

interface Props {
  value: string;
  onChange: (next: string) => void;
  rows?: number;
}

export default function MarkdownEditor({ value, onChange, rows }: Props) {
  const [mode, setMode] = useState<"edit" | "preview">("edit");

  return (
    <div className="island-shell overflow-hidden rounded-2xl">
      <div className="flex items-center justify-between border-b border-[var(--line)] bg-[var(--surface)] px-3 py-1.5">
        <div className="flex gap-1 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setMode("edit")}
            className={[
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 transition",
              mode === "edit"
                ? "bg-[var(--chip-bg)] text-[var(--sea-ink)]"
                : "text-[var(--sea-ink-soft)] hover:text-[var(--sea-ink)]",
            ].join(" ")}
          >
            <Pencil size={12} />
            Edit
          </button>
          <button
            type="button"
            onClick={() => setMode("preview")}
            className={[
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 transition",
              mode === "preview"
                ? "bg-[var(--chip-bg)] text-[var(--sea-ink)]"
                : "text-[var(--sea-ink-soft)] hover:text-[var(--sea-ink)]",
            ].join(" ")}
          >
            <Eye size={12} />
            Preview
          </button>
        </div>
      </div>

      {mode === "edit" ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows ?? 18}
          spellCheck={false}
          className="w-full resize-y bg-transparent px-4 py-3 font-mono text-sm leading-relaxed text-[var(--sea-ink)] outline-none"
        />
      ) : (
        <div className="px-4 py-3">
          {value.trim() ? (
            <MarkdownPreview source={value} />
          ) : (
            <p className="text-sm italic text-[var(--sea-ink-soft)]">Empty.</p>
          )}
        </div>
      )}
    </div>
  );
}
