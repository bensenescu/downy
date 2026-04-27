# Downy — Product Spec

## Vision

A cloud-hosted personal agent with OpenClaw's soul — one persistent chat thread, living memory, relentless research — rebuilt on Cloudflare's Project Think so anyone can deploy it in a weekend and run it on the free tier.

## Target User

- Tinkerers who want an OpenClaw-style agent but can't or won't run a VPS.
- Non-devs turned off by terminal setup, Discord bridges, and root access.
- Devs who still want a privacy-preserving path (deploy to their own Cloudflare account).

## Product Principles

1. **One chat, one soul.** Every interaction flows through a single persistent thread.
2. **Never block.** Long tasks run async; the agent notifies when they're done.
3. **Files are first class.** Memory and outputs are markdown you can browse, not a black-box vector store.
4. **Personality over polish.** Lift OpenClaw's identity rituals and aggressive-research ethos directly.

## What We Keep from OpenClaw

- A single chat thread (no session fragmentation).
- An agent with a name and an identity.
- Output files as durable memory artifacts.
- Asynchronous background work that doesn't block conversation.
- Aggressive, unrestricted web scraping.

## What We Change

- Cloud-native from day one. No self-hosting requirement, no Discord/Telegram bridge.
- Files live in a first-class UI alongside the chat, not in Obsidian or an IDE.
- One-click deploy to the user's own Cloudflare account; zero VPS.
- Free-tier viable via Durable Object hibernation.

---

## Feature → Project Think Primitive Map

### 1. The One Chat Interface

A single conversation spanning weeks. Full-text searchable. Hibernates between turns at zero cost.

- **Persistent Sessions API** — tree-structured message store + FTS5 search. Solves "where did I ask X?" natively.
- **Think base class** — handles the agentic loop, streaming, tool dispatch. We subclass it; the chat backend is mostly free.
- **`@cloudflare/ai-chat` + WebSockets** — token-level streaming to the UI with minimal glue.
- **DO Hibernation** — thread sits dormant at zero compute cost between messages. The thing that makes free-tier hosting work.

### 2. Asynchronous Tasks

User asks for research. Agent replies "on it, I'll ping you." The thread stays responsive. Minutes or hours later, a new message appears linking to the output file.

- **Fibers** — durable execution with `stash()` checkpoints. Tasks survive restarts and redeploys; the agent hibernates between steps instead of burning compute.
- **WebSocket push** — completed Fiber posts a message into the session; any connected client receives it live.
- **Sub-Agents via Facets** (post-v1) — deeper research delegates to child DOs with their own SQLite, keeping the main thread's state clean.

### 3. First-Class Files

A file browser alongside the chat. Every agent-generated markdown doc is browseable, editable, and linkable in messages.

- **Workspace (Tier 0 of the Execution Ladder)** — durable virtual filesystem backed by SQLite + R2. Replaces the "raw R2 + custom tool" approach from the original sketch; we get list/read/write primitives without designing the storage layer.
- **Workspace sync** — changes from higher-tier environments (Browser Run, Sandbox) propagate back automatically. No glue code.

### 4. Personality & Identity Files

`SOUL.md`, `IDENTITY.md`, `USER.md`, `MEMORY.md` live in Workspace and are read fresh into the system prompt on every turn. User can hand-edit in the Settings UI; agent can write to them with normal tools.

- **Workspace as source of truth** — user sees and edits the literal files.
- **`beforeTurn()` hook (Think)** — re-reads the four files each turn and projects them into the system prompt. Edits take effect on the very next message with no sync step.
- **Context Blocks not needed** — since the files are the source of truth and projection is cheap, we skip Think's Context Block machinery for v1.

Why files + `beforeTurn()` instead of Context Blocks: user-editability. Context Blocks are agent-authored and not naturally surfaced to users; files are transparent, diffable, and live in the same UI the user already uses for research outputs.

### 5. Core Tools (via Codemode)

Two superpowers at launch — manage files and search/scrape the web — delivered through **codemode**, not direct tool calls.

- **`createCodeTool` (codemode)** — the model writes TypeScript that chains operations in one generation, then it executes in a sandboxed Dynamic Worker. Far better fit than discrete tool calls for multi-step research workflows, and each Fiber wake-up does more work per LLM call.
- **Workspace tools** — `list` / `read` / `write` / `delete`.
- **Web search** — **Exa** for v1 (agent-tuned results, clean API). Key in an env var.
- **Web scrape** — **Browser Run** (Tier 3) for JS-heavy pages; `fetch()` fallback for static. No restrictions imposed.
- **Session search** — full-text query over message history.

### 6. Self-Editing (post-v1, already aligned)

The agent writes its own TypeScript tools over time.

- **Self-Authored Extensions** — agent emits TypeScript, runs it in a Dynamic Worker with declared permissions, extension persists in DO storage. Because we're already on codemode, extensions are "save this script as a named tool" — a trivial follow-on rather than a new subsystem.

---

## UX Sketch

### Chat Interface (primary page)

- Full-height chat with streaming messages.
- Input pinned to the bottom.
- Two floating icon buttons (top-right): **Settings** (gear) and **Workspace** (folder).
- Agent-pushed completion messages render with a file-link pill when they reference a workspace path.

### Settings Page

- List of the four core markdown files with one-line descriptions and last-edited timestamps.
- Click one → full-page markdown editor with preview toggle, Save, Revert.
- Edits take effect on the next chat turn — no restart, no sync flow.

### Workspace Page

- Flat list of all agent-generated files (identity files excluded — those live in Settings).
- Click a file → preview (markdown rendered) with an edit toggle and delete button.

---

## Onboarding Flow

1. User clicks "Deploy to Cloudflare" — provisions the Worker, Durable Object, and R2 bucket in their own account.
2. First visit seeds `SOUL.md`, `IDENTITY.md` (with a default agent name shipped by us), `USER.md` (empty), `MEMORY.md` (empty).
3. User is dropped straight into the chat. No forced naming ritual, no multi-step wizard — user can rename the agent later by editing `IDENTITY.md` in Settings.

---

## Out of Scope for v1

- Multi-tenant hosted version (single-tenant deploy-to-own-CF only)
- Auth / accounts
- BYO model keys (Workers AI default)
- HEARTBEAT.md and scheduled heartbeat routines
- Sub-agent Facets
- Self-authored extensions
- Tier-4 full sandbox
- Conversation branching
- Forced onboarding / naming ritual

---

## Self-Hosting

`wrangler deploy` to the user's own Cloudflare account is the distribution path. `wrangler dev` covers local development. The free tier eliminates most of the VPS pain, so a Docker path is not planned.

---

## Success Criteria (weekend-build definition of done)

- Deploy to a throwaway Cloudflare account and have a working chat in under 15 minutes.
- Ask for competitive research on any topic → agent replies immediately → a markdown file appears in Workspace later → a chat message pings with a link.
- Edit `SOUL.md` in Settings → next agent response reflects the new personality.
- Reload the page mid-research → WebSocket reconnects → completion message still arrives.
