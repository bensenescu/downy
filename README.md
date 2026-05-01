# Downy

Build a team of agents and work with them from any device.

- Best UX for working with multiple agents.
- Works out of the box with Kimi 2.6 on Workers AI — or bring your OpenAI subscription / any other model provider.

![Downy demo](docs/demo.gif)

## Why Downy

- **Self-hosted.**
  - Runs in your Cloudflare account or locally on your machine.
- **Multi-agent.**
  - Each agent has its own personality, skills, tools, and workspace. Create specific agents instead of trying to make OpenClaw or Hermes do everything.
- **Kimi 2.6 configured by default — works with zero extra setup.**
  - Inference goes to Kimi 2.6 via Workers AI out of the box; no API keys to wire up, you only pay per-token usage on your Cloudflare bill.
  - Prefer something smarter? Point Downy at your existing **ChatGPT Plus/Pro** for a flat-rate cost — see [Optional: ChatGPT subscription](#optional-chatgpt-subscription) — or any OpenRouter model via an API key.
- **Purpose-built UX.**
  - Manage each agent's workspace and tools directly in the app — no Obsidian, no CLI.
  - View background tasks so you can inspect what its doing behind the scenes and coach it to do better next time.
- **Access anywhere.**
  - Cloudflare-native, so you can deploy and securely access Downy from all your devices.

## Architecture

```
[Your devices] --SSO+MFA--> [Cloudflare Access]
                                    |
                              signed JWT
                                    v
                            [Downy Worker]
                          /       |        \
                  [D1/R2/DOs] [Kimi]   [VPC binding] (optional)
                                            |
                                            v
                                    [cloudflared tunnel]
                                            |
                                            v
                                  [Pi proxy on your host]
```

Downy runs entirely on Cloudflare. Each agent is a Durable Object owning its own chat, workspace, and MCP connections; files live in R2, the agent registry in D1. By default, inference goes to Kimi via Workers AI. If you'd rather use your existing ChatGPT subscription, you can run a small proxy on your own hardware and reach it through a Cloudflare Tunnel + VPC binding — see [Optional: ChatGPT subscription](#optional-chatgpt-subscription).

For the full implementation map, see [`docs/architecture.md`](docs/architecture.md).

## Deploy

Downy is deployed with [Alchemy](https://alchemy.run) — infrastructure as TypeScript. The whole config (bindings, vars, secrets, D1 migrations) lives in [`alchemy.run.ts`](alchemy.run.ts), and `pnpm deploy` syncs all of it in one command.

You'll need:

- Node 24 LTS and `pnpm` (`npm install -g pnpm`) — `nvm install 24 && nvm use 24` (23.6 also works, but 23 is EOL; 22 won't load `alchemy.run.ts` natively)
- A Cloudflare account on the **Workers Paid plan** ($5/mo) — Durable Objects with SQLite storage and Workers AI aren't available on the free plan.
- An [Exa](https://exa.ai) API key — **free** ($10 of credit, effectively unlimited for personal use). Required; the search tool won't work without it. (Other providers coming soon.)

Then, from a fresh clone:

```bash
pnpm install
pnpm alchemy login            # one-time browser OAuth to your Cloudflare account
cp .env.example .env          # then fill in EXA_API_KEY and ALCHEMY_PASSWORD (random string)
pnpm deploy
```

`pnpm deploy` creates the Worker, D1 database, R2 bucket, and Durable Object namespaces (or adopts existing ones with the same name), runs any pending D1 migrations from `migrations/`, and pushes the latest secrets from `.env`. Re-running it is idempotent — only changed resources are touched.

If your Cloudflare account doesn't have a `*.workers.dev` subdomain enabled yet, turn it on at **Workers & Pages → downy → Settings → Domains & Routes** (the three-dot menu next to `workers.dev`). Otherwise the Worker has no URL to hit.

To use OpenRouter for inference, drop both `OPENROUTER_API_KEY=…` and `OPENROUTER_MODEL_ID=…` (e.g. `anthropic/claude-sonnet-4-5`) into `.env` and re-run `pnpm deploy`. Both are required — there is no default model. The provider is selectable in Settings → Preferences once they're set.

The Worker rejects every request until Cloudflare Access is in front of it — that's next.

## Authentication: Cloudflare Access

**Why this is safer than a public Worker.** Without Access, your Worker is a public URL — anyone on the internet can hit any endpoint. Adding password auth in your code helps, but the auth code itself becomes attack surface. Cloudflare Access moves identity enforcement to Cloudflare's edge: every request is checked against your SSO/MFA policy _before_ it reaches your Worker. By the time your code runs, the request is already authenticated; the Worker only verifies the cryptographic JWT Cloudflare attached. There's no path around the gate — even direct hits to your `*.workers.dev` URL are intercepted at the edge.

Setup:

1. **Pick a Zero Trust team name** at [one.dash.cloudflare.com](https://one.dash.cloudflare.com) (Settings → Custom Pages, or the first-run wizard if this is a new account). Your team domain is `https://<team>.cloudflareaccess.com`.
2. **Add a self-hosted Access Application** at [one.dash.cloudflare.com](https://one.dash.cloudflare.com) → **Access → Applications → Add an application → Self-hosted**. Use your Worker hostname (`downy.<sub>.workers.dev` or your custom domain) as the application domain. Add an Allow policy with your email. After saving, open the application's **Overview** tab and copy the **Application Audience (AUD) Tag**.
3. **Set `TEAM_DOMAIN` and `POLICY_AUD` in `.env`** — the same `.env` file you used for `EXA_API_KEY`:
   - `TEAM_DOMAIN` = `https://<team>.cloudflareaccess.com`
   - `POLICY_AUD` = the AUD tag
4. `pnpm deploy`, then open your Worker URL — Cloudflare should prompt you to log in. Use the same email you allow-listed in the Access policy. After login, **refresh the page once** if the sidebar/agent picker doesn't appear immediately.

<details>
<summary>Sign-in works but you still see "Authentication required"?</summary>

`pnpm tail` (which runs `wrangler tail downy`) shows the verifier's failure reason — usually `TEAM_DOMAIN` missing `https://` or a stale `POLICY_AUD`.

</details>

<details>
<summary>Deploy fails with `VPC service ... does not exist`?</summary>

`PI_RELAY_VPC_SERVICE_ID` should be unset in `.env` by default. If you set it, either remove it or follow [`docs/pi-proxy-setup.md`](docs/pi-proxy-setup.md) to provision the VPC service.

</details>

## Optional: ChatGPT subscription

Point Downy at your **ChatGPT Plus/Pro subscription** instead of Kimi. OpenAI's models are smarter than Kimi 2.6, and a flat-rate subscription is cheaper than per-token API billing. OpenAI currently allows third-party harnesses to use ChatGPT subscriptions for personal use — that policy could change at any time, so treat this path as best-effort.

**The trick:** the proxy holds your subscription's OAuth tokens, so it must never be reachable from the public internet. Downy uses a small proxy on your hardware (a Mac mini, Raspberry Pi, or VPS) listening only on loopback. A Cloudflare Tunnel makes an **outbound** connection from that host to Cloudflare — no inbound port, no public hostname. The Worker reaches the tunnel through a Workers VPC binding, which is account-scoped and never traverses the public internet. The proxy itself runs without auth because the network boundary _is_ the security.

Once the VPC service is set up (see walkthrough below), drop its service ID into `.env` as `PI_RELAY_VPC_SERVICE_ID=…` and `pnpm deploy` will reference it as the `PI_RELAY_VPC` binding on the Worker.

Walkthrough: [`docs/pi-proxy-setup.md`](docs/pi-proxy-setup.md).

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — full system map: Durable Objects, storage, request flow, bindings.
- [`docs/pi-proxy-setup.md`](docs/pi-proxy-setup.md) — step-by-step VPC + tunnel setup for the ChatGPT subscription path.
- [`docs/local-development.md`](docs/local-development.md) — running Downy locally, plus a `pi-local` shortcut for testing the subscription path without a tunnel.

## CI

```bash
pnpm run ci:check       # prettier + knip + tsc + oxlint
pnpm run format:write
pnpm run lint:fix
```
