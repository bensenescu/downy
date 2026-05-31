import { createFileRoute, Link } from "@tanstack/react-router";
import { useSystemStatus } from "../lib/queries";
import PageShell from "../components/ui/PageShell";
import BackLink from "../components/ui/BackLink";
import PageHeader from "../components/ui/PageHeader";
import { useFallbackAgentSlug } from "../lib/agents";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ShieldCheck,
  MessageSquare,
  Database,
  ExternalLink,
  Activity,
  Box,
  Brain,
  HardDrive,
} from "lucide-react";

export const Route = createFileRoute("/settings/status")({
  component: SystemStatusPage,
});

function SystemStatusPage() {
  const fallbackSlug = useFallbackAgentSlug();
  const { data: status, isLoading, error } = useSystemStatus();

  if (isLoading) return <PageShell>Loading...</PageShell>;
  if (error) return <PageShell>Error: {error.message}</PageShell>;
  if (!status) return <PageShell>No status data available.</PageShell>;

  const StatusItem = ({
    label,
    value,
    status: itemStatus,
  }: {
    label: string;
    value: string;
    status: "ok" | "warn" | "error";
  }) => (
    <div className="flex items-center justify-between p-4 bg-base-200 rounded-lg">
      <div>
        <div className="text-sm opacity-60 uppercase tracking-wider font-bold">
          {label}
        </div>
        <div className="text-lg font-medium">{value}</div>
      </div>
      <div>
        {itemStatus === "ok" && (
          <CheckCircle2 className="text-success w-6 h-6" />
        )}
        {itemStatus === "warn" && (
          <AlertTriangle className="text-warning w-6 h-6" />
        )}
        {itemStatus === "error" && <XCircle className="text-error w-6 h-6" />}
      </div>
    </div>
  );

  return (
    <PageShell width="wide">
      {fallbackSlug ? (
        <BackLink
          to="/agent/$slug"
          params={{ slug: fallbackSlug }}
          label="chat"
        />
      ) : (
        <BackLink to="/" label="home" />
      )}

      <PageHeader kicker="System" title="Status & Health." />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-8">
        <section className="space-y-4">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <ShieldCheck className="w-5 h-5" /> External Services
          </h2>
          <StatusItem
            label="Exa Search API"
            value={status.exaConfigured ? "Configured" : "Missing API Key"}
            status={status.exaConfigured ? "ok" : "warn"}
          />
          <StatusItem
            label="VPC Tunnel (ChatGPT)"
            value={status.vpcTunnelConfigured ? "Connected" : "Not Configured"}
            status={status.vpcTunnelConfigured ? "ok" : "warn"}
          />
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <MessageSquare className="w-5 h-5" /> Integrations
          </h2>
          <StatusItem
            label="Telegram Bot"
            value={status.telegramConfigured ? "Active" : "Disabled"}
            status={status.telegramConfigured ? "ok" : "warn"}
          />
          <div className="p-4 bg-base-200 rounded-lg">
            <div className="text-sm opacity-60 uppercase tracking-wider font-bold mb-1">
              Telegram Whitelist
            </div>
            <div className="font-mono text-xs break-all">
              {status.telegramWhitelist || "None (Open)"}
            </div>
          </div>
        </section>

        <section className="space-y-4 md:col-span-2">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Activity className="w-5 h-5" /> Agent Health & Usage
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(status.agentStats || []).map((agent: any) => (
              <div
                key={agent.slug}
                className="p-4 bg-base-200 rounded-lg border border-base-300"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="font-bold text-lg">agent/{agent.slug}</div>
                  <Link
                    to="/agent/$slug"
                    params={{ slug: agent.slug }}
                    className="btn btn-ghost btn-xs"
                  >
                    View <ExternalLink size={12} />
                  </Link>
                </div>

                {agent.error ? (
                  <div className="text-error text-sm flex items-center gap-1">
                    <XCircle size={14} /> Failed to fetch metrics
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-base-100 p-2 rounded flex flex-col">
                        <span className="text-[10px] uppercase opacity-50 font-bold">
                          Tokens (In/Out)
                        </span>
                        <span className="font-mono text-sm">
                          {agent.usage?.input || 0} / {agent.usage?.output || 0}
                        </span>
                      </div>
                      <div className="bg-base-100 p-2 rounded flex flex-col">
                        <span className="text-[10px] uppercase opacity-50 font-bold">
                          Workspace Storage
                        </span>
                        <span className="font-mono text-sm">
                          {(agent.storageUsage / 1024).toFixed(1)} KB
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <div className="badge badge-sm badge-outline gap-1">
                        <Box size={10} /> {agent.fileCount} files
                      </div>
                      <div className="badge badge-sm badge-success gap-1">
                        {agent.completedTasks} tasks done
                      </div>
                      {agent.activeTasks > 0 && (
                        <div className="badge badge-sm badge-warning gap-1 animate-pulse">
                          {agent.activeTasks} running
                        </div>
                      )}
                      {agent.failedTasks > 0 && (
                        <div className="badge badge-sm badge-error gap-1">
                          {agent.failedTasks} failed
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-4 md:col-span-2">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Database className="w-5 h-5" /> AI Providers
          </h2>
          <div className="p-6 bg-base-200 rounded-lg border border-base-300">
            <div className="flex items-center justify-between mb-4">
              <div className="text-2xl font-bold">
                {status.aiProvidersCount} Registered Providers
              </div>
              <ExternalLink className="opacity-40" />
            </div>
            <p className="opacity-70 mb-4">
              You have {status.aiProvidersCount} custom AI providers configured.
              These include OpenAI, Anthropic, Google, and OpenRouter
              connections.
            </p>
            <div className="flex gap-2">
              <Link to="/settings" className="btn btn-sm btn-primary">
                Manage Providers
              </Link>
            </div>
          </div>
        </section>
      </div>
    </PageShell>
  );
}
