import { createOpenAI } from "@ai-sdk/openai";

// Fields the ChatGPT-OAuth backend rejects or ignores. AI SDK includes them as
// `undefined` (which JSON-serializes away) but we strip defensively in case any
// caller sets them explicitly.
const STRIP_FIELDS = new Set([
  "temperature",
  "top_p",
  "max_output_tokens",
  "max_tokens",
  "service_tier",
  "safety_identifier",
  "prompt_cache_key",
  "prompt_cache_retention",
  "user",
]);

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isSystemMessageItem(
  item: unknown,
): item is Record<string, unknown> & { content: unknown } {
  return (
    isPlainObject(item) &&
    item.type === "message" &&
    (item.role === "system" || item.role === "developer")
  );
}

function extractText(content: unknown): string[] {
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];
  const out: string[] = [];
  for (const part of content) {
    if (isPlainObject(part) && typeof part.text === "string") {
      out.push(part.text);
    }
  }
  return out;
}

// The OAuth backend rejects system/developer role messages inside `input` and
// requires non-empty `instructions` at the top level. AI SDK v6 packs system
// prompts into `input` items, so we lift them here.
function liftSystemMessages(body: Record<string, unknown>): void {
  if (!Array.isArray(body.input) || body.input.length === 0) return;

  const lifted: string[] = [];
  const remaining: unknown[] = [];
  for (const item of body.input) {
    if (isSystemMessageItem(item)) {
      lifted.push(...extractText(item.content));
    } else {
      remaining.push(item);
    }
  }

  if (lifted.length === 0) return;
  const existing =
    typeof body.instructions === "string" && body.instructions.length > 0
      ? [body.instructions]
      : [];
  body.instructions = [...existing, ...lifted].join("\n\n");
  body.input = remaining;
}

// AI SDK echoes back the server-generated response-item id (fc_xxx, msg_xxx,
// rs_xxx, etc.) on each item it puts into `input` for the next turn. With
// `store: false` the OAuth backend can't resolve those references and 404s.
// `call_id` is what actually links a function_call to its function_call_output,
// so we leave that alone — only the top-level response-item `id` is dropped.
function stripServerItemIds(body: Record<string, unknown>): void {
  if (!Array.isArray(body.input)) return;
  for (const item of body.input) {
    if (isPlainObject(item) && typeof item.id === "string") {
      delete item.id;
    }
  }
  // previous_response_id refers to a stored response, also unusable with store=false.
  delete body.previous_response_id;
}

function applyCodexTransforms(body: Record<string, unknown>): void {
  for (const key of STRIP_FIELDS) delete body[key];
  liftSystemMessages(body);
  stripServerItemIds(body);
  body.store = false;
  if (body.parallel_tool_calls === undefined) {
    body.parallel_tool_calls = false;
  }
  if (typeof body.instructions !== "string" || body.instructions.length === 0) {
    body.instructions = "You are a helpful assistant.";
  }
}

function shortId(): string {
  return crypto.randomUUID().slice(0, 8);
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function transformBody(rawBody: string): {
  next: string;
  log: Record<string, unknown>;
} | null {
  const parsed: unknown = JSON.parse(rawBody);
  if (!isPlainObject(parsed)) return null;
  applyCodexTransforms(parsed);
  const next = JSON.stringify(parsed);
  return {
    next,
    log: {
      model: parsed.model,
      inputCount: Array.isArray(parsed.input) ? parsed.input.length : 0,
      instructionsLen:
        typeof parsed.instructions === "string"
          ? parsed.instructions.length
          : 0,
      toolCount: Array.isArray(parsed.tools) ? parsed.tools.length : 0,
      toolChoice: parsed.tool_choice,
      stream: parsed.stream,
      bytes: next.length,
    },
  };
}

const codexFetch: typeof fetch = async (input, init) => {
  const url = urlOf(input);
  const requestId = shortId();

  let nextInit: RequestInit | undefined = init ?? undefined;

  if (
    url.endsWith("/responses") &&
    init?.body !== undefined &&
    typeof init.body === "string"
  ) {
    try {
      const out = transformBody(init.body);
      if (out) {
        nextInit = { ...init, body: out.next };
        console.log(`[codex-provider ${requestId}] outbound`, {
          url,
          ...out.log,
        });
      }
    } catch (err) {
      console.warn(
        `[codex-provider ${requestId}] body transform failed`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  const startedAt = Date.now();
  const res = await fetch(input, nextInit);
  const ttfb = Date.now() - startedAt;

  if (!res.ok) {
    const detail = await res
      .clone()
      .text()
      .catch(() => "");
    console.error(
      `[codex-provider ${requestId}] response ${res.status} (${ttfb}ms ttfb): ${detail.slice(0, 1000)}`,
    );
  } else {
    console.log(
      `[codex-provider ${requestId}] response ${res.status} (${ttfb}ms ttfb)`,
    );
  }

  return res;
};

export function createCodexProvider(opts: {
  baseURL: string;
  apiKey?: string;
}) {
  return createOpenAI({
    baseURL: opts.baseURL,
    apiKey: opts.apiKey ?? "unused",
    fetch: codexFetch,
  });
}
