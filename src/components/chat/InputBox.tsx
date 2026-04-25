import { Loader2, Mic, Send, Square } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import { transcribeAudio } from "../../lib/api-client";

interface Props {
  onSend: (text: string) => void;
  onStop?: () => void;
  busy?: boolean;
  placeholder?: string;
  /**
   * Externally controlled draft. When this changes (and is non-null), the
   * textarea is replaced with `draft` and refocused. Used by the "edit last
   * message" affordance to seed the input with the prior message text. Pass
   * `null` (or omit) for the normal greenfield input.
   */
  draft?: string | null;
  /**
   * Called when the user clears the draft (Escape or the cancel control).
   * Only meaningful when `draft` is non-null.
   */
  onCancelDraft?: () => void;
}

// Auto-grow bounds. Start showing 2 lines so the textarea doesn't feel like a
// single-line input, and cap at 8 before scrolling — after that the pane is
// already tall enough to edit comfortably without squeezing the chat above.
const MIN_LINES = 2;
const MAX_LINES = 8;

type RecorderState = "idle" | "recording" | "transcribing";

/**
 * Preferred MIME types for `MediaRecorder`, in order of preference. Chrome and
 * Firefox support `audio/webm;codecs=opus`; Safari only supports `audio/mp4`.
 * Whisper accepts both, so we just use whatever the browser gives us.
 */
const MIME_PREFERENCE = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg",
];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const mime of MIME_PREFERENCE) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return undefined;
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m)}:${String(s).padStart(2, "0")}`;
}

export default function InputBox({
  onSend,
  onStop,
  busy,
  placeholder,
  draft,
  onCancelDraft,
}: Props) {
  const [value, setValue] = useState("");

  // When the parent hands us a new draft (e.g. user clicked Edit), replace
  // the textarea contents and refocus. Comparing against the previous draft
  // prevents this from clobbering the user's in-progress edits on every
  // keystroke — `draft` only updates when the parent rewrites it.
  const lastDraftRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (draft === lastDraftRef.current) return;
    lastDraftRef.current = draft;
    if (draft != null) {
      setValue(draft);
      queueMicrotask(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.focus();
        // Place caret at end so the user can keep typing without selecting.
        ta.setSelectionRange(ta.value.length, ta.value.length);
      });
    }
  }, [draft]);
  const [recorderState, setRecorderState] = useState<RecorderState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Tear down any still-running media resources on unmount. We're careful not
  // to cancel an in-flight transcription request — that's fine to let finish.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          // ignore
        }
      }
      streamRef.current?.getTracks().forEach((track) => {
        track.stop();
      });
    };
  }, []);

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
    } else if (e.key === "Escape" && draft != null && onCancelDraft) {
      e.preventDefault();
      onCancelDraft();
    }
  }

  // Resize the textarea to fit content, clamped between MIN_LINES and
  // MAX_LINES. We read `line-height` and vertical padding from computed style
  // so this stays correct if the font size changes (e.g. browser zoom). The
  // `height = auto` reset is required — otherwise scrollHeight is pinned to
  // the previous height and the box can only grow, never shrink.
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const cs = getComputedStyle(ta);
    const lineHeight = parseFloat(cs.lineHeight);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const minH = lineHeight * MIN_LINES + padY;
    const maxH = lineHeight * MAX_LINES + padY;
    const next = Math.min(Math.max(ta.scrollHeight, minH), maxH);
    ta.style.height = `${next}px`;
    ta.style.overflowY = ta.scrollHeight > maxH ? "auto" : "hidden";
  }, [value]);

  /**
   * Append transcribed text to whatever the user has already typed so a voice
   * note can combine with a typed prefix/suffix. We insert with a leading
   * space when there's existing content.
   */
  function insertTranscript(transcript: string) {
    const cleaned = transcript.trim();
    if (!cleaned) return;
    setValue((current) => {
      if (!current) return cleaned;
      const sep = /\s$/.test(current) ? "" : " ";
      return `${current}${sep}${cleaned}`;
    });
    // Refocus the textarea so the user can keep editing.
    queueMicrotask(() => textareaRef.current?.focus());
  }

  function stopTimer() {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function stopStream() {
    streamRef.current?.getTracks().forEach((track) => {
      track.stop();
    });
    streamRef.current = null;
  }

  async function startRecording() {
    if (recorderState !== "idle") return;
    setError(null);

    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices ||
      typeof MediaRecorder === "undefined"
    ) {
      setError("Voice input isn't supported in this browser.");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(
        message.toLowerCase().includes("permission")
          ? "Microphone permission denied."
          : `Couldn't access the microphone: ${message}`,
      );
      return;
    }

    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(
      stream,
      mimeType ? { mimeType } : undefined,
    );

    chunksRef.current = [];
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    });
    recorder.addEventListener("stop", () => {
      void handleRecorderStop(mimeType);
    });
    recorder.addEventListener("error", () => {
      setError("Recording failed.");
      cancelRecording();
    });

    recorderRef.current = recorder;
    streamRef.current = stream;

    recorder.start();
    setRecorderState("recording");
    setElapsed(0);
    const start = Date.now();
    timerRef.current = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 250);
  }

  function stopRecording() {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    stopTimer();
    recorder.stop();
    // `handleRecorderStop` takes it from here once the 'stop' event fires.
  }

  function cancelRecording() {
    stopTimer();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        // ignore
      }
    }
    recorderRef.current = null;
    stopStream();
    chunksRef.current = [];
    setRecorderState("idle");
    setElapsed(0);
  }

  async function handleRecorderStop(mimeType: string | undefined) {
    stopStream();
    const chunks = chunksRef.current;
    chunksRef.current = [];
    recorderRef.current = null;

    if (chunks.length === 0) {
      setRecorderState("idle");
      return;
    }

    const blob = new Blob(chunks, { type: mimeType ?? chunks[0]?.type ?? "" });
    if (blob.size === 0) {
      setRecorderState("idle");
      return;
    }

    setRecorderState("transcribing");
    try {
      const text = await transcribeAudio(blob);
      insertTranscript(text);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message || "Transcription failed.");
    } finally {
      setRecorderState("idle");
      setElapsed(0);
    }
  }

  const isRecording = recorderState === "recording";
  const isTranscribing = recorderState === "transcribing";
  const micDisabled = busy || isTranscribing;

  return (
    <form onSubmit={handleSubmit} className="relative">
      <div className="flex items-end gap-2 rounded-box border border-base-300 bg-base-100 px-3 py-2 shadow-sm focus-within:border-primary">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKey}
          placeholder={
            isRecording
              ? `Recording… ${formatElapsed(elapsed)}`
              : isTranscribing
                ? "Transcribing…"
                : (placeholder ?? "Ask Claw anything…")
          }
          rows={MIN_LINES}
          disabled={isTranscribing}
          className="flex-1 resize-none border-0 bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-base-content/50 focus:outline-none disabled:opacity-60"
        />

        {isRecording ? (
          <button
            type="button"
            onClick={stopRecording}
            aria-label="Stop recording"
            title={`Stop recording (${formatElapsed(elapsed)})`}
            className="btn btn-error btn-sm btn-circle animate-pulse"
          >
            <Square size={14} />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void startRecording()}
            disabled={micDisabled}
            aria-label="Record voice message"
            title="Record voice message"
            className="btn btn-ghost btn-sm btn-circle"
          >
            {isTranscribing ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Mic size={14} />
            )}
          </button>
        )}

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
            disabled={busy || isRecording || isTranscribing || !value.trim()}
            aria-label="Send message"
            className="btn btn-primary btn-sm btn-circle"
          >
            <Send size={14} />
          </button>
        )}
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-1 text-xs text-error"
          onClick={() => {
            setError(null);
          }}
        >
          {error}
        </p>
      ) : null}
    </form>
  );
}
