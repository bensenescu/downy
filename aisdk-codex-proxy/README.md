# codex-relay

A tiny Hono HTTP server that forwards ChatGPT/Codex Responses API requests to `chatgpt.com/backend-api/codex/responses` using a long-lived OAuth session.

The relay is intentionally **dumb**: it injects auth headers, forwards bytes, and streams the SSE response back. All Codex-OAuth quirks (field stripping, `instructions` lifting, required `store: false`) are the **caller's** responsibility — see `../src/worker/agent/get-model.ts` in Emily for one implementation.

Run it on a host that has a persistent `codex login` and expose it on a private interface only — locally that's loopback; in production that's a Cloudflare VPC subnet reachable from the Worker via a Workers VPC connector.

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

There is no auth on `/v1/*`. The relay relies on the network it's deployed on — locally that's loopback; in production that's a Cloudflare VPC subnet reachable only via a Workers VPC connector. Do not expose this on a public interface.

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

## Deploy

Run on a host inside a Cloudflare VPC subnet. Bind to the private interface only — no public ingress. The Worker reaches it via a Workers VPC connector binding (`CODEX_RELAY_VPC` in this repo's `wrangler.jsonc`); the connector is the only network path, so no auth lives on the relay itself.

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
