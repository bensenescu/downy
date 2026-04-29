import { Link, useRouterState } from "@tanstack/react-router";
import {
  ChevronDown,
  Menu,
  Settings as SettingsIcon,
  User,
} from "lucide-react";

import { useAgents, useCurrentAgentSlug } from "../lib/agents";
import { setMobilePanelOpen } from "../lib/mobile-panel";

// Mobile-only top bar. The desktop layout puts identity, agent selector, and
// the user menu inside the sidebar instead of a global header — which frees
// the vertical space the header used to consume.
export default function Header() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const slug = useCurrentAgentSlug();
  const onChat = /^\/agent\/[^/]+\/?$/.test(pathname);

  return (
    <header className="sticky top-0 z-50 flex min-h-14 w-full items-center gap-2 bg-base-100/80 px-2 backdrop-blur-lg md:hidden">
      <div className="flex flex-1 items-center gap-2">
        {onChat ? (
          <>
            <button
              type="button"
              aria-label="Open panel"
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
            Downy
          </Link>
        )}
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
  if (!selected) return null;

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
      <span className="truncate">{selected.displayName}</span>
      <ChevronDown size={14} className="shrink-0 text-base-content/60" />
    </button>
  );
}

function UserMenu({
  align = "end",
  triggerClassName,
}: {
  align?: "start" | "end";
  triggerClassName?: string;
} = {}) {
  return (
    <div className={`dropdown ${align === "end" ? "dropdown-end" : ""}`}>
      <div
        tabIndex={0}
        role="button"
        aria-label="Open user menu"
        className={
          triggerClassName ??
          "flex size-9 items-center justify-center rounded-full bg-base-200 text-base-content/80 active:bg-base-300 md:bg-transparent md:hover:bg-base-200"
        }
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
