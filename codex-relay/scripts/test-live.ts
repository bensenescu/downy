/**
 * End-to-end smoke test against a running relay.
 *
 * Usage:
 *   RELAY_URL=http://127.0.0.1:8787 npm run test:live
 *
 * Fires one streaming chat.completions request and one non-streaming request,
 * prints the streamed output and final completion, exits non-zero on failure.
 */

const RELAY_URL = process.env.RELAY_URL ?? 'http://127.0.0.1:8787';
const RELAY_API_KEY = process.env.RELAY_API_KEY;
const MODEL = process.env.TEST_MODEL ?? 'gpt-5';
const PROMPT = process.env.TEST_PROMPT ?? 'Say "pong" and nothing else.';

const authHeaders: Record<string, string> = RELAY_API_KEY
  ? { authorization: `Bearer ${RELAY_API_KEY}` }
  : {};

async function health() {
  const res = await fetch(`${RELAY_URL}/health`);
  if (!res.ok) throw new Error(`health check failed: ${res.status}`);
  console.log('[health]', await res.json());
}

async function nonStreaming() {
  console.log('\n--- non-streaming ---');
  const res = await fetch(`${RELAY_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: PROMPT }],
      stream: false,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`[non-streaming] ${res.status}: ${text}`);
    throw new Error(`non-streaming failed: ${res.status}`);
  }
  const json = JSON.parse(text) as {
    choices: Array<{ message: { content: string } }>;
    usage: Record<string, number>;
  };
  console.log('[reply]', json.choices[0]?.message.content);
  console.log('[usage]', json.usage);
}

async function streaming() {
  console.log('\n--- streaming ---');
  const res = await fetch(`${RELAY_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      ...authHeaders,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: PROMPT }],
      stream: true,
    }),
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    throw new Error(`streaming failed: ${res.status} ${detail}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let collected = '';
  let chunks = 0;

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
        if (payload === '[DONE]') {
          console.log(`\n[streamed ${chunks} chunks] ${JSON.stringify(collected)}`);
          return;
        }
        try {
          const obj = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
            error?: { message: string };
          };
          if (obj.error) {
            throw new Error(`upstream error frame: ${obj.error.message}`);
          }
          const content = obj.choices?.[0]?.delta?.content;
          if (typeof content === 'string' && content.length) {
            process.stdout.write(content);
            collected += content;
            chunks += 1;
          }
        } catch (err) {
          throw new Error(`failed parsing SSE frame '${payload}': ${err}`);
        }
      }
    }
  }
}

try {
  await health();
  await streaming();
  await nonStreaming();
  console.log('\nOK');
} catch (err) {
  console.error('\nFAIL:', err instanceof Error ? err.message : err);
  process.exit(1);
}
