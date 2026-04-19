import type { UIMessage } from "ai";
import { Check, ChevronRight, Copy, FileText, Trash2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { z } from "zod";

import { readWorkspaceFile } from "../../lib/api-client";
import { useShowThinking } from "../../lib/preferences";
import {
  IDENTITY_PATH,
  MEMORY_PATH,
  SOUL_PATH,
  USER_PATH,
} from "../../worker/agent/core-files";
import MarkdownPreview from "../markdown/MarkdownPreview";
import ToolPart, { ToolPartSchema } from "./ToolParts";

const CORE_FILE_PATHS = new Set<string>([
  SOUL_PATH,
  IDENTITY_PATH,
  USER_PATH,
  MEMORY_PATH,
]);

interface Props {
  message: UIMessage;
  turnEnded: boolean;
  onDelete?: (messageId: string) => void | Promise<void>;
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

function MessageActions({
  message,
  isUser,
  onDelete,
}: {
  message: UIMessage;
  isUser: boolean;
  onDelete?: (messageId: string) => void | Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Auto-revert both transient states. Copy flashes for feedback; the delete
  // confirmation times out so an accidental arm doesn't linger and catch the
  // user off guard the next time they mouse over the bubble.
  useEffect(() => {
    if (!copied) return undefined;
    const id = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(id);
  }, [copied]);
  useEffect(() => {
    if (!confirmingDelete) return undefined;
    const id = setTimeout(() => setConfirmingDelete(false), 3000);
    return () => clearTimeout(id);
  }, [confirmingDelete]);

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

  const handleDelete = async () => {
    if (!onDelete || deleting) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setConfirmingDelete(false);
    setDeleting(true);
    try {
      await onDelete(message.id);
    } catch (err) {
      console.warn("[chat] delete failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      setDeleting(false);
    }
    // On success the message unmounts, so no `setDeleting(false)` needed.
  };

  const canCopy = messageToPlainText(message).length > 0;

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
      {onDelete ? (
        <button
          type="button"
          onClick={() => void handleDelete()}
          disabled={deleting}
          className={[
            "btn btn-ghost btn-xs gap-1",
            confirmingDelete
              ? "text-error hover:text-error"
              : "text-base-content/60 hover:text-error",
          ].join(" ")}
          aria-label={confirmingDelete ? "Confirm delete" : "Delete message"}
          title={confirmingDelete ? "Click again to confirm" : "Delete message"}
        >
          <Trash2 size={12} />
          {deleting ? "Deleting…" : confirmingDelete ? "Confirm?" : "Delete"}
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
  const safePath = path.replace(/^\/+/, "");
  const isCore = CORE_FILE_PATHS.has(safePath);
  // Core files are always resolvable (falling back to bundled defaults), so
  // skip the existence check for them.
  const [exists, setExists] = useState<boolean | null>(isCore ? true : null);

  useEffect(() => {
    if (isCore) return undefined;
    let cancelled = false;
    readWorkspaceFile(safePath)
      .then((file) => {
        if (!cancelled) setExists(file !== null);
      })
      .catch((err: unknown) => {
        console.warn("[chat] FileLinkPill existence check failed", {
          path: safePath,
          error: err instanceof Error ? err.message : String(err),
        });
        if (!cancelled) setExists(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isCore, safePath]);

  if (exists === false) return null;

  if (isCore) {
    return (
      <Link
        to="/settings/$file"
        params={{ file: safePath }}
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
      to="/workspace/$"
      params={{ _splat: encoded }}
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

export default function MessageView({ message, turnEnded, onDelete }: Props) {
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
      <MessageActions message={message} isUser={isUser} onDelete={onDelete} />
    </div>
  );
}
