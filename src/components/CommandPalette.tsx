import { Command } from "cmdk";
import { type NavigateOptions, useNavigate } from "@tanstack/react-router";
import { CornerDownLeft, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useArchiveAgent, useCurrentAgentSlug } from "../lib/agents";
import { confirmDialog } from "./ui/dialog";

import {
  ActionsScope,
  AgentsScope,
  IdentityScope,
  McpScope,
  NewAgentScope,
  RootScope,
  SettingsScope,
  ThemesScope,
} from "./CommandPalette.scopes";
import { SkillsScope, WorkspaceScope } from "./CommandPalette.hybrid-scopes";
import {
  resolveScopeKey,
  type Scope,
  type ScopeKey,
  SCOPE_PREFIX,
} from "./CommandPalette.types";

// ── Main component ─────────────────────────────────────────────────────────

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Scope>(null);
  const [search, setSearch] = useState("");
  const [value, setValue] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const navigate = useNavigate();
  const slug = useCurrentAgentSlug();
  const archiveMut = useArchiveAgent();

  // Global ⌘K / Ctrl+K toggle. cmdk docs: "Listen for ⌘K automatically? No,
  // do it yourself to have full control over keybind context."
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  // Drive native <dialog> off the open flag — same idiom as DialogHost.
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  function reset() {
    setOpen(false);
    setScope(null);
    setSearch("");
    setValue("");
  }

  function enterScope(next: Scope) {
    setScope(next);
    setSearch("");
    setValue("");
  }

  function go(target: NavigateOptions) {
    void navigate(target);
    reset();
  }

  async function runArchive(target: string) {
    reset();
    const ok = await confirmDialog({
      title: "Archive agent?",
      message: `This will hide ${target} from the agent list. You can restore it from Settings → Archived agents.`,
      confirmLabel: "Archive",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await archiveMut.mutateAsync(target);
    } catch {
      // Surfacing failure inline would require keeping the palette open; the
      // toast/error path can be added once we have a global notification host.
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    // Backspace-on-empty pops scope (cmdk's pages-pattern recipe).
    if (e.key === "Backspace" && !search && scope) {
      e.preventDefault();
      enterScope(null);
      return;
    }
    // Tab on a category row enters that scope. cmdk's filter ranks by visible
    // text + keywords, so tab-to-scope works on whatever the user typed —
    // e.g. "ag<Tab>" lands on Agents.
    if (e.key === "Tab" && !scope && value.startsWith(SCOPE_PREFIX)) {
      const next = resolveScopeKey(value.slice(SCOPE_PREFIX.length));
      if (next) {
        e.preventDefault();
        enterScope(next);
      }
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      data-cmdk-dialog="true"
      onClose={() => {
        reset();
      }}
    >
      <div className="modal-box w-[640px] max-w-[92vw] p-0 shadow-2xl">
        <Command
          label="Command palette"
          value={value}
          onValueChange={setValue}
          onKeyDown={onKeyDown}
          shouldFilter={scope !== "new-agent"}
        >
          <PaletteHeader
            scope={scope}
            onClearScope={() => {
              enterScope(null);
            }}
          />
          <Command.Input
            value={search}
            onValueChange={setSearch}
            placeholder={placeholderFor(scope, slug)}
            autoFocus
          />
          <Command.List>
            <Command.Empty>
              {scope
                ? "No matches. Press Backspace to exit."
                : "No matches. Try a different search."}
            </Command.Empty>
            {scope === null && (
              <RootScope
                go={go}
                slug={slug}
                onScope={enterScope}
                onArchive={runArchive}
              />
            )}
            {scope === "agents" && <AgentsScope go={go} currentSlug={slug} />}
            {scope === "workspace" && (
              <WorkspaceScope go={go} currentSlug={slug} search={search} />
            )}
            {scope === "skills" && (
              <SkillsScope go={go} currentSlug={slug} search={search} />
            )}
            {scope === "mcp" && <McpScope go={go} currentSlug={slug} />}
            {scope === "identity" && (
              <IdentityScope go={go} currentSlug={slug} />
            )}
            {scope === "settings" && (
              <SettingsScope go={go} currentSlug={slug} />
            )}
            {scope === "actions" && (
              <ActionsScope
                go={go}
                currentSlug={slug}
                onScope={enterScope}
                onArchive={runArchive}
              />
            )}
            {scope === "themes" && <ThemesScope onClose={reset} />}
            {scope === "new-agent" && <NewAgentScope go={go} search={search} />}
          </Command.List>
          <PaletteFooter scope={scope} />
        </Command>
      </div>
      <form method="dialog" className="modal-backdrop bg-base-300/60">
        <button type="submit" aria-label="Close">
          close
        </button>
      </form>
    </dialog>
  );
}

// ── Header / footer chrome ─────────────────────────────────────────────────

const SCOPE_LABEL: Record<ScopeKey, string> = {
  agents: "Agents",
  workspace: "Workspace",
  skills: "Skills",
  mcp: "MCP servers",
  identity: "Identity",
  settings: "Settings",
  actions: "Actions",
  themes: "Theme",
};

function PaletteHeader({
  scope,
  onClearScope,
}: {
  scope: Scope;
  onClearScope: () => void;
}) {
  if (!scope) return null;
  const label = scope === "new-agent" ? "New agent" : SCOPE_LABEL[scope];
  return (
    <div className="cmdk-scope-row">
      <button
        type="button"
        className="cmdk-scope-chip"
        onClick={onClearScope}
        title="Exit scope (Backspace)"
      >
        <span>{label}</span>
        <X size={11} className="opacity-60" />
      </button>
    </div>
  );
}

function PaletteFooter({ scope }: { scope: Scope }) {
  return (
    <div className="cmdk-footer">
      <span className="cmdk-kbd-row">
        <kbd className="kbd kbd-xs">↑</kbd>
        <kbd className="kbd kbd-xs">↓</kbd>
        navigate
      </span>
      {!scope && (
        <span className="cmdk-kbd-row">
          <kbd className="kbd kbd-xs">Tab</kbd>
          enter scope
        </span>
      )}
      {scope && (
        <span className="cmdk-kbd-row">
          <kbd className="kbd kbd-xs">⌫</kbd>
          exit scope
        </span>
      )}
      <span className="cmdk-kbd-row">
        <CornerDownLeft size={11} />
        select
      </span>
      <span className="cmdk-kbd-row">
        <kbd className="kbd kbd-xs">esc</kbd>
        close
      </span>
    </div>
  );
}

function placeholderFor(scope: Scope, slug: string): string {
  if (scope === null) return "Search for agents, files, settings, actions…";
  if (scope === "workspace") return `Search files in ${slug}…`;
  if (scope === "skills") return `Search skills in ${slug}…`;
  const fixed: Record<Exclude<Scope, null | "workspace" | "skills">, string> = {
    agents: "Search agents…",
    mcp: "Search MCP servers…",
    identity: "Search identity files…",
    settings: "Search settings…",
    actions: "Search actions…",
    themes: "Pick a theme…",
    "new-agent": "agent-slug (lowercase, hyphens)",
  };
  return fixed[scope];
}
