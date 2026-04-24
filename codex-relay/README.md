# codex-relay

A tiny Hono HTTP server that exposes an OpenAI-compatible `/v1/chat/completions` endpoint backed by a ChatGPT/Codex OAuth session.

Run it on a Mac Mini / Raspberry Pi / VPS that has a persistent `codex login`, expose it privately via Cloudflare Tunnel + Access, and point any OpenAI-compatible client (Vercel AI SDK, OpenAI SDK, etc.) at its `baseURL`.

The OAuth + Responses-API plumbing is implemented directly in `src/auth.ts` and `src/codex.ts` — no third-party provider libraries to audit. Total surface is ~300 lines of TypeScript plus Hono.

## ⚠️ ToS warning

Using a ChatGPT Plus/Pro subscription for programmatic traffic almost certainly violates OpenAI's terms. Realistic failure modes: rate-limiting, account suspension, silent capability downgrades, endpoint shape changing without notice. Personal/dev use only — do not ship this to other users.

## Prereqs

1. [Install the Codex CLI](https://github.com/openai/codex) on the host machine.
2. Run `codex login` once. This writes `~/.codex/auth.json`, which this relay reads on startup; refreshes are written back to the same file.

## Install & run

```bash
cd codex-relay
npm install
npm run dev        # watch mode, or:
npm start
```

To smoke-test against a running relay:

```bash
RELAY_URL=http://127.0.0.1:8787 npm run test:live
```

Fires one streaming and one non-streaming `chat.completions` request and prints the result.

Defaults to `http://127.0.0.1:8787`. Env vars:

- `PORT` — listen port (default 8787)
- `HOST` — listen host (default `127.0.0.1`; only set to `0.0.0.0` if you trust the network)
- `CODEX_AUTH_PATH` — override the `~/.codex/auth.json` location
- `RELAY_API_KEY` — if set, `/v1/*` requires `Authorization: Bearer <value>`. Optional defense-in-depth alongside Cloudflare Access.
- `RELAY_DEFAULT_MODEL` — model used when the request omits `model` (default `gpt-5.4`).

## Supported models

The ChatGPT-OAuth backend only accepts a small allowlist of models, and that list moves over time as OpenAI ships new lineups. The relay does **not** hardcode an allowlist — whatever you put in `body.model` is forwarded as-is, and the upstream returns a clear error if it's not accepted.

Default is `gpt-5.4` (override with `RELAY_DEFAULT_MODEL`). To find what your account currently accepts, check what your local Codex CLI is configured for:

```bash
grep '^model' ~/.codex/config.toml
```

Whatever that value is, it'll work here too.

## How it works

1. `src/auth.ts` reads `~/.codex/auth.json`, extracts the access token + refresh token + account ID (from `tokens.account_id`, falling back to the `id_token` JWT claim), and refreshes against `https://auth.openai.com/oauth/token` when the access token is within 60s of its JWT `exp`. Refreshes rotate the refresh token and persist back to `auth.json`.
2. `src/codex.ts` converts the incoming OpenAI-shaped `messages` into the Codex Responses API shape: `system`/`developer` messages → `instructions`, everything else → `input[]` with `input_text`/`output_text` content items. It then POSTs to `https://chatgpt.com/backend-api/codex/responses` with the headers a first-party Codex client sends (`originator: codex_cli_rs`, `openai-beta: responses=experimental`, `chatgpt-account-id`, etc.) and returns the raw SSE stream.
3. `src/index.ts` translates the upstream SSE back to OpenAI `chat.completion.chunk` frames (pulling text out of `response.output_text.delta`, usage out of `response.completed`, errors out of `response.failed`).

## Client usage (Vercel AI SDK)

```ts
import { createOpenAI } from '@ai-sdk/openai';
import { streamText } from 'ai';

const openai = createOpenAI({
  baseURL: 'https://codex.your-tunnel.example.com/v1',
  apiKey: process.env.RELAY_API_KEY ?? 'unused',
  headers: {
    'CF-Access-Client-Id': process.env.CF_ACCESS_CLIENT_ID!,
    'CF-Access-Client-Secret': process.env.CF_ACCESS_CLIENT_SECRET!,
  },
});

const result = streamText({ model: openai('gpt-5'), prompt: 'hi' });
```

## Cloudflare Tunnel + Access setup

One-time:

1. On the host: `brew install cloudflared && cloudflared tunnel login && cloudflared tunnel create codex-relay`.
2. `config.yml` pointing the tunnel at `http://127.0.0.1:8787` on a hostname like `codex.your-zone.example.com`.
3. `cloudflared tunnel route dns codex-relay codex.your-zone.example.com`.
4. `cloudflared tunnel run codex-relay` (install as a launchd/systemd service so it survives reboots).
5. Zero Trust → Access → Applications: create a self-hosted app for that hostname with a **Service Token** policy. Copy the client ID/secret into Emily's env.

Only requests carrying the service-token headers reach the tunnel; everything else is 403'd at the edge.

## Limitations

- No tool calling yet (the request sends `tools: []`). Easy to add — map OpenAI `tools` to Codex `function_call` items.
- No image input yet.
- No structured-output mode — upstream doesn't support it over the OAuth path; use prompt-engineered JSON instead.
- `temperature` / `top_p` / `max_tokens` are ignored (upstream rejects or drops them).

## Layout

```
codex-relay/
├── package.json
├── tsconfig.json
├── README.md
└── src/
    ├── auth.ts       # auth.json + token refresh
    ├── codex.ts      # Responses API request + SSE parsing
    └── index.ts      # Hono server
```

Self-contained — safe to `git mv` out to its own repo later.
