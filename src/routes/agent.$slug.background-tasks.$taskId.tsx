import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";

import BackgroundTaskView from "../components/chat/BackgroundTaskView";
import { useBackHint } from "../lib/back-nav";

export const Route = createFileRoute("/agent/$slug/background-tasks/$taskId")({
  component: BackgroundTaskPage,
});

function BackgroundTaskPage() {
  const { slug, taskId } = Route.useParams();
  const back = useBackHint({
    href: `/agent/${slug}/background-tasks`,
    label: "background tasks",
  });

  return (
    <main className="mx-auto flex h-[calc(100vh-3.5rem)] w-full max-w-5xl flex-col px-4 pb-4 pt-4">
      <div className="mb-3 flex items-center gap-2">
        <Link
          to={back.href}
          className="btn btn-ghost btn-sm gap-1.5"
          aria-label={`Back to ${back.label}`}
        >
          <ChevronLeft size={14} />
          Back to {back.label}
        </Link>
      </div>
      <div className="flex-1 overflow-hidden rounded-lg border border-base-300 bg-base-100 shadow-sm">
        <BackgroundTaskView taskId={taskId} />
      </div>
    </main>
  );
}
