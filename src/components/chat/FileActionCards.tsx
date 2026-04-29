import {
  AlertCircle,
  Check,
  ChevronRight,
  FileX,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";

import MarkdownPreview from "../markdown/MarkdownPreview";
import type { RenderStatus, ToolPart } from "./tool-part-types";

// Inputs are parsed permissively: during `input-streaming` the model has only
// emitted part of the JSON, so even `path` may not be available on the first
// render. We show fields as they appear instead of forcing a placeholder.
const WriteInputSchema = z.object({
  path: z.string().optional(),
  content: z.string().optional(),
});
const EditInputSchema = z.object({
  path: z.string().optional(),
  old_string: z.string().optional(),
  new_string: z.string().optional(),
});
const DeleteInputSchema = z.object({
  path: z.string().optional(),
  recursive: z.boolean().optional(),
});

const WriteOutputSchema = z.object({
  path: z.string(),
  bytesWritten: z.number().optional(),
  lines: z.number().optional(),
});
const EditOutputSchema = z.object({
  path: z.string().optional(),
  created: z.boolean().optional(),
  replaced: z.boolean().optional(),
  fuzzyMatch: z.boolean().optional(),
  lines: z.number().optional(),
});
const DeleteOutputSchema = z.object({
  deleted: z.string(),
});

export default function FileActionCard({
  part,
  name,
  status,
}: {
  part: ToolPart;
  name: string;
  status: RenderStatus;
}) {
  if (name === "write") {
    return <WriteCard part={part} status={status} />;
  }
  if (name === "edit") {
    return <EditCard part={part} status={status} />;
  }
  return <DeleteCard part={part} status={status} />;
}

function cardShell(isError: boolean, isDone: boolean): string {
  // `min-w-[min(22rem,100%)]` keeps all file-action cards at a consistent
  // width across streaming / done states — the chat bubble that contains
  // them is content-sized, so without a min-width, a card missing its path
  // chip would render visibly narrower than its siblings.
  return [
    "my-1.5 w-full min-w-[min(22rem,100%)] max-w-full overflow-hidden rounded-lg border text-left",
    isError
      ? "border-error/50 bg-error/5"
      : isDone
        ? "border-base-300 bg-base-200/40"
        : "border-base-300/60 bg-base-200/30",
  ].join(" ");
}

// Latches the path once we've seen it. The AI SDK re-parses partial JSON as
// tool inputs stream in, and intermediate re-parses can transiently drop the
// `path` field — without latching, the chip appears then flickers out. Once a
// concrete path arrives we keep rendering it even if a later partial drops it.
function useStickyPath(path: string | undefined): string | undefined {
  const [sticky, setSticky] = useState(path);
  useEffect(() => {
    if (path && path !== sticky) setSticky(path);
  }, [path, sticky]);
  return path ?? sticky;
}

// Emit a console.warn when a file-action card stays in the pending state for
// longer than `STUCK_THRESHOLD_MS` — something has gone wrong on the server
// side (tool call emitted but never resolved, or the SDK's stream closed
// without a final state). The warning includes the full tool part so we can
// diagnose without having to re-repro.
const STUCK_THRESHOLD_MS = 30_000;

function useStuckToolWarning(part: ToolPart, isDone: boolean): void {
  useEffect(() => {
    if (isDone) return undefined;
    const started = Date.now();
    const timer = setTimeout(() => {
      console.warn("[chat] tool call stuck in pending state", {
        type: part.type,
        state: part.state,
        elapsedMs: Date.now() - started,
        input: part.input,
        output: part.output,
        errorText: part.errorText,
      });
    }, STUCK_THRESHOLD_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [isDone, part.type, part.state, part.input, part.output, part.errorText]);
}

function StatusPill({
  isError,
  isDone,
  label,
}: {
  isError: boolean;
  isDone: boolean;
  label?: string;
}) {
  if (isError) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-error">
        <AlertCircle size={12} /> failed
      </span>
    );
  }
  if (!isDone) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-base-content/60">
        <span className="loading loading-dots loading-xs text-primary" />
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-success">
      <Check size={12} />
      {label ?? "done"}
    </span>
  );
}

function WriteCard({ part, status }: { part: ToolPart; status: RenderStatus }) {
  const input = WriteInputSchema.safeParse(part.input).data;
  const output = WriteOutputSchema.safeParse(part.output).data;
  const path = useStickyPath(input?.path ?? output?.path);
  const content = input?.content ?? "";
  const { isDone, isError, errorText } = status;
  const lines = output?.lines ?? (content ? content.split("\n").length : 0);
  useStuckToolWarning(part, isDone);

  const verb = !isDone ? "Writing" : isError ? "Write failed" : "Wrote";
  const summary =
    !isError && isDone && lines ? `${String(lines)} lines` : undefined;

  return (
    <details className={cardShell(isError, isDone)}>
      <summary className="flex cursor-pointer select-none list-none items-center gap-2 px-3 py-2">
        <Plus size={14} className="shrink-0 opacity-70" />
        <span className="text-sm font-medium">{verb}</span>
        {path ? <PathChip path={path} /> : null}
        {summary ? (
          <span className="text-xs text-base-content/60">· {summary}</span>
        ) : null}
        <span className="ml-auto flex items-center gap-1.5">
          <StatusPill isError={isError} isDone={isDone} />
          {(isDone && content) || isError ? (
            <ChevronRight
              size={14}
              className="opacity-60 transition-transform [details[open]_&]:rotate-90"
            />
          ) : null}
        </span>
      </summary>
      {isError ? (
        <ErrorBody errorText={errorText} />
      ) : isDone && content ? (
        // Defer the markdown render until the tool call is done. Re-parsing
        // markdown on every streamed chunk for a large file is slower than
        // the chunk rate, queueing renders faster than React can commit and
        // eventually tripping the "Maximum update depth exceeded" guard.
        // The <details> body is hidden until expanded anyway, so deferring
        // costs nothing visible.
        <FilePreview content={content} path={path ?? ""} />
      ) : null}
    </details>
  );
}

function EditCard({ part, status }: { part: ToolPart; status: RenderStatus }) {
  const input = EditInputSchema.safeParse(part.input).data;
  const output = EditOutputSchema.safeParse(part.output).data;
  const path = useStickyPath(input?.path ?? output?.path);
  const { isDone, isError, errorText } = status;
  useStuckToolWarning(part, isDone);

  const verb = !isDone
    ? "Editing"
    : isError
      ? "Edit failed"
      : output?.created
        ? "Created"
        : "Edited";
  const summary =
    !isError && isDone && output
      ? output.created
        ? output.lines
          ? `${String(output.lines)} lines`
          : undefined
        : output.replaced
          ? output.fuzzyMatch
            ? "replaced (fuzzy)"
            : "replaced"
          : undefined
      : undefined;

  const hasDiff = Boolean(input?.old_string || input?.new_string);

  return (
    <details className={cardShell(isError, isDone)}>
      <summary className="flex cursor-pointer select-none list-none items-center gap-2 px-3 py-2">
        <Pencil size={14} className="shrink-0 opacity-70" />
        <span className="text-sm font-medium">{verb}</span>
        {path ? <PathChip path={path} /> : null}
        {summary ? (
          <span className="text-xs text-base-content/60">· {summary}</span>
        ) : null}
        <span className="ml-auto flex items-center gap-1.5">
          <StatusPill isError={isError} isDone={isDone} />
          {(isDone && hasDiff) || isError ? (
            <ChevronRight
              size={14}
              className="opacity-60 transition-transform [details[open]_&]:rotate-90"
            />
          ) : null}
        </span>
      </summary>
      {isError ? (
        <ErrorBody errorText={errorText} />
      ) : isDone && hasDiff ? (
        // Same reasoning as WriteCard — defer the diff body until done so
        // we don't re-render a large diff on every streamed chunk.
        <DiffBody
          oldText={input?.old_string ?? ""}
          newText={input?.new_string ?? ""}
        />
      ) : null}
    </details>
  );
}

function DeleteCard({
  part,
  status,
}: {
  part: ToolPart;
  status: RenderStatus;
}) {
  const input = DeleteInputSchema.safeParse(part.input).data;
  const output = DeleteOutputSchema.safeParse(part.output).data;
  const path = useStickyPath(output?.deleted ?? input?.path);
  const { isDone, isError, errorText } = status;
  useStuckToolWarning(part, isDone);
  const verb = !isDone ? "Deleting" : isError ? "Delete failed" : "Deleted";

  const Wrapper: "details" | "div" = isError ? "details" : "div";

  return (
    <Wrapper className={cardShell(isError, isDone)}>
      <div className="flex items-center gap-2 px-3 py-2">
        {isDone && !isError ? (
          <Trash2 size={14} className="shrink-0 opacity-70" />
        ) : (
          <FileX size={14} className="shrink-0 opacity-70" />
        )}
        <span className="text-sm font-medium">{verb}</span>
        {path ? <PathChip path={path} /> : null}
        <span className="ml-auto">
          <StatusPill isError={isError} isDone={isDone} />
        </span>
      </div>
      {isError ? <ErrorBody errorText={errorText} /> : null}
    </Wrapper>
  );
}

function PathChip({ path }: { path: string }) {
  return (
    <code className="truncate rounded bg-base-300/50 px-1.5 py-0.5 text-xs">
      {path}
    </code>
  );
}

function FilePreview({ content, path }: { content: string; path: string }) {
  const isMarkdown = path.toLowerCase().endsWith(".md");
  return (
    <div className="border-t border-base-300/60 px-3 py-2">
      {isMarkdown ? (
        <MarkdownPreview source={content} />
      ) : (
        <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs text-base-content/80">
          {content}
        </pre>
      )}
    </div>
  );
}

function DiffBody({ oldText, newText }: { oldText: string; newText: string }) {
  return (
    <div className="divide-y divide-base-300/60 border-t border-base-300/60 text-xs">
      <pre className="overflow-x-auto whitespace-pre-wrap break-words bg-error/5 px-3 py-2 text-error/90">
        − {oldText.replaceAll("\n", "\n  ")}
      </pre>
      <pre className="overflow-x-auto whitespace-pre-wrap break-words bg-success/5 px-3 py-2 text-success/90">
        + {newText.replaceAll("\n", "\n  ")}
      </pre>
    </div>
  );
}

function ErrorBody({ errorText }: { errorText?: string }) {
  if (!errorText) return null;
  return (
    <div className="border-t border-error/30 bg-error/5 px-3 py-2 text-xs text-error/90">
      {errorText}
    </div>
  );
}
