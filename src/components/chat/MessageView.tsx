import type { UIMessage } from "ai";
import { Cog, FileText, Globe, Search } from "lucide-react";
import { Link } from "@tanstack/react-router";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { z } from "zod";

import MarkdownPreview from "../markdown/MarkdownPreview";

interface Props {
  message: UIMessage;
}

/**
 * Shape of AI SDK tool/dynamic-tool parts that we actually render. The SDK
 * types these generically; this schema is the local narrowing we rely on.
 */
const ToolPartSchema = z.object({
  type: z.string(),
  state: z.string().optional(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
});
type ToolPart = z.infer<typeof ToolPartSchema>;

/**
 * Tool inputs are `unknown` because the AI SDK types them generically. We peek
 * for a single human-readable field to surface in the chip. Any of these four
 * keys may be present depending on which tool produced the part.
 */
const ToolInputPreviewSchema = z.object({
  query: z.string().optional(),
  url: z.string().optional(),
  path: z.string().optional(),
  pattern: z.string().optional(),
});

/**
 * AI SDK reasoning parts carry a `text` field. The SDK's union type isn't
 * narrowly exposed here, so we validate the shape explicitly.
 */
const ReasoningPartSchema = z.object({ text: z.string() });

function toolIcon(toolName: string) {
  if (toolName === "web_search") return Search;
  if (toolName === "web_scrape") return Globe;
  if (toolName.startsWith("read") || toolName === "list" || toolName === "find")
    return FileText;
  return Cog;
}

function previewToolInput(input: unknown): string | undefined {
  const parsed = ToolInputPreviewSchema.safeParse(input);
  if (!parsed.success) return undefined;
  return (
    parsed.data.query ??
    parsed.data.url ??
    parsed.data.path ??
    parsed.data.pattern
  );
}

function ToolChip({ part }: { part: ToolPart }) {
  const toolName = part.type
    .replace(/^tool-/, "")
    .replace(/^dynamic-tool-/, "");
  const Icon = toolIcon(toolName);
  const query = previewToolInput(part.input);

  const isDone =
    part.state === "output-available" || part.state === "output-error";
  const isError = part.state === "output-error";

  return (
    <div
      className={[
        "badge badge-outline my-1 h-auto gap-2 px-3 py-1.5 text-xs",
        isError ? "badge-error" : "",
      ].join(" ")}
    >
      <Icon size={12} className="opacity-70" />
      <span className="font-mono text-xs font-medium">{toolName}</span>
      {query ? (
        <span className="truncate">
          {query.length > 80 ? `${query.slice(0, 80)}…` : query}
        </span>
      ) : null}
      {!isDone ? (
        <span className="loading loading-dots loading-xs text-primary" />
      ) : null}
    </div>
  );
}

function FileLinkPill({ path }: { path: string }) {
  const safePath = path.replace(/^\/+/, "");
  const encoded = safePath
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/");
  return (
    <Link
      to="/workspace/$"
      params={{ _splat: encoded }}
      className="badge badge-primary badge-outline my-1 gap-1.5 px-3 py-1.5 text-xs no-underline hover:bg-primary/10"
    >
      <FileText size={12} />
      {safePath}
    </Link>
  );
}

function extractFilePaths(text: string): string[] {
  const matches = Array.from(text.matchAll(/`([^`]+\.[a-zA-Z0-9]{1,6})`/g));
  return Array.from(new Set(matches.map((m) => m[1] ?? "")));
}

// Opencode-style reasoning block: one inline block per reasoning part. The
// string `_Thinking:_ ` is prepended so the italic label and any model-written
// `**bold header**` flow through the markdown renderer together, producing the
// "Thinking: Title" look without needing to parse a separate title field.
function ReasoningBlock({ text }: { text: string }) {
  // Some providers (e.g. OpenRouter) interleave `[REDACTED]` placeholders in
  // the reasoning stream — opencode strips them; we do the same.
  const cleaned = text.replaceAll("[REDACTED]", "").trim();
  if (!cleaned) return null;
  return (
    <div className="my-2 border-l-2 border-base-300 pl-3">
      <div
        className={[
          "prose prose-sm max-w-none break-words opacity-80",
          "prose-p:my-1 prose-p:leading-relaxed prose-p:text-base-content/70",
          "prose-em:font-medium prose-em:text-amber-600 dark:prose-em:text-amber-400",
          "prose-strong:text-rose-600 dark:prose-strong:text-rose-400",
          "prose-code:border-0 prose-code:bg-transparent prose-code:px-0.5 prose-code:text-rose-600 dark:prose-code:text-rose-400",
          "prose-headings:font-semibold prose-headings:text-base-content/70",
          "prose-li:text-base-content/70",
          "prose-a:text-primary",
        ].join(" ")}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {"_Thinking:_ " + cleaned}
        </ReactMarkdown>
      </div>
    </div>
  );
}

export default function MessageView({ message }: Props) {
  const isUser = message.role === "user";
  return (
    <div className={["chat", isUser ? "chat-end" : "chat-start"].join(" ")}>
      <div
        className={[
          "chat-bubble max-w-[calc(100%-2rem)] sm:max-w-[42rem]",
          isUser
            ? "chat-bubble-primary"
            : "border border-base-300 bg-base-100 text-base-content",
        ].join(" ")}
      >
        {message.parts.map((part, idx) => {
          if (part.type === "text") {
            const paths = !isUser ? extractFilePaths(part.text) : [];
            return (
              <div key={idx}>
                <MarkdownPreview source={part.text} />
                {paths.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {paths.map((path) => (
                      <FileLinkPill key={path} path={path} />
                    ))}
                  </div>
                ) : null}
              </div>
            );
          }
          if (part.type === "reasoning") {
            const reasoning = ReasoningPartSchema.safeParse(part);
            if (!reasoning.success) return null;
            return <ReasoningBlock key={idx} text={reasoning.data.text} />;
          }
          if (
            part.type.startsWith("tool-") ||
            part.type.startsWith("dynamic-tool")
          ) {
            const tool = ToolPartSchema.safeParse(part);
            if (!tool.success) return null;
            return <ToolChip key={idx} part={tool.data} />;
          }
          return null;
        })}
      </div>
    </div>
  );
}
