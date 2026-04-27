# Downy — Technical Plan

## Context

Build a cloud-hosted personal agent on Cloudflare's Project Think primitives — single persistent chat thread, user-editable identity/memory markdown files, asynchronous research tasks. See `product-spec.md` for the product rationale.

Starts from the current repo: a bare TanStack Start + Vite + Tailwind + Cloudflare Workers template (React 19, TanStack Router, `@cloudflare/vite-plugin`, Manrope/Fraunces typography with a custom `sea-ink`/`lagoon`/`foam` palette in `src/styles.css`). No DOs, no agent SDKs installed yet.

`private-every-app/apps/todo-app` is a reference **only** for Durable Object wiring — `wrangler.jsonc` structure, `entry.worker.ts` hand-off to TanStack, WebSocket upgrade pattern, client reconnect. Its D1 / Drizzle / TanStack DB / daisyUI / auth / sync middleware are not applicable.

### Locked decisions

- Single-tenant, deploy-to-own-Cloudflare (no multi-tenant, no auth).
- **Kimi 2.5** as the default model.
- **Exa** as the web search provider.
- **Codemode** as the primary tool surface (not direct tools).
- Four core markdown files live in Workspace, read fresh into the system prompt each turn via `beforeTurn()`.
- Async tasks use Fibers with WebSocket push when complete.
- No HEARTBEAT / alarms. No forced onboarding / naming ritual.
- **Out of v1:** self-authored extensions, sub-agent Facets, Tier-4 sandbox, conversation branching.

---

## Architecture

One singleton Durable Object (`DownyAgent`) extends the `Think` base class and owns:

- The Persistent Session (message history with FTS5 search).
- The Workspace (durable virtual filesystem for files).
- A `beforeTurn()` hook that reads `SOUL.md`, `IDENTITY.md`, `USER.md`, `MEMORY.md` from Workspace and injects them into the system prompt.
- Tools registered through `createCodeTool` (codemode) — workspace CRUD, web search, web scrape, session search.
- A WebSocket endpoint for streaming tokens + task-completion notifications back to the UI.
- Fibers for long-running work the agent wants to spawn without blocking the chat.

Frontend is three TanStack Start routes layered on top of the existing template:

- `/` — chat interface with floating Settings + Workspace buttons.
- `/settings` — editing the four core markdown files.
- `/workspace` — browsing agent-generated output files.

### Model provider

`workers-ai-provider` covers Workers AI-hosted models. If Kimi 2.5 is available in the Workers AI catalog at build time, use the binding. If not, wire a compatible provider (Moonshot direct or OpenRouter) via the `ai` SDK and put the key in an env var. **Verify availability as the first step of implementation** and pick the provider accordingly — this is the only decision that can gate everything else.

---

## Cloudflare Bindings

Extend existing `wrangler.jsonc`:

```jsonc
{
  "name": "downy",
  "main": "src/entry.worker.ts",
  "compatibility_date": "2025-09-02",
  "compatibility_flags": ["nodejs_compat"],
  "durable_objects": {
    "bindings": [{ "name": "AGENT", "class_name": "DownyAgent" }],
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["DownyAgent"] }],
  "r2_buckets": [
    { "binding": "WORKSPACE_BUCKET", "bucket_name": "downy-workspace" },
  ],
  "ai": { "binding": "AI" },
  "browser": { "binding": "BROWSER" },
  "vars": {
    "EXA_API_KEY": "",
    "MODEL_ID": "kimi-2.5",
  },
}
```

Reference for structure: `private-every-app/apps/todo-app/wrangler.jsonc` (DO binding + migrations shape).

---

## Dependencies to Add

```
@cloudflare/think
@cloudflare/agents
@cloudflare/ai-chat
@cloudflare/codemode
@cloudflare/shell
ai
workers-ai-provider
zod
react-markdown
remark-gfm
```

Keep: React 19, TanStack Start/Router, Tailwind 4, Vite, lucide-react, wrangler 4, `@cloudflare/vite-plugin`.

---

## Backend

### Directory layout (new under `src/`)

```
src/
  entry.worker.ts              # NEW — composes on top of TanStack's server-entry
  worker/
    agent/
      DownyAgent.ts         # Think subclass, the DO
      systemPrompt.ts          # beforeTurn() — read identity files → prompt
      tools.ts                 # codemode tool registry
      tools/
        workspace.ts           # list / read / write / delete
        web.ts                 # search (Exa) + scrape (Browser Run + fetch)
        session.ts             # session FTS search
    handlers/
      chat.ts                  # WebSocket upgrade → DO.fetch()
      files.ts                 # REST: list / read / write core + workspace files
  lib/
    core-files.ts              # constants: SOUL_PATH, IDENTITY_PATH, etc.
```

### `src/entry.worker.ts`

`@tanstack/react-start/server-entry` is a tiny module that exports `{ fetch }` from `createStartHandler(defaultStreamHandler)`. We don't replace TanStack — we compose. Pattern mirrors `private-every-app/apps/todo-app/src/entry.worker.ts`:

```ts
import tanstackEntry from "@tanstack/react-start/server-entry";
import { handleChatWebSocket } from "./worker/handlers/chat";
import { handleFilesRequest } from "./worker/handlers/files";

export * from "@tanstack/react-start/server-entry"; // load-bearing re-export
export { DownyAgent } from "./worker/agent/DownyAgent"; // DO class

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/chat") return handleChatWebSocket(request, env);
    if (url.pathname.startsWith("/api/files"))
      return handleFilesRequest(request, env);
    return tanstackEntry.fetch(request);
  },
};
```

The `export *` line is required — the Cloudflare Vite plugin and TanStack's build expect all TanStack exports re-surfaced at the entry boundary. The `export { DownyAgent }` makes the DO class discoverable by the Wrangler binding. Switch `wrangler.jsonc`'s `"main"` from `@tanstack/react-start/server-entry` to `src/entry.worker.ts`.

### `DownyAgent` (extends Think)

- `idFromName("singleton")` — one DO for the whole deployment.
- `getModel()` returns Kimi 2.5 via the chosen provider (see Model Provider above).
- Workspace mounted at Tier 0 of the Execution Ladder (SQLite + R2 via `WORKSPACE_BUCKET`).
- Uses Think's built-in Persistent Sessions for message storage (no custom DB).
- `beforeTurn()`: calls `buildSystemPrompt()`, which reads the four core files fresh from Workspace and composes them into the system prompt.
- Registers codemode tool via `createCodeTool({ tools: [workspaceTools, webTools, sessionTools] })`.
- On first boot (empty session): seed the four core files in Workspace with starter content — OpenClaw-style personality prose for `SOUL.md` / `IDENTITY.md` (shipped default agent name), empty `USER.md` / `MEMORY.md`.

### Tools (codemode namespace)

One `createCodeTool` call; agent writes TypeScript that calls `codemode.*`:

- `workspace.list(path?)` → Workspace directory listing
- `workspace.read(path)` → file contents
- `workspace.write(path, content)` → write/overwrite
- `workspace.delete(path)` → delete
- `web.search(query)` → Exa API call (using `EXA_API_KEY`)
- `web.scrape(url)` → Browser Run via `env.BROWSER` for JS pages; `fetch()` fallback for static
- `session.search(query)` → FTS5 search over Think's session

### Async Tasks via Fibers

When a request needs background work, codemode looks like:

```ts
await fiber.spawn(async () => {
  const results = await codemode.webSearch({ query });
  // multi-step research
  await codemode.workspaceWrite({ path, content });
  await session.postMessage("Done — see notes/foo.md");
});
return "On it — I'll ping you when it's ready.";
```

The chat turn returns immediately. The Fiber runs in the background, hibernates between steps, and posts a completion message back through the session. WebSocket pushes the new message to any connected client.

---

## Frontend

### Theme

Keep `sea-ink` / `lagoon` / `foam` palette and Manrope/Fraunces typography from `src/styles.css`. Do not pull in daisyUI — extend Tailwind 4 and the existing CSS tokens.

### Routes (file-based, under `src/routes/`)

```
src/routes/
  __root.tsx                   # EDIT — keep layout, drop Footer on chat page
  index.tsx                    # REWRITE — chat interface
  settings.tsx                 # NEW — list of four core files
  settings.$file.tsx           # NEW — editor for one core file
  workspace.tsx                # NEW — workspace file browser
  workspace.$.tsx              # NEW — splat, individual file view/edit
  about.tsx                    # DELETE (template demo)
```

### Components (under `src/components/`)

```
components/
  chat/
    ChatShell.tsx              # Layout with floating action buttons
    MessageList.tsx            # Scrolling list, streaming
    Message.tsx                # Single message, markdown render, file-link pill
    InputBox.tsx               # Textarea + Enter-submit
    FloatingButtons.tsx        # Settings + Workspace icons (lucide-react)
    useChatSocket.ts           # WebSocket client with reconnect
  markdown/
    MarkdownEditor.tsx         # Textarea-based editor (v1; Tiptap later)
    MarkdownPreview.tsx        # react-markdown + remark-gfm
  files/
    FileTree.tsx               # Flat listing (workspace is shallow in v1)
    FileViewer.tsx             # Preview non-markdown; editor for .md
```

### Chat (`/`)

- Full-height layout; message list scrolls; input pinned bottom.
- Two floating icon buttons (top-right): gear → `/settings`, folder → `/workspace`.
- `useChatSocket` opens WebSocket to `/api/chat`, receives streaming tokens, reconnects on close (mirror `private-every-app/apps/todo-app/src/client/sync/useSyncEvents.ts` for reconnect shape — reference only).
- Fiber completion messages render with a file-link pill when they reference a workspace path.

### Settings (`/settings` + `/settings/$file`)

- Index: list of the four core files with one-line descriptions + last-edited timestamps from `/api/files`.
- Detail: `MarkdownEditor` (textarea) with preview toggle, Save, Revert.
- PUT to `/api/files/settings/:name`; agent picks up changes on the next turn via `beforeTurn()`.

### Workspace (`/workspace` + `/workspace/$`)

- Index: `FileTree` listing all files excluding the four core identity files.
- Detail (splat): markdown files render with `MarkdownPreview` + Edit toggle; non-markdown files shown as plain text.
- Delete uses native `confirm()` for v1 simplicity.

---

## Reference Files (todo-app — DO/WebSocket wiring only)

| Pattern                                          | File                                                               |
| ------------------------------------------------ | ------------------------------------------------------------------ |
| Worker entry w/ custom fetch + TanStack fallback | `private-every-app/apps/todo-app/src/entry.worker.ts`              |
| Wrangler DO binding + migrations shape           | `private-every-app/apps/todo-app/wrangler.jsonc`                   |
| WebSocket upgrade handler                        | `private-every-app/apps/todo-app/src/handlers/sync.ts`             |
| DO with WebSocket hibernation                    | `private-every-app/apps/todo-app/src/durableObjects/UserSyncDO.ts` |
| Client reconnect pattern                         | `private-every-app/apps/todo-app/src/client/sync/useSyncEvents.ts` |

Do **not** copy: D1/Drizzle, TanStack DB collections, auth middleware, emitSyncEvent middleware, daisyUI components, Tiptap, dnd-kit.

---

## Implementation Order

1. Confirm Kimi 2.5 availability in Workers AI; if absent, wire Moonshot/OpenRouter via `ai` SDK. This decision unblocks everything else.
2. Install dependencies; extend `wrangler.jsonc` with DO + R2 + AI + Browser bindings and the `EXA_API_KEY` / `MODEL_ID` vars.
3. Write `src/entry.worker.ts` — pass through to TanStack; handle `/api/chat` and `/api/files/*`.
4. Implement `DownyAgent` DO: minimal Think subclass that echoes back first.
5. Wire Persistent Sessions + streaming over WebSocket; test with a hardcoded system prompt.
6. Add Workspace; seed the four core files on first boot.
7. Implement `beforeTurn()` to read core files into the system prompt.
8. Register codemode with workspace tools; verify the agent can read/write files via script.
9. Add Exa search and Browser Run scrape tools.
10. Add Fiber-based async task pattern; verify background kick-off and completion message.
11. Build the chat route (`/`) and `useChatSocket`.
12. Build Settings routes + `MarkdownEditor`.
13. Build Workspace routes + `FileTree` / `FileViewer`.
14. Add floating Settings + Workspace buttons to the chat shell.
15. Write initial `SOUL.md` / `IDENTITY.md` seed content.

---

## Verification

- `npm run dev` — chat loads at `/`, streams a response from the agent over WebSocket.
- Edit `SOUL.md` in `/settings` → send a message → agent's next response reflects the edit (proves `beforeTurn()` reads fresh).
- Ask for competitive research on any topic → agent replies "on it" immediately → a new markdown file appears in `/workspace` later → a chat message links to it.
- Click the file link → `/workspace/$` renders the markdown.
- Reload the page mid-task → WebSocket reconnects → completion message still arrives.
- `npm run build` passes type-check.
- `wrangler deploy` deploys cleanly to a throwaway Cloudflare account.
