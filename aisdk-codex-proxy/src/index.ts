import { randomUUID } from 'node:crypto';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { forwardToCodex } from './codex.js';
import { summarizeChatRequest, translateChatToCodex } from './translate-request.js';
import { translateCodexStreamToChat } from './translate-response.js';

const app = new Hono();

app.get('/health', (c) => c.json({ ok: true }));

app.use('/v1/*', async (c, next) => {
  const expected = process.env.RELAY_API_KEY;
  if (!expected) return next();
  const header = c.req.header('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  if (token !== expected) {
    return c.json({ error: { message: 'unauthorized', type: 'invalid_request_error' } }, 401);
  }
  return next();
});

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

app.post('/v1/chat/completions', async (c) => {
  const requestId = randomUUID().slice(0, 8);
  const startedAt = Date.now();
  const rawBody = await c.req.text();

  const chat = parseJsonObject(rawBody);
  if (!chat) {
    console.error(`[proxy ${requestId}] bad request body`);
    return c.json(
      { error: { message: 'body must be a JSON object', type: 'invalid_request_error' } },
      400,
    );
  }

  console.log(
    `[proxy ${requestId}] /v1/chat/completions incoming ${rawBody.length}B`,
    summarizeChatRequest(chat),
  );

  const codexBody = translateChatToCodex(chat);
  const codexJson = JSON.stringify(codexBody);

  console.log(`[proxy ${requestId}] → codex ${codexJson.length}B`, {
    model: codexBody.model,
    instructionsLen: codexBody.instructions.length,
    inputItems: codexBody.input.length,
    toolCount: codexBody.tools.length,
  });

  let upstream: Response;
  try {
    upstream = await forwardToCodex(codexJson);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[proxy ${requestId}] forward failed: ${message}`);
    return c.json({ error: { message, type: 'upstream_error' } }, 502);
  }

  const ttfb = Date.now() - startedAt;

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    console.error(
      `[proxy ${requestId}] upstream ${upstream.status} (${ttfb}ms ttfb): ${detail.slice(0, 800)}`,
    );
    return c.json(
      {
        error: {
          message: detail || `upstream ${upstream.status}`,
          type: 'upstream_error',
          code: upstream.status,
        },
      },
      502,
    );
  }

  if (!upstream.body) {
    console.warn(`[proxy ${requestId}] upstream had no body`);
    return c.json({ error: { message: 'no upstream body', type: 'upstream_error' } }, 502);
  }

  console.log(`[proxy ${requestId}] upstream ${upstream.status}, translating (${ttfb}ms ttfb)`);

  const chatStream = translateCodexStreamToChat(
    upstream.body,
    {
      id: `chatcmpl-${randomUUID()}`,
      model: typeof chat.model === 'string' ? chat.model : codexBody.model,
      created: Math.floor(startedAt / 1000),
    },
    (stats) => {
      console.log(
        `[proxy ${requestId}] stream done: ${stats.events} events, ${stats.textBytes}B text, ${stats.toolCalls} tool_calls, finish=${stats.finishReason}, usage=${JSON.stringify(stats.usage)}, ${Date.now() - startedAt}ms total`,
      );
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

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';
serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  console.log(`aisdk-codex-proxy listening on http://${info.address}:${info.port}`);
});
