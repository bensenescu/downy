import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";

import McpServersCard from "../components/McpServersCard";

export const Route = createFileRoute("/mcp/")({ component: McpPage });

function McpPage() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-12 pt-8">
      <Link to="/" className="btn btn-ghost btn-sm mb-4 gap-1 px-2">
        <ChevronLeft size={14} />
        Back to chat
      </Link>

      <div className="mb-6">
        <p className="mb-2 text-xs font-bold uppercase tracking-widest text-primary">
          MCP servers
        </p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Tools attached to this agent.
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-base-content/70 sm:text-base">
          Remote tool servers Claw has connected this session. Ask Claw to
          connect or disconnect a server in chat.
        </p>
      </div>

      <McpServersCard />
    </main>
  );
}
