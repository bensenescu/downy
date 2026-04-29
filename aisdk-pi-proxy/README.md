# aisdk-pi-proxy

A tiny Hono HTTP server that accepts OpenAI **Responses API** requests (e.g. from `@ai-sdk/openai`'s `openai.responses(modelId)`) and forwards them to **any provider supported by [`@mariozechner/pi-ai`](https://www.npmjs.com/package/@mariozechner/pi-ai)**. Defaults to **OpenAI Codex** (ChatGPT Plus/Pro OAuth).

The Responses API has native event types for reasoning summaries, structured output items, and function-call argument streaming — pi-ai's unified events map to it directly with no `<think>` tag smuggling and no AI-SDK middleware.

- **Reasoning is native.** pi-ai's `thinking_*` events become `response.reasoning_summary_text.delta` chunks; AI SDK surfaces them as proper `reasoning-*` parts.
- **Auth is provider-agnostic.** Swapping `PI_PROVIDER` switches between Anthropic Pro/Max OAuth, GitHub Copilot, Gemini CLI, Antigravity, OpenAI Codex, or any API-key provider — pi-ai handles refresh.
- **Reasoning effort per request.** Send `x-pi-reasoning: minimal|low|medium|high|xhigh` to override the default; the request body's `reasoning.effort` is also honored.

## ⚠️ ToS warning

Using a ChatGPT Plus/Pro subscription (or Anthropic Pro/Max, etc.) for programmatic traffic likely violates the provider's terms. Realistic failure modes: rate-limiting, account suspension, silent capability downgrades, endpoint shape changing without notice. Personal/dev use only — do not ship this to other users.

## Prereqs

1. Install pi-ai's CLI and log in once on the host:

   ```bash
   cd aisdk-pi-proxy
   npm install
   npx @mariozechner/pi-ai login openai-codex
   ```

   This writes `auth.json` in the current directory. The proxy reads from the same path on startup; refreshes are written back.

2. Other providers (any of `anthropic`, `github-copilot`, `google-gemini-cli`, `google-antigravity`) work the same way — `npx @mariozechner/pi-ai login <provider>`, then set `PI_PROVIDER` accordingly.

## Run

```bash
npm install
npm run dev        # watch mode, or:
npm start
```

Smoke-test:

```bash
RELAY_URL=http://127.0.0.1:8788 npm run test:live
```

Sends a streaming request and prints content + reasoning bytes + tool-call deltas + usage.

## Env vars

| Var                    | Default               | Purpose                                                                    |
| ---------------------- | --------------------- | -------------------------------------------------------------------------- |
| `PORT`                 | `8788`                | Listen port (codex proxy uses 8787 — different by default so they coexist) |
| `HOST`                 | `127.0.0.1`           | Listen host. Set to `0.0.0.0` only on a trusted private network            |
| `PI_PROVIDER`          | `openai-codex`        | pi-ai provider id (e.g. `anthropic`, `openai`, `google`)                   |
| `PI_OAUTH_PROVIDER`    | same as `PI_PROVIDER` | Override if the OAuth provider id differs from the model provider id       |
| `PI_DEFAULT_MODEL`     | `gpt-5.4`             | Default model id when the request doesn't pin one                          |
| `PI_DEFAULT_REASONING` | `medium`              | One of `minimal`, `low`, `medium`, `high`, `xhigh`                         |
| `PI_AUTH_PATH`         | `./auth.json`         | Path to the credentials file written by `pi-ai login`                      |

## Endpoints

- `GET /health` — liveness + reports the active provider/model/reasoning
- `POST /v1/responses` — Responses API in, Responses API SSE out

### Per-request overrides (headers)

- `x-pi-reasoning: minimal | low | medium | high | xhigh` — overrides `PI_DEFAULT_REASONING` (also overridden by the request body's `reasoning.effort`)
- `x-pi-model: <model-id>` — overrides the request body's `model` field
- `x-pi-session-id: <id>` — passed to pi-ai as `sessionId` for prompt caching (pi-ai applies this for providers that support it, e.g. OpenAI Codex)

There is no auth on `/v1/*`. The proxy relies on the network it's deployed on — locally that's loopback; in production that's a Cloudflare VPC subnet reachable only via a Workers VPC connector. **Do not expose this on a public interface.**

## Wire format notes

- **Reasoning** flows as `response.output_item.added` (`type: reasoning`) → `response.reasoning_summary_text.delta` → `response.output_item.done`. AI SDK surfaces this as `reasoning-start` / `reasoning-delta` / `reasoning-end` parts.
- **Text** flows as `response.output_item.added` (`type: message`) → `response.output_text.delta` → `response.output_item.done`.
- **Tool calls** flow as `response.output_item.added` (`type: function_call`) → `response.function_call_arguments.delta` → `response.output_item.done` carrying the final argument string.
- **Usage** is reported on `response.completed` as `input_tokens` / `output_tokens` (with `input_tokens_details.cached_tokens` when pi-ai surfaces a cache-read count).
- **Errors** during streaming are emitted as a `response.failed` frame followed by `data: [DONE]` so the client doesn't hang.

## Layout

```
aisdk-pi-proxy/
├── package.json
├── tsconfig.json
├── README.md
├── auth.json              # created by `pi-ai login`, gitignored
└── src/
    ├── auth.ts                  # reads/refreshes auth.json via pi-ai/oauth
    ├── translate-request.ts     # Responses API → pi-ai Context + Tool[]
    ├── translate-response.ts    # pi-ai event stream → Responses API SSE
    └── index.ts                 # Hono server
```

Self-contained — safe to `git mv` out to its own repo later.

## Deploy

Run on a host inside a Cloudflare VPC subnet. Bind to the private interface only — no public ingress. The Worker reaches it via a Workers VPC connector binding; the connector is the only network path, so no auth lives on the proxy itself. Same operational model as `aisdk-codex-proxy`.

## Relationship to `aisdk-codex-proxy`

Once this proxy is verified end-to-end against ChatGPT Plus OAuth, it can fully replace `../aisdk-codex-proxy/`. The Codex auth file layouts differ — this proxy uses pi-ai's `auth.json` (run `pi-ai login openai-codex`), not Codex CLI's `~/.codex/auth.json`. Until the swap is confirmed, both can coexist on different ports (`8787` codex, `8788` pi).
