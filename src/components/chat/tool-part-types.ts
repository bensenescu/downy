import { z } from "zod";

/**
 * The AI SDK's `UIMessagePart` union for tool parts is generic (`ToolUIPart`
 * parameterized by a `ToolSet`). Narrowing it at the call site means every
 * render path casts. Instead we parse with Zod and work in terms of the
 * narrow shape we actually touch.
 */
export const ToolPartSchema = z.object({
  type: z.string(),
  toolName: z.string().optional(),
  state: z
    .enum([
      "input-streaming",
      "input-available",
      "input-approval-requested",
      "output-available",
      "output-error",
      "output-denied",
    ])
    .optional(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  errorText: z.string().optional(),
});
export type ToolPart = z.infer<typeof ToolPartSchema>;

export interface RenderStatus {
  isDone: boolean;
  isError: boolean;
  errorText: string | undefined;
}

const ABORTED_ERROR = "Error";

/**
 * Returns the part's derived render status, finalizing a stale pending part
 * (turn already ended but the part never reached `output-*`) as an error so
 * the UI never renders a forever-spinning card.
 */
export function deriveRenderStatus(
  part: ToolPart,
  turnEnded: boolean,
): RenderStatus {
  const terminal =
    part.state === "output-available" ||
    part.state === "output-error" ||
    part.state === "output-denied";
  if (terminal) {
    return {
      isDone: true,
      isError: part.state === "output-error",
      errorText: part.errorText,
    };
  }
  if (turnEnded) {
    return {
      isDone: true,
      isError: true,
      errorText: ABORTED_ERROR,
    };
  }
  return { isDone: false, isError: false, errorText: undefined };
}
