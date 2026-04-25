/**
 * End-to-end smoke test against a running relay.
 *
 * Usage:
 *   RELAY_URL=http://127.0.0.1:8787 npm run test:live
 *
 * Sends a fully-formed Codex Responses API request to /v1/responses,
 * parses the upstream SSE stream, and prints text deltas + final usage.
 * The relay does not transform requests — callers are responsible for
 * providing OAuth-compatible bodies (in production that's done by the
 * codex-provider in Emily, here we just hand-craft one).
 */

const RELAY_URL = process.env.RELAY_URL ?? 'http://127.0.0.1:8787';
const RELAY_API_KEY = process.env.RELAY_API_KEY;
const MODEL = process.env.TEST_MODEL ?? 'gpt-5.4';
const PROMPT = process.env.TEST_PROMPT ?? 'Say "pong" and nothing else.';

const authHeaders: Record<string, string> = RELAY_API_KEY
  ? { authorization: `Bearer ${RELAY_API_KEY}` }
  : {};

async function health() {
  const res = await fetch(`${RELAY_URL}/health`);
  if (!res.ok) throw new Error(`health check failed: ${res.status}`);
  console.log('[health]', await res.json());
}

async function streaming() {
  console.log('\n--- streaming /v1/responses ---');
  const res = await fetch(`${RELAY_URL}/v1/responses`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      ...authHeaders,
    },
    body: JSON.stringify({
      model: MODEL,
      instructions: 'Be terse.',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: PROMPT }],
        },
      ],
      tools: [],
      tool_choice: 'auto',
      parallel_tool_calls: false,
      store: false,
      stream: true,
    }),
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    throw new Error(`request failed: ${res.status} ${detail}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let collected = '';
  const eventCounts = new Map<string, number>();
  let usage: Record<string, unknown> | null = null;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let eventName: string | null = null;
      let dataPayload: string | null = null;
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) eventName = line.slice(6).trim();
        else if (line.startsWith('data:')) dataPayload = line.slice(5).trimStart();
      }
      if (eventName) {
        eventCounts.set(eventName, (eventCounts.get(eventName) ?? 0) + 1);
      }
      if (dataPayload && dataPayload !== '[DONE]') {
        try {
          const parsed = JSON.parse(dataPayload) as {
            type?: string;
            delta?: string;
            response?: { usage?: Record<string, unknown> };
          };
          if (parsed.type === 'response.output_text.delta' && typeof parsed.delta === 'string') {
            process.stdout.write(parsed.delta);
            collected += parsed.delta;
          }
          if (parsed.type === 'response.completed' && parsed.response?.usage) {
            usage = parsed.response.usage;
          }
        } catch {
          // tolerate malformed frames
        }
      }
    }
  }

  console.log(`\n\n[collected] ${JSON.stringify(collected)}`);
  console.log('[event counts]', Object.fromEntries(eventCounts));
  console.log('[usage]', usage);
}

try {
  await health();
  await streaming();
  console.log('\nOK');
} catch (err) {
  console.error('\nFAIL:', err instanceof Error ? err.message : err);
  process.exit(1);
}
