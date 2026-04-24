import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

// Hardcoded for local dev: routes to the codex-relay running on the host.
// In production this will need to go through Workers VPC (or similar) so the
// deployed Worker can reach the relay — see codex-relay/README.md.
const RELAY_BASE_URL = "http://127.0.0.1:8787/v1";
const MODEL_ID = "gpt-5.4";

export function getCodexRelayModel(): LanguageModel {
  const openai = createOpenAI({
    baseURL: RELAY_BASE_URL,
    apiKey: "unused",
  });
  return openai(MODEL_ID);
}
