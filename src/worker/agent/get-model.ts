import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

// Hardcoded for local dev: routes to the aisdk-codex-proxy running on the host.
// In production this will need to go through Workers VPC (or similar) so the
// deployed Worker can reach the proxy — see aisdk-codex-proxy/README.md.
//
// The proxy speaks OpenAI Chat Completions and does the chat → Codex Responses
// translation internally, so Emily just uses vanilla `openai.chat()`.
const RELAY_BASE_URL = "http://127.0.0.1:8787/v1";
const MODEL_ID = "gpt-5.5";

const provider = createOpenAI({
  baseURL: RELAY_BASE_URL,
  apiKey: "unused",
});

export function getCodexRelayModel(): LanguageModel {
  return provider.chat(MODEL_ID);
}
