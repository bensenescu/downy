import { randomUUID } from 'node:crypto';
import { serve } from '@hono/node-server';
import { getModel, streamSimple, type ThinkingLevel } from '@mariozechner/pi-ai';
import { Hono } from 'hono';
import { getApiKey, getAuthPath } from './auth.js';
import { summarizeChatRequest, translateChatToContext, type ChatRequest } from './translate-request.js';
import { translatePiStreamToChat } from './translate-response.js';

const PI_PROVIDER = process.env.PI_PROVIDER ?? 'openai-codex';
const PI_OAUTH_PROVIDER = process.env.PI_OAUTH_PROVIDER ?? PI_PROVIDER;
const PI_DEFAULT_MODEL = process.env.PI_DEFAULT_MODEL ?? 'gpt-5.4';
const PI_DEFAULT_REASONING = (process.env.PI_DEFAULT_REASONING ?? 'medium') as ThinkingLevel;

const REASONING_LEVELS: ReadonlySet<ThinkingLevel> = new Set([
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
]);

function isReasoningLevel(value: string): value is ThinkingLevel {
  return (REASONING_LEVELS as Set<string>).has(value);
}

function parseJsonObject(raw: string): ChatRequest | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as ChatRequest;
  } catch {
    return null;
  }
}

const app = new Hono();

app.get('/health', (c) =>
  c.json({
    ok: true,
    provider: PI_PROVIDER,
    oauthProvider: PI_OAUTH_PROVIDER,
    defaultModel: PI_DEFAULT_MODEL,
    defaultReasoning: PI_DEFAULT_REASONING,
    authPath: getAuthPath(),
  }),
);

app.post('/v1/chat/completions', async (c) => {
  const requestId = randomUUID().slice(0, 8);
  const startedAt = Date.now();
  const rawBody = await c.req.text();

  const chat = parseJsonObject(rawBody);
  if (!chat) {
    console.error(`[pi-proxy ${requestId}] bad request body`);
    return c.json(
      { error: { message: 'body must be a JSON object', type: 'invalid_request_error' } },
      400,
    );
  }

  // Reasoning is selected by header (Chat Completions has no native field).
  // x-pi-reasoning: minimal | low | medium | high | xhigh
  const headerReasoning = c.req.header('x-pi-reasoning')?.toLowerCase() ?? '';
  const reasoning: ThinkingLevel = isReasoningLevel(headerReasoning)
    ? headerReasoning
    : PI_DEFAULT_REASONING;

  // Optional model override per-request via header (lets one proxy serve
  // multiple models without changing env).
  const modelId = c.req.header('x-pi-model') ?? chat.model ?? PI_DEFAULT_MODEL;

  console.log(
    `[pi-proxy ${requestId}] /v1/chat/completions incoming ${rawBody.length}B`,
    {
      ...summarizeChatRequest(chat),
      provider: PI_PROVIDER,
      modelId,
      reasoning,
    },
  );

  const { context } = translateChatToContext(chat);

  let model;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    model = getModel(PI_PROVIDER as any, modelId as any);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[pi-proxy ${requestId}] unknown model: ${message}`);
    return c.json(
      { error: { message, type: 'invalid_request_error' } },
      400,
    );
  }

  let apiKey: string;
  try {
    apiKey = await getApiKey(PI_OAUTH_PROVIDER);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[pi-proxy ${requestId}] auth failed: ${message}`);
    return c.json({ error: { message, type: 'auth_error' } }, 502);
  }

  const upstream = streamSimple(model, context, {
    apiKey,
    reasoning,
    sessionId: c.req.header('x-pi-session-id'),
  });

  const ttfb = Date.now() - startedAt;
  console.log(`[pi-proxy ${requestId}] dispatched to pi-ai (${ttfb}ms ttfb-to-dispatch)`);

  const chatStream = translatePiStreamToChat(
    upstream,
    {
      id: `chatcmpl-${randomUUID()}`,
      model: modelId,
      created: Math.floor(startedAt / 1000),
    },
    (stats) => {
      console.log(
        `[pi-proxy ${requestId}] stream done: ${stats.events} events, ${stats.textBytes}B text, ${stats.thinkingBytes}B thinking, ${stats.toolCalls} tool_calls, finish=${stats.finishReason}, usage=${JSON.stringify(stats.usage)}, ${Date.now() - startedAt}ms total`,
      );
      console.log(
        `[pi-proxy ${requestId}] event types: ${JSON.stringify(stats.eventTypes)}`,
      );
      if (stats.errorMessage) {
        console.error(`[pi-proxy ${requestId}] upstream error: ${stats.errorMessage}`);
      }
    },
  );

  return new Response(chatStream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
});

const port = Number(process.env.PORT ?? 8788);
const host = process.env.HOST ?? '127.0.0.1';
serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  console.log(
    `aisdk-pi-proxy listening on http://${info.address}:${info.port} ` +
      `(provider=${PI_PROVIDER}, model=${PI_DEFAULT_MODEL}, reasoning=${PI_DEFAULT_REASONING}, auth=${getAuthPath()})`,
  );
});
