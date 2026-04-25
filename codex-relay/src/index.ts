import { randomUUID } from 'node:crypto';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { forwardToCodex } from './codex.js';

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

type BodySummary =
  | {
      model: unknown;
      inputCount: number;
      hasInstructions: boolean;
      instructionsPreview: string | null;
      toolCount: number;
      toolChoice: unknown;
      stream: unknown;
      store: unknown;
      parallelToolCalls: unknown;
    }
  | { unparseable: true; bytes: number };

function summarizeBody(raw: string): BodySummary {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const instructions =
      typeof parsed.instructions === 'string' ? parsed.instructions : null;
    return {
      model: parsed.model,
      inputCount: Array.isArray(parsed.input) ? parsed.input.length : 0,
      hasInstructions: instructions !== null && instructions.length > 0,
      instructionsPreview: instructions ? instructions.slice(0, 80) : null,
      toolCount: Array.isArray(parsed.tools) ? parsed.tools.length : 0,
      toolChoice: parsed.tool_choice,
      stream: parsed.stream,
      store: parsed.store,
      parallelToolCalls: parsed.parallel_tool_calls,
    };
  } catch {
    return { unparseable: true, bytes: raw.length };
  }
}

async function tallyStream(
  stream: ReadableStream<Uint8Array>,
  requestId: string,
  startedAt: number,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let events = 0;
  let buffer = '';
  const eventTypes = new Map<string, number>();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        events += 1;
        const eventLine = frame.split('\n').find((l) => l.startsWith('event:'));
        if (eventLine) {
          const t = eventLine.slice(6).trim();
          eventTypes.set(t, (eventTypes.get(t) ?? 0) + 1);
        }
      }
    }
  } catch (err) {
    console.error(`[relay ${requestId}] stream tally error`, err);
  } finally {
    reader.releaseLock();
  }
  const summary = [...eventTypes.entries()]
    .map(([t, n]) => `${t}=${n}`)
    .join(', ');
  console.log(
    `[relay ${requestId}] stream done: ${events} events, ${bytes}B, ${Date.now() - startedAt}ms total. types: ${summary || '(none)'}`,
  );
}

app.post('/v1/responses', async (c) => {
  const requestId = randomUUID().slice(0, 8);
  const startedAt = Date.now();
  const body = await c.req.text();

  console.log(
    `[relay ${requestId}] /v1/responses incoming ${body.length}B`,
    summarizeBody(body),
  );

  let upstream: Response;
  try {
    upstream = await forwardToCodex(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[relay ${requestId}] forward failed:`, message);
    return c.json({ error: { message, type: 'relay_upstream_error' } }, 502);
  }

  const ttfb = Date.now() - startedAt;

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    console.error(
      `[relay ${requestId}] upstream ${upstream.status} (${ttfb}ms ttfb): ${detail.slice(0, 800)}`,
    );
    return new Response(detail || JSON.stringify({ error: { message: `upstream ${upstream.status}` } }), {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'text/plain' },
    });
  }

  console.log(
    `[relay ${requestId}] upstream ${upstream.status}, streaming back (${ttfb}ms ttfb)`,
  );

  if (!upstream.body) {
    console.warn(`[relay ${requestId}] upstream had no body`);
    return new Response(null, { status: upstream.status });
  }

  const [forClient, forLog] = upstream.body.tee();
  void tallyStream(forLog, requestId, startedAt);

  return new Response(forClient, {
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

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';
serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  console.log(`codex-relay listening on http://${info.address}:${info.port}`);
});
