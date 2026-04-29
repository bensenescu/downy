import { Link } from "@tanstack/react-router";
import { PanelLeftClose, PanelLeftOpen, SlidersHorizontal } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";

import { useCurrentAgentSlug } from "../../lib/agents";
import { setMobilePanelOpen, useMobilePanelOpen } from "../../lib/mobile-panel";
import {
  AgentSelector,
  BackgroundTasksSection,
  IdentitySection,
  McpSection,
  SettingsSection,
  SkillsSection,
  WorkspaceSection,
  type AgentSocket,
} from "./agent-panel-sections";

type Props = {
  agent: AgentSocket;
};

const COLLAPSED_KEY = "downy:agent-panel-collapsed";
const COLLAPSED_EVENT = "downy:agent-panel-collapsed-change";

function readCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(COLLAPSED_KEY) === "true";
}

function writeCollapsed(v: boolean): void {
  window.localStorage.setItem(COLLAPSED_KEY, String(v));
  window.dispatchEvent(new Event(COLLAPSED_EVENT));
}

function subscribeCollapsed(cb: () => void): () => void {
  window.addEventListener("storage", cb);
  window.addEventListener(COLLAPSED_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(COLLAPSED_EVENT, cb);
  };
}

function useDesktopCollapsed(): [boolean, (v: boolean) => void] {
  const value = useSyncExternalStore(
    subscribeCollapsed,
    readCollapsed,
    () => false,
  );
  return [value, writeCollapsed];
}

export default function AgentPanel({ agent }: Props) {
  const [desktopCollapsed, setDesktopCollapsed] = useDesktopCollapsed();
  const mobileOpen = useMobilePanelOpen();
  const slug = useCurrentAgentSlug();

  // Lock body scroll while the mobile drawer is open.
  useEffect(() => {
    if (!mobileOpen) return undefined;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [mobileOpen]);

  const closeMobile = () => {
    setMobilePanelOpen(false);
  };

  return (
    <>
      {/* Desktop open button — only when collapsed. Sits at the very top-left
          of the viewport since there's no global header to anchor against. */}
      {desktopCollapsed ? (
        <button
          type="button"
          onClick={() => {
            setDesktopCollapsed(false);
          }}
          aria-label="Open panel"
          className="btn btn-ghost btn-sm btn-square fixed left-2 top-2 z-40 hidden border border-base-300/60 bg-base-100/90 text-base-content/70 shadow-sm backdrop-blur hover:text-base-content md:inline-flex"
        >
          <PanelLeftOpen size={16} />
        </button>
      ) : null}

      {/* Mobile backdrop. */}
      {mobileOpen ? (
        <button
          type="button"
          aria-label="Close panel"
          onClick={closeMobile}
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
        />
      ) : null}

      <aside
        className={[
          "z-50 flex shrink-0 flex-col border-r border-base-300 bg-base-100 transition-all duration-200 ease-out",
          // Mobile drawer: floats over content from the left edge.
          "fixed inset-y-0 left-0 w-[85vw] max-w-xs",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          // Desktop in-flow column, full viewport height.
          "md:static md:h-full md:translate-x-0 md:bg-base-100/40",
          desktopCollapsed
            ? "md:w-0 md:overflow-hidden md:border-r-0"
            : "md:w-72",
        ].join(" ")}
        aria-hidden={!mobileOpen && desktopCollapsed ? true : undefined}
      >
        {/* Top: Downy identity row + collapse toggle inline. No standalone
            row, so no whitespace band when the panel is open. */}
        <div className="flex items-center justify-between gap-2 px-4 pt-4">
          <Link
            to="/agent/$slug"
            params={{ slug }}
            className="min-w-0 truncate text-base font-semibold no-underline hover:opacity-80"
            onClick={closeMobile}
          >
            Downy
          </Link>
          <button
            type="button"
            onClick={() => {
              setDesktopCollapsed(true);
            }}
            aria-label="Collapse panel"
            className="btn btn-ghost btn-xs btn-square hidden text-base-content/60 md:inline-flex"
          >
            <PanelLeftClose size={14} />
          </button>
          <button
            type="button"
            onClick={closeMobile}
            aria-label="Close panel"
            className="btn btn-ghost btn-xs btn-square text-base-content/60 md:hidden"
          >
            <PanelLeftClose size={14} />
          </button>
        </div>

        {/* Scrollable content. Agent settings sits with the other sections;
            the footer holds only the user-level Preferences link. */}
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
          <AgentSelector />
          <IdentitySection onNavigate={closeMobile} />
          <WorkspaceSection onNavigate={closeMobile} />
          <SkillsSection onNavigate={closeMobile} />
          <McpSection agent={agent} onNavigate={closeMobile} />
          <BackgroundTasksSection agent={agent} onNavigate={closeMobile} />
          <SettingsSection onNavigate={closeMobile} />
        </div>

        {/* Footer: user-level preferences (theme, density, archived agents).
            A direct link, not a dropdown — the dropdown trigger inside an
            overflow-hidden flex column was getting clipped. */}
        <div className="border-t border-base-300/60 px-4 py-3">
          <Link
            to="/settings"
            onClick={closeMobile}
            className="flex items-center gap-2 rounded-md px-1.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-base-content/60 hover:bg-base-200 hover:text-base-content"
          >
            <SlidersHorizontal size={12} />
            Preferences
          </Link>
        </div>
      </aside>
    </>
  );
}
