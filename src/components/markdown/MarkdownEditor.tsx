import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo,
  Strikethrough,
  Undo,
} from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";

interface Props {
  value: string;
  onChange: (next: string) => void;
  /** Approximate number of lines of visible editor area (min-height hint). */
  rows?: number;
}

const PROSE_CLASSES = [
  "prose prose-sm max-w-none break-words",
  "prose-headings:text-base-content prose-headings:font-semibold",
  "prose-p:text-base-content prose-p:leading-relaxed",
  "prose-a:text-primary prose-strong:text-base-content",
  "prose-code:rounded prose-code:bg-base-200 prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[0.85em] prose-code:before:content-none prose-code:after:content-none",
  "prose-pre:border prose-pre:border-base-300 prose-pre:bg-base-200",
  "prose-li:text-base-content",
].join(" ");

export default function MarkdownEditor({ value, onChange, rows }: Props) {
  // Track the last markdown string we emitted so we can distinguish
  // "parent echoed our change back" from "parent pushed a new value at us".
  // Without this the `value` prop change from our own onChange would loop
  // through setContent and reset the cursor on every keystroke.
  const lastEmittedRef = useRef<string>(value);

  const editor = useEditor({
    // immediatelyRender: false avoids SSR hydration mismatches under
    // TanStack Start. The editor renders client-side on first effect tick.
    immediatelyRender: false,
    // Re-render the React tree on every transaction so toolbar active
    // states (bold/italic/heading level) stay in sync with the selection.
    shouldRerenderOnTransaction: true,
    extensions: [StarterKit, Markdown],
    content: value,
    contentType: "markdown",
    editorProps: {
      attributes: {
        class: [
          PROSE_CLASSES,
          "px-4 py-3 focus:outline-none",
          "[&_.ProseMirror-focused]:outline-none",
        ].join(" "),
        // Fall back to ~18 rows (matching the previous textarea default)
        // when no explicit row count is supplied.
        style: `min-height: ${(rows ?? 18) * 1.5}rem;`,
      },
    },
    onUpdate({ editor: instance }) {
      const md = instance.getMarkdown();
      lastEmittedRef.current = md;
      onChange(md);
    },
  });

  // Sync external value -> editor. Skip when value matches what we just
  // emitted (avoids cursor jumps during typing) and when value matches the
  // current editor content (avoids no-op re-renders).
  useEffect(() => {
    if (!editor) return;
    if (value === lastEmittedRef.current) return;
    const current = editor.getMarkdown();
    if (current === value) {
      lastEmittedRef.current = value;
      return;
    }
    lastEmittedRef.current = value;
    editor.commands.setContent(value, {
      contentType: "markdown",
      emitUpdate: false,
    });
  }, [value, editor]);

  return (
    <div className="overflow-hidden rounded-box border border-base-300 bg-base-100">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor | null }) {
  const disabled = !editor;

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-base-300 bg-base-200/60 px-2 py-1.5">
      <ToolbarButton
        label="Bold"
        shortcut="⌘B"
        disabled={disabled}
        active={editor?.isActive("bold") ?? false}
        onClick={() => editor?.chain().focus().toggleBold().run()}
      >
        <Bold size={14} />
      </ToolbarButton>
      <ToolbarButton
        label="Italic"
        shortcut="⌘I"
        disabled={disabled}
        active={editor?.isActive("italic") ?? false}
        onClick={() => editor?.chain().focus().toggleItalic().run()}
      >
        <Italic size={14} />
      </ToolbarButton>
      <ToolbarButton
        label="Strikethrough"
        disabled={disabled}
        active={editor?.isActive("strike") ?? false}
        onClick={() => editor?.chain().focus().toggleStrike().run()}
      >
        <Strikethrough size={14} />
      </ToolbarButton>
      <ToolbarButton
        label="Inline code"
        shortcut="⌘E"
        disabled={disabled}
        active={editor?.isActive("code") ?? false}
        onClick={() => editor?.chain().focus().toggleCode().run()}
      >
        <Code size={14} />
      </ToolbarButton>

      <ToolbarDivider />

      <ToolbarButton
        label="Heading 1"
        disabled={disabled}
        active={editor?.isActive("heading", { level: 1 }) ?? false}
        onClick={() =>
          editor?.chain().focus().toggleHeading({ level: 1 }).run()
        }
      >
        <Heading1 size={14} />
      </ToolbarButton>
      <ToolbarButton
        label="Heading 2"
        disabled={disabled}
        active={editor?.isActive("heading", { level: 2 }) ?? false}
        onClick={() =>
          editor?.chain().focus().toggleHeading({ level: 2 }).run()
        }
      >
        <Heading2 size={14} />
      </ToolbarButton>
      <ToolbarButton
        label="Heading 3"
        disabled={disabled}
        active={editor?.isActive("heading", { level: 3 }) ?? false}
        onClick={() =>
          editor?.chain().focus().toggleHeading({ level: 3 }).run()
        }
      >
        <Heading3 size={14} />
      </ToolbarButton>

      <ToolbarDivider />

      <ToolbarButton
        label="Bullet list"
        disabled={disabled}
        active={editor?.isActive("bulletList") ?? false}
        onClick={() => editor?.chain().focus().toggleBulletList().run()}
      >
        <List size={14} />
      </ToolbarButton>
      <ToolbarButton
        label="Numbered list"
        disabled={disabled}
        active={editor?.isActive("orderedList") ?? false}
        onClick={() => editor?.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered size={14} />
      </ToolbarButton>
      <ToolbarButton
        label="Blockquote"
        disabled={disabled}
        active={editor?.isActive("blockquote") ?? false}
        onClick={() => editor?.chain().focus().toggleBlockquote().run()}
      >
        <Quote size={14} />
      </ToolbarButton>
      <ToolbarButton
        label="Horizontal rule"
        disabled={disabled}
        onClick={() => editor?.chain().focus().setHorizontalRule().run()}
      >
        <Minus size={14} />
      </ToolbarButton>

      <ToolbarDivider />

      <ToolbarButton
        label="Undo"
        shortcut="⌘Z"
        disabled={disabled || !editor?.can().undo()}
        onClick={() => editor?.chain().focus().undo().run()}
      >
        <Undo size={14} />
      </ToolbarButton>
      <ToolbarButton
        label="Redo"
        shortcut="⇧⌘Z"
        disabled={disabled || !editor?.can().redo()}
        onClick={() => editor?.chain().focus().redo().run()}
      >
        <Redo size={14} />
      </ToolbarButton>
    </div>
  );
}

interface ToolbarButtonProps {
  label: string;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}

function ToolbarButton({
  label,
  shortcut,
  active,
  disabled,
  onClick,
  children,
}: ToolbarButtonProps) {
  const title = shortcut ? `${label} (${shortcut})` : label;
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        // Prevent the button from stealing focus from the editor, which
        // would drop the current selection and make toggleMark etc. no-op.
        e.preventDefault();
      }}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={label}
      aria-pressed={active}
      className={[
        "btn btn-ghost btn-xs btn-square",
        active ? "btn-active" : "",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function ToolbarDivider() {
  return <span className="mx-1 h-4 w-px bg-base-300" aria-hidden="true" />;
}
