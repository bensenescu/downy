# Local development

```bash
pnpm run dev
```

Create `.env.local`:

```
EXA_API_KEY=your-exa-key-here
# Disable Cloudflare Access gating local dev
LOCAL_NOAUTH=1
```

`EXA_API_KEY` is the same key you set as a Worker secret during deploy — required for the search tool to work locally too. `LOCAL_NOAUTH=1` bypasses the Cloudflare Access gate; never set it in production.

## Optional: ChatGPT subscription locally (pi-local)

To use your ChatGPT Plus/Pro subscription locally instead of Kimi — no VPC, no tunnel, just a sibling proxy on loopback. From `aisdk-pi-proxy/`:

```bash
npm install
npx @mariozechner/pi-ai login openai-codex   # once, writes auth.json
npm run dev                                  # listens on 127.0.0.1:8788
```

Then in the running app at `/settings` → **Preferences** → **Model**, pick **Pi proxy — local dev**. OpenAI currently allows third-party harnesses to use ChatGPT subscriptions for personal use, but that policy could change at any time — treat this path as best-effort. See [`aisdk-pi-proxy/README.md`](../aisdk-pi-proxy/README.md) for more.
