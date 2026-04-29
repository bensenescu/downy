# Downy Architecture

This document describes the current implementation. It supersedes older planning notes in `docs/product-spec.md` and `docs/technical-plan.md` where those documents still describe the original singleton/Fiber design.

## System Shape

Downy is a single-user, Cloudflare-hosted personal agent app. The frontend is a TanStack Router/React app served by the same Worker that handles agent APIs. The backend runs on Cloudflare Workers, Durable Objects, D1, R2, Workers AI, Browser Rendering, and Worker Loader.

The app is multi-agent within one deployment. Each named agent has its own `DownyAgent` Durable Object instance keyed by slug. The root route redirects to the default agent, and all agent-specific screens live under `/agent/:slug/...`.

At a high level, there are four durable layers:

- The Worker is the request, auth, and routing boundary.
- D1 is the user-level and registry database.
- Each `DownyAgent` Durable Object owns one agent runtime.
- R2, accessed through `@cloudflare/shell` `Workspace`, stores per-agent files.

## Request Flow

All requests enter through `src/entry.worker.ts`.

1. Cloudflare Access is verified unless local development explicitly enables `LOCAL_NOAUTH=1`.
2. The default agent row is seeded into D1 once per Worker isolate.
3. REST API requests are dispatched to handlers under `src/worker/handlers/`.
4. Agent WebSocket/chat requests fall through to `routeAgentRequest()` from `agents`.
5. Everything else falls through to TanStack Start server rendering.

The important production chokepoint is the Access gate in `entry.worker.ts`; REST handlers, agent sockets, and SSR all pass through it.

## Durable Objects

`DownyAgent` is the user-facing Think agent.

It owns:

- The Think chat/session state for one agent slug.
- The per-agent `Workspace` backed by Durable Object SQLite plus R2.
- Live MCP connections for that agent.
- Background task records in DO storage.
- Bootstrap state and synthetic bootstrap kickoff.
- Peer-agent read-only RPC methods.

`ChildAgent` is a background worker agent.

It owns:

- One background task transcript and metadata.
- The LLM loop for a dispatched task.
- A remote workspace proxy that forwards file operations to the parent `DownyAgent`.
- MCP proxy tools that call through the parent agent's live MCP connections.

The child does not maintain an independent workspace. This keeps background task output in the parent agent's workspace and avoids syncing two file stores.

## Storage Boundaries

`D1` stores deployment-level user and registry data:

- Agent registry: slug, display name, privacy flag, archive timestamp.
- Shared user profile file content for `identity/USER.md`.
- Preferences such as theme, color scheme, thinking visibility, and AI provider.

`R2` stores workspace file bytes through `@cloudflare/shell` `Workspace`.

`Durable Object storage` stores agent-local runtime state:

- Think session/chat state.
- Bootstrap sentinel state.
- Background task records.
- Persisted MCP server connection config.

## Identity Model

The UI and tools expose four identity files under `identity/`, but they do not all have the same owner.

- `identity/SOUL.md`, `identity/IDENTITY.md`, and `identity/MEMORY.md` are agent-level files in that agent's workspace.
- `identity/USER.md` is user-level state in D1 and is shared by all agents.

`DownyAgent.beforeTurn()` reads the agent files, the shared user file, peer-agent metadata, skills, and bootstrap state to build the per-turn system prompt.

## Bootstrap Lifecycle

On first use, the agent seeds `BOOTSTRAP.md` once in its workspace and the chat client asks `/api/bootstrap/start` when the transcript is empty. The agent receives a synthetic user message with metadata `{ kickoff: true }`, starts the onboarding ritual, and deletes `BOOTSTRAP.md` when it considers setup complete.

The dev reset endpoint clears messages, resets the bootstrap sentinel, and re-seeds `BOOTSTRAP.md`. It is only available on localhost.

## Tool Surface

Shared parent/child tools are built in `src/worker/agent/tool-registry.ts`.

- `execute` runs JavaScript through Worker Loader and exposes codemode helpers.
- Codemode helpers include `web_search`, `web_scrape`, `read_peer_agent`, `list_skills`, `read_skill`, and `list_skill_files`.
- Top-level shared tools include fixed `write`, `move`, `copy`, skill mutation tools, and `todo_write`.
- Think also auto-registers workspace-backed file tools from each agent's `workspace` property.

Parent-only tools live on `DownyAgent`:

- `spawn_background_task` creates a `ChildAgent` task.
- `connect_mcp_server`, `list_mcp_servers`, and `disconnect_mcp_server` manage live MCP connections.

Child agents intentionally cannot spawn nested background tasks or connect MCP servers. They inherit access through parent RPC.

## Background Tasks

Background tasks are child Durable Objects, not Fibers.

The flow is:

1. The parent calls `spawn_background_task` with a brief.
2. A `ChildAgent` stores metadata and starts one Think turn with the brief.
3. The child uses parent workspace and MCP proxies while working.
4. The child returns a final markdown document with a `slug:` header.
5. The parent writes that result to `workspace/notes/<slug>.md`.
6. The parent injects a synthetic background-task completion message so the main agent can summarize the artifact for the user.

## Frontend Layout

The root document owns theme bootstrapping, React Query, the mobile header, and TanStack devtools in development.

The agent chat route is client-only because the chat hooks need browser WebSocket state. Desktop navigation lives in `AgentPanel`; mobile uses `Header` plus a drawer state in `src/lib/mobile-panel.ts`.

Agent sub-screens are grouped by route:

- `/agent/:slug/` for chat.
- `/agent/:slug/identity` for identity files.
- `/agent/:slug/workspace` for workspace files.
- `/agent/:slug/skills` for skill catalog.
- `/agent/:slug/mcp` for MCP status.
- `/agent/:slug/background-tasks` for task history/detail.
- `/agent/:slug/settings` for agent-level settings.

User-level settings live under `/settings`.

## Production Bindings

The Worker expects these Cloudflare resources:

- `DB`: D1 database with `migrations/0001_init.sql` applied.
- `WORKSPACE_BUCKET`: R2 bucket for workspace files.
- `DownyAgent`: Durable Object namespace.
- `ChildAgent`: Durable Object namespace.
- `AI`: Workers AI binding.
- `BROWSER`: Browser Rendering binding.
- `LOADER`: Worker Loader binding for execute/codemode.
- `EXA_API_KEY`: secret for web search.
- `TEAM_DOMAIN` and `POLICY_AUD`: Cloudflare Access verification.
- Optional `PI_RELAY_VPC`: VPC binding for the production Pi proxy model provider.

## Known Rough Edges

- Some legacy docs still describe a singleton agent, Fibers, and root-level workspace/settings routes.
- MCP header-auth credentials are persisted in agent DO storage. That is acceptable for a self-hosted personal prototype but should be treated as sensitive data at rest.
- `ignore-client-cancels` patches Think internals. Keep this isolated and revisit when upstream cancellation behavior stabilizes.
- Several UI screens duplicate shell/header/list/status-dot patterns. Consolidating these would make the interface feel more intentional.
- The current local/prod VPC comments in `wrangler.jsonc` should be kept aligned with the actual binding strategy.
