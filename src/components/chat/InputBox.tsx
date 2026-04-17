import { Send, Square } from "lucide-react";
import { useState, type FormEvent, type KeyboardEvent } from "react";

interface Props {
  onSend: (text: string) => void;
  onStop?: () => void;
  busy?: boolean;
  placeholder?: string;
}

export default function InputBox({ onSend, onStop, busy, placeholder }: Props) {
  const [value, setValue] = useState("");

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    onSend(trimmed);
    setValue("");
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    submit();
  }

  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="relative">
      <div className="island-shell flex items-end gap-2 rounded-2xl px-3 py-2">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKey}
          placeholder={placeholder ?? "Ask Claw anything…"}
          rows={1}
          className="min-h-[2.25rem] max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-[var(--sea-ink)] outline-none placeholder:text-[var(--sea-ink-soft)]"
        />
        {busy && onStop ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop generation"
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] text-[var(--sea-ink)] transition hover:-translate-y-0.5"
          >
            <Square size={14} />
          </button>
        ) : (
          <button
            type="submit"
            disabled={busy || !value.trim()}
            aria-label="Send message"
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[var(--lagoon-deep)] text-white shadow-sm transition hover:-translate-y-0.5 disabled:opacity-40 disabled:hover:translate-y-0"
          >
            <Send size={14} />
          </button>
        )}
      </div>
    </form>
  );
}
