import { tool } from "ai";
import { getAgentByName } from "agents";
import { z } from "zod";

import { getAgent } from "../../db/profile";

const inputSchema = z.object({
  slug: z
    .string()
    .describe(
      "The slug of the peer agent to read from (matches what the user sees in the agent dropdown). Must be active — archived agents are unreachable.",
    ),
  op: z
    .enum(["describe", "list_workspace", "read_file", "read_identity"])
    .describe(
      "describe → quick name + identity summary; list_workspace → file list (optionally filtered by path prefix); read_file → contents at `path`; read_identity → SOUL/IDENTITY/MEMORY contents.",
    ),
  path: z
    .string()
    .optional()
    .describe(
      "Required for `read_file`. Optional prefix for `list_workspace`. Ignored otherwise.",
    ),
});

const PEER_READ_TURN_LIMIT = 20;

/**
 * CodeMode wrapper around peer-agent reads. Lives inside the `execute` sandbox
 * so the model can fan out across peers + paths in a single `Promise.all`
 * snippet rather than emitting one tool call per file.
 *
 * The actual reads happen on the peer's own `DownyAgent` DO via RPC —
 * privacy enforcement lives on the read methods themselves, not here, so a
 * future caller of the RPC can't bypass it. This tool only handles dispatch:
 * slug validation, archive check, self-loop guard, per-turn rate limit.
 */
export function createReadPeerAgentTool(args: {
  env: Cloudflare.Env;
  parentSlug: string;
  bumpCount: () => number;
}) {
  return tool({
    description:
      "Read another agent's workspace or identity files. The user has multiple named agents (e.g. linkedin, vc); when they ask you to reference one of them, use this tool. Read-only. Use the `## Peer agents` section of the system prompt to find valid slugs.",
    inputSchema,
    execute: async ({ slug, op, path }) => {
      if (slug === args.parentSlug) {
        return { error: "Cannot peer-read your own agent." };
      }
      const used = args.bumpCount();
      if (used > PEER_READ_TURN_LIMIT) {
        return {
          error: `Per-turn peer-read limit (${String(PEER_READ_TURN_LIMIT)}) exceeded.`,
        };
      }
      const target = await getAgent(args.env.DB, slug);
      if (!target) {
        return { error: `Unknown agent: ${slug}` };
      }
      if (target.archivedAt !== null) {
        return { error: `Agent is archived: ${slug}` };
      }

      const stub = await getAgentByName(args.env.DownyAgent, slug);
      try {
        switch (op) {
          case "describe":
            return { result: await stub.peerDescribe() };
          case "list_workspace":
            return { result: await stub.peerListWorkspace(path) };
          case "read_file":
            if (!path) {
              return { error: "`path` is required for op=read_file." };
            }
            return { result: await stub.peerReadFile(path) };
          case "read_identity":
            return { result: await stub.peerReadIdentityFiles() };
          default:
            return { error: `Unknown op: ${String(op)}` };
        }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  });
}
