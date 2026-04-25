import {
  defaultSettingsMiddleware,
  wrapLanguageModel,
  type LanguageModel,
} from "ai";
import { createCodexProvider } from "./codex-provider";

// Hardcoded for local dev: routes to the codex-relay running on the host.
// In production this will need to go through Workers VPC (or similar) so the
// deployed Worker can reach the relay — see codex-relay/README.md.
const RELAY_BASE_URL = "http://127.0.0.1:8787/v1";
const MODEL_ID = "gpt-5.4";

const provider = createCodexProvider({ baseURL: RELAY_BASE_URL });

// AI SDK's OpenAI Responses provider defaults `store: true`, which makes it
// emit `{type: "item_reference", id}` for previous-turn items rather than
// inlining their content. The Codex-OAuth backend rejects `store: true` outright
// AND can't resolve those references when store is forced false on the wire,
// so we set `store: false` at request build time. AI SDK then inlines the full
// items; codex-provider.ts strips the leftover server-assigned ids before
// forwarding (mirroring openai/codex's own client behavior).
const codexStoreFalse = defaultSettingsMiddleware({
  settings: {
    providerOptions: {
      openai: { store: false },
    },
  },
});

export function getCodexRelayModel(): LanguageModel {
  return wrapLanguageModel({
    model: provider(MODEL_ID),
    middleware: codexStoreFalse,
  });
}
