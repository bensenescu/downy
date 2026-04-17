import type { UIMessage } from "ai";
import { Cog, FileText, Globe, Search } from "lucide-react";
import { Link } from "@tanstack/react-router";

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
            if (!reasoningText) return null;
            return (
              <details
                key={idx}
                className="collapse collapse-arrow my-1 bg-base-200/50 text-xs"
              >
                <summary className="collapse-title cursor-pointer py-2 text-xs font-medium text-base-content/70">
                  thinking…
                </summary>
                <div className="collapse-content whitespace-pre-wrap text-xs text-base-content/70">
                  {reasoningText}
                </div>
              </details>
            );
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
