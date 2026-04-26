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

const CODEX_MODEL_ID = "gpt-5.5";

const REGISTRY: Record<AiProvider, (env: Env) => LanguageModel> = {
  kimi: (env) => createWorkersAI({ binding: env.AI }).chat(env.MODEL_ID),

  "codex-local": () =>
    createOpenAI({
      baseURL: "http://127.0.0.1:8787/v1",
      apiKey: "unused",
    }).chat(CODEX_MODEL_ID),

  // Local aisdk-pi-proxy — same Chat Completions shape as codex-local, but
  // routes through @mariozechner/pi-ai (defaults to openai-codex auth).
  // The proxy emits thinking content inline as `<think>…</think>` because
  // @ai-sdk/openai's Chat Completions chunk schema drops every non-standard
  // delta field (reasoning_content, reasoning, etc.). extractReasoningMiddleware
  // pulls those tags out into proper AI SDK reasoning parts, which the chat UI
  // already renders.
  "pi-local": () =>
    wrapLanguageModel({
      model: createOpenAI({
        baseURL: "http://127.0.0.1:8788/v1",
        apiKey: "unused",
      }).chat(CODEX_MODEL_ID),
      middleware: extractReasoningMiddleware({ tagName: "think" }),
    }),

  // Reach the relay through the Workers VPC binding — that's the only
  // network path from a deployed Worker. There's no public ingress and no
  // bearer token; the connector is the auth boundary.
  //
  // The binding is declared in wrangler.jsonc only when deploying — see the
  // commented `vpc_services` block there. Locally it's undefined; selecting
  // this provider in dev throws the error below instead of silently hanging.
  "codex-prod": (env) => {
    // The binding is only present when wrangler.jsonc declares the
    // `vpc_services` entry — left out by default so `wrangler dev` doesn't
    // try to provision a remote edge-preview. Both casts are the price of
    // reaching for a binding that may or may not exist on this Env shape.
    // eslint-disable-next-line typescript/no-unsafe-type-assertion -- optional binding lookup; throws below if absent.
    const envWithVpc = env as unknown as { CODEX_RELAY_VPC?: Fetcher };
    const vpc = envWithVpc.CODEX_RELAY_VPC;
    if (!vpc) {
      throw new Error(
        "codex-prod selected but CODEX_RELAY_VPC binding is not configured (see wrangler.jsonc)",
      );
    }
    return createOpenAI({
      baseURL: "http://codex-relay.internal/v1",
      apiKey: "unused",
      fetch: vpc.fetch.bind(vpc),
    }).chat(CODEX_MODEL_ID);
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
