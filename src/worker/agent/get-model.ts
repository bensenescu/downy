import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  wrapLanguageModel,
  type LanguageModel,
  type LanguageModelMiddleware,
} from "ai";
import { createWorkersAI } from "workers-ai-provider";

import {
  DEFAULT_AI_PROVIDER,
  isAiProvider,
  type AiProvider,
} from "../../lib/ai-providers";
import { readPreferences } from "../db/profile";

export { DEFAULT_AI_PROVIDER };

const PI_MODEL_ID = "gpt-5.5";

// aisdk-pi-proxy speaks the OpenAI Responses API in both directions: the
// worker uses @ai-sdk/openai's `.responses()` provider, the proxy translates
// pi-ai's unified event stream into Responses SSE. Reasoning, tool calls and
// encrypted reasoning round-trip as native AI SDK parts — no middleware, no
// `<think>` tag hack.
//
// Reasoning level is opt-in via the `x-pi-reasoning` header (medium is the
// proxy default). We pin this to `high` for both providers so multi-step
// turns — skill catalog inspection, tool fan-out planning, post-background
// synthesis — get the headroom they need.
const PI_REASONING_LEVEL = "high";

// Pin `store: false` on every Responses API call. Default is `store: true`,
// which makes @ai-sdk/openai emit `item_reference` input items pointing at
// previous-turn function_call IDs it expects the upstream to have stored.
// Codex (via pi-ai) is stateless on our pipeline — those references resolve
// to nothing, and the upstream errors with `No tool call found for function
// call output with call_id ...`. With store: false, AI SDK inlines the full
// function_call items on every replay and Codex can match call_ids again.
//
// Also strip reasoning parts from prior assistant messages. With store: false
// @ai-sdk/openai requires reasoning parts to carry encrypted_content for
// replay; pi-ai is multi-provider and doesn't emit that, so the SDK drops
// them anyway with a noisy warning. The proxy already discards reasoning on
// input (see aisdk-pi-proxy/src/translate-request.ts), so removing them here
// is a no-op for behavior and silences the warning.
const piRequestMiddleware: LanguageModelMiddleware = {
  specificationVersion: "v3",
  transformParams: ({ params }) =>
    Promise.resolve({
      ...params,
      prompt: params.prompt.map((message) =>
        message.role === "assistant"
          ? {
              ...message,
              content: message.content.filter(
                (part) => part.type !== "reasoning",
              ),
            }
          : message,
      ),
      providerOptions: {
        ...params.providerOptions,
        openai: {
          ...params.providerOptions?.openai,
          store: false,
        },
      },
    }),
};

function piModel(baseURL: string, fetchImpl?: typeof fetch): LanguageModel {
  const baseFetch = fetchImpl ?? fetch;
  const piFetch: typeof fetch = (input, init) => {
    const merged = new Headers(init?.headers);
    if (!merged.has("x-pi-reasoning"))
      merged.set("x-pi-reasoning", PI_REASONING_LEVEL);
    return baseFetch(input, { ...init, headers: merged });
  };
  return wrapLanguageModel({
    model: createOpenAI({
      baseURL,
      apiKey: "unused",
      fetch: piFetch,
    }).responses(PI_MODEL_ID),
    middleware: piRequestMiddleware,
  });
}

const REGISTRY: Record<AiProvider, (env: Env) => LanguageModel> = {
  kimi: (env) => createWorkersAI({ binding: env.AI }).chat(env.MODEL_ID),

  "pi-local": () => piModel("http://127.0.0.1:8788/v1"),

  // Reach the proxy through the Workers VPC binding — the only network path
  // from a deployed Worker. There's no public ingress and no bearer token;
  // the connector is the auth boundary.
  //
  // The binding is declared in wrangler.jsonc only when deploying — see the
  // commented `vpc_services` block there. Locally it's undefined; selecting
  // this provider in dev throws the error below instead of silently hanging.
  "pi-prod": (env) => {
    // eslint-disable-next-line typescript/no-unsafe-type-assertion -- optional binding lookup; throws below if absent.
    const envWithVpc = env as unknown as { PI_RELAY_VPC?: Fetcher };
    const vpc = envWithVpc.PI_RELAY_VPC;
    if (!vpc) {
      throw new Error(
        "pi-prod selected but PI_RELAY_VPC binding is not configured (see wrangler.jsonc)",
      );
    }
    return piModel("http://pi-relay.internal/v1", vpc.fetch.bind(vpc));
  },

  // OpenRouter speaks OpenAI-compatible chat-completions. The official adapter
  // returns a v6 LanguageModel directly, no middleware needed (unlike Pi,
  // OpenRouter is stateless — no `store: false` injection, no reasoning-part
  // stripping). Read the secret defensively so deploys without it boot fine
  // and only error if a turn actually picks this provider.
  openrouter: (env) => {
    const apiKey = env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error(
        "openrouter selected but OPENROUTER_API_KEY is not set " +
          "(run `wrangler secret put OPENROUTER_API_KEY` or add it to .dev.vars)",
      );
    }
    const modelId = env.OPENROUTER_MODEL_ID ?? "anthropic/claude-sonnet-4-5";
    return createOpenRouter({ apiKey })(modelId);
  },
};

export function getModelFor(env: Env, provider: AiProvider): LanguageModel {
  return REGISTRY[provider](env);
}

export async function readAiProvider(db: D1Database): Promise<AiProvider> {
  const prefs = await readPreferences(db);
  return isAiProvider(prefs.ai_provider)
    ? prefs.ai_provider
    : DEFAULT_AI_PROVIDER;
}
