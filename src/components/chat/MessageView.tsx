import type { UIMessage } from "ai";
import { Cog, FileText, Globe, Search } from "lucide-react";
import { Link } from "@tanstack/react-router";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import MarkdownPreview from "../markdown/MarkdownPreview";

interface Props {
  message: UIMessage;
}

interface ToolPart {
  type: string;
  state?: string;
  input?: unknown;
  output?: unknown;
}

function toolIcon(toolName: string) {
  if (toolName === "web_search") return Search;
  if (toolName === "web_scrape") return Globe;
  if (toolName.startsWith("read") || toolName === "list" || toolName === "find")
    return FileText;
  return Cog;
}

function readString(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const v: unknown = Reflect.get(value, key);
  return typeof v === "string" ? v : undefined;
}

function ToolChip({ part }: { part: ToolPart }) {
  const toolName = part.type
    .replace(/^tool-/, "")
    .replace(/^dynamic-tool-/, "");
  const Icon = toolIcon(toolName);
  const query =
    readString(part.input, "query") ??
    readString(part.input, "url") ??
    readString(part.input, "path") ??
    readString(part.input, "pattern");

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
            const reasoningText =
              typeof (part as { text?: unknown }).text === "string"
                ? (part as { text: string }).text
                : "";
            return <ReasoningBlock key={idx} text={reasoningText} />;
          }
          if (
            part.type.startsWith("tool-") ||
            part.type.startsWith("dynamic-tool")
          ) {
            return <ToolChip key={idx} part={part as ToolPart} />;
          }
          return null;
        })}
      </div>
    </div>
  );
}
