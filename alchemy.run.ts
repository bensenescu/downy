/// <reference types="@cloudflare/workers-types/experimental" />

import alchemy from "alchemy";
import {
  Ai,
  D1Database,
  DurableObjectNamespace,
  R2Bucket,
  TanStackStart,
} from "alchemy/cloudflare";

import type { ChildAgent as ChildAgentClass } from "./src/worker/agent/ChildAgent.ts";
import type { DownyAgent as DownyAgentClass } from "./src/worker/agent/DownyAgent.ts";

const app = await alchemy("downy", {
  password: process.env.ALCHEMY_PASSWORD,
});

// `adopt: true` makes Alchemy take over the pre-existing `downy` worker,
// `downy` D1 database, and `downy-workspace` R2 bucket on first deploy
// instead of failing with "already exists". Subsequent deploys are
// idempotent updates.
const db = await D1Database("DB", {
  name: "downy",
  adopt: true,
  migrationsDir: "./migrations",
});

const workspaceBucket = await R2Bucket("WORKSPACE_BUCKET", {
  name: "downy-workspace",
  adopt: true,
});

const downyAgent = DurableObjectNamespace<DownyAgentClass>("DownyAgent", {
  className: "DownyAgent",
  sqlite: true,
});

const childAgent = DurableObjectNamespace<ChildAgentClass>("ChildAgent", {
  className: "ChildAgent",
  sqlite: true,
});

// Optional: only present when the user has set up the ChatGPT subscription
// path (see docs/pi-proxy-setup.md). The VPC service itself is provisioned
// out-of-band by `wrangler vpc service create`; we only reference it here.
// Built inline instead of via `VpcServiceRef` because alchemy@0.93.6's
// formatter crashes on IP-based services (resolver_network is null).
const piRelayVpc = process.env.PI_RELAY_VPC_SERVICE_ID
  ? {
      type: "vpc_service" as const,
      serviceId: process.env.PI_RELAY_VPC_SERVICE_ID,
    }
  : undefined;

export const worker = await TanStackStart("downy", {
  name: "downy",
  adopt: true,
  compatibilityDate: "2025-09-02",
  compatibilityFlags: ["nodejs_compat"],
  bindings: {
    DB: db,
    WORKSPACE_BUCKET: workspaceBucket,
    DownyAgent: downyAgent,
    ChildAgent: childAgent,
    AI: Ai<AiModels>(),
    POLICY_AUD: process.env.POLICY_AUD ?? "",
    TEAM_DOMAIN: process.env.TEAM_DOMAIN ?? "",
    MODEL_ID: process.env.MODEL_ID ?? "@cf/moonshotai/kimi-k2.6",
    EXA_API_KEY: alchemy.secret(process.env.EXA_API_KEY),
    // Optional: only used when the `openrouter` AI provider is selected in
    // Settings → Preferences. Both vars must be set explicitly — there is no
    // default model. Read defensively in src/worker/agent/get-model.ts so
    // deploys without them boot fine and only error at turn time.
    ...(process.env.OPENROUTER_API_KEY
      ? { OPENROUTER_API_KEY: alchemy.secret(process.env.OPENROUTER_API_KEY) }
      : {}),
    ...(process.env.OPENROUTER_MODEL_ID
      ? { OPENROUTER_MODEL_ID: process.env.OPENROUTER_MODEL_ID }
      : {}),
    ...(piRelayVpc ? { PI_RELAY_VPC: piRelayVpc } : {}),
  },
});

console.log({ url: worker.url });

await app.finalize();
