import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";

import AppearanceCard from "../components/AppearanceCard";
import PreferencesCard from "../components/PreferencesCard";
import { DEFAULT_SLUG } from "../lib/agents";

export const Route = createFileRoute("/settings/")({ component: SettingsPage });

function SettingsPage() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-12 pt-8">
      <Link
        to="/agent/$slug"
        params={{ slug: DEFAULT_SLUG }}
        className="btn btn-ghost btn-sm mb-4 gap-1 px-2"
      >
        <ChevronLeft size={14} />
        Back to chat
      </Link>

      <div className="mb-8">
        <p className="mb-2 text-xs font-bold uppercase tracking-widest text-primary">
          Settings
        </p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Preferences.
        </h1>
      </div>

      <div className="grid gap-4">
        <AppearanceCard />
        <PreferencesCard />
      </div>
    </main>
  );
}
