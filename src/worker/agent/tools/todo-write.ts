import { tool } from "ai";
import { z } from "zod";

const TodoStatus = z.enum(["pending", "in_progress", "completed", "cancelled"]);

const TodoItem = z.object({
  content: z
    .string()
    .min(1)
    .describe(
      "Imperative one-liner describing the step (e.g. 'Scrape three VC blog posts on agent infra').",
    ),
  status: TodoStatus.describe(
    "pending | in_progress | completed | cancelled. Only one item may be 'in_progress' at a time.",
  ),
});

const inputSchema = z.object({
  todos: z
    .array(TodoItem)
    .describe(
      "The full updated todo list. Each call replaces the previous list — always send all items, including the ones that are already 'completed' or 'cancelled'.",
    ),
});

export type TodoStatusValue = z.infer<typeof TodoStatus>;
export type TodoItemValue = z.infer<typeof TodoItem>;

// Persisted shape kept on each agent's DO storage. Read every turn in
// `beforeTurn` and rendered into the system prompt as `## Active plan` so
// the model has one canonical slot — not a stack of historical tool results.
export type ActivePlan = {
  todos: TodoItemValue[];
  updatedAt: number;
};

// The tool replaces the list on each call (no merge), and we persist the
// latest list to DO storage via `setActivePlan`. Older `todo_write` results
// also survive in message history, but the model has to scan history to
// find the current one; the persisted copy gives it a stable slot.
export function createTodoWriteTool({
  setActivePlan,
}: {
  setActivePlan: (plan: ActivePlan | null) => Promise<void>;
}) {
  return tool({
    description: `Maintain a per-turn checklist for multi-step work (3+ logical steps). Each call replaces the previous list — always send all items. Statuses: \`pending\` | \`in_progress\` | \`completed\` | \`cancelled\`. Only one item may be \`in_progress\` at a time. See the system prompt for when to call and how to drive the checklist through a turn.`,
    inputSchema,
    execute: async ({ todos }) => {
      const inProgress = todos.filter((t) => t.status === "in_progress");
      if (inProgress.length > 1) {
        // Don't update persistence on invariant failure — keep the previous
        // valid plan around so the system-prompt section doesn't go stale on
        // a botched call. The model will repair the list on its next attempt.
        return {
          error: `${String(inProgress.length)} items are 'in_progress' at once. Only one item may be 'in_progress' at a time — complete or cancel the others first.`,
          todos,
        };
      }
      const counts = {
        pending: todos.filter((t) => t.status === "pending").length,
        in_progress: inProgress.length,
        completed: todos.filter((t) => t.status === "completed").length,
        cancelled: todos.filter((t) => t.status === "cancelled").length,
      };
      const allDone = counts.pending === 0 && counts.in_progress === 0;
      // Clear when nothing is open — otherwise the section lingers across
      // unrelated future turns and clutters the prompt.
      await setActivePlan(allDone ? null : { todos, updatedAt: Date.now() });
      return { todos, counts };
    },
  });
}
