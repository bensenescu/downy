/**
 * End-to-end smoke test against a running aisdk-pi-proxy.
 *
 * Sends a Responses API request to /v1/responses and prints streamed
 * output_text + reasoning_summary + function_call argument deltas + usage.
 */

const RELAY_URL = process.env.RELAY_URL ?? 'http://127.0.0.1:8788';
const MODEL = process.env.TEST_MODEL ?? 'gpt-5.4';
const PROMPT = process.env.TEST_PROMPT ?? 'Think briefly, then say "pong" and nothing else.';
const REASONING = process.env.TEST_REASONING ?? 'low';

async function health() {
  const res = await fetch(`${RELAY_URL}/health`);
  if (!res.ok) throw new Error(`health check failed: ${res.status}`);
  console.log('[health]', await res.json());
}

async function streaming() {
  console.log(`\n--- streaming /v1/responses (reasoning=${REASONING}) ---`);
  const res = await fetch(`${RELAY_URL}/v1/responses`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      'x-pi-reasoning': REASONING,
    },
    body: JSON.stringify({
      model: MODEL,
      instructions: 'Be terse.',
      input: [{ role: 'user', content: [{ type: 'input_text', text: PROMPT }] }],
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
  let reasoning = '';
  let toolArgDeltas = 0;
  let usage: Record<string, unknown> | null = null;
  let completed = false;
  let failed: string | null = null;

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
            type?: string;
            delta?: string;
            response?: {
              usage?: Record<string, unknown>;
              error?: { message?: string };
            };
          };
          switch (parsed.type) {
            case 'response.output_text.delta':
              if (parsed.delta) {
                process.stdout.write(parsed.delta);
                content += parsed.delta;
              }
              break;
            case 'response.reasoning_summary_text.delta':
              if (parsed.delta) reasoning += parsed.delta;
              break;
            case 'response.function_call_arguments.delta':
              toolArgDeltas += 1;
              break;
            case 'response.completed':
              completed = true;
              if (parsed.response?.usage) usage = parsed.response.usage;
              break;
            case 'response.failed':
              failed = parsed.response?.error?.message ?? 'unknown failure';
              break;
          }
        } catch (err) {
          throw new Error(`bad SSE frame '${payload}': ${err instanceof Error ? err.message : err}`);
        }
      }
    }
  }

  console.log(`\n\n[content] ${JSON.stringify(content)}`);
  console.log(`[reasoning bytes] ${reasoning.length}`);
  if (reasoning) console.log(`[reasoning preview] ${JSON.stringify(reasoning.slice(0, 200))}`);
  console.log(`[function_call_arguments deltas] ${toolArgDeltas}`);
  console.log(`[completed] ${completed}`);
  console.log(`[usage] ${JSON.stringify(usage)}`);
  if (failed) throw new Error(`response.failed: ${failed}`);
}

async function main() {
  await health();
  await streaming();
  console.log('\nOK');
}

main().catch((err: unknown) => {
  console.error('\nFAIL:', err instanceof Error ? err.message : err);
  process.exit(1);
});

export {};
