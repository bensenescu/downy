// Translates an OpenAI Chat Completions request body into a Codex Responses
// API body that the ChatGPT-OAuth endpoint accepts.
//
// Mirrors what `openai/codex` and `router-for-me/CLIProxyAPI` do internally —
// system/developer messages lift to top-level `instructions`; user/assistant
// messages become typed input items; tool_calls flatten into function_call
// items; tool-role messages become function_call_output items. Codex-rejected
// fields (temperature, top_p, max_tokens, etc.) are not forwarded. `store` is
// forced false and `parallel_tool_calls` defaulted to false — both required
// by the OAuth path.

type JsonObject = Record<string, unknown>;

type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool' | 'developer' | string;
  content?: string | Array<{ type?: string; text?: string }> | null;
  tool_calls?: Array<{
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }>;
  tool_call_id?: string;
};

type ChatTool = {
  type?: string;
  function?: {
    name?: string;
    description?: string;
    parameters?: unknown;
    strict?: boolean;
  };
};

type ChatRequest = {
  model?: string;
  messages?: ChatMessage[];
  tools?: ChatTool[];
  tool_choice?: unknown;
  stream?: boolean;
  parallel_tool_calls?: boolean;
};

type CodexContentItem =
  | { type: 'input_text'; text: string }
  | { type: 'output_text'; text: string };

type CodexInputItem =
  | { type: 'message'; role: 'user' | 'assistant'; content: CodexContentItem[] }
  | { type: 'function_call'; call_id: string; name: string; arguments: string }
  | { type: 'function_call_output'; call_id: string; output: string };

type CodexTool = {
  type: 'function';
  name: string;
  description?: string;
  parameters?: unknown;
  strict?: boolean;
};

export type CodexRequest = {
  model: string;
  instructions: string;
  input: CodexInputItem[];
  tools: CodexTool[];
  tool_choice: unknown;
  parallel_tool_calls: boolean;
  store: false;
  stream: boolean;
};

function extractText(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const p of content) {
    if (p && typeof p.text === 'string') parts.push(p.text);
  }
  return parts.join('');
}

function translateAssistantMessage(msg: ChatMessage): CodexInputItem[] {
  const out: CodexInputItem[] = [];
  const text = extractText(msg.content);
  if (text) {
    out.push({
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text }],
    });
  }
  if (Array.isArray(msg.tool_calls)) {
    for (const tc of msg.tool_calls) {
      const callId = tc.id;
      const name = tc.function?.name;
      if (!callId || !name) continue;
      out.push({
        type: 'function_call',
        call_id: callId,
        name,
        arguments: typeof tc.function?.arguments === 'string' ? tc.function.arguments : '{}',
      });
    }
  }
  return out;
}

export function translateChatToCodex(chat: ChatRequest): CodexRequest {
  const instructions: string[] = [];
  const input: CodexInputItem[] = [];

  for (const msg of chat.messages ?? []) {
    if (msg.role === 'system' || msg.role === 'developer') {
      const text = extractText(msg.content);
      if (text) instructions.push(text);
      continue;
    }
    if (msg.role === 'user') {
      const text = extractText(msg.content);
      if (text) {
        input.push({
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text }],
        });
      }
      continue;
    }
    if (msg.role === 'assistant') {
      input.push(...translateAssistantMessage(msg));
      continue;
    }
    if (msg.role === 'tool') {
      if (!msg.tool_call_id) continue;
      input.push({
        type: 'function_call_output',
        call_id: msg.tool_call_id,
        output: extractText(msg.content),
      });
      continue;
    }
  }

  const tools: CodexTool[] = [];
  for (const t of chat.tools ?? []) {
    const name = t.function?.name;
    if (!name) continue;
    tools.push({
      type: 'function',
      name,
      description: t.function?.description,
      parameters: t.function?.parameters,
      strict: t.function?.strict ?? false,
    });
  }

  return {
    model: chat.model ?? 'gpt-5.4',
    instructions: instructions.join('\n\n') || 'You are a helpful assistant.',
    input,
    tools,
    tool_choice: chat.tool_choice ?? 'auto',
    parallel_tool_calls: chat.parallel_tool_calls ?? false,
    store: false,
    stream: chat.stream ?? true,
  };
}

export function summarizeChatRequest(body: JsonObject): JsonObject {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const roles: Record<string, number> = {};
  let toolCalls = 0;
  for (const m of messages) {
    if (m && typeof m === 'object' && 'role' in m && typeof m.role === 'string') {
      roles[m.role] = (roles[m.role] ?? 0) + 1;
      if ('tool_calls' in m && Array.isArray(m.tool_calls)) toolCalls += m.tool_calls.length;
    }
  }
  return {
    model: body.model,
    messageCount: messages.length,
    roles,
    toolCallsInHistory: toolCalls,
    toolCount: tools.length,
    toolChoice: body.tool_choice,
    stream: body.stream,
  };
}
