import type { UIMessage } from "ai";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Copy,
  FileText,
  Pencil,
  Sparkles,
  Undo2,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { z } from "zod";

import { useWorkspaceFile } from "../../lib/queries";
import { useCurrentAgentSlug } from "../../lib/agents";
import { withBack } from "../../lib/back-nav";
import { useShowThinking } from "../../lib/preferences";
import {
  IDENTITY_PATH,
  MEMORY_PATH,
  SOUL_PATH,
  USER_PATH,
} from "../../worker/agent/core-files";
import MarkdownPreview from "../markdown/MarkdownPreview";
import { ToolPartSchema } from "./tool-part-types";
import ToolPart from "./ToolParts";

const CORE_FILE_PATHS = new Set<string>([
  SOUL_PATH,
  IDENTITY_PATH,
  USER_PATH,
  MEMORY_PATH,
]);

interface Props {
  message: UIMessage;
  turnEnded: boolean;
  /**
   * If this is the last user message and the chat isn't streaming, the chat
   * page passes the message text in here so MessageView can show an "Edit"
   * affordance that hands the text back via `onEdit`.
   */
  onEdit?: (text: string) => void;
  /**
   * If this is the last assistant message and the chat isn't streaming, the
   * chat page passes a revert handler that will drop the last user-initiated
   * turn from the transcript.
   */
  onRevert?: () => void;
  /**
   * Whether this turn touched workspace files / spawned tasks / called MCP
   * tools — used to gate the warning tooltip on the Undo + Edit buttons.
   * The buttons still work; the tooltip just sets expectations.
   */
  hasSideEffects?: boolean;
  /**
   * Set when this assistant message was generated in response to a background
   * task completing. Renders a small header above the message linking back to
   * the task page so the user knows the reply was triggered by a worker
   * finishing rather than by their own message.
   */
  backgroundTaskSource?: {
    taskId: string;
    taskKind: string;
    status: "done" | "error";
  };
}

// Walks an assistant message's parts looking for tools that mutate state
// outside the chat transcript. Read-only tools (search, scrape, peer reads)
// produce nothing the user needs to roll back, so they don't trigger the
// warning. MCP tools (`dynamic-tool-*`) are flagged conservatively — we don't
// know which are mutating, so we treat them all as if they were.
export function turnHasSideEffects(message: UIMessage): boolean {
  for (const part of message.parts) {
    if (
      part.type === "tool-write" ||
      part.type === "tool-edit" ||
      part.type === "tool-delete" ||
      part.type === "tool-spawn_background_task" ||
      part.type.startsWith("dynamic-tool-")
    ) {
      return true;
    }
  }
  return false;
}

// Flatten the user-authored text of a message so we can prefill the input on
// edit. Mirrors `messageToPlainText` but only includes text parts — reasoning
// and tool parts don't apply to user messages.
function messageUserText(message: UIMessage): string {
  const chunks: string[] = [];
  for (const part of message.parts) {
    if (part.type === "text") {
      const parsed = z.object({ text: z.string() }).safeParse(part);
      if (parsed.success) chunks.push(parsed.data.text);
    }
  }
  return chunks.join("\n\n");
}

/**
 * AI SDK reasoning parts carry a `text` field. The SDK's union type isn't
 * narrowly exposed here, so we validate the shape explicitly.
 */
const ReasoningPartSchema = z.object({ text: z.string() });

/**
 * Flatten a message's text and reasoning into a single plain-text blob for
 * clipboard copy. Tool parts are skipped — they're structured objects that
 * don't round-trip as text usefully. Reasoning is included because users who
 * have "Show thinking" on are reading it as prose; those who don't can still
 * copy it if they explicitly clicked the chevron open to read it.
 */
function messageToPlainText(message: UIMessage): string {
  const chunks: string[] = [];
  for (const part of message.parts) {
    if (part.type === "text") {
      const parsed = z.object({ text: z.string() }).safeParse(part);
      if (parsed.success) chunks.push(parsed.data.text);
    } else if (part.type === "reasoning") {
      const parsed = ReasoningPartSchema.safeParse(part);
      if (parsed.success) {
        const cleaned = parsed.data.text.replaceAll("[REDACTED]", "").trim();
        if (cleaned) chunks.push(cleaned);
      }
    }
  }
  return chunks.join("\n\n");
}

// Tooltip text shared by Edit + Undo when the assistant's reply touched
// workspace files / spawned background tasks / called MCP tools — none of
// which we roll back when truncating the transcript.
const SIDE_EFFECT_WARNING =
  "Files Claw wrote, edits Claw made, and tasks Claw spawned won't be undone.";

function MessageActions({
  message,
  isUser,
  onEdit,
  onRevert,
  hasSideEffects,
}: {
  message: UIMessage;
  isUser: boolean;
  onEdit?: (text: string) => void;
  onRevert?: () => void;
  hasSideEffects?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const id = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(id);
  }, [copied]);

  const handleCopy = async () => {
    const text = messageToPlainText(message);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch (err) {
      console.warn("[chat] copy failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const canCopy = messageToPlainText(message).length > 0;
  // Render the action row whenever any action is available — Copy is
  // text-only, but Edit/Undo can be useful even on tool-only assistant
  // messages (e.g. a turn that wrote a file and said nothing).
  const showRow = canCopy || onEdit || onRevert;
  if (!showRow) return null;

  return (
    <div
      className={[
        "chat-footer mt-1 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100",
        isUser ? "justify-end" : "justify-start",
      ].join(" ")}
    >
      {canCopy ? (
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="btn btn-ghost btn-xs gap-1 text-base-content/60 hover:text-base-content"
          aria-label={copied ? "Copied" : "Copy message"}
          title={copied ? "Copied" : "Copy message"}
        >
          {copied ? (
            <>
              <Check size={12} /> Copied
            </>
          ) : (
            <>
              <Copy size={12} /> Copy
            </>
          )}
        </button>
      ) : null}
      {onEdit ? (
        <button
          type="button"
          onClick={() => {
            const text = messageUserText(message);
            onEdit(text);
          }}
          className="btn btn-ghost btn-xs gap-1 text-base-content/60 hover:text-base-content"
          aria-label="Edit message"
          title={
            hasSideEffects
              ? `Edit message — ${SIDE_EFFECT_WARNING}`
              : "Edit and resend"
          }
        >
          <Pencil size={12} /> Edit
          {hasSideEffects ? (
            <AlertTriangle size={12} className="text-warning" />
          ) : null}
        </button>
      ) : null}
      {onRevert ? (
        <button
          type="button"
          onClick={onRevert}
          className="btn btn-ghost btn-xs gap-1 text-base-content/60 hover:text-base-content"
          aria-label="Undo last turn"
          title={
            hasSideEffects
              ? `Undo last turn — ${SIDE_EFFECT_WARNING}`
              : "Undo last turn"
          }
        >
          <Undo2 size={12} /> Undo
          {hasSideEffects ? (
            <AlertTriangle size={12} className="text-warning" />
          ) : null}
        </button>
      ) : null}
    </div>
  );
}

// File-link pills are extracted heuristically from backtick-quoted paths in
// the assistant's text. We verify the file actually exists before rendering a
// clickable pill — otherwise a hallucinated "I've created foo.md" produces a
// pill that 404s. Missing files render nothing, so the user can see that a
// claimed write didn't actually happen.
function FileLinkPill({ path }: { path: string }) {
  const slug = useCurrentAgentSlug();
  const safePath = path.replace(/^\/+/, "");
  const isCore = CORE_FILE_PATHS.has(safePath);
  // Core files are always resolvable (falling back to bundled defaults), so
  // skip the existence check for them. For workspace files, the cached
  // query lets multiple pills for the same path dedupe to one HTTP call.
  const fileQ = useWorkspaceFile(slug, safePath, { enabled: !isCore });
  const exists = isCore
    ? true
    : fileQ.isFetched
      ? fileQ.data !== null
      : null;

  if (exists === false) return null;

  const back = withBack({ href: `/agent/${slug}`, label: "chat" });

  if (isCore) {
    return (
      <Link
        to="/agent/$slug/identity/$file"
        params={{ slug, file: safePath }}
        state={back}
        className="badge badge-primary badge-outline my-1 gap-1.5 px-3 py-1.5 text-xs no-underline hover:bg-primary/10"
      >
        <FileText size={12} />
        {safePath}
      </Link>
    );
  }

  const encoded = safePath
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/");

  const isLoading = exists === null;
  return (
    <Link
      to="/agent/$slug/workspace/$"
      params={{ slug, _splat: encoded }}
      state={back}
      className={[
        "badge badge-primary my-1 gap-1.5 px-3 py-1.5 text-xs no-underline",
        isLoading
          ? "badge-outline opacity-60"
          : "badge-outline hover:bg-primary/10",
      ].join(" ")}
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

const REASONING_PROSE_CLASSES = [
  "prose prose-sm max-w-none break-words opacity-80",
  "prose-p:my-1 prose-p:leading-relaxed prose-p:text-base-content/70",
  "prose-em:font-medium prose-em:text-amber-600 dark:prose-em:text-amber-400",
  "prose-strong:text-rose-600 dark:prose-strong:text-rose-400",
  "prose-code:border-0 prose-code:bg-transparent prose-code:px-0.5 prose-code:text-rose-600 dark:prose-code:text-rose-400",
  "prose-headings:font-semibold prose-headings:text-base-content/70",
  "prose-li:text-base-content/70",
  "prose-a:text-primary",
].join(" ");

// Opencode-style reasoning block: one inline block per reasoning part.
// Default is collapsed — the raw thinking is noisy, and most users care about
// the agent's final output, not its scratch pad. Users who do want to see it
// can either click a single block to expand (via <details>) or flip the
// "Show thinking" preference in Settings to expand all of them by default.
// The string `_Thinking:_ ` is prepended so the italic label and any
// model-written `**bold header**` flow through the markdown renderer together.
function ReasoningBlock({ text }: { text: string }) {
  const [showThinking] = useShowThinking();
  // Some providers (e.g. OpenRouter) interleave `[REDACTED]` placeholders in
  // the reasoning stream — opencode strips them; we do the same.
  const cleaned = text.replaceAll("[REDACTED]", "").trim();
  if (!cleaned) return null;

  if (showThinking) {
    return (
      <div className="my-2 border-l-2 border-base-300 pl-3">
        <div className={REASONING_PROSE_CLASSES}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {"_Thinking:_ " + cleaned}
          </ReactMarkdown>
        </div>
      </div>
    );
  }

  return (
    <details className="group my-1.5">
      <summary className="flex cursor-pointer select-none list-none items-center gap-1.5 text-xs italic text-amber-600/90 hover:text-amber-600 dark:text-amber-400/90 dark:hover:text-amber-400">
        <ChevronRight
          size={12}
          className="transition-transform group-open:rotate-90"
        />
        Thinking
      </summary>
      <div className="mt-1.5 border-l-2 border-base-300 pl-3">
        <div className={REASONING_PROSE_CLASSES}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{cleaned}</ReactMarkdown>
        </div>
      </div>
    </details>
  );
}

// Small banner above an assistant message that the agent generated in
// response to a background task finishing — reminds the user the reply isn't
// a direct response to *their* last message and links back to the task.
function BackgroundTaskHeader({
  source,
}: {
  source: { taskId: string; taskKind: string; status: "done" | "error" };
}) {
  const slug = useCurrentAgentSlug();
  return (
    <div className="-mx-5 -mt-4 mb-3 flex items-center gap-2 border-b border-base-300 bg-base-200/40 px-5 py-2 text-xs text-base-content/70">
      <Sparkles size={12} className="text-primary" />
      <span>From background task</span>
      <Link
        to="/agent/$slug/background-tasks/$taskId"
        params={{ slug, taskId: source.taskId }}
        className="font-mono text-primary hover:underline"
      >
        {source.taskKind}
      </Link>
      {source.status === "error" ? (
        <span className="text-error">(failed)</span>
      ) : null}
    </div>
  );
}

export default function MessageView({
  message,
  turnEnded,
  onEdit,
  onRevert,
  hasSideEffects,
  backgroundTaskSource,
}: Props) {
  const isUser = message.role === "user";
  return (
    // Messages share the same background and border; the role is carried by
    // a 3px left stripe (primary = assistant, accent = user) and by a subtle
    // left indent on user messages, replacing the old SMS-style right-align.
    // `group` powers the hover-reveal on MessageActions.
    <div
      className={["group", isUser ? "pl-6 sm:pl-16 md:pl-24" : ""].join(" ")}
    >
      <div
        className={[
          // Squared corners so the 3px left stripe runs edge-to-edge instead
          // of bending around a border-radius.
          "border border-base-300 bg-base-100 px-5 py-4 text-base-content",
          "border-l-[3px]",
          isUser ? "border-l-accent" : "border-l-primary",
        ].join(" ")}
      >
        {backgroundTaskSource ? (
          <BackgroundTaskHeader source={backgroundTaskSource} />
        ) : null}
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
            return (
              <ToolPart key={idx} part={tool.data} turnEnded={turnEnded} />
            );
          }
          return null;
        })}
      </div>
      <MessageActions
        message={message}
        isUser={isUser}
        onEdit={onEdit}
        onRevert={onRevert}
        hasSideEffects={hasSideEffects}
      />
    </div>
  );
}
