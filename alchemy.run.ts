/// <reference types="@cloudflare/workers-types/experimental" />

import alchemy from "alchemy";
import {
  Ai,
  D1Database,
  DurableObjectNamespace,
  R2Bucket,
  TanStackStart,
  VpcServiceRef,
  WorkerLoader,
} from "alchemy/cloudflare";

import type { ChildAgent as ChildAgentClass } from "./src/worker/agent/ChildAgent.ts";
import type { DownyAgent as DownyAgentClass } from "./src/worker/agent/DownyAgent.ts";

const app = await alchemy("downy-alchemy", {
  password: process.env.ALCHEMY_PASSWORD,
});

// Fresh D1 / R2 / DO namespaces so this deploy doesn't touch the existing
// `downy` worker's data. Flip names back to `downy` once the Alchemy path
// is validated and you're ready to cut over.
const db = await D1Database("DB", {
  name: "downy-alchemy",
  migrationsDir: "./migrations",
});

const workspaceBucket = await R2Bucket("WORKSPACE_BUCKET", {
  name: "downy-alchemy-workspace",
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
const piRelayVpc = process.env.PI_RELAY_VPC_SERVICE_ID
  ? await VpcServiceRef({ serviceId: process.env.PI_RELAY_VPC_SERVICE_ID })
  : undefined;

export const worker = await TanStackStart("downy", {
  name: "downy-alchemy",
  compatibilityDate: "2025-09-02",
  compatibilityFlags: ["nodejs_compat"],
  bindings: {
    DB: db,
    WORKSPACE_BUCKET: workspaceBucket,
    DownyAgent: downyAgent,
    ChildAgent: childAgent,
    AI: Ai<AiModels>(),
    LOADER: WorkerLoader(),
    POLICY_AUD: process.env.POLICY_AUD ?? "",
    TEAM_DOMAIN: process.env.TEAM_DOMAIN ?? "",
    MODEL_ID: process.env.MODEL_ID ?? "@cf/moonshotai/kimi-k2.6",
    EXA_API_KEY: alchemy.secret(process.env.EXA_API_KEY),
    ...(piRelayVpc ? { PI_RELAY_VPC: piRelayVpc } : {}),
  },
});

console.log({ url: worker.url });

await app.finalize();
