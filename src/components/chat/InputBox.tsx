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
      <div className="flex items-end gap-2 rounded-box border border-base-300 bg-base-100 px-3 py-2 shadow-sm focus-within:border-primary">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKey}
          placeholder={placeholder ?? "Ask Claw anything…"}
          rows={1}
          className="max-h-40 min-h-9 flex-1 resize-none border-0 bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-base-content/50 focus:outline-none"
        />
        {busy && onStop ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop generation"
            className="btn btn-ghost btn-sm btn-circle"
          >
            <Square size={14} />
          </button>
        ) : (
          <button
            type="submit"
            disabled={busy || !value.trim()}
            aria-label="Send message"
            className="btn btn-primary btn-sm btn-circle"
          >
            <Send size={14} />
          </button>
        )}
      </div>
    </form>
  );
}
