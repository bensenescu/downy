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
        "prose-headings:text-base-content prose-headings:font-semibold",
        "prose-p:text-base-content prose-p:leading-relaxed",
        "prose-a:text-primary prose-strong:text-base-content",
        "prose-code:rounded prose-code:bg-base-200 prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[0.85em] prose-code:text-base-content prose-code:before:content-none prose-code:after:content-none",
        "prose-pre:border prose-pre:border-base-300 prose-pre:bg-base-200 prose-pre:text-base-content",
        "prose-li:text-base-content",
        className ?? "",
      ].join(" ")}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ node: _node, ...props }) => (
            <div className="my-4 overflow-x-auto">
              <table {...props} className="my-0" />
            </div>
          ),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
