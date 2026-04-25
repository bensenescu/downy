// Translates the Codex Responses API SSE stream into an OpenAI Chat Completions
// SSE stream. Consumes events like `response.output_text.delta`,
// `response.output_item.added` (function_call), `response.function_call_arguments.delta`,
// `response.completed` and emits OpenAI-shape `chat.completion.chunk` frames
// followed by `data: [DONE]`.

type CodexUsage = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
};

type CodexFunctionCallItem = {
  type: 'function_call';
  id?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
};

type CodexItem = { type?: string } & Partial<CodexFunctionCallItem>;

type CodexEvent = {
  type?: string;
  delta?: string;
  item?: CodexItem;
  item_id?: string;
  response?: {
    id?: string;
    usage?: CodexUsage;
    error?: { message?: string; code?: string };
  };
};

type ChatChunkChoice = {
  index: 0;
  delta: Record<string, unknown>;
  finish_reason: 'stop' | 'tool_calls' | 'error' | null;
};

type ChatChunk = {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: ChatChunkChoice[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
};

export type StreamStats = {
  events: number;
  textBytes: number;
  toolCalls: number;
  finishReason: 'stop' | 'tool_calls' | 'error';
  usage: CodexUsage | null;
};

function parseFrame(frame: string): CodexEvent | null {
  for (const line of frame.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trimStart();
    if (payload === '[DONE]') return null;
    try {
      return JSON.parse(payload) as CodexEvent;
    } catch {
      return null;
    }
  }
  return null;
}

export function translateCodexStreamToChat(
  upstream: ReadableStream<Uint8Array>,
  opts: { id: string; model: string; created: number },
  onStats?: (stats: StreamStats) => void,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const stats: StreamStats = {
    events: 0,
    textBytes: 0,
    toolCalls: 0,
    finishReason: 'stop',
    usage: null,
  };

  return new ReadableStream({
    async start(controller) {
      const emit = (chunk: ChatChunk): void => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      };
      const chunkFrame = (
        delta: Record<string, unknown>,
        finishReason: ChatChunkChoice['finish_reason'] = null,
      ): ChatChunk => ({
        id: opts.id,
        object: 'chat.completion.chunk',
        created: opts.created,
        model: opts.model,
        choices: [{ index: 0, delta, finish_reason: finishReason }],
      });

      emit(chunkFrame({ role: 'assistant' }));

      const reader = upstream.getReader();
      const toolCallIndex = new Map<string, number>();
      let nextIdx = 0;
      let buffer = '';

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let boundary: number;
          while ((boundary = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const event = parseFrame(frame);
            if (!event?.type) continue;
            stats.events += 1;
            handleEvent(event, emit, chunkFrame, toolCallIndex, () => nextIdx++, stats);
          }
        }

        const finalChunk = chunkFrame({}, stats.finishReason === 'error' ? null : stats.finishReason);
        if (stats.usage) {
          finalChunk.usage = {
            prompt_tokens: stats.usage.input_tokens ?? 0,
            completion_tokens: stats.usage.output_tokens ?? 0,
            total_tokens: stats.usage.total_tokens ?? 0,
          };
        }
        emit(finalChunk);
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ error: { message, type: 'upstream_error' } })}\n\n`,
          ),
        );
      } finally {
        reader.releaseLock();
        controller.close();
        onStats?.(stats);
      }
    },
  });
}

function handleEvent(
  event: CodexEvent,
  emit: (chunk: ChatChunk) => void,
  chunkFrame: (delta: Record<string, unknown>) => ChatChunk,
  toolCallIndex: Map<string, number>,
  nextIdx: () => number,
  stats: StreamStats,
): void {
  switch (event.type) {
    case 'response.output_item.added': {
      const item = event.item;
      if (item?.type !== 'function_call') return;
      const itemId = item.id;
      if (!itemId) return;
      const idx = nextIdx();
      toolCallIndex.set(itemId, idx);
      stats.toolCalls += 1;
      stats.finishReason = 'tool_calls';
      emit(
        chunkFrame({
          tool_calls: [
            {
              index: idx,
              id: item.call_id ?? itemId,
              type: 'function',
              function: { name: item.name ?? '', arguments: '' },
            },
          ],
        }),
      );
      return;
    }
    case 'response.function_call_arguments.delta': {
      const itemId = event.item_id ?? '';
      const idx = toolCallIndex.get(itemId);
      if (idx === undefined || typeof event.delta !== 'string') return;
      emit(
        chunkFrame({
          tool_calls: [{ index: idx, function: { arguments: event.delta } }],
        }),
      );
      return;
    }
    case 'response.output_text.delta': {
      if (typeof event.delta !== 'string' || !event.delta) return;
      stats.textBytes += event.delta.length;
      emit(chunkFrame({ content: event.delta }));
      return;
    }
    case 'response.completed': {
      if (event.response?.usage) stats.usage = event.response.usage;
      return;
    }
    case 'response.failed': {
      stats.finishReason = 'error';
      const message = event.response?.error?.message ?? 'upstream failed';
      emit(chunkFrame({ content: `[upstream error: ${message}]` }));
      return;
    }
    default:
      return;
  }
}
