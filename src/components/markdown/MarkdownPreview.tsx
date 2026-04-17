import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Props {
  source: string;
  className?: string;
}

export default function MarkdownPreview({ source, className }: Props) {
  return (
    <div
      className={[
        "prose prose-sm max-w-none break-words",
        "prose-headings:font-semibold prose-headings:text-[var(--sea-ink)]",
        "prose-p:text-[var(--sea-ink)] prose-p:leading-relaxed",
        "prose-a:text-[var(--lagoon-deep)] prose-strong:text-[var(--sea-ink)]",
        "prose-code:rounded prose-code:bg-[var(--chip-bg)] prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[0.85em] prose-code:before:content-none prose-code:after:content-none",
        "prose-pre:border prose-pre:border-[var(--line)] prose-pre:bg-[var(--surface-strong)]",
        "prose-li:text-[var(--sea-ink)]",
        className ?? "",
      ].join(" ")}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{source}</ReactMarkdown>
    </div>
  );
}
