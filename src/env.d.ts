/// <reference types="vite/client" />

declare namespace Cloudflare {
  interface Env {
    EXA_API_KEY: string;
    AI_GATEWAY_ID?: string;
    // Cloudflare Access — set in dashboard (Variables & Secrets) once Access
    // is enabled on the Worker route. See README "Cloudflare Access".
    TEAM_DOMAIN?: string;
    POLICY_AUD?: string;
    // `wrangler dev` only — bypasses the Access JWT check. Set in .dev.vars.
    LOCAL_NOAUTH?: string;
    // Required when the `openrouter` AI provider is selected. Set with
    // `wrangler secret put OPENROUTER_API_KEY` for prod, or in `.dev.vars`
    // locally. Read defensively in src/worker/agent/get-model.ts so an
    // unset value only errors at turn time, not at boot.
    // (OPENROUTER_MODEL_ID is a wrangler var — auto-typed via cf-typegen.)
    OPENROUTER_API_KEY?: string;
  }
}
