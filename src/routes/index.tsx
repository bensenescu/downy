import { createFileRoute, redirect } from "@tanstack/react-router";

import { DEFAULT_SLUG } from "../lib/agents";

// Land on the default agent's chat. Multi-agent routing is per-slug under
// `/agent/:slug/...`; the registry always has a `default` entry seeded by
// `ensureProfileSeeded` in entry.worker.ts, so this is always reachable.
export const Route = createFileRoute("/")({
  loader: () => {
    throw redirect({ to: "/agent/$slug", params: { slug: DEFAULT_SLUG } });
  },
});
