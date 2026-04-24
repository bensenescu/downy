import { randomUUID } from 'node:crypto';
import { getAuth } from './auth.js';

const RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses';
const ORIGINATOR = 'codex_cli_rs';

export type OpenAIChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool' | 'developer';
  content: string | Array<{ type: string; text?: string }>;
};

type CodexContentItem =
  | { type: 'input_text'; text: string }
  | { type: 'output_text'; text: string };

type CodexInputItem = {
  type: 'message';
  role: 'user' | 'assistant' | 'system';
  content: CodexContentItem[];
};

export type CodexEvent = {
  type: string;
  delta?: string;
  response?: {
    id?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      total_tokens?: number;
    };
    error?: { code?: string; message?: string };
  };
  [k: string]: unknown;
};

function messageText(content: OpenAIChatMessage['content']): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(
      (p): p is { type: string; text: string } =>
        p.type === 'text' && typeof p.text === 'string',
    )
    .map((p) => p.text)
    .join('');
}

export function convertMessages(messages: OpenAIChatMessage[]): {
  instructions: string;
  input: CodexInputItem[];
} {
  const systemChunks: string[] = [];
  const input: CodexInputItem[] = [];

  for (const m of messages) {
    const text = messageText(m.content);
    if (!text) continue;
    if (m.role === 'system' || m.role === 'developer') {
      systemChunks.push(text);
    } else if (m.role === 'assistant') {
      input.push({
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text }],
      });
    } else {
      // user + tool both land as user-side input_text for now
      input.push({
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text }],
      });
    }
  }

  return { instructions: systemChunks.join('\n\n'), input };
}

export async function openCodexStream(opts: {
  model: string;
  messages: OpenAIChatMessage[];
}): Promise<Response> {
  const auth = await getAuth();
  const { instructions, input } = convertMessages(opts.messages);

  const body = {
    model: opts.model,
    instructions,
    input,
    tools: [],
    tool_choice: 'auto',
    parallel_tool_calls: false,
    store: false,
    stream: true,
  };

  const res = await fetch(RESPONSES_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      authorization: `Bearer ${auth.accessToken}`,
      'chatgpt-account-id': auth.accountId,
      'openai-beta': 'responses=experimental',
      originator: ORIGINATOR,
      session_id: randomUUID(),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    throw new Error(`codex upstream ${res.status}: ${detail.slice(0, 500)}`);
  }
  return res;
}

export async function* parseCodexSSE(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<CodexEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const chunk = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trimStart();
          if (payload === '[DONE]') return;
          try {
            yield JSON.parse(payload) as CodexEvent;
          } catch {
            // skip malformed frames; stream keeps going
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
