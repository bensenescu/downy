import {
  AlertCircle,
  Check,
  Code2,
  FileText,
  Globe,
  Search,
} from "lucide-react";
import { z } from "zod";

import FileActionCard from "./FileActionCards";
import {
  deriveRenderStatus,
  type RenderStatus,
  type ToolPart,
} from "./tool-part-types";

function toolName(part: ToolPart): string {
  return part.type.replace(/^tool-/, "").replace(/^dynamic-tool-/, "");
}

const FILE_MUTATING = new Set(["write", "edit", "delete"]);

export default function ToolPart({
  part,
  turnEnded,
}: {
  part: ToolPart;
  turnEnded: boolean;
}) {
  const name = toolName(part);
  const status = deriveRenderStatus(part, turnEnded);
  if (FILE_MUTATING.has(name)) {
    return <FileActionCard part={part} name={name} status={status} />;
  }
  return <ReadOnlyToolChip part={part} name={name} status={status} />;
}

const ReadOnlyInputSchema = z.object({
  query: z.string().optional(),
  url: z.string().optional(),
  path: z.string().optional(),
  pattern: z.string().optional(),
  code: z.string().optional(),
});

function readOnlyInputPreview(input: unknown): string | undefined {
  const parsed = ReadOnlyInputSchema.safeParse(input);
  if (!parsed.success) return undefined;
  const code = parsed.data.code;
  if (code != null) {
    // Collapse whitespace so the first line of the snippet shows in the chip.
    return code.replace(/\s+/g, " ").trim();
  }
  return (
    parsed.data.query ??
    parsed.data.url ??
    parsed.data.path ??
    parsed.data.pattern
  );
}

function readOnlyIcon(name: string) {
  if (name === "web_search") return Search;
  if (name === "web_scrape") return Globe;
  if (name === "execute") return Code2;
  return FileText;
}

function ReadOnlyToolChip({
  part,
  name,
  status,
}: {
  part: ToolPart;
  name: string;
  status: RenderStatus;
}) {
  const Icon = readOnlyIcon(name);
  const preview = readOnlyInputPreview(part.input);
  const { isDone, isError, errorText } = status;

  return (
    <div className="my-1 flex flex-col gap-1">
      <div
        className={[
          "inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-xs",
          isError
            ? "border-error/40 bg-error/10 text-error"
            : "border-base-300 bg-base-200/50 text-base-content/80",
        ].join(" ")}
      >
        <Icon size={12} className="opacity-70" />
        <span className="font-mono font-medium">{name}</span>
        {preview ? (
          <span className="max-w-[28rem] truncate opacity-80">
            {preview.length > 80 ? `${preview.slice(0, 80)}…` : preview}
          </span>
        ) : null}
        {!isDone ? (
          <span className="loading loading-dots loading-xs text-primary" />
        ) : isError ? (
          <AlertCircle size={12} />
        ) : (
          <Check size={12} className="opacity-70" />
        )}
      </div>
      {isError && errorText ? (
        <p className="pl-3 text-xs text-error/90">{errorText}</p>
      ) : null}
    </div>
  );
}
