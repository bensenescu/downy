import { createOpenAI } from "@ai-sdk/openai";
import {
  extractReasoningMiddleware,
  wrapLanguageModel,
  type LanguageModel,
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

// aisdk-pi-proxy emits thinking content inline as `<think>…</think>` because
// @ai-sdk/openai's Chat Completions chunk schema drops every non-standard
// delta field (reasoning_content, reasoning, etc.). extractReasoningMiddleware
// rewrites those tags into proper AI SDK reasoning parts, which the chat UI
// already renders.
function piModel(baseURL: string, fetchImpl?: typeof fetch): LanguageModel {
  return wrapLanguageModel({
    model: createOpenAI({
      baseURL,
      apiKey: "unused",
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
    }).chat(PI_MODEL_ID),
    middleware: extractReasoningMiddleware({ tagName: "think" }),
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
