# OpenClaw

A personal AI agent that runs entirely on your Cloudflare account —
persistent memory, editable identity, real tools.

![OpenClaw demo](docs/demo.gif)

## Why OpenClaw

- **Self-hosted.** 
    - Runs in your Cloudflare account or locally on your machine.
- **Kimi 2.6 through Cloudflare Workers AI**
    - This is the default model, but we recommend using your OpenAI sub since their models are better.
- **Use your OpenAI Subscription** 
    - Read [Pi Proxy](#pi-proxy-vpc-setup) to see how to use your OpenAI sub with your agents
- **Access Anywhere**
    - Cloudflare native so you can easily deploy and securely access Meerkats from all your devices.
- **Multi Agent**
    - Create different agents with different skills and personalities. Each has their own workspace. 

See `docs/product-spec.md` and `docs/technical-plan.md` for the design.

## Setup

You'll need:

- Node 22+
- A Cloudflare account with Workers AI + Browser Rendering enabled
- An [Exa](https://exa.ai) API key (**required** — the search tool
  won't work without it)
  - We'll add support for other search providers soon.
- `npx wrangler login`

Then:

```bash
pnpm install
npx wrangler secret put EXA_API_KEY    # paste key when prompted
pnpm run deploy
```

The Worker rejects every request until Cloudflare Access is in front of
it — that's the next section.

## Cloudflare Access

Browser requests redirect to `/unauthenticated`; API/WebSocket get
JSON 401.

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
- `pi-prod` — deployed Workers via a Workers VPC binding. See
  [Pi proxy VPC setup](#pi-proxy-vpc-setup) below.

See `aisdk-pi-proxy/README.md` for ToS caveats.

### Pi proxy VPC setup

The deployed Worker reaches the proxy through a Workers VPC binding,
which is the only network path in. The tunnel is outbound-only (no
public hostname, no inbound port) and the binding is account-scoped,
so the proxy stays unreachable from the internet and runs without auth.
Just don't expose port 8788 on the host's public interface.

The setup is four steps. Run all of them on the machine where the
proxy will live — co-locating the proxy and `cloudflared` means
everything talks over loopback and there's nothing else to wire up.

1. **Start the proxy.** From `aisdk-pi-proxy/`:
   ```bash
   HOST=0.0.0.0 PORT=8788 npm start
   ```
2. **Create the tunnel.** Cloudflare dashboard → **Networking →
   Tunnels → Create**. Name it `pi-relay`, pick your OS, and run the
   `cloudflared` install command it gives you on this same host. Wait
   for the dashboard to show **Healthy**, then copy the tunnel ID.
3. **Register the VPC service** so the tunnel forwards requests to the
   proxy on loopback:
   ```bash
   npx wrangler vpc service create pi-relay \
     --type http \
     --tunnel-id <TUNNEL_ID> \
     --ipv4 127.0.0.1 \
     --http-port 8788
   ```
   Copy the returned service ID. (If you ever split the proxy onto a
   different host, swap `--ipv4 127.0.0.1` for the proxy host's
   private IP, or use `--hostname <dns-name>` — the CLI rejects IPs
   in `--hostname`.)
4. **Bind it and deploy.** Uncomment the `vpc_services` block in
   `wrangler.jsonc`, paste the service ID, then:
   ```bash
   npm run cf-typegen && npm run deploy
   ```
   ```jsonc
   "vpc_services": [
     { "binding": "PI_RELAY_VPC", "service_id": "<service-id>" }
   ]
   ```

If turns fail, `npx wrangler tail` shows the runtime error.
`connection_refused` means `cloudflared` can't reach the proxy on
loopback — check it's running with `curl http://127.0.0.1:8788/health`
on the tunnel host. `npx wrangler vpc service list` confirms the
service is registered. Workers VPC is in public beta and free on all
Workers plans.

## Local development

```bash
npm run dev
```

Create `.env.local`:

```
EXA_API_KEY=your-exa-key-here
# Disable Cloudflare Access gating local dev
LOCAL_NOAUTH=1
```

`EXA_API_KEY` is the same key you set as a secret in Setup — required
for the search tool to work locally too. `LOCAL_NOAUTH=1` bypasses the
Cloudflare Access gate; never set it in production.

## CI

```bash
npm run ci:check       # prettier + knip + tsc + oxlint
npm run format:write
npm run lint:fix
```
