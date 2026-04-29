import { createFileRoute } from "@tanstack/react-router";

import AppearanceCard from "../components/AppearanceCard";
import PreferencesCard from "../components/PreferencesCard";
import BackLink from "../components/ui/BackLink";
import PageHeader from "../components/ui/PageHeader";
import PageShell from "../components/ui/PageShell";
import { useFallbackAgentSlug } from "../lib/agents";

export const Route = createFileRoute("/settings/")({ component: SettingsPage });

function SettingsPage() {
  const fallbackSlug = useFallbackAgentSlug();
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

      <PageHeader kicker="Settings" title="Preferences." />

      <div className="grid gap-4">
        <AppearanceCard />
        <PreferencesCard />
      </div>
    </PageShell>
  );
}
