import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronDown, Menu, Settings as SettingsIcon, User } from "lucide-react";

import { useAgents, useCurrentAgentSlug } from "../lib/agents";
import { setMobilePanelOpen } from "../lib/mobile-panel";

export default function Header() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const slug = useCurrentAgentSlug();
  // The chat lives at `/agent/:slug` exactly — no nested segment after.
  const onChat = /^\/agent\/[^/]+\/?$/.test(pathname);

  return (
    <header className="sticky top-0 z-50 flex min-h-14 w-full items-center gap-2 bg-base-100/80 px-2 backdrop-blur-lg sm:border-b sm:border-base-300 sm:px-4">
      {/* Mobile-only: ChatGPT-style pill row. */}
      <div className="flex flex-1 items-center gap-2 md:hidden">
        {onChat ? (
          <>
            <button
              type="button"
              aria-label="Open mission control"
              onClick={() => {
                setMobilePanelOpen(true);
              }}
              className="flex size-9 items-center justify-center rounded-full bg-base-200 text-base-content/80 active:bg-base-300"
            >
              <Menu size={18} />
            </button>
            <AgentPill />
          </>
        ) : (
          <Link
            to="/agent/$slug"
            params={{ slug }}
            className="flex items-center gap-2 px-2 py-1 text-base font-semibold no-underline"
          >
            <span className="size-2 rounded-full bg-primary" />
            OpenClaw
          </Link>
        )}
      </div>

      {/* Desktop brand. */}
      <div className="hidden flex-1 md:flex">
        <Link
          to="/agent/$slug"
          params={{ slug }}
          className="flex items-center gap-2 px-2 py-1 text-base font-semibold no-underline hover:opacity-80"
        >
          <span className="size-2 rounded-full bg-primary" />
          OpenClaw
        </Link>
      </div>

      <UserMenu />
    </header>
  );
}

function AgentPill() {
  const agents = useAgents();
  const selectedSlug = useCurrentAgentSlug();
  const selected =
    agents.find((a) => a.slug === selectedSlug) ?? agents[0] ?? null;

  return (
    <button
      type="button"
      aria-label="Switch agent"
      onClick={() => {
        setMobilePanelOpen(true);
      }}
      className="flex h-9 max-w-[60vw] items-center gap-1.5 rounded-full bg-base-200 px-3.5 text-sm font-semibold text-base-content active:bg-base-300"
    >
      <span className="size-2 shrink-0 rounded-full bg-primary" />
      <span className="truncate">
        {selected?.displayName ?? "Default agent"}
      </span>
      <ChevronDown size={14} className="shrink-0 text-base-content/60" />
    </button>
  );
}

function UserMenu() {
  return (
    <div className="dropdown dropdown-end">
      <div
        tabIndex={0}
        role="button"
        aria-label="Open user menu"
        className="flex size-9 items-center justify-center rounded-full bg-base-200 text-base-content/80 active:bg-base-300 md:bg-transparent md:hover:bg-base-200"
      >
        <User size={16} />
      </div>
      <ul
        tabIndex={0}
        className="menu dropdown-content z-[60] mt-3 w-44 rounded-box border border-base-300 bg-base-100 p-2 shadow-lg"
      >
        <li>
          <Link to="/settings" className="gap-2">
            <SettingsIcon size={14} />
            Settings
          </Link>
        </li>
      </ul>
    </div>
  );
}
