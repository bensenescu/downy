import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import {
  openCodexStream,
  parseCodexSSE,
  proxyResponsesRequest,
  type OpenAIChatMessage,
} from './codex.js';

const DEFAULT_MODEL = process.env.RELAY_DEFAULT_MODEL ?? 'gpt-5.4';

type ChatRequest = {
  model?: string;
  messages: OpenAIChatMessage[];
  stream?: boolean;
};

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

app.get('/v1/models', (c) =>
  c.json({
    object: 'list',
    data: [DEFAULT_MODEL].map((id) => ({
      id,
      object: 'model',
      created: 0,
      owned_by: 'openai',
    })),
  }),
);

app.post('/v1/responses', async (c) => {
  const body = (await c.req.json()) as Record<string, unknown>;
  let upstream: Response;
  try {
    upstream = await proxyResponsesRequest(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: { message, type: 'relay_upstream_error' } }, 502);
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type':
        upstream.headers.get('content-type') ?? 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
});

app.post('/v1/chat/completions', async (c) => {
  const body = await c.req.json<ChatRequest>();
  const model = body.model || DEFAULT_MODEL;
  const id = `chatcmpl-${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);

  let upstream: Response;
  try {
    upstream = await openCodexStream({ model, messages: body.messages });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: { message, type: 'relay_upstream_error' } }, 502);
  }

  const upstreamBody = upstream.body;
  if (!upstreamBody) {
    return c.json(
      { error: { message: 'upstream returned no body', type: 'relay_upstream_error' } },
      502,
    );
  }

  if (!body.stream) {
    let text = '';
    let usage: { input_tokens?: number; output_tokens?: number; total_tokens?: number } = {};
    try {
      for await (const evt of parseCodexSSE(upstreamBody)) {
        if (evt.type === 'response.output_text.delta' && typeof evt.delta === 'string') {
          text += evt.delta;
        } else if (evt.type === 'response.completed') {
          usage = evt.response?.usage ?? {};
        } else if (evt.type === 'response.failed') {
          const message = evt.response?.error?.message ?? 'upstream failed';
          return c.json({ error: { message, type: 'relay_upstream_error' } }, 502);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: { message, type: 'relay_upstream_error' } }, 502);
    }
    return c.json({
      id,
      object: 'chat.completion',
      created,
      model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: text },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: usage.input_tokens ?? 0,
        completion_tokens: usage.output_tokens ?? 0,
        total_tokens: usage.total_tokens ?? 0,
      },
    });
  }

  const encoder = new TextEncoder();
  const sseStream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));

      send({
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
      });

      try {
        for await (const evt of parseCodexSSE(upstreamBody)) {
          if (evt.type === 'response.output_text.delta' && typeof evt.delta === 'string' && evt.delta) {
            send({
              id,
              object: 'chat.completion.chunk',
              created,
              model,
              choices: [{ index: 0, delta: { content: evt.delta }, finish_reason: null }],
            });
          } else if (evt.type === 'response.failed') {
            send({
              error: {
                message: evt.response?.error?.message ?? 'upstream failed',
                type: 'relay_upstream_error',
              },
            });
            controller.close();
            return;
          }
        }
      } catch (err) {
        send({
          error: {
            message: err instanceof Error ? err.message : String(err),
            type: 'relay_upstream_error',
          },
        });
        controller.close();
        return;
      }

      send({
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      });
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });

  return new Response(sseStream, {
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
  console.log(`codex-relay listening on http://${info.address}:${info.port}`);
});
