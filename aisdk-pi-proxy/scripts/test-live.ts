/**
 * End-to-end smoke test against a running aisdk-pi-proxy.
 *
 * Sends a Chat Completions request to /v1/chat/completions and prints
 * streamed content + reasoning + tool-call deltas + usage.
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
  console.log(`\n--- streaming /v1/chat/completions (reasoning=${REASONING}) ---`);
  const res = await fetch(`${RELAY_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      'x-pi-reasoning': REASONING,
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
  let reasoning = '';
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
              delta?: {
                content?: string;
                reasoning_content?: string;
                tool_calls?: unknown[];
              };
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
          }
          if (choice?.delta?.reasoning_content) {
            reasoning += choice.delta.reasoning_content;
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

  console.log(`\n\n[content] ${JSON.stringify(content)}`);
  console.log(`[reasoning bytes] ${reasoning.length}`);
  if (reasoning) console.log(`[reasoning preview] ${JSON.stringify(reasoning.slice(0, 200))}`);
  console.log(`[tool_call deltas] ${toolCallDeltas}`);
  console.log(`[finish_reason] ${finishReason}`);
  console.log(`[usage] ${JSON.stringify(usage)}`);
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
