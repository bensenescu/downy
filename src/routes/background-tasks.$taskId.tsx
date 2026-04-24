import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";

import BackgroundTaskView from "../components/chat/BackgroundTaskView";

export const Route = createFileRoute("/background-tasks/$taskId")({
  component: BackgroundTaskPage,
});

function BackgroundTaskPage() {
  const { taskId } = Route.useParams();

  return (
    <main className="mx-auto flex h-[calc(100vh-4.25rem)] w-full max-w-5xl flex-col px-4 pb-4 pt-4">
      <div className="mb-3 flex items-center gap-2">
        <Link
          to="/"
          className="btn btn-ghost btn-sm gap-1.5"
          aria-label="Back to chat"
        >
          <ChevronLeft size={14} />
          Back to chat
        </Link>
      </div>
      <div className="flex-1 overflow-hidden rounded-lg border border-base-300 bg-base-100 shadow-sm">
        <BackgroundTaskView taskId={taskId} />
      </div>
    </main>
  );
}
