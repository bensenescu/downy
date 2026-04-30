import type { UIMessage } from "ai";
import { Check, ChevronDown, ChevronRight, Circle } from "lucide-react";
import { useMemo, useState } from "react";
import { z } from "zod";

/**
 * Persisted todo-list panel rendered above the input (main chat) or as a
 * sticky footer (background-task chat). Reads from the message stream —
 * the latest `tool-todo_write` tool result wins. The agent also persists
 * the same shape to DO storage so the *system prompt* carries an `## Active
 * plan` section, but the UI doesn't need that round-trip; the message is
 * already authoritative for what to render.
 */

const TodoStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
  "cancelled",
]);
type TodoStatus = z.infer<typeof TodoStatusSchema>;

const TodoOutputSchema = z.object({
  todos: z.array(
    z.object({
      content: z.string(),
      status: TodoStatusSchema,
    }),
  ),
});
type TodoOutput = z.infer<typeof TodoOutputSchema>;

function findLatestTodoOutput(messages: UIMessage[]): TodoOutput | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || msg.role !== "assistant") continue;
    const parts = msg.parts;
    for (let j = parts.length - 1; j >= 0; j--) {
      const part = parts[j] as {
        type?: string;
        state?: string;
        output?: unknown;
      };
      if (part.type !== "tool-todo_write") continue;
      if (part.state !== "output-available") continue;
      const parsed = TodoOutputSchema.safeParse(part.output);
      if (!parsed.success) continue;
      return parsed.data;
    }
  }
  return null;
}

export default function TodoList({ messages }: { messages: UIMessage[] }) {
  const latest = useMemo(() => findLatestTodoOutput(messages), [messages]);
  const [collapsed, setCollapsed] = useState(false);

  if (!latest || latest.todos.length === 0) return null;

  const counts = latest.todos.reduce<Record<TodoStatus, number>>(
    (acc, t) => {
      acc[t.status] = (acc[t.status] ?? 0) + 1;
      return acc;
    },
    { pending: 0, in_progress: 0, completed: 0, cancelled: 0 },
  );
  const total = latest.todos.length;
  const done = counts.completed + counts.cancelled;
  // Mirror the agent-side behavior in `todo_write` (clears the active plan
  // from DO storage when nothing is open) so the UI doesn't linger on a
  // stale all-done checklist after the turn wraps.
  if (counts.pending === 0 && counts.in_progress === 0) return null;

  return (
    <div className="mb-2 rounded-lg border border-base-300 bg-base-200/50">
      <button
        type="button"
        onClick={() => {
          setCollapsed((v) => !v);
        }}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-base-content/70 hover:text-base-content"
      >
        {collapsed ? (
          <ChevronRight size={12} className="opacity-60" />
        ) : (
          <ChevronDown size={12} className="opacity-60" />
        )}
        <span className="font-medium">Plan</span>
        <span className="opacity-60">
          · {done}/{total} done
        </span>
        {counts.in_progress > 0 ? (
          <span className="loading loading-dots loading-xs ml-1 text-primary" />
        ) : null}
      </button>
      {collapsed ? null : (
        <ul className="space-y-1 px-3 pb-2 pt-0.5">
          {latest.todos.map((todo, idx) => (
            <TodoRow key={idx} content={todo.content} status={todo.status} />
          ))}
        </ul>
      )}
    </div>
  );
}

function TodoRow({ content, status }: { content: string; status: TodoStatus }) {
  if (status === "completed") {
    return (
      <li className="flex items-start gap-2 text-xs">
        <Check size={12} className="mt-0.5 shrink-0 text-success" />
        <span className="line-through opacity-60">{content}</span>
      </li>
    );
  }
  if (status === "in_progress") {
    return (
      <li className="flex items-start gap-2 text-xs">
        <span className="mt-0.5 shrink-0 text-primary">→</span>
        <span className="font-medium text-base-content">{content}</span>
      </li>
    );
  }
  if (status === "cancelled") {
    return (
      <li className="flex items-start gap-2 text-xs">
        <span className="mt-0.5 shrink-0 opacity-40">×</span>
        <span className="line-through opacity-40">{content}</span>
        <span className="ml-1 rounded bg-base-300/60 px-1 text-[10px] uppercase tracking-wide opacity-60">
          cancelled
        </span>
      </li>
    );
  }
  return (
    <li className="flex items-start gap-2 text-xs">
      <Circle size={10} className="mt-1 shrink-0 opacity-40" />
      <span className="opacity-80">{content}</span>
    </li>
  );
}
