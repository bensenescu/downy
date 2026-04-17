import type { UIMessage } from "ai";
import { Cog, FileText, Globe, Search } from "lucide-react";
import { Link } from "@tanstack/react-router";
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
        "my-1 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs",
        isError
          ? "border-red-300/40 bg-red-100/30 text-red-800"
          : "border-[var(--chip-line)] bg-[var(--chip-bg)] text-[var(--sea-ink-soft)]",
      ].join(" ")}
    >
      <Icon size={12} className="opacity-70" />
      <span className="font-mono text-[0.72rem] font-medium text-[var(--sea-ink)]">
        {toolName}
      </span>
      {query ? (
        <span className="truncate">
          {query.length > 80 ? `${query.slice(0, 80)}…` : query}
        </span>
      ) : null}
      {!isDone ? (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--lagoon)]" />
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
      className="my-1 inline-flex items-center gap-1.5 rounded-full border border-[var(--chip-line)] bg-[var(--surface-strong)] px-3 py-1 text-xs font-medium text-[var(--lagoon-deep)] no-underline"
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
    <div
      className={["flex w-full", isUser ? "justify-end" : "justify-start"].join(
        " ",
      )}
    >
      <div
        className={[
          "max-w-[calc(100%-2rem)] rounded-2xl border px-4 py-3 shadow-sm sm:max-w-[42rem]",
          isUser
            ? "border-[rgba(50,143,151,0.3)] bg-[rgba(79,184,178,0.16)] text-[var(--sea-ink)]"
            : "border-[var(--line)] bg-[var(--surface-strong)] text-[var(--sea-ink)]",
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
            if (!reasoning.success || !reasoning.data.text) return null;
            return (
              <details
                key={idx}
                className="my-1 text-xs text-[var(--sea-ink-soft)]"
              >
                <summary className="cursor-pointer">thinking…</summary>
                <div className="mt-1 whitespace-pre-wrap">
                  {reasoning.data.text}
                </div>
              </details>
            );
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
