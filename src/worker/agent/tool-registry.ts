import { createExecuteTool } from "@cloudflare/think/tools/execute";
import type { Workspace } from "@cloudflare/shell";
import { dynamicTool, jsonSchema } from "ai";
import type { ToolSet } from "ai";

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
import { createWebScrapeTool } from "./tools/web-scrape";
import { createWebSearchTool } from "./tools/web-search";

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
 * `activeTools`, so Think exposes the full merged catalog.
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
    create_skill: createCreateSkillTool({ getWorkspace }),
    update_skill: createUpdateSkillTool({ getWorkspace }),
    delete_skill: createDeleteSkillTool({ getWorkspace }),
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
