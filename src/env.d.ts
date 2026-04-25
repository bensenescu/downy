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
  }
}
