# Tool calling between parent and background tasks

How tool calls and MCP servers flow between the user-facing `DownyAgent` ("parent") and the background workers it dispatches via `spawn_background_task` ("child" — a `ChildAgent` durable object).

The short version: the parent owns all authoritative state — workspace files, MCP transports, peer-agent access. The child runs its own LLM loop in its own DO, but every tool call that touches state ultimately round-trips through the parent over DO-to-DO RPC. The child does its own web fetches and its own LLM inference; everything else is borrowed.

## Why this shape

A background task is a separate durable object so its inference loop, message buffer, and abort signals are independent of the parent's chat — the user can keep talking while the worker grinds. But the child shouldn't keep its own copy of the workspace (file writes need to land where the parent can see them), and it can't open its own MCP transports (those carry live OAuth / bearer auth state that lives on the parent).

So the child gets the parent's tool surface but not the parent's state. The bridge is RPC.

## Diagram

```
                 ┌──────────────────────────────────────────────────────────┐
                 │                  DownyAgent (parent DO)                  │
                 │                                                          │
   user chat ───▶│  Think loop                                              │
                 │   ├── web_search / web_scrape (Exa, bulk-form)           │
                 │   ├── read_peer_agent ─── DB + RPC to peer agent         │
                 │   ├── list_skills / read_skill / list_skill_files        │
                 │   ├── create_skill / update_skill / delete_skill         │
                 │   ├── spawn_background_task ─────────┐                   │
                 │   ├── connect_mcp_server / list / disconnect             │
                 │   ├── todo_write                                         │
                 │   └── workspace tools (auto-registered by Think,         │
                 │       bound to `this.workspace`)                         │
                 │                                                          │
                 │  this.workspace ◀─── R2 + DO SQL (authoritative state)   │
                 │  this.mcp        ◀── live MCP transports (auth state)    │
                 └──────────────────────────────┬───────────────────────────┘
                                                │
              ┌─────────────────────────────────┼──────────────────────────────┐
              │ DO-to-DO RPC                    │                              │
              │ ─ workspaceCallForChild         │                              │
              │ ─ listMcpToolsForChild          │                              │
              │ ─ callMcpToolForChild           │                              │
              │ ─ onBackgroundTaskComplete      │                              │
              ▼                                 ▼                              ▼
    ┌────────────────────────────────────────────────────────────────────────────┐
    │                        ChildAgent (one DO per task)                        │
    │                                                                            │
    │   Think loop (its own inference, its own messages)                         │
    │     ├── web_search / web_scrape (runs locally — Exa fetches)               │
    │     ├── read_peer_agent ── DB + RPC to peer agent                          │
    │     ├── list_skills / read_skill / list_skill_files ─▶ proxy ws ──▶ parent │
    │     ├── create_skill / update_skill / delete_skill ─▶ proxy ws ──▶ parent  │
    │     ├── workspace tools (read/write/edit/list/grep/find/delete)            │
    │     │   auto-registered off this.workspace ─▶ proxy ws ──▶ parent          │
    │     └── tool_<server>_<name>  (one dynamicTool per parent MCP tool)        │
    │                                            │                               │
    │                                            └─▶ callMcpToolForChild ──┐     │
    │                                                                      │     │
    │   this.workspace = createRemoteWorkspace(() => parent stub)          │     │
    │     └── Proxy: every method call ─▶ parent.workspaceCallForChild     │     │
    └──────────────────────────────────────────────────────────────────────┼─────┘
                                                                           │
                                                                           ▼
                                                          parent's live MCPClientManager
                                                          (DataForSEO, Linear, PostHog…)
```

## What lives where

| Capability                                 | Parent             | Child                                                                                                               |
| ------------------------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Inference loop, messages, abort            | own                | own                                                                                                                 |
| Workspace files (R2 + SQL)                 | authoritative      | proxy via `workspaceCallForChild` RPC                                                                               |
| MCP transports + auth state                | authoritative      | proxy: `dynamicTool` per parent tool, calls `callMcpToolForChild`                                                   |
| `web_search` / `web_scrape` (Exa, browser) | own                | own (each DO opens its own outbound fetches)                                                                        |
| Peer-agent reads                           | own (RPC to peer)  | own (RPC to peer; the child's `parentSlug` for the self-loop check is the _parent's_ slug, fetched at `beforeTurn`) |
| Skill catalog (read + write)               | tools at top level | same surface — workspace ops route through parent                                                                   |
| Connect/list/disconnect MCP servers        | own                | **not exposed** — those mutate parent's transport state                                                             |
| `spawn_background_task`                    | own                | **not exposed** — no recursive task dispatch                                                                        |

## How a child gets the parent's tools

`ChildAgent.beforeTurn` runs on every inference turn (a child has exactly one turn — the brief — but the hook runs there). It composes the tool set the same way the parent does, swapping in proxy-backed implementations:

1. **Workspace proxy.** `this.workspace` is overridden with `createRemoteWorkspace(...)` — a runtime `Proxy` whose `get` trap returns an async function for any property access. That function resolves the parent stub via `getAgentByName(env.DownyAgent, meta.parentName)` and calls `parent.workspaceCallForChild(method, args)`. The parent's RPC method allowlists method names against `ALLOWED_WORKSPACE_METHODS` (the public `Workspace` surface, no `_*` internals) and dispatches via `Reflect.get(this.workspace, method)`. The proxy is built as a `Proxy` rather than a hand-written wrapper so it covers all ~22 `Workspace` public methods without 22 forwarders.

2. **Skill tools.** `create_skill`, `update_skill`, `delete_skill` (write side) and `list_skills`, `read_skill`, `list_skill_files` (read side) are all registered top-level with `getWorkspace: () => this.workspace`. Because `this.workspace` is the proxy, every read/write lands on the parent's authoritative copy.

3. **Workspace file tools** (`read`, `write`, `edit`, `list`, `grep`, `find`, `delete`). These are auto-registered by Think off `this.workspace`. The proxy makes them transparent — the model sees the same tool names with the same behavior as in the parent. Neither agent passes `activeTools`, so Think exposes the full merged catalog (shared bundle + auto-registered file tools + MCP proxies) automatically.

4. **MCP tools.** `ChildAgent#buildMcpProxyTools` calls `parent.listMcpToolsForChild()` (which returns serializable `McpToolDescriptor` records — see `mcp-proxy.ts`) and wraps each entry in a `dynamicTool` whose `execute` calls back to `parent.callMcpToolForChild(serverId, name, args)`. The child can't open its own MCP transports — the live state (sessions, OAuth tokens, header auth) belongs to the parent — so every MCP call round-trips. The child's tool naming matches the parent's framework convention (`tool_<serverId-without-dashes>_<toolName>`), so the model sees identical names whether it runs in parent or child.

5. **`read_peer_agent`** is built per-turn because it closes over the parent's slug (used to block self-loops) and over `bumpPeerReadCount` (per-turn fan-out cap). The slug comes from `meta.parentName`. The actual peer reads bypass the parent — they go directly via `getAgentByName(env.DownyAgent, slug)` to the _peer_ agent's DO, which enforces its own privacy check on each method.

## What a tool call looks like end-to-end

### Workspace write (e.g. the model in the child calls `write`)

1. Think dispatches `write({ path, content })` against the auto-registered tool bound to `this.workspace`.
2. The auto-registered tool calls `this.workspace.writeFile(path, content)`.
3. The `Proxy` `get` trap fires for the `writeFile` property, returning an async function.
4. That function resolves the parent stub via `getAgentByName(env.DownyAgent, meta.parentName)`.
5. It calls `parent.workspaceCallForChild("writeFile", [path, content])`.
6. The parent allowlists `writeFile`, then `Reflect.get(this.workspace, "writeFile").apply(this.workspace, [path, content])` — the write lands in the parent's R2 + DO SQL.
7. The promise resolves; the tool result returns to Think, the next inference step proceeds.

### MCP call (e.g. `tool_dataforseo_<name>`)

1. The child's model calls `tool_dataforseo_serpgooglesearchlive` (or whatever).
2. The `dynamicTool`'s `execute` runs — it calls `parent.callMcpToolForChild("dataforseo", "serp/google/search/live", args)` over RPC.
3. The parent's `callMcpToolViaParent` invokes `this.mcp.callTool({ serverId, name, arguments })` over its live transport. If the MCP server returns `isError: true`, the parent throws — the child receives the rejection, the AI SDK surfaces it as a step error to the model.
4. Successful result returns up the same chain.

### Background task completion

1. The child finishes its single turn and emits a final assistant message (no tool calls).
2. `ChildAgent#onChatResponse` extracts that text and calls `parent.onBackgroundTaskComplete(taskId, status, body)` over RPC.
3. The parent parses the `slug:` header, picks an artifact path under `notes/`, writes the body to its own workspace, and injects a synthetic user message into its own chat (`<background_task ... completed — findings saved to {path}>`) so the model sees the result on the next turn.

## Trust and failure modes

- **Allowlist boundary:** `workspaceCallForChild` rejects any method not in `ALLOWED_WORKSPACE_METHODS`. Adding a new public `Workspace` method means adding it to that set; otherwise the child can't reach it.
- **MCP failure:** If `listMcpToolsForChild` throws (e.g. parent transport isn't ready), `ChildAgent#buildMcpProxyTools` swallows and the child runs without MCP. A single MCP call failing surfaces as a normal tool error to the model — it can retry or pick a different approach.
- **Workspace failure:** If the parent DO is offline or the RPC throws, the proxy's awaited call rejects; the file tool reports an error to the child's model. There's no local fallback by design — the child shouldn't write to its own DO and pretend it succeeded.
- **Recursion:** `spawn_background_task` is intentionally not exposed in the child. A child can't spawn its own children. Same for `connect_mcp_server` — children inherit the parent's connections; they can't add new ones.

## Keeping the two agents in sync

The shared tool surface lives in **`src/worker/agent/tool-registry.ts`** so the parent and child can't drift. Both agents call `buildSharedToolSet({ env, getWorkspace, parentSlug, bumpPeerReadCount })` and merge in their own additions — that's the only file you edit when adding a new shared tool.

```
                buildSharedToolSet (tool-registry.ts)
                ├── web_search / web_scrape (bulk-form)
                ├── read_peer_agent
                ├── list_skills / read_skill / list_skill_files
                ├── create_skill / update_skill / delete_skill
                ├── read / write / edit / delete / move / copy
                └── todo_write

   ┌────────────────────────┐
   │                        │
   ▼                        ▼
DownyAgent#getTools  ChildAgent#beforeTurn
 + spawn_background_task  + buildMcpProxyTools(parent-RPC-bound)
 + read_user_profile      (workspace tools auto-registered by Think
 + write_user_profile      off `this.workspace` — same on both sides;
 + connect_mcp_server      neither agent passes `activeTools`)
 + list_mcp_servers
 + disconnect_mcp_server
```

What still lives on each agent rather than in the registry:

- **Parent-only tools** (`spawn_background_task`, MCP `connect`/`list`/`disconnect`) close over parent-only state — DO RPC dispatch, the live `MCPClientManager`. They're added on the parent's side after spreading the shared set.
- **Child MCP proxies** are dynamic per-turn — the child fetches `listMcpToolsForChild()` from the parent, then `buildMcpProxyTools` (also in the registry) wraps each descriptor in a `dynamicTool` whose `execute` round-trips back via the supplied `callTool`. The two callers of `buildMcpProxyTools` would, in principle, be the parent and the child — today only the child needs it because Think handles MCP merging natively on the parent.
- **Workspace and peer-read counter** are still local: the parent uses `this.workspace`, the child uses the `RemoteWorkspace` proxy; `bumpPeerReadCount` lives on each agent so each gets its own per-turn fan-out budget.

To add a shared tool: edit `tool-registry.ts` and extend the bundle returned by `buildSharedToolSet`. Both agents pick it up automatically because neither filters via `activeTools`. To add a parent-only tool: add it in `DownyAgent#getTools` after spreading the shared set — the child won't see it. To add a tool only the child needs: spread it after `buildSharedToolSet(...)` in `ChildAgent#beforeTurn` (rare; almost everything that makes sense in the child also makes sense in the parent).

## Files

- `src/worker/agent/tool-registry.ts` — `buildSharedToolSet` and `buildMcpProxyTools`. Single source of truth for the shared surface.
- `src/worker/agent/DownyAgent.ts` — parent agent. Defines `workspaceCallForChild`, `listMcpToolsForChild`, `callMcpToolForChild`, `onBackgroundTaskComplete`, and `ALLOWED_WORKSPACE_METHODS`. Layers parent-only tools onto the shared set.
- `src/worker/agent/ChildAgent.ts` — background worker. Overrides `this.workspace` with the proxy, calls `buildSharedToolSet` + `buildMcpProxyTools` in `beforeTurn`.
- `src/worker/agent/RemoteWorkspace.ts` — `createRemoteWorkspace`, the `Proxy`-based `Workspace` shim.
- `src/worker/agent/mcp-proxy.ts` — `McpToolDescriptor`, `listMcpToolDescriptors`, `callMcpToolViaParent`. Pure helpers, no DO state.
- `src/worker/agent/tools/spawn-background-task.ts` — the dispatch tool itself; lives on the parent only.
