import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";

import McpServersCard from "../components/McpServersCard";

export const Route = createFileRoute("/agent/$slug/mcp/")({
  component: McpPage,
});

function McpPage() {
  const { slug } = Route.useParams();
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-8">
      <Link
        to="/agent/$slug"
        params={{ slug }}
        className="btn btn-ghost btn-sm mb-4 gap-1 px-2"
      >
        <ChevronLeft size={14} />
        Back to chat
      </Link>

      <div className="mb-6">
        <p className="mb-2 text-xs font-bold uppercase tracking-widest text-primary">
          MCP servers
        </p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Connected tools.
        </h1>
      </div>

      <McpServersCard />
    </main>
  );
}
