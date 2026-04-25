# codex-relay

A tiny Hono HTTP server that forwards ChatGPT/Codex Responses API requests to `chatgpt.com/backend-api/codex/responses` using a long-lived OAuth session.

The relay is intentionally **dumb**: it injects auth headers, forwards bytes, and streams the SSE response back. All Codex-OAuth quirks (field stripping, `instructions` lifting, required `store: false`) are the **caller's** responsibility — see `../src/worker/agent/codex-provider.ts` in Emily for one implementation.

Run it on a Mac Mini / Raspberry Pi / VPS that has a persistent `codex login`, expose it privately via Cloudflare Tunnel + Access, and have your client send fully-formed Codex Responses API requests to its `/v1/responses` endpoint.

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

Smoke-test against a running relay:

```bash
RELAY_URL=http://127.0.0.1:8787 npm run test:live
```

Fires a streaming `/v1/responses` request and parses the upstream SSE.

## Env vars

- `PORT` — listen port (default 8787)
- `HOST` — listen host (default `127.0.0.1`; set to `0.0.0.0` only if you trust the network)
- `CODEX_AUTH_PATH` — override the `~/.codex/auth.json` location
- `RELAY_API_KEY` — if set, `/v1/*` requires `Authorization: Bearer <value>`. Optional defense-in-depth alongside Cloudflare Access.

## Endpoints

- `GET /health` — unauthenticated liveness
- `POST /v1/responses` — passthrough to `chatgpt.com/backend-api/codex/responses`. The relay does NOT modify the request body; the caller must send a body the OAuth backend will accept.

## Logging

Every request gets a short request id (`[relay xxxxxxxx]`). Logged on each request:

- `incoming`: byte size, model, input count, has-instructions, instructions preview, tool count, tool choice, stream/store/parallel_tool_calls
- `upstream`: status code + ttfb. On non-2xx, the upstream response body is logged (truncated to 800 bytes).
- `stream done`: total events, bytes, total ms, and event-type counts (e.g. `response.output_text.delta=42`)

## Caller obligations (so the OAuth backend doesn't reject)

The body forwarded to `/v1/responses` MUST be valid for the ChatGPT-OAuth Responses API:

- `store: false` — required, the OAuth path rejects `store: true`
- `instructions` — non-empty string at the top level
- No `system` or `developer` role messages inside `input[]` — lift them into `instructions` instead
- No `temperature`, `top_p`, `max_output_tokens`, `max_tokens`, `service_tier`, `safety_identifier`, `prompt_cache_key`, `prompt_cache_retention`, `user`
- `parallel_tool_calls: false` if you're not handling parallel calls

## Cloudflare Tunnel + Access setup

One-time:

1. On the host: `brew install cloudflared && cloudflared tunnel login && cloudflared tunnel create codex-relay`.
2. `config.yml` pointing the tunnel at `http://127.0.0.1:8787` on a hostname like `codex.your-zone.example.com`.
3. `cloudflared tunnel route dns codex-relay codex.your-zone.example.com`.
4. `cloudflared tunnel run codex-relay` (install as a launchd/systemd service so it survives reboots).
5. Zero Trust → Access → Applications: create a self-hosted app for that hostname with a **Service Token** policy. Copy the client ID/secret into the caller's env.

Only requests carrying the service-token headers reach the tunnel; everything else is 403'd at the edge.

## Layout

```
codex-relay/
├── package.json
├── tsconfig.json
├── README.md
└── src/
    ├── auth.ts       # auth.json + token refresh
    ├── codex.ts      # forwardToCodex(): build headers + POST upstream
    └── index.ts      # Hono server + /v1/responses passthrough + logging
```

Self-contained — safe to `git mv` out to its own repo later.
