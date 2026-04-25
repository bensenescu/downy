# OpenClaw Cloud Native

A cloud-hosted personal agent with OpenClaw's soul — one persistent chat thread, living memory, relentless research — on Cloudflare's Project Think primitives.

- **One chat**, streamed token-by-token over WebSockets.
- **Four user-editable identity files** (`SOUL.md`, `IDENTITY.md`, `USER.md`, `MEMORY.md`) read fresh into the system prompt on every turn.
- **Workspace of files** the agent produces — browseable, editable, deletable in the UI.
- **Tools:** workspace (built-in via Think), Exa web search, Puppeteer web scrape.
- **Model:** Kimi K2.6 via Workers AI by default. Opt in to a Codex relay (local for dev, or a private VPC instance for prod) per-user from the preferences card. See `src/worker/agent/get-model.ts` and `aisdk-codex-proxy/`.

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
LOCAL_NOAUTH=1
```

`LOCAL_NOAUTH=1` bypasses the Cloudflare Access gate — Access doesn't run
against `localhost`, so without this every page renders the unauthenticated
screen. Never set it in production.

## Deploy

```bash
npm run deploy
```

## Cloudflare Access

The Worker enforces Cloudflare Access at the edge — every request (REST
handlers, the agent WebSocket, and TanStack SSR routes) is gated by a single
check at the top of `src/entry.worker.ts`. Unverified browser requests are
rewritten to `/unauthenticated`; unverified API or WebSocket requests get a
JSON 401.

To enable it on a deployment:

1. In the Cloudflare dashboard, open `Compute` → `Workers & Pages` → your
   `openclaw` Worker.
2. Open `Settings` → `Domains & Routes` and enable `Cloudflare Access` on the
   route (e.g. the `workers.dev` route or your custom domain).
3. Cloudflare will show a `POLICY_AUD` and a JWKS URL. The team domain is the
   origin part of the JWKS URL (e.g. `https://your-team.cloudflareaccess.com`).
4. Under `Settings` → `Variables & Secrets`, add:
   - `TEAM_DOMAIN` — full https origin of your team domain
   - `POLICY_AUD` — the Application Audience tag from Access

Verification uses `jose`'s `createRemoteJWKSet` against
`${TEAM_DOMAIN}/cdn-cgi/access/certs` and validates `iss = TEAM_DOMAIN` and
`aud = POLICY_AUD`. JWKS are cached per isolate. The token is read from the
`cf-access-jwt-assertion` header (Cloudflare attaches it on every request)
with the `CF_Authorization` cookie as a fallback for plain navigations.

For local development, set `LOCAL_NOAUTH=1` in `.dev.vars` (see above) so the
gate is bypassed.

## Codex relay (optional)

By default the agents run on Kimi K2.6 via Workers AI. A second option is the
codex relay in `aisdk-codex-proxy/` — a small Hono server that forwards
OpenAI-compatible chat traffic to a host with a persistent `codex login`. Per-user
opt-in via the **Model** dropdown in the Preferences card. There are three
choices, all backed by the registry in `src/worker/agent/get-model.ts`:

- `kimi` — default, no setup.
- `codex-local` — for dev. Hits `http://127.0.0.1:8787/v1` directly.
- `codex-prod` — for deployed Workers. Routes through a Workers VPC binding.

### Local dev

```bash
cd aisdk-codex-proxy
npm install
npm run dev          # listens on http://127.0.0.1:8787
```

In another terminal run `npm run dev` at the repo root, open the app, and
choose **Codex relay — local dev** in the Preferences card. The relay's
console will log every `[proxy …] /v1/chat/completions incoming` request.

There is no auth on the relay's `/v1/*` routes — loopback is the trust
boundary. See `aisdk-codex-proxy/README.md` for ToS caveats and Codex-OAuth
caller obligations.

### Production via Workers VPC

The deployed Worker can't reach `127.0.0.1`, so the relay needs a private
network path. The shape:

1. Run the relay on a host inside a Cloudflare VPC subnet. Bind to the
   private interface only — **no public ingress**.
2. Register a VPC connectivity service for that host in the Cloudflare
   dashboard. Note the service ID.
3. Add the binding to `wrangler.jsonc` (commented out by default — see the
   `vpc_services` note in that file):

   ```jsonc
   "vpc_services": [
     { "binding": "CODEX_RELAY_VPC", "service_id": "<service-id-from-step-2>" }
   ]
   ```

4. `npm run cf-typegen && npm run deploy`.
5. In the Preferences card on the deployed app, switch to **Codex relay —
   production VPC**.

The connector is the only network path to the relay, so no bearer token or
Access policy is needed. Selecting `codex-prod` without the binding declared
throws a clear "not configured" error at turn time.

The binding is intentionally absent from the default `wrangler.jsonc` because
`vpc_services` has no local emulation — declaring it forces `wrangler dev`
to provision a remote edge-preview Worker, which fails on accounts without
the right entitlement.

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
