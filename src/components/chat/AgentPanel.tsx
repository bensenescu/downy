import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";

import { setMobilePanelOpen, useMobilePanelOpen } from "../../lib/mobile-panel";
import {
  AgentSelector,
  BackgroundTasksSection,
  IdentitySection,
  McpSection,
  SkillsSection,
  WorkspaceSection,
  type AgentSocket,
} from "./agent-panel-sections";

type Props = {
  agent: AgentSocket;
};

const COLLAPSED_KEY = "openclaw:agent-panel-collapsed";
const COLLAPSED_EVENT = "openclaw:agent-panel-collapsed-change";

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
      {/* Desktop open button — only when collapsed. */}
      {desktopCollapsed ? (
        <button
          type="button"
          onClick={() => {
            setDesktopCollapsed(false);
          }}
          aria-label="Open mission control"
          className="btn btn-ghost btn-sm btn-square fixed left-2 top-[3.75rem] z-30 hidden border border-base-300 bg-base-100 shadow-sm md:inline-flex"
        >
          <PanelLeftOpen size={16} />
        </button>
      ) : null}

      {/* Mobile backdrop. */}
      {mobileOpen ? (
        <button
          type="button"
          aria-label="Close mission control"
          onClick={closeMobile}
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
        />
      ) : null}

      <aside
        className={[
          "z-50 flex shrink-0 flex-col gap-4 border-r border-base-300 bg-base-100 transition-all duration-200 ease-out",
          // Mobile drawer.
          "fixed inset-y-0 left-0 w-[85vw] max-w-xs overflow-y-auto p-4",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          // Desktop in-flow column.
          "md:static md:translate-x-0 md:bg-base-100/40",
          desktopCollapsed
            ? "md:w-0 md:overflow-hidden md:border-r-0 md:p-0"
            : "md:w-72 md:p-4",
        ].join(" ")}
        aria-hidden={!mobileOpen && desktopCollapsed ? true : undefined}
      >
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-widest text-base-content/40">
            Mission control
          </span>
          <button
            type="button"
            onClick={() => {
              setDesktopCollapsed(true);
            }}
            aria-label="Collapse mission control"
            className="btn btn-ghost btn-xs btn-square hidden md:inline-flex"
          >
            <PanelLeftClose size={14} />
          </button>
          <button
            type="button"
            onClick={closeMobile}
            aria-label="Close mission control"
            className="btn btn-ghost btn-xs btn-square md:hidden"
          >
            <PanelLeftClose size={14} />
          </button>
        </div>

        <AgentSelector />
        <IdentitySection onNavigate={closeMobile} />
        <WorkspaceSection onNavigate={closeMobile} />
        <SkillsSection onNavigate={closeMobile} />
        <McpSection agent={agent} onNavigate={closeMobile} />
        <BackgroundTasksSection agent={agent} onNavigate={closeMobile} />
      </aside>
    </>
  );
}
