# Downy

Build a team of agents and interface with them through a purpose-built web app you can access from anywhere.

100% open source. Self-host on Cloudflare and use your OpenAI subscription for frontier models at an affordable price.

![Downy demo](docs/demo.gif)

## Why Downy

- **Self-hosted.**
  - Runs in your Cloudflare account or locally on your machine.
- **Multi-agent.**
  - Each agent has its own personality, skills, tools, and workspace. Create specific agents instead of trying to make OpenClaw or Hermes do everything. 
- **Kimi 2.6 by default — or your OpenAI subscription.**
  - Kimi runs on Workers AI, but costs money based on token usage; OpenAI's models are smarter. See [Optional: ChatGPT subscription](#optional-chatgpt-subscription) to use your existing ChatGPT Plus/Pro at a flat-rate cost.
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

You'll need:

- Node 22+
- A Cloudflare account with Workers AI + Browser Rendering enabled
- An [Exa](https://exa.ai) API key — required; the search tool won't work without it. (Other providers coming soon.)
- `npx wrangler login`

Then:

```bash
pnpm install
npx wrangler secret put EXA_API_KEY    # paste key when prompted
pnpm run deploy
```

The Worker rejects every request until Cloudflare Access is in front of it — that's next.

## Authentication: Cloudflare Access

**Why this is safer than a public Worker.** Without Access, your Worker is a public URL — anyone on the internet can hit any endpoint. Adding password auth in your code helps, but the auth code itself becomes attack surface. Cloudflare Access moves identity enforcement to Cloudflare's edge: every request is checked against your SSO/MFA policy *before* it reaches your Worker. By the time your code runs, the request is already authenticated; the Worker only verifies the cryptographic JWT Cloudflare attached. There's no path around the gate — even direct hits to your `*.workers.dev` URL are intercepted at the edge.

Setup:

1. **Pick a Zero Trust team name** at [one.dash.cloudflare.com](https://one.dash.cloudflare.com). Your team domain is `https://<team>.cloudflareaccess.com`.
2. **Add a self-hosted Access Application** (Zero Trust → Access → Applications → Add) for your Worker hostname (`downy.<sub>.workers.dev` or your custom domain). Add an Allow policy with your email. Copy the **AUD tag** from the app's Overview.
3. **Set Worker variables** (Workers & Pages → downy → Settings → Variables and Secrets):
   - `TEAM_DOMAIN` = `https://<team>.cloudflareaccess.com`
   - `POLICY_AUD` = the AUD tag
4. `pnpm run deploy`, then open the URL — it should prompt you to log in. Use the same email as your Cloudflare account.

<details>
<summary>Sign-in works but you still see "Authentication required"?</summary>

`npx wrangler tail` shows the verifier's failure reason — usually `TEAM_DOMAIN` missing `https://` or a stale `POLICY_AUD`.
</details>

## Optional: ChatGPT subscription

Point Downy at your **ChatGPT Plus/Pro subscription** instead of Kimi. OpenAI's models are smarter than Kimi 2.6, and a flat-rate subscription is cheaper than per-token API billing. OpenAI currently allows third-party harnesses to use ChatGPT subscriptions for personal use — that policy could change at any time, so treat this path as best-effort.

**The trick:** the proxy holds your subscription's OAuth tokens, so it must never be reachable from the public internet. Downy uses a small proxy on your hardware (a Mac mini, Raspberry Pi, or VPS) listening only on loopback. A Cloudflare Tunnel makes an **outbound** connection from that host to Cloudflare — no inbound port, no public hostname. The Worker reaches the tunnel through a Workers VPC binding, which is account-scoped and never traverses the public internet. The proxy itself runs without auth because the network boundary *is* the security.

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
