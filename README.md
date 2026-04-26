# OpenClaw Cloud Native

A cloud-hosted personal agent on Cloudflare. One persistent chat, four
editable identity files, a workspace, and tools (Exa search, Puppeteer
scrape). Default model: Kimi K2.6 via Workers AI.

See `docs/product-spec.md` and `docs/technical-plan.md`.

## Prerequisites

- Node 22+
- Cloudflare account with Workers AI + Browser Rendering
- Exa API key from [exa.ai](https://exa.ai)
- `npx wrangler login`

## Setup

```bash
npm install
npx wrangler r2 bucket create openclaw-workspace
npx wrangler secret put EXA_API_KEY
```

## Local dev

```bash
npm run dev
```

Create `.env.local`:

```
EXA_API_KEY=your-exa-key-here
LOCAL_NOAUTH=1
```

`LOCAL_NOAUTH=1` bypasses the Cloudflare Access gate locally. Never set
in production.

## Deploy

```bash
npm run deploy
```

## Cloudflare Access

The Worker rejects every request until Access is wired up. Browser
requests redirect to `/unauthenticated`; API/WebSocket get JSON 401.

1. **Pick a Zero Trust team name** at
   [one.dash.cloudflare.com](https://one.dash.cloudflare.com). Your team
   domain is `https://<team>.cloudflareaccess.com`.
2. **Add a self-hosted Access Application** (Zero Trust → Access →
   Applications → Add) for your Worker hostname
   (`openclaw.<sub>.workers.dev` or your custom domain). Add an Allow
   policy with your email. Copy the **AUD tag** from the app's Overview.
3. **Set Worker variables** (Workers & Pages → openclaw → Settings →
   Variables and Secrets):
   - `TEAM_DOMAIN` = `https://<team>.cloudflareaccess.com`
   - `POLICY_AUD` = the AUD tag
4. `npm run deploy`, then open the URL in incognito.

If sign-in works but you still see "Authentication required",
`npx wrangler tail` shows the verifier's failure reason — usually
`TEAM_DOMAIN` missing `https://` or a stale `POLICY_AUD`.

## Pi proxy (optional)

Per-user opt-in alternative to Kimi via the **Model** dropdown in
Preferences. The proxy forwards Chat Completions to any provider in
`@mariozechner/pi-ai` (default: ChatGPT Plus/Pro OAuth):

- `kimi` — default, no setup.
- `pi-local` — dev only. Run `cd aisdk-pi-proxy && npm install`,
  `npx @mariozechner/pi-ai login openai-codex` once to write `auth.json`,
  then `npm run dev` (listens on `127.0.0.1:8788`).
- `pi-prod` — deployed Workers. Run the proxy on a host inside a
  Cloudflare VPC subnet (no public ingress), register a VPC connectivity
  service, and uncomment the `vpc_services` block in `wrangler.jsonc`
  with the service ID. `npm run cf-typegen && npm run deploy`.

See `aisdk-pi-proxy/README.md` for ToS caveats.

## CI

```bash
npm run ci:check       # prettier + knip + tsc + oxlint
npm run format:write
npm run lint:fix
```
