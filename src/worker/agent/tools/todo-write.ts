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
    description: `Maintain a per-turn checklist that externalizes a multi-step plan. Returns the list back so it shows up in the conversation thread.

When to call:
- Any turn that has three or more logical steps (research → save → summarize, connect-MCP → list-pages → pull-summary, etc.).
- The user gave you a numbered or comma-separated list of asks.
- You're about to do something complex enough you'd otherwise lose track of where you are.

When NOT to call:
- Single-step asks ("what's X", "save these notes to Y").
- Purely conversational turns.
- Turns you've already routed to \`spawn_background_task\` — the worker handles its own tracking.

Rules (these matter — drift here is the most common cause of skipped steps and false "I'm done" claims):
- Call \`todo_write\` *before* you start the work, with all items in \`pending\` and the first one flipped to \`in_progress\`. Don't do step 1 first and then write the list.
- Flip an item to \`completed\` *immediately* after it lands — same turn, before doing anything else. Never batch completions at the end.
- Only one item may be \`in_progress\` at a time. Finish or cancel the current one before starting the next.
- Cancel items that became irrelevant; never silently drop them. \`cancelled\` is a real status — use it.
- Send the full updated list every call (you replace the previous list, you don't merge into it).
- Don't claim the turn is finished while any item is still \`pending\` or \`in_progress\` — either complete it, cancel it, or tell the user honestly what's left.

Status values: \`pending\` | \`in_progress\` | \`completed\` | \`cancelled\`.`,
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
