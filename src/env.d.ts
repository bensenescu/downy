/// <reference types="vite/client" />
/// <reference types="@cloudflare/workers-types/experimental" />

import type { worker } from "../alchemy.run.ts";

export type CloudflareEnv = typeof worker.Env;

declare global {
  namespace Cloudflare {
    interface Env extends CloudflareEnv {}
  }

  // Mirror the wrangler-generated alias so handlers can reference `Env`
  // directly as well as `Cloudflare.Env`.
  interface Env extends Cloudflare.Env {}
}
