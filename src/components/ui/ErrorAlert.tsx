type Tone = "error" | "warning";

// daisyUI alert with the right ARIA role. Returns null when there's no
// message so callers can pass a possibly-null string without wrapping it in
// a ternary at every call site.
export default function ErrorAlert({
  message,
  tone = "error",
  className,
}: {
  message: string | null | undefined;
  tone?: Tone;
  className?: string;
}) {
  if (!message) return null;
  const toneClass = tone === "warning" ? "alert-warning" : "alert-error";
  return (
    <div
      role="alert"
      className={`alert ${toneClass} mb-4 ${className ?? ""}`.trim()}
    >
      <span>{message}</span>
    </div>
  );
}

// Coerce an `unknown` thrown / queryError into a display string.
export function errorMessage(err: unknown): string | null {
  if (!err) return null;
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return "Unknown error";
  }
}
