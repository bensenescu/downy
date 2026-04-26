// Translates an OpenAI Chat Completions request body into a pi-ai
// `Context` plus a `Tool[]`. Maps:
//   - system/developer messages → context.systemPrompt (joined)
//   - user messages → user `Message` (text only; image_url not yet handled)
//   - assistant messages → assistant `Message` with text + toolCall blocks
//   - tool messages → toolResult `Message`
//
// Tool definitions are passed through as-is: AI SDK's `parameters` is
// already JSON Schema, which pi-ai forwards to providers as-is. We tag
// it as a TSchema since pi-ai's `Tool` type requires it.

import type { Context, Message, Tool } from '@mariozechner/pi-ai';

type ChatContent = string | Array<{ type?: string; text?: string }> | null | undefined;

type ChatToolCall = {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
};

type ChatMessage = {
  role: string;
  content?: ChatContent;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
  name?: string;
};

type ChatTool = {
  type?: string;
  function?: { name?: string; description?: string; parameters?: unknown };
};

export type ChatRequest = {
  model?: string;
  messages?: ChatMessage[];
  tools?: ChatTool[];
  tool_choice?: unknown;
  stream?: boolean;
  parallel_tool_calls?: boolean;
};

function extractText(content: ChatContent): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const p of content) {
    if (p && typeof p.text === 'string') parts.push(p.text);
  }
  return parts.join('');
}

function parseArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {}
  return {};
}

export function translateChatToContext(chat: ChatRequest): {
  context: Context;
  defaultModelId: string;
} {
  const systemParts: string[] = [];
  const messages: Message[] = [];

  for (const msg of chat.messages ?? []) {
    if (msg.role === 'system' || msg.role === 'developer') {
      const text = extractText(msg.content);
      if (text) systemParts.push(text);
      continue;
    }
    if (msg.role === 'user') {
      const text = extractText(msg.content);
      messages.push({
        role: 'user',
        content: text,
        timestamp: Date.now(),
      });
      continue;
    }
    if (msg.role === 'assistant') {
      const blocks: Array<
        | { type: 'text'; text: string }
        | { type: 'toolCall'; id: string; name: string; arguments: Record<string, unknown> }
      > = [];
      const text = extractText(msg.content);
      if (text) blocks.push({ type: 'text', text });
      for (const tc of msg.tool_calls ?? []) {
        const id = tc.id;
        const name = tc.function?.name;
        if (!id || !name) continue;
        blocks.push({
          type: 'toolCall',
          id,
          name,
          arguments: parseArgs(tc.function?.arguments),
        });
      }
      // Skip empty assistant turns (some clients send these as placeholders).
      if (blocks.length === 0) continue;
      messages.push({
        role: 'assistant',
        // Cast: pi-ai's AssistantMessage has many provider-tracking fields
        // (api/provider/model/usage/stopReason/timestamp) that the LLM doesn't
        // care about for replay. pi-ai's transform-messages tolerates partial
        // assistant messages from "another provider" just fine.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        content: blocks as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      continue;
    }
    if (msg.role === 'tool') {
      if (!msg.tool_call_id) continue;
      messages.push({
        role: 'toolResult',
        toolCallId: msg.tool_call_id,
        toolName: msg.name ?? '',
        content: [{ type: 'text', text: extractText(msg.content) }],
        isError: false,
        timestamp: Date.now(),
      });
      continue;
    }
  }

  const tools: Tool[] = [];
  for (const t of chat.tools ?? []) {
    const name = t.function?.name;
    if (!name) continue;
    tools.push({
      name,
      description: t.function?.description ?? '',
      // AI SDK gives us JSON Schema; pi-ai expects TypeBox but forwards
      // raw JSON Schema to providers. Cast through.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parameters: (t.function?.parameters ?? { type: 'object', properties: {} }) as any,
    });
  }

  const context: Context = {
    systemPrompt: systemParts.join('\n\n') || undefined,
    messages,
    tools: tools.length > 0 ? tools : undefined,
  };

  return { context, defaultModelId: chat.model ?? '' };
}

export function summarizeChatRequest(chat: ChatRequest): Record<string, unknown> {
  const messages = chat.messages ?? [];
  const roles: Record<string, number> = {};
  let toolCalls = 0;
  for (const m of messages) {
    roles[m.role] = (roles[m.role] ?? 0) + 1;
    if (Array.isArray(m.tool_calls)) toolCalls += m.tool_calls.length;
  }
  return {
    model: chat.model,
    messageCount: messages.length,
    roles,
    toolCallsInHistory: toolCalls,
    toolCount: chat.tools?.length ?? 0,
    toolChoice: chat.tool_choice,
    stream: chat.stream,
  };
}
