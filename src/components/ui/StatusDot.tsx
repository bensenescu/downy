type Tone = "success" | "warning" | "error" | "neutral";

const COLOR: Record<Tone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  error: "bg-error",
  neutral: "bg-base-content/40",
};

// Coloured pill used to flag readiness/health/run state. `pulse` adds a
// daisy-style ping ring (e.g. for in-flight states like "connecting" or
// "running").
export default function StatusDot({
  tone,
  pulse = false,
  title,
}: {
  tone: Tone;
  pulse?: boolean;
  title?: string;
}) {
  const color = COLOR[tone];
  return (
    <span
      title={title}
      className="relative inline-flex h-2 w-2 flex-shrink-0 items-center justify-center"
    >
      {pulse ? (
        <span
          className={`absolute inline-flex h-full w-full animate-ping rounded-full ${color} opacity-60`}
        />
      ) : null}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${color}`} />
    </span>
  );
}
