import { createExecuteTool } from "@cloudflare/think/tools/execute";
import type { Workspace } from "@cloudflare/shell";
import { dynamicTool, jsonSchema, tool } from "ai";
import type { ToolSet } from "ai";
import { z } from "zod";

import type { McpToolDescriptor } from "./mcp-proxy";
import { createReadPeerAgentTool } from "./tools/read-peer-agent";
import {
  createCreateSkillTool,
  createDeleteSkillTool,
  createListSkillFilesTool,
  createListSkillsTool,
  createReadSkillTool,
  createUpdateSkillTool,
} from "./tools/skills";
import { createTodoWriteTool } from "./tools/todo-write";
import { createWebScrapeTool } from "./tools/web-scrape";
import { createWebSearchTool } from "./tools/web-search";

// Override Think's auto-registered `write`. Its parent-derivation
// (`path.replace(/\/[^/]+$/, "")`) returns the unchanged path for top-level
// files with no slash, then mkdirs it as a directory before writeFile —
// leaving a `type='directory'` row that subsequent writes can't repair.
// `Workspace.writeFile` already ensures parent dirs, so we just call it.
// TODO(@cloudflare/think>0.2.4): drop once upstream is fixed.
function createFixedWriteTool({
  getWorkspace,
}: {
  getWorkspace: () => Workspace;
}) {
  return tool({
    description:
      "Write content to a file. Creates the file if it does not exist, overwrites if it does. Parent directories are created automatically.",
    inputSchema: z.object({
      path: z.string().describe("Path to the file (workspace-relative)"),
      content: z.string().describe("Content to write to the file"),
    }),
    execute: async ({ path, content }) => {
      await getWorkspace().writeFile(path, content);
      return {
        path,
        bytesWritten: new TextEncoder().encode(content).byteLength,
        lines: content.split("\n").length,
      };
    },
  });
}

function createMoveTool({ getWorkspace }: { getWorkspace: () => Workspace }) {
  return tool({
    description:
      "Move or rename a file or directory inside the workspace. Prefer this over `read` + `write` + `delete` when relocating existing content — preserves bytes exactly, atomic, and works on binary files. Parent directories at the destination are created automatically. Set `recursive: true` when the source is a directory; otherwise the call fails with EISDIR.",
    inputSchema: z.object({
      from: z.string().describe("Source path (workspace-relative)"),
      to: z.string().describe("Destination path (workspace-relative)"),
      recursive: z
        .boolean()
        .optional()
        .describe(
          "Required when `from` is a directory. Defaults to false; on a directory source the call fails with EISDIR.",
        ),
    }),
    execute: async ({ from, to, recursive }) => {
      await getWorkspace().mv(from, to, { recursive: recursive ?? false });
      return { from, to };
    },
  });
}

function createCopyTool({ getWorkspace }: { getWorkspace: () => Workspace }) {
  return tool({
    description:
      "Copy a file or directory inside the workspace. Prefer this over `read` + `write` when duplicating existing content — preserves bytes exactly and works on binary files. Parent directories at the destination are created automatically. Set `recursive: true` when the source is a directory; otherwise the call fails with EISDIR.",
    inputSchema: z.object({
      from: z.string().describe("Source path (workspace-relative)"),
      to: z.string().describe("Destination path (workspace-relative)"),
      recursive: z
        .boolean()
        .optional()
        .describe(
          "Required when `from` is a directory. Defaults to false; on a directory source the call fails with EISDIR.",
        ),
    }),
    execute: async ({ from, to, recursive }) => {
      await getWorkspace().cp(from, to, { recursive: recursive ?? false });
      return { from, to };
    },
  });
}

/**
 * Single source of truth for the tool surface shared between
 * `DownyAgent` (the user-facing chat agent) and `ChildAgent` (the
 * background-task worker). Both agents call `buildSharedToolSet` so a new
 * tool is added in exactly one place; the only knob is whether to expose it
 * top-level (parent-only) or in the shared bundle (both).
 *
 * `buildSharedToolSet` returns the `execute` bundle (codemode-namespaced
 * read helpers) plus the skill-write trio. The child binds `getWorkspace`
 * to its remote-workspace proxy so workspace ops transparently hit the
 * parent's DO. Parent-only capabilities (`spawn_background_task`,
 * `connect_mcp_server`, `list_mcp_servers`, `disconnect_mcp_server`) stay
 * inline in `DownyAgent#getTools` because they close over parent-only
 * state — DO RPC dispatch and the live `MCPClientManager`.
 *
 * Workspace file tools (`read`, `write`, `edit`, `list`, `find`, `grep`,
 * `delete`) are auto-registered by Think off `this.workspace` and merged
 * into the turn's tool set automatically — neither agent passes
 * `activeTools`, so Think exposes the full merged catalog. `move` and
 * `copy` aren't auto-registered by Think, so they're added here as plain
 * wrappers around `Workspace.mv` / `Workspace.cp`.
 */

type SharedToolDeps = {
  env: Cloudflare.Env;
  /** Lazy so each tool call sees the current `this.workspace` reference. */
  getWorkspace: () => Workspace;
  /**
   * Slug to treat as "self" for `read_peer_agent`'s self-loop guard. For
   * the parent agent this is `this.name`; for the child it's the parent's
   * slug (the child reads peers on the parent's behalf, so it shouldn't be
   * able to read the parent itself either).
   */
  parentSlug: string;
  bumpPeerReadCount: () => number;
};

/**
 * Tools both agents register. The execute bundle exposes `codemode.*`
 * helpers (web search/scrape, peer reads, skill reads) inside the
 * sandboxed Worker; the skill writes stay top-level so each "I created a
 * skill" claim corresponds to one auditable tool call.
 */
export function buildSharedToolSet(deps: SharedToolDeps): ToolSet {
  const { env, getWorkspace, parentSlug, bumpPeerReadCount } = deps;
  return {
    execute: createExecuteTool({
      tools: {
        web_search: createWebSearchTool(env.EXA_API_KEY),
        web_scrape: createWebScrapeTool(env.BROWSER),
        read_peer_agent: createReadPeerAgentTool({
          env,
          parentSlug,
          bumpCount: bumpPeerReadCount,
        }),
        list_skills: createListSkillsTool({ getWorkspace }),
        read_skill: createReadSkillTool({ getWorkspace }),
        list_skill_files: createListSkillFilesTool({ getWorkspace }),
      },
      loader: env.LOADER,
      timeout: 60_000,
    }),
    write: createFixedWriteTool({ getWorkspace }),
    move: createMoveTool({ getWorkspace }),
    copy: createCopyTool({ getWorkspace }),
    create_skill: createCreateSkillTool({ getWorkspace }),
    update_skill: createUpdateSkillTool({ getWorkspace }),
    delete_skill: createDeleteSkillTool({ getWorkspace }),
    todo_write: createTodoWriteTool(),
  };
}

/**
 * Wrap each parent MCP tool in a `dynamicTool` whose `execute` round-trips
 * back to the parent over RPC. Naming matches the AI SDK convention the
 * parent's framework uses (`tool_<serverId-without-dashes>_<toolName>`),
 * so the model sees identical names regardless of which agent is running.
 */
export function buildMcpProxyTools(args: {
  descriptors: McpToolDescriptor[];
  callTool: (serverId: string, name: string, args: unknown) => Promise<unknown>;
}): ToolSet {
  const tools: ToolSet = {};
  for (const entry of args.descriptors) {
    const key = `tool_${entry.serverId.replace(/-/g, "")}_${entry.name}`;
    tools[key] = dynamicTool({
      description: entry.description,
      // McpToolDescriptor.inputSchema is structurally JSONSchema7
      // (object-rooted with optional properties/required); the type-utils
      // signature wants the canonical type.
      // eslint-disable-next-line typescript/no-unsafe-type-assertion -- structural match enforced by McpToolDescriptor.
      inputSchema: jsonSchema(
        entry.inputSchema as Parameters<typeof jsonSchema>[0],
      ),
      execute: async (input) =>
        args.callTool(entry.serverId, entry.name, input),
    });
  }
  return tools;
}
