import { createFileRoute } from "@tanstack/react-router";

import BackgroundTaskView from "../components/chat/BackgroundTaskView";
import BackLink from "../components/ui/BackLink";
import { useBackHint } from "../lib/back-nav";

export const Route = createFileRoute("/agent/$slug/background-tasks/$taskId")({
  component: BackgroundTaskPage,
});

// This page intentionally skips PageShell: it needs full-viewport height for
// the embedded BackgroundTaskView (a scroll container) and a different
// padding profile than the standard list/detail pages.
function BackgroundTaskPage() {
  const { slug, taskId } = Route.useParams();
  const back = useBackHint({
    href: `/agent/${slug}/background-tasks`,
    label: "background tasks",
  });

  return (
    <main className="mx-auto flex h-[calc(100vh-3.5rem)] w-full max-w-5xl flex-col px-4 pb-4 pt-4 md:h-screen">
      <BackLink to={back.href} label={back.label} variant="chip" />
      <div className="flex-1 overflow-hidden rounded-lg border border-base-300/70 bg-base-100">
        <BackgroundTaskView taskId={taskId} />
      </div>
    </main>
  );
}
