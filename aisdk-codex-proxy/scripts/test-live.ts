/**
 * End-to-end smoke test against a running proxy.
 *
 * Sends a Chat Completions request to /v1/chat/completions and prints
 * streamed content + tool-call deltas + usage.
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
  console.log('\n--- streaming /v1/chat/completions ---');
  const res = await fetch(`${RELAY_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      ...authHeaders,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: 'Be terse.' },
        { role: 'user', content: PROMPT },
      ],
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
  let content = '';
  let chunks = 0;
  let toolCallDeltas = 0;
  let usage: Record<string, unknown> | null = null;
  let finishReason: string | null = null;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trimStart();
        if (payload === '[DONE]') break;
        try {
          const parsed = JSON.parse(payload) as {
            choices?: Array<{
              delta?: { content?: string; tool_calls?: unknown[] };
              finish_reason?: string | null;
            }>;
            usage?: Record<string, unknown>;
            error?: { message: string };
          };
          if (parsed.error) throw new Error(parsed.error.message);
          const choice = parsed.choices?.[0];
          if (choice?.delta?.content) {
            process.stdout.write(choice.delta.content);
            content += choice.delta.content;
            chunks += 1;
          }
          if (choice?.delta?.tool_calls) toolCallDeltas += 1;
          if (choice?.finish_reason) finishReason = choice.finish_reason;
          if (parsed.usage) usage = parsed.usage;
        } catch (err) {
          throw new Error(`bad SSE frame '${payload}': ${err instanceof Error ? err.message : err}`);
        }
      }
    }
  }

  console.log(`\n\n[content chunks] ${chunks}`);
  console.log(`[tool_call deltas] ${toolCallDeltas}`);
  console.log(`[finish_reason] ${finishReason}`);
  console.log(`[usage] ${JSON.stringify(usage)}`);
  console.log(`[collected] ${JSON.stringify(content)}`);
}

try {
  await health();
  await streaming();
  console.log('\nOK');
} catch (err) {
  console.error('\nFAIL:', err instanceof Error ? err.message : err);
  process.exit(1);
}
