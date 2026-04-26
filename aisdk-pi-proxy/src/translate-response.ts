// Consumes pi-ai's `AssistantMessageEventStream` and emits an OpenAI
// Chat Completions SSE stream.
//
// Reasoning: `@ai-sdk/openai`'s Chat Completions chunk schema only
// recognizes role/content/tool_calls/annotations — fields like
// `reasoning_content` are silently dropped by its Zod parser. So we
// emit thinking content inline inside `delta.content` wrapped in
// `<think>…</think>` tags, and the caller wraps the language model
// with `extractReasoningMiddleware({ tagName: "think" })` on the AI
// SDK side, which rewrites those tags into proper `reasoning` parts.
// This is the canonical AI SDK pattern for OpenAI-compatible
// providers that don't natively surface reasoning.

import type {
  AssistantMessage,
  AssistantMessageEvent,
  AssistantMessageEventStream,
} from '@mariozechner/pi-ai';

type ChatChunk = {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: 0;
    delta: Record<string, unknown>;
    finish_reason: 'stop' | 'tool_calls' | 'length' | null;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
};

export type StreamStats = {
  events: number;
  textBytes: number;
  thinkingBytes: number;
  toolCalls: number;
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error' | 'aborted';
  errorMessage?: string;
  usage: AssistantMessage['usage'] | null;
  eventTypes: Record<string, number>;
};

export function translatePiStreamToChat(
  upstream: AssistantMessageEventStream,
  opts: { id: string; model: string; created: number },
  onStats?: (stats: StreamStats) => void,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  const stats: StreamStats = {
    events: 0,
    textBytes: 0,
    thinkingBytes: 0,
    toolCalls: 0,
    finishReason: 'stop',
    usage: null,
    eventTypes: {},
  };

  // Map pi-ai contentIndex (across mixed thinking/text/toolCall blocks)
  // to a Chat Completions tool_calls index (only counts tool calls).
  const toolIndexByContentIndex = new Map<number, number>();
  let nextToolIndex = 0;

  return new ReadableStream({
    async start(controller) {
      const emit = (chunk: ChatChunk): void => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      };
      const frame = (
        delta: Record<string, unknown>,
        finishReason: ChatChunk['choices'][0]['finish_reason'] = null,
      ): ChatChunk => ({
        id: opts.id,
        object: 'chat.completion.chunk',
        created: opts.created,
        model: opts.model,
        choices: [{ index: 0, delta, finish_reason: finishReason }],
      });

      // Initial role chunk so AI SDK has a stable assistant turn.
      emit(frame({ role: 'assistant' }));

      try {
        for await (const event of upstream as AsyncIterable<AssistantMessageEvent>) {
          stats.events += 1;
          stats.eventTypes[event.type] = (stats.eventTypes[event.type] ?? 0) + 1;

          switch (event.type) {
            case 'thinking_start':
              // Open the tag in-band so extractReasoningMiddleware can
              // pull the contents back out as a reasoning part.
              emit(frame({ content: '<think>' }));
              break;

            case 'thinking_delta':
              if (event.delta) {
                stats.thinkingBytes += event.delta.length;
                emit(frame({ content: event.delta }));
              }
              break;

            case 'thinking_end':
              emit(frame({ content: '</think>' }));
              break;

            case 'text_delta':
              if (event.delta) {
                stats.textBytes += event.delta.length;
                emit(frame({ content: event.delta }));
              }
              break;

            case 'toolcall_start': {
              const block = event.partial.content[event.contentIndex];
              if (!block || block.type !== 'toolCall') break;
              const idx = nextToolIndex++;
              toolIndexByContentIndex.set(event.contentIndex, idx);
              stats.toolCalls += 1;
              emit(
                frame({
                  tool_calls: [
                    {
                      index: idx,
                      id: block.id,
                      type: 'function',
                      function: { name: block.name, arguments: '' },
                    },
                  ],
                }),
              );
              break;
            }

            case 'toolcall_delta': {
              // pi-ai's `delta` for tool calls is the raw JSON-text fragment.
              const idx = toolIndexByContentIndex.get(event.contentIndex);
              if (idx === undefined || !event.delta) break;
              emit(
                frame({
                  tool_calls: [
                    {
                      index: idx,
                      function: { arguments: event.delta },
                    },
                  ],
                }),
              );
              break;
            }

            case 'done':
              stats.usage = event.message.usage;
              stats.finishReason =
                event.reason === 'toolUse'
                  ? 'tool_calls'
                  : event.reason === 'length'
                    ? 'length'
                    : 'stop';
              break;

            case 'error':
              stats.usage = event.error.usage;
              stats.errorMessage = event.error.errorMessage;
              stats.finishReason = event.reason === 'aborted' ? 'aborted' : 'error';
              break;

            // start / text_start / text_end / thinking_start / thinking_end /
            // toolcall_end have no Chat Completions equivalent — skip.
          }
        }

        const final = frame(
          {},
          stats.finishReason === 'error' || stats.finishReason === 'aborted'
            ? null
            : stats.finishReason,
        );
        if (stats.usage) {
          final.usage = {
            prompt_tokens: stats.usage.input,
            completion_tokens: stats.usage.output,
            total_tokens: stats.usage.totalTokens,
          };
        }
        emit(final);

        if (stats.finishReason === 'error' || stats.finishReason === 'aborted') {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                error: {
                  message: stats.errorMessage ?? 'upstream failed',
                  type: stats.finishReason === 'aborted' ? 'aborted' : 'upstream_error',
                },
              })}\n\n`,
            ),
          );
        }

        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ error: { message, type: 'proxy_error' } })}\n\n`,
          ),
        );
      } finally {
        controller.close();
        onStats?.(stats);
      }
    },
  });
}
