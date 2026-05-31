export const BUILTIN_AI_PROVIDERS = [
  "kimi",
  "pi-local",
  "pi-prod",
  "openrouter",
] as const;
export const AI_PROVIDERS = BUILTIN_AI_PROVIDERS;
export type BuiltinAiProvider = (typeof BUILTIN_AI_PROVIDERS)[number];
export type AiProvider = BuiltinAiProvider | string;
export const DEFAULT_AI_PROVIDER: AiProvider = "kimi";

export interface ManagedAiProvider {
  id: string;
  name: string;
  type: "openai" | "anthropic" | "google" | "openrouter" | "workers-ai";
  apiKey: string;
  endpoint?: string;
  modelId?: string;
}

export function isBuiltinAiProvider(
  value: unknown,
): value is BuiltinAiProvider {
  return (
    typeof value === "string" &&
    (BUILTIN_AI_PROVIDERS as readonly string[]).includes(value)
  );
}

export function isAiProvider(value: unknown): value is AiProvider {
  return typeof value === "string";
}
