import { createFileRoute } from "@tanstack/react-router";

import McpServersCard from "../components/McpServersCard";
import BackLink from "../components/ui/BackLink";
import PageHeader from "../components/ui/PageHeader";
import PageShell from "../components/ui/PageShell";

export const Route = createFileRoute("/agent/$slug/mcp/")({
  component: McpPage,
});

function McpPage() {
  const { slug } = Route.useParams();
  return (
    <PageShell>
      <BackLink to="/agent/$slug" params={{ slug }} label="chat" />

      <PageHeader kicker="MCP servers" title="Connected tools." />

      <McpServersCard />
    </PageShell>
  );
}
