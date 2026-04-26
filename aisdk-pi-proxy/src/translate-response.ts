// Consumes pi-ai's `AssistantMessageEventStream` and emits an OpenAI
// Responses API SSE stream.
//
// The Responses API has native event types for reasoning, structured
// output items, and function-call argument streaming, so pi-ai's
// thinking/text/toolcall events map directly without `<think>` tag
// smuggling. AI SDK's `openai.responses()` parser turns these events
// into proper `reasoning-*`, `text-*`, `tool-*` LanguageModelV3 stream
// parts. See node_modules/@ai-sdk/openai/dist/index.mjs around
// `isResponseOutputItemAddedChunk` for the parser side.
//
// Event sequence per kind:
//   thinking → output_item.added(reasoning)
//              → reasoning_summary_text.delta*
//              → output_item.done(reasoning)
//   text     → output_item.added(message)
//              → output_text.delta*
//              → output_item.done(message)
//   toolcall → output_item.added(function_call)
//              → function_call_arguments.delta*
//              → output_item.done(function_call)
//
// Reasoning summary_index is 0 for every thinking block — pi-ai surfaces
// one summary stream per reasoning step.

import type {
  AssistantMessage,
  AssistantMessageEvent,
  AssistantMessageEventStream,
} from '@mariozechner/pi-ai';

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

type OutputItem =
  | { type: 'message'; id: string }
  | { type: 'reasoning'; id: string; encrypted_content: null }
  | {
      type: 'function_call';
      id: string;
      call_id: string;
      name: string;
      arguments: string;
      status?: 'completed';
    };

type ItemSlot = {
  outputIndex: number;
  item: OutputItem;
  // For tool calls we accumulate args text so we can emit it on output_item.done.
  toolArgsBuffer?: string;
};

type Emit = (chunk: Record<string, unknown>) => void;

type StreamState = {
  stats: StreamStats;
  slots: Map<number, ItemSlot>;
  nextOutputIndex: number;
};

function handleThinkingStart(state: StreamState, emit: Emit, contentIndex: number): void {
  const outputIndex = state.nextOutputIndex++;
  const item: OutputItem = {
    type: 'reasoning',
    id: `rs_${contentIndex}`,
    encrypted_content: null,
  };
  state.slots.set(contentIndex, { outputIndex, item });
  emit({ type: 'response.output_item.added', output_index: outputIndex, item });
}

function handleThinkingDelta(
  state: StreamState,
  emit: Emit,
  contentIndex: number,
  delta: string,
): void {
  const slot = state.slots.get(contentIndex);
  if (!slot || slot.item.type !== 'reasoning' || !delta) return;
  state.stats.thinkingBytes += delta.length;
  emit({
    type: 'response.reasoning_summary_text.delta',
    item_id: slot.item.id,
    summary_index: 0,
    delta,
  });
}

function handleTextStart(state: StreamState, emit: Emit, contentIndex: number): void {
  const outputIndex = state.nextOutputIndex++;
  const item: OutputItem = { type: 'message', id: `msg_${contentIndex}` };
  state.slots.set(contentIndex, { outputIndex, item });
  emit({ type: 'response.output_item.added', output_index: outputIndex, item });
}

function handleTextDelta(
  state: StreamState,
  emit: Emit,
  contentIndex: number,
  delta: string,
): void {
  const slot = state.slots.get(contentIndex);
  if (!slot || slot.item.type !== 'message' || !delta) return;
  state.stats.textBytes += delta.length;
  emit({ type: 'response.output_text.delta', item_id: slot.item.id, delta });
}

function handleToolStart(
  state: StreamState,
  emit: Emit,
  event: Extract<AssistantMessageEvent, { type: 'toolcall_start' }>,
): void {
  const block = event.partial.content[event.contentIndex];
  if (!block || block.type !== 'toolCall') return;
  const outputIndex = state.nextOutputIndex++;
  // Use pi-ai's tool-call id as both the function_call.id (item id) and the
  // call_id (cross-reference token paired with function_call_output on the
  // next turn). They're allowed to be the same string and pi-ai only tracks
  // one identifier.
  const item: OutputItem = {
    type: 'function_call',
    id: block.id,
    call_id: block.id,
    name: block.name,
    arguments: '',
  };
  state.slots.set(event.contentIndex, { outputIndex, item, toolArgsBuffer: '' });
  state.stats.toolCalls += 1;
  emit({ type: 'response.output_item.added', output_index: outputIndex, item });
}

function handleToolDelta(
  state: StreamState,
  emit: Emit,
  contentIndex: number,
  delta: string,
): void {
  const slot = state.slots.get(contentIndex);
  if (!slot || slot.item.type !== 'function_call' || !delta) return;
  slot.toolArgsBuffer = (slot.toolArgsBuffer ?? '') + delta;
  emit({
    type: 'response.function_call_arguments.delta',
    item_id: slot.item.id,
    output_index: slot.outputIndex,
    delta,
  });
}

function handleToolEnd(
  state: StreamState,
  emit: Emit,
  event: Extract<AssistantMessageEvent, { type: 'toolcall_end' }>,
): void {
  const slot = state.slots.get(event.contentIndex);
  if (!slot || slot.item.type !== 'function_call') return;
  const finalArgs =
    slot.toolArgsBuffer && slot.toolArgsBuffer.length > 0
      ? slot.toolArgsBuffer
      : JSON.stringify(event.toolCall.arguments ?? {});
  emit({
    type: 'response.output_item.done',
    output_index: slot.outputIndex,
    item: { ...slot.item, arguments: finalArgs, status: 'completed' },
  });
  state.slots.delete(event.contentIndex);
}

function handleBlockEnd(state: StreamState, emit: Emit, contentIndex: number): void {
  const slot = state.slots.get(contentIndex);
  if (!slot) return;
  emit({
    type: 'response.output_item.done',
    output_index: slot.outputIndex,
    item: slot.item,
  });
  state.slots.delete(contentIndex);
}

function handleEvent(state: StreamState, emit: Emit, event: AssistantMessageEvent): void {
  state.stats.events += 1;
  state.stats.eventTypes[event.type] = (state.stats.eventTypes[event.type] ?? 0) + 1;

  switch (event.type) {
    case 'thinking_start':
      handleThinkingStart(state, emit, event.contentIndex);
      return;
    case 'thinking_delta':
      handleThinkingDelta(state, emit, event.contentIndex, event.delta ?? '');
      return;
    case 'thinking_end':
    case 'text_end':
      handleBlockEnd(state, emit, event.contentIndex);
      return;
    case 'text_start':
      handleTextStart(state, emit, event.contentIndex);
      return;
    case 'text_delta':
      handleTextDelta(state, emit, event.contentIndex, event.delta ?? '');
      return;
    case 'toolcall_start':
      handleToolStart(state, emit, event);
      return;
    case 'toolcall_delta':
      handleToolDelta(state, emit, event.contentIndex, event.delta ?? '');
      return;
    case 'toolcall_end':
      handleToolEnd(state, emit, event);
      return;
    case 'done':
      state.stats.usage = event.message.usage;
      state.stats.finishReason =
        event.reason === 'toolUse'
          ? 'tool_calls'
          : event.reason === 'length'
            ? 'length'
            : 'stop';
      return;
    case 'error':
      state.stats.usage = event.error.usage;
      state.stats.errorMessage = event.error.errorMessage;
      state.stats.finishReason = event.reason === 'aborted' ? 'aborted' : 'error';
      return;
    // `start` carries no info AI SDK needs — response.created went out before
    // any pi-ai events arrived.
  }
}

export function translatePiStreamToResponses(
  upstream: AssistantMessageEventStream,
  opts: { id: string; model: string; created: number },
  onStats?: (stats: StreamStats) => void,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  const state: StreamState = {
    stats: {
      events: 0,
      textBytes: 0,
      thinkingBytes: 0,
      toolCalls: 0,
      finishReason: 'stop',
      usage: null,
      eventTypes: {},
    },
    slots: new Map<number, ItemSlot>(),
    nextOutputIndex: 0,
  };

  return new ReadableStream({
    async start(controller) {
      const emit: Emit = (chunk) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      };

      // response.created so AI SDK records id/timestamp/modelId.
      emit({
        type: 'response.created',
        response: {
          id: opts.id,
          created_at: opts.created,
          model: opts.model,
          service_tier: null,
        },
      });

      try {
        for await (const event of upstream as AsyncIterable<AssistantMessageEvent>) {
          handleEvent(state, emit, event);
        }
        const { stats, slots } = state;

        // Close any items pi-ai didn't explicitly close (defensive — pi-ai
        // does emit *_end events, but a hung upstream might skip them).
        for (const slot of slots.values()) {
          emit({
            type: 'response.output_item.done',
            output_index: slot.outputIndex,
            item: slot.item,
          });
        }
        slots.clear();

        if (stats.finishReason === 'error') {
          emit({
            type: 'response.failed',
            response: {
              error: { message: stats.errorMessage ?? 'upstream failed' },
              usage: stats.usage
                ? {
                    input_tokens: stats.usage.input,
                    output_tokens: stats.usage.output,
                  }
                : undefined,
            },
          });
        } else {
          emit({
            type: 'response.completed',
            response: {
              usage: {
                input_tokens: stats.usage?.input ?? 0,
                output_tokens: stats.usage?.output ?? 0,
                input_tokens_details: stats.usage?.cacheRead
                  ? { cached_tokens: stats.usage.cacheRead }
                  : undefined,
              },
              ...(stats.finishReason === 'length'
                ? { incomplete_details: { reason: 'max_output_tokens' } }
                : {}),
            },
          });
        }

        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        state.stats.errorMessage = state.stats.errorMessage ?? message;
        state.stats.finishReason = 'error';
        emit({
          type: 'response.failed',
          response: { error: { message } },
        });
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      } finally {
        controller.close();
        onStats?.(state.stats);
      }
    },
  });
}
