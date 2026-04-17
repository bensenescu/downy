# OpenClaw Cloud Native

A cloud-hosted personal agent with OpenClaw's soul — one persistent chat thread, living memory, relentless research — on Cloudflare's Project Think primitives.

- **One chat**, streamed token-by-token over WebSockets.
- **Four user-editable identity files** (`SOUL.md`, `IDENTITY.md`, `USER.md`, `MEMORY.md`) read fresh into the system prompt on every turn.
- **Workspace of files** the agent produces — browseable, editable, deletable in the UI.
- **Tools:** workspace (built-in via Think), Exa web search, Puppeteer web scrape.
- **Model:** Kimi K2.5 via Workers AI.

See `docs/product-spec.md` and `docs/technical-plan.md` for the full design.

## Prerequisites

- Node 22+
- A Cloudflare account with Workers AI + Browser Rendering enabled
- An Exa API key from [exa.ai](https://exa.ai)
- `wrangler` authenticated: `npx wrangler login`

## First-time setup

```bash
npm install

# Create the R2 bucket for workspace file overflow storage
npx wrangler r2 bucket create openclaw-workspace

# Set the Exa API key as a runtime secret
npx wrangler secret put EXA_API_KEY
```

## Local development

```bash
npm run dev
```

For `EXA_API_KEY` in local dev, create a `.dev.vars` file:

```
EXA_API_KEY=your-exa-key-here
```

## Deploy

```bash
npm run deploy
```

## CI hygiene

```bash
npm run ci:check         # prettier + knip + tsc + oxlint
npm run format:write     # autoformat
npm run lint:fix         # autofix oxlint
```

## Project layout

```
src/
  entry.worker.ts                  # Worker entry — routes /api/files, agent traffic, falls through to TanStack
  env.d.ts                         # Augments Cloudflare.Env with the EXA_API_KEY secret
  worker/
    agent/
      OpenClawAgent.ts             # Think subclass — the Durable Object
      core-files.ts                # SOUL / IDENTITY / USER / MEMORY paths + seed content
      build-system-prompt.ts       # beforeTurn: reads core files, composes system prompt
      tools/
        web-search.ts              # Exa search tool
        web-scrape.ts              # Fetch + Puppeteer scrape tool
    handlers/
      files.ts                     # REST: /api/files/{core,workspace}
    lib/
      get-agent.ts                 # DurableObject stub helper
  routes/
    __root.tsx                     # Header + theme
    index.tsx                      # Chat page
    settings.tsx                   # List of four identity files
    settings.$file.tsx             # Editor for one identity file
    workspace.tsx                  # File browser
    workspace.$.tsx                # View/edit a workspace file
  components/
    Header.tsx, ThemeToggle.tsx
    chat/                          # MessageView, InputBox
    markdown/                      # MarkdownPreview, MarkdownEditor
  lib/
    api-client.ts                  # Typed fetch helpers for /api/files
```

## Stack

- `@cloudflare/think` — chat agent base class (agentic loop, session, workspace, lifecycle hooks)
- `@cloudflare/shell` — Workspace (SQLite + R2) durable filesystem
- `@cloudflare/ai-chat` + `agents` — WebSocket chat transport + React hooks
- `@cloudflare/puppeteer` — browser automation over Cloudflare Browser Rendering
- `workers-ai-provider` + `ai` v6 — Workers AI as an AI SDK LanguageModel
- TanStack Start, React 19, Tailwind 4, Vite 8
