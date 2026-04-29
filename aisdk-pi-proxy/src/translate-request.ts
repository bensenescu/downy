// Translates an OpenAI Responses API request body into a pi-ai
// `Context` plus a `Tool[]`.
//
// Wire-format reference: https://platform.openai.com/docs/api-reference/responses/create
// AI SDK request shape: see node_modules/@ai-sdk/openai/dist/index.mjs
// (`convertToOpenAIResponsesInput` for input items, `prepareResponsesTools`
// for the tool shape).
//
// Mappings:
//   - `instructions` (string) prepended to systemPrompt
//   - input items with role: system|developer|user|assistant → Message[]
//   - input items with type: function_call → assistant Message with toolCall block
//   - input items with type: function_call_output → toolResult Message
//   - input items with type: reasoning → skipped (we don't replay encrypted
//     reasoning blobs across providers; pi-ai handles its own provider's
//     thinking signatures internally)
//   - tools array (already flat function objects per Responses API) → Tool[]

import type { Context, Message, Tool } from "@mariozechner/pi-ai";

// Loose structural shape — Responses API has many content-part subtypes
// (input_text, input_image, input_file, output_text, summary_text, ...) and
// all the ones we care about expose `.text`. Anything without `.text` is
// silently dropped from extracted text by `extractInputText`.
type ResponsesInputContentPart = {
  type?: string;
  text?: string;
  // image_url, file_id, file_data, etc. ride through but we don't read them yet.
  [k: string]: unknown;
};

// One loose shape covering every input-item flavor (role-bearing message
// items, function_call, function_call_output, reasoning, item_reference,
// plus any forward-compatible item_type we don't recognize). The narrowing
// happens at runtime via the role/type checks below.
type ResponsesInputItem = {
  role?: "system" | "developer" | "user" | "assistant";
  type?: string;
  id?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  status?: string;
  content?: string | ResponsesInputContentPart[];
  output?: string | ResponsesInputContentPart[];
  summary?: Array<{ type: "summary_text"; text: string }>;
  encrypted_content?: string | null;
  [k: string]: unknown;
};

type ResponsesTool = {
  type?: string;
  name?: string;
  description?: string;
  parameters?: unknown;
};

export type ResponsesRequest = {
  model?: string;
  input?: ResponsesInputItem[];
  instructions?: string | null;
  tools?: ResponsesTool[];
  tool_choice?: unknown;
  parallel_tool_calls?: boolean;
  store?: boolean;
  include?: string[];
  reasoning?: { effort?: string; summary?: string } | null;
  previous_response_id?: string | null;
  stream?: boolean;
};

function extractInputText(
  content: string | ResponsesInputContentPart[] | undefined,
): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const p of content) {
    // Accept input_text, output_text, summary_text, plus any { text } shape.
    if (p && typeof p.text === "string") parts.push(p.text);
  }
  return parts.join("");
}

function parseArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    if (v && typeof v === "object" && !Array.isArray(v))
      return v as Record<string, unknown>;
  } catch {}
  return {};
}

type AssistantBlock =
  | { type: "text"; text: string }
  | {
      type: "toolCall";
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    };

function flushAssistantBlocks(
  messages: Message[],
  blocks: AssistantBlock[],
): void {
  if (blocks.length === 0) return;
  messages.push({
    role: "assistant",
    // Cast: pi-ai's AssistantMessage carries provider-tracking fields
    // (api/provider/model/usage/stopReason/timestamp) that the LLM doesn't
    // care about for replay. pi-ai's transform-messages tolerates partial
    // assistant messages just fine.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    content: blocks as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

export function translateResponsesToContext(req: ResponsesRequest): {
  context: Context;
  defaultModelId: string;
} {
  const systemParts: string[] = [];
  if (typeof req.instructions === "string" && req.instructions.length > 0) {
    systemParts.push(req.instructions);
  }

  const messages: Message[] = [];
  let pendingAssistant: AssistantBlock[] = [];

  for (const item of req.input ?? []) {
    // Role-based message items.
    if ("role" in item && item.role) {
      // Any role transition flushes a pending assistant turn.
      if (item.role !== "assistant" && pendingAssistant.length > 0) {
        flushAssistantBlocks(messages, pendingAssistant);
        pendingAssistant = [];
      }
      if (item.role === "system" || item.role === "developer") {
        const text = extractInputText(item.content);
        if (text) systemParts.push(text);
        continue;
      }
      if (item.role === "user") {
        const text = extractInputText(item.content);
        messages.push({
          role: "user",
          content: text,
          timestamp: Date.now(),
        });
        continue;
      }
      if (item.role === "assistant") {
        const text = extractInputText(item.content);
        if (text) pendingAssistant.push({ type: "text", text });
        continue;
      }
    }

    // Type-based items.
    if (item.type === "function_call" && item.call_id && item.name) {
      // Pi-ai's toolCall id is what gets matched against toolResult.toolCallId.
      // The Responses API uses `call_id` as the cross-reference token.
      pendingAssistant.push({
        type: "toolCall",
        id: item.call_id,
        name: item.name,
        arguments: parseArgs(item.arguments),
      });
      continue;
    }
    if (item.type === "function_call_output" && item.call_id) {
      if (pendingAssistant.length > 0) {
        flushAssistantBlocks(messages, pendingAssistant);
        pendingAssistant = [];
      }
      const text =
        typeof item.output === "string"
          ? item.output
          : extractInputText(item.output);
      messages.push({
        role: "toolResult",
        toolCallId: item.call_id,
        toolName: "",
        content: [{ type: "text", text }],
        isError: false,
        timestamp: Date.now(),
      });
      continue;
    }
    // reasoning + item_reference + unknown server-side items: skip.
    // pi-ai's own provider regenerates whatever signed reasoning the next
    // turn needs; we don't try to round-trip another provider's encrypted
    // reasoning through this stateless replay.
  }

  if (pendingAssistant.length > 0)
    flushAssistantBlocks(messages, pendingAssistant);

  const tools: Tool[] = [];
  for (const t of req.tools ?? []) {
    if (t.type !== "function") continue;
    if (!t.name) continue;
    tools.push({
      name: t.name,
      description: t.description ?? "",
      // AI SDK passes JSON Schema directly under `parameters`; pi-ai
      // forwards it to providers as-is despite typing it as TSchema.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parameters: (t.parameters ?? { type: "object", properties: {} }) as any,
    });
  }

  const context: Context = {
    systemPrompt: systemParts.join("\n\n") || undefined,
    messages,
    tools: tools.length > 0 ? tools : undefined,
  };

  return { context, defaultModelId: req.model ?? "" };
}

export function summarizeResponsesRequest(
  req: ResponsesRequest,
): Record<string, unknown> {
  const items = req.input ?? [];
  const itemTypes: Record<string, number> = {};
  for (const it of items) {
    const key =
      "role" in it && it.role
        ? `role:${it.role}`
        : `type:${"type" in it ? it.type : "unknown"}`;
    itemTypes[key] = (itemTypes[key] ?? 0) + 1;
  }
  return {
    model: req.model,
    inputCount: items.length,
    itemTypes,
    hasInstructions:
      typeof req.instructions === "string" && req.instructions.length > 0,
    toolCount: req.tools?.length ?? 0,
    toolChoice: req.tool_choice,
    stream: req.stream,
    store: req.store,
    reasoningEffort: req.reasoning?.effort,
    include: req.include,
  };
}
