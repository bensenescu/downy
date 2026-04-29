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

// Stateless: the tool just echoes the new list (after a couple of cheap
// invariant checks) so it lands in the conversation as a normal tool result.
// The model holds the canonical state in its own message history; the UI
// can render the tool call/result as a checklist when it's ready to.
export function createTodoWriteTool() {
  return tool({
    description: `Maintain a per-turn checklist for multi-step work (3+ logical steps). Each call replaces the previous list — always send all items. Statuses: \`pending\` | \`in_progress\` | \`completed\` | \`cancelled\`. Only one item may be \`in_progress\` at a time. See the system prompt for when to call and how to drive the checklist through a turn.`,
    inputSchema,
    execute: async ({ todos }) => {
      const inProgress = todos.filter((t) => t.status === "in_progress");
      if (inProgress.length > 1) {
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
      return { todos, counts };
    },
  });
}
