export const AI_PROVIDERS = [
  "kimi",
  "codex-local",
  "codex-prod",
  "pi-local",
] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];
export const DEFAULT_AI_PROVIDER: AiProvider = "kimi";

export function isAiProvider(value: unknown): value is AiProvider {
  return (
    typeof value === "string" &&
    (AI_PROVIDERS as readonly string[]).includes(value)
  );
}
