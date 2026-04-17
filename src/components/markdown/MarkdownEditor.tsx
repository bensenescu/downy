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
    <div className="overflow-hidden rounded-box border border-base-300 bg-base-100">
      <div className="flex items-center justify-between border-b border-base-300 bg-base-200/60 px-3 py-1.5">
        <div role="tablist" className="tabs tabs-sm tabs-boxed bg-base-200">
          <button
            type="button"
            role="tab"
            onClick={() => setMode("edit")}
            className={[
              "tab gap-1.5 text-xs",
              mode === "edit" ? "tab-active" : "",
            ].join(" ")}
          >
            <Pencil size={12} />
            Edit
          </button>
          <button
            type="button"
            role="tab"
            onClick={() => setMode("preview")}
            className={[
              "tab gap-1.5 text-xs",
              mode === "preview" ? "tab-active" : "",
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
          className="w-full resize-y border-0 bg-transparent px-4 py-3 font-mono text-sm leading-relaxed outline-none focus:outline-none"
        />
      ) : (
        <div className="px-4 py-3">
          {value.trim() ? (
            <MarkdownPreview source={value} />
          ) : (
            <p className="text-sm italic text-base-content/60">Empty.</p>
          )}
        </div>
      )}
    </div>
  );
}
