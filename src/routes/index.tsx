import { createFileRoute, Navigate } from "@tanstack/react-router";

import { useAgents } from "../lib/agents";

// Land on the user's top agent. The dropdown is ordered by `created_at`, so
// `agents[0]` matches what they'd see at the top of the picker. If they've
// archived everything, render a tiny empty state — there's nothing to redirect
// to and forcing a slug would 404.
export const Route = createFileRoute("/")({
  component: IndexRedirect,
});

function IndexRedirect() {
  const agents = useAgents();
  const first = agents[0];
  if (first) {
    return <Navigate to="/agent/$slug" params={{ slug: first.slug }} replace />;
  }
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">
      <h1 className="text-2xl font-bold">No agents yet</h1>
      <p className="mt-2 text-sm text-base-content/65">
        Create one from the agent picker in the sidebar to get started.
      </p>
    </main>
  );
}
