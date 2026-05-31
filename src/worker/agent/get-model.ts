import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import {
  wrapLanguageModel,
  type LanguageModel,
  type LanguageModelMiddleware,
} from "ai";
import { createWorkersAI } from "workers-ai-provider";

import {
  DEFAULT_AI_PROVIDER,
  isBuiltinAiProvider,
  type AiProvider,
} from "../../lib/ai-providers";
import {
  readPreferences,
  getAiProvider,
  type AiProviderRecord,
} from "../db/profile";

export { DEFAULT_AI_PROVIDER };

const PI_MODEL_ID = "gpt-5.5";
const PI_REASONING_LEVEL = "high";

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

function piRelayVpc(env: Cloudflare.Env): Fetcher | undefined {
  return (env as any).PI_RELAY_VPC;
}

const friendlyLocalPiFetch: typeof fetch = async (input, init) => {
  try {
    return await fetch(input, init);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `MODEL_PROVIDER_UNREACHABLE: pi-local requires aisdk-pi-proxy at http://127.0.0.1:8788/v1. This is a model endpoint, not an MCP server. ${detail}`,
      { cause: err },
    );
  }
};

const BUILTIN_REGISTRY: Record<string, (env: Cloudflare.Env) => LanguageModel> =
  {
    kimi: (env) => createWorkersAI({ binding: env.AI }).chat(env.MODEL_ID),

    "pi-local": (env) => {
      if (piRelayVpc(env)) return BUILTIN_REGISTRY["pi-prod"](env);
      return piModel("http://127.0.0.1:8788/v1", friendlyLocalPiFetch);
    },

    "pi-prod": (env) => {
      const vpc = piRelayVpc(env);
      if (!vpc) {
        throw new Error(
          "VPC_UNREACHABLE: pi-prod selected but PI_RELAY_VPC binding is not configured (set PI_RELAY_VPC_SERVICE_ID in .env)",
        );
      }
      const baseFetch = vpc.fetch.bind(vpc);
      const timedFetch: typeof fetch = async (input, init) => {
        const ctrl = new AbortController();
        const timeout = setTimeout(() => {
          ctrl.abort();
        }, 20_000);
        try {
          return await baseFetch(input, { ...init, signal: ctrl.signal });
        } catch (err) {
          if (ctrl.signal.aborted) {
            throw new Error(
              "VPC_UNREACHABLE: timed out reaching pi-relay.internal through the Workers VPC binding",
              { cause: err },
            );
          }
          const detail = err instanceof Error ? err.message : String(err);
          throw new Error(`VPC_UNREACHABLE: ${detail}`, { cause: err });
        } finally {
          clearTimeout(timeout);
        }
      };
      return piModel("http://pi-relay.internal/v1", timedFetch);
    },

    openrouter: (env) => {
      const apiKey = env.OPENROUTER_API_KEY;
      const modelId = env.OPENROUTER_MODEL_ID;
      if (!apiKey || !modelId) {
        throw new Error(
          "openrouter selected but OPENROUTER_API_KEY or OPENROUTER_MODEL_ID is not set",
        );
      }
      return createOpenRouter({ apiKey })(modelId);
    },
  };

export async function getModelFor(
  env: Cloudflare.Env,
  providerId: AiProvider,
): Promise<LanguageModel> {
  if (isBuiltinAiProvider(providerId)) {
    return BUILTIN_REGISTRY[providerId](env);
  }

  // Dynamic provider from D1
  const config = await getAiProvider(env.DB, providerId);
  if (!config) {
    throw new Error(`Unknown AI provider: ${providerId}`);
  }

  if (config.type === "workers-ai") {
    return createWorkersAI({ binding: env.AI }).chat(
      config.modelId || env.MODEL_ID,
    );
  }

  return createModelFromConfig(config);
}

function createModelFromConfig(config: AiProviderRecord): LanguageModel {
  const { type, apiKey, endpoint, modelId } = config;

  switch (type) {
    case "anthropic":
      return createAnthropic({ apiKey: apiKey ?? "" })(
        modelId || "claude-3-5-sonnet-latest",
      );
    case "google":
      return createGoogleGenerativeAI({ apiKey: apiKey ?? "" })(
        modelId || "gemini-1.5-pro",
      );
    case "openrouter":
      return createOpenRouter({ apiKey: apiKey ?? "" })(
        modelId || "meta-llama/llama-3.1-405b-instruct",
      );
    case "openai":
    case "custom":
      return createOpenAI({
        apiKey: apiKey ?? "",
        baseURL: endpoint ?? undefined,
      })(modelId || "gpt-4o");
    case "workers-ai":
      // Since it's not in the original switch, but it's in ManagedAiProvider type
      // I'll add it here.
      // Note: This needs access to env.AI if it's workers-ai, but this function
      // only takes config.
      // Actually, getModelFor has access to env.
      throw new Error(`workers-ai provider should be handled in getModelFor`);
    default:
      throw new Error(`Unsupported provider type: ${type}`);
  }
}

export async function readAiProvider(db: D1Database): Promise<AiProvider> {
  const prefs = await readPreferences(db);
  return prefs.ai_provider || DEFAULT_AI_PROVIDER;
}
