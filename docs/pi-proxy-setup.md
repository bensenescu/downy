# Pi proxy setup

The Pi proxy lets Downy route inference through your **ChatGPT Plus/Pro subscription** via [`@mariozechner/pi-ai`](https://www.npmjs.com/package/@mariozechner/pi-ai).

OpenAI currently allows third-party harnesses to use ChatGPT subscriptions for personal use, but that policy could change at any time — treat this path as best-effort. See [`aisdk-pi-proxy/README.md`](../aisdk-pi-proxy/README.md) for ToS context.

## How the network path works

The proxy holds your subscription's OAuth tokens — anyone who can reach it can drain your account. The setup below makes sure the proxy is _unreachable from the public internet_:

- The proxy listens only on loopback (`127.0.0.1:8788`) on a host you control.
- A Cloudflare Tunnel (`cloudflared`) makes an **outbound** connection from that host to Cloudflare's edge. No inbound port, no public hostname.
- The Worker reaches the tunnel through a **Workers VPC binding**, which is account-scoped and never traverses the public internet.

The proxy itself runs without auth because the network boundary _is_ the security. The walkthrough below binds the proxy to `127.0.0.1` and runs `cloudflared` on the same host, so the only thing that can reach the proxy is `cloudflared` itself.

## Steps

1. **Sign in and start the proxy** on the host (a Mac mini, Raspberry Pi, or VPS so it's always available):

   ```bash
   cd aisdk-pi-proxy/
   npm install
   npx @mariozechner/pi-ai login openai-codex   # once, writes auth.json
   HOST=127.0.0.1 PORT=8788 npm start
   ```

   `auth.json` is refreshed automatically on subsequent runs.

2. **Create the tunnel.** Cloudflare dashboard → **Networking → Tunnels → Create**. Name it `pi-relay`, pick your OS, and run the `cloudflared` install command on this same host. Wait for the dashboard to show **Healthy**, then copy the tunnel ID.

3. **Register the VPC service** so the tunnel forwards requests to the proxy on loopback:

   ```bash
   npx wrangler vpc service create pi-relay \
     --type http \
     --tunnel-id <TUNNEL_ID> \
     --ipv4 127.0.0.1 \
     --http-port 8788
   ```

   Copy the returned service ID. (If you ever split the proxy onto a different host, swap `--ipv4 127.0.0.1` for the proxy host's private IP, or use `--hostname <dns-name>` — the CLI rejects IPs in `--hostname`.)

4. **Bind it and deploy.** Drop the service ID into your `.env` as `PI_RELAY_VPC_SERVICE_ID`, then deploy:

   ```bash
   echo "PI_RELAY_VPC_SERVICE_ID=<service-id>" >> .env
   pnpm deploy
   ```

   `alchemy.run.ts` reads that env var and adds the `PI_RELAY_VPC` binding via `VpcServiceRef` only when it's set, so you can leave the line commented out on machines that don't have the proxy.

5. **Switch Downy to the proxy.** Open the deployed app at `/settings` → **Preferences** → **Model** and pick **Pi proxy — production VPC**. New turns route through your subscription.

## Troubleshooting

If turns fail, `pnpm tail` shows the runtime error. `connection_refused` means `cloudflared` can't reach the proxy on loopback — check it's running with `curl http://127.0.0.1:8788/health` on the tunnel host. `npx wrangler vpc service list` confirms the service is registered. Workers VPC is in public beta and free on all Workers plans.
