import { Command, useCommandState } from "cmdk";
import {
  Archive,
  Bot,
  FileText,
  IdCard,
  Palette,
  Plug,
  Plus,
  Settings as SettingsIcon,
  Sparkles,
  User,
  X,
} from "lucide-react";
import { useEffect, useMemo } from "react";

import { encodePath } from "../lib/api-client";
import { useAgents, useCreateAgent } from "../lib/agents";
import { useCoreFiles, useMcpServers } from "../lib/queries";
import {
  previewThemeId,
  restorePersistedTheme,
  setColorScheme,
  setThemeId,
  THEMES,
  useColorScheme,
  useThemeId,
} from "../lib/theme";

import type { GoFn, Scope, ScopeKey } from "./CommandPalette.types";
import { SCOPE_PREFIX } from "./CommandPalette.types";

// Same slug shape the AgentSelector form enforces.
const SLUG_PATTERN = /^[a-z][a-z0-9-]{1,30}$/;

// ── Generic scope row helper ───────────────────────────────────────────────

function ScopeRow({
  scope,
  label,
  description,
  icon: Icon,
  onScope,
  shortcut,
}: {
  scope: ScopeKey;
  label: string;
  description: string;
  icon: typeof Bot;
  onScope: (s: Scope) => void;
  shortcut?: string;
}) {
  return (
    <Command.Item
      value={`${SCOPE_PREFIX}${scope}`}
      keywords={[label, description, scope]}
      onSelect={() => {
        onScope(scope);
      }}
    >
      <Icon size={15} className="cmdk-icon" />
      <span className="cmdk-row-label">{label}</span>
      <span className="cmdk-row-meta">{description}</span>
      <span className="cmdk-row-shortcut">
        {shortcut ? <kbd className="kbd kbd-xs">{shortcut}</kbd> : null}
        <kbd className="kbd kbd-xs">Tab</kbd>
      </span>
    </Command.Item>
  );
}

// ── Root scope ─────────────────────────────────────────────────────────────

export function RootScope({
  go,
  slug,
  onScope,
  onArchive,
}: {
  go: GoFn;
  slug: string;
  onScope: (s: Scope) => void;
  onArchive: (slug: string) => void;
}) {
  const agents = useAgents();
  const current = agents.find((a) => a.slug === slug);

  return (
    <>
      <Command.Group heading="Agents">
        <Command.Item
          // Bare Command.Item (not ScopeRow) so it registers with cmdk in the
          // same render pass as its siblings — wrapping in ScopeRow caused
          // late registration that bumped this row out of DOM order.
          value={`${SCOPE_PREFIX}agents`}
          keywords={["switch", "change", "jump", "go to"]}
          onSelect={() => {
            onScope("agents");
          }}
        >
          <Bot size={15} className="cmdk-icon" />
          <span className="cmdk-row-label">Switch agent</span>
          <span className="cmdk-row-meta">
            {current ? `Currently: ${current.displayName}` : "Browse all agents"}
          </span>
          <span className="cmdk-row-shortcut">
            <kbd className="kbd kbd-xs">Tab</kbd>
          </span>
        </Command.Item>
        <Command.Item
          value="action:new-agent"
          keywords={["create", "add", "new", "agent"]}
          onSelect={() => {
            onScope("new-agent");
          }}
        >
          <Plus size={15} className="cmdk-icon" />
          <span className="cmdk-row-label">New agent…</span>
          <span className="cmdk-row-meta">Create and switch</span>
        </Command.Item>
        <Command.Item
          value="action:archived-agents"
          keywords={["archived", "deleted", "restore", "agents"]}
          onSelect={() => {
            go({ to: "/settings/archived-agents" });
          }}
        >
          <Archive size={15} className="cmdk-icon" />
          <span className="cmdk-row-label">View archived agents</span>
          <span className="cmdk-row-meta">Restore previously archived</span>
        </Command.Item>
        <Command.Item
          value="action:archive-agent"
          keywords={["archive", "delete", "remove", slug, "agent"]}
          onSelect={() => {
            onArchive(slug);
          }}
        >
          <Archive size={15} className="cmdk-icon" />
          <span className="cmdk-row-label">Archive {slug}</span>
          <span className="cmdk-row-meta">Hide this agent</span>
        </Command.Item>
      </Command.Group>

      <Command.Group heading={`In ${slug}`}>
        <ScopeRow
          scope="workspace"
          label="Workspace"
          description="Files"
          icon={FileText}
          onScope={onScope}
        />
        <ScopeRow
          scope="skills"
          label="Skills"
          description="Reusable instructions"
          icon={Sparkles}
          onScope={onScope}
        />
        <ScopeRow
          scope="mcp"
          label="MCP servers"
          description="Tools and integrations"
          icon={Plug}
          onScope={onScope}
        />
        <ScopeRow
          scope="identity"
          label="Identity"
          description="USER, SOUL, MEMORY"
          icon={IdCard}
          onScope={onScope}
        />
        <Command.Item
          value="settings:agent"
          keywords={["agent settings", slug, current?.displayName ?? ""]}
          onSelect={() => {
            go({ to: "/agent/$slug/settings", params: { slug } });
          }}
        >
          <SettingsIcon size={15} className="cmdk-icon" />
          <span className="cmdk-row-label">Agent settings</span>
          <span className="cmdk-row-meta">Per-agent preferences</span>
        </Command.Item>
      </Command.Group>

      <Command.Group heading="User">
        <Command.Item
          value="settings:user"
          keywords={["preferences", "profile", "account", "user", "global"]}
          onSelect={() => {
            go({ to: "/settings" });
          }}
        >
          <User size={15} className="cmdk-icon" />
          <span className="cmdk-row-label">User preferences</span>
          <span className="cmdk-row-meta">Profile, account</span>
        </Command.Item>
        <ScopeRow
          scope="themes"
          label="Switch theme…"
          description="Change the look"
          icon={Palette}
          onScope={onScope}
        />
      </Command.Group>
    </>
  );
}

// ── Agents scope ───────────────────────────────────────────────────────────

export function AgentsScope({
  go,
  currentSlug,
}: {
  go: GoFn;
  currentSlug: string;
}) {
  const agents = useAgents();
  const sorted = useMemo(() => {
    const current = agents.find((a) => a.slug === currentSlug);
    const rest = agents.filter((a) => a.slug !== currentSlug);
    return current ? [current, ...rest] : rest;
  }, [agents, currentSlug]);

  return (
    <Command.Group heading="Agents">
      {sorted.map((a) => (
        <Command.Item
          key={a.slug}
          value={a.slug}
          keywords={[a.displayName, "switch", "agent"]}
          onSelect={() => {
            go({ to: "/agent/$slug", params: { slug: a.slug } });
          }}
        >
          <Bot size={15} className="cmdk-icon" />
          <span className="cmdk-row-label">{a.displayName}</span>
          <span className="cmdk-row-meta">{a.slug}</span>
          {a.slug === currentSlug && (
            <span className="cmdk-row-shortcut opacity-60">current</span>
          )}
        </Command.Item>
      ))}
    </Command.Group>
  );
}

// Hybrid scopes (Workspace, Skills) live in CommandPalette.hybrid-scopes.tsx
// because their cross-agent fan-out logic is heavy enough to push this file
// past the project's max-lines budget.

// ── MCP scope ──────────────────────────────────────────────────────────────

export function McpScope({
  go,
  currentSlug,
}: {
  go: GoFn;
  currentSlug: string;
}) {
  const { data: servers = [] } = useMcpServers(currentSlug);
  return (
    <Command.Group heading={`MCP servers in ${currentSlug}`}>
      <Command.Item
        value="mcp:overview"
        keywords={["all", "manage", "list"]}
        onSelect={() => {
          go({ to: "/agent/$slug/mcp", params: { slug: currentSlug } });
        }}
      >
        <Plug size={15} className="cmdk-icon" />
        <span className="cmdk-row-label">Manage MCP servers</span>
        <span className="cmdk-row-meta">Open settings page</span>
      </Command.Item>
      {servers.map((s) => (
        <Command.Item
          key={s.id}
          value={`mcp:${s.id}`}
          keywords={[s.name, s.url, ...s.toolNames]}
          onSelect={() => {
            go({ to: "/agent/$slug/mcp", params: { slug: currentSlug } });
          }}
        >
          <Plug size={15} className="cmdk-icon" />
          <span className="cmdk-row-label">{s.name}</span>
          <span className="cmdk-row-meta">
            {s.state}
            {s.toolNames.length > 0
              ? ` · ${String(s.toolNames.length)} tools`
              : ""}
          </span>
        </Command.Item>
      ))}
    </Command.Group>
  );
}

// ── Identity scope ─────────────────────────────────────────────────────────

export function IdentityScope({
  go,
  currentSlug,
}: {
  go: GoFn;
  currentSlug: string;
}) {
  const { data: coreFiles = [] } = useCoreFiles(currentSlug);
  return (
    <>
      <Command.Group heading={`Identity in ${currentSlug}`}>
        <Command.Item
          value="identity:overview"
          keywords={["all", "soul", "memory"]}
          onSelect={() => {
            go({
              to: "/agent/$slug/identity",
              params: { slug: currentSlug },
            });
          }}
        >
          <IdCard size={15} className="cmdk-icon" />
          <span className="cmdk-row-label">Identity overview</span>
        </Command.Item>
        {coreFiles.map((f) => (
          <Command.Item
            key={f.path}
            value={`identity:${f.path}`}
            keywords={[f.label, f.description, f.path]}
            onSelect={() => {
              go({
                to: "/agent/$slug/identity/$",
                params: { slug: currentSlug, _splat: encodePath(f.path) },
              });
            }}
          >
            <IdCard size={15} className="cmdk-icon" />
            <span className="cmdk-row-label">{f.label}</span>
            <span className="cmdk-row-meta">{f.description}</span>
          </Command.Item>
        ))}
      </Command.Group>
      <Command.Group heading="Global">
        <Command.Item
          value="identity:user"
          keywords={["user", "profile", "you", "USER.md"]}
          onSelect={() => {
            go({ to: "/settings" });
          }}
        >
          <User size={15} className="cmdk-icon" />
          <span className="cmdk-row-label">User profile</span>
          <span className="cmdk-row-meta">USER.md (shared across agents)</span>
        </Command.Item>
      </Command.Group>
    </>
  );
}

// ── Settings scope ─────────────────────────────────────────────────────────

export function SettingsScope({
  go,
  currentSlug,
}: {
  go: GoFn;
  currentSlug: string;
}) {
  return (
    <>
      <Command.Group heading="User">
        <Command.Item
          value="settings:user-prefs"
          keywords={["preferences", "profile", "account"]}
          onSelect={() => {
            go({ to: "/settings" });
          }}
        >
          <User size={15} className="cmdk-icon" />
          <span className="cmdk-row-label">User preferences</span>
          <span className="cmdk-row-meta">Theme, profile, account</span>
        </Command.Item>
        <Command.Item
          value="settings:archived-agents"
          keywords={["archived", "restore", "deleted"]}
          onSelect={() => {
            go({ to: "/settings/archived-agents" });
          }}
        >
          <Archive size={15} className="cmdk-icon" />
          <span className="cmdk-row-label">Archived agents</span>
          <span className="cmdk-row-meta">Restore previously archived</span>
        </Command.Item>
      </Command.Group>
      <Command.Group heading={`Agent: ${currentSlug}`}>
        <Command.Item
          value="settings:agent-prefs"
          keywords={[currentSlug, "agent settings"]}
          onSelect={() => {
            go({ to: "/agent/$slug/settings", params: { slug: currentSlug } });
          }}
        >
          <SettingsIcon size={15} className="cmdk-icon" />
          <span className="cmdk-row-label">{currentSlug} settings</span>
          <span className="cmdk-row-meta">Per-agent settings</span>
        </Command.Item>
        <Command.Item
          value="settings:mcp"
          keywords={["mcp", "tools"]}
          onSelect={() => {
            go({ to: "/agent/$slug/mcp", params: { slug: currentSlug } });
          }}
        >
          <Plug size={15} className="cmdk-icon" />
          <span className="cmdk-row-label">MCP servers</span>
          <span className="cmdk-row-meta">Tools and integrations</span>
        </Command.Item>
        <Command.Item
          value="settings:identity"
          keywords={["identity", "soul", "memory"]}
          onSelect={() => {
            go({
              to: "/agent/$slug/identity",
              params: { slug: currentSlug },
            });
          }}
        >
          <IdCard size={15} className="cmdk-icon" />
          <span className="cmdk-row-label">Identity</span>
          <span className="cmdk-row-meta">USER, SOUL, MEMORY</span>
        </Command.Item>
      </Command.Group>
    </>
  );
}

// ── Actions scope ──────────────────────────────────────────────────────────

export function ActionsScope({
  go,
  currentSlug,
  onScope,
  onArchive,
}: {
  go: GoFn;
  currentSlug: string;
  onScope: (s: Scope) => void;
  onArchive: (slug: string) => void;
}) {
  return (
    <Command.Group heading="Actions">
      <Command.Item
        value="actions:new-agent"
        keywords={["create", "add", "new"]}
        onSelect={() => {
          onScope("new-agent");
        }}
      >
        <Plus size={15} className="cmdk-icon" />
        <span className="cmdk-row-label">New agent…</span>
        <span className="cmdk-row-meta">Create and switch</span>
      </Command.Item>
      <Command.Item
        value="actions:archive-agent"
        keywords={["archive", "remove", currentSlug]}
        onSelect={() => {
          onArchive(currentSlug);
        }}
      >
        <Archive size={15} className="cmdk-icon" />
        <span className="cmdk-row-label">Archive {currentSlug}</span>
        <span className="cmdk-row-meta">Hide this agent</span>
      </Command.Item>
      <Command.Item
        value="actions:archived-agents"
        keywords={["archived", "restore"]}
        onSelect={() => {
          go({ to: "/settings/archived-agents" });
        }}
      >
        <Archive size={15} className="cmdk-icon" />
        <span className="cmdk-row-label">View archived agents</span>
      </Command.Item>
      <Command.Item
        value={`${SCOPE_PREFIX}themes`}
        keywords={["theme", "appearance", "dark", "light"]}
        onSelect={() => {
          onScope("themes");
        }}
      >
        <Palette size={15} className="cmdk-icon" />
        <span className="cmdk-row-label">Switch theme…</span>
        <span className="cmdk-row-shortcut">
          <kbd className="kbd kbd-xs">Tab</kbd>
        </span>
      </Command.Item>
    </Command.Group>
  );
}

// ── Themes scope ───────────────────────────────────────────────────────────

export function ThemesScope({ onClose }: { onClose: () => void }) {
  const themeId = useThemeId();
  const colorScheme = useColorScheme();

  // Read the parent Command's currently-highlighted value via cmdk's hook.
  // When it points at a theme row, apply that theme without persisting; when
  // it leaves a theme row (or the scope unmounts), restore the saved theme.
  const highlighted = useCommandState((s) => s.value);
  useEffect(() => {
    if (typeof highlighted === "string" && highlighted.startsWith("theme:")) {
      previewThemeId(highlighted.slice("theme:".length));
    } else {
      restorePersistedTheme();
    }
  }, [highlighted]);
  useEffect(
    () => () => {
      restorePersistedTheme();
    },
    [],
  );

  return (
    <>
      <Command.Group heading="Color scheme">
        {(["system", "light", "dark"] as const).map((s) => (
          <Command.Item
            key={s}
            value={`scheme:${s}`}
            keywords={["color scheme", s]}
            onSelect={() => {
              setColorScheme(s);
              onClose();
            }}
          >
            <Palette size={15} className="cmdk-icon" />
            <span className="cmdk-row-label">
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </span>
            {colorScheme === s && (
              <span className="cmdk-row-shortcut opacity-60">current</span>
            )}
          </Command.Item>
        ))}
      </Command.Group>
      <Command.Group heading="Theme">
        {THEMES.map((t) => (
          <Command.Item
            key={t.id}
            value={`theme:${t.id}`}
            keywords={[t.name]}
            onMouseEnter={() => {
              previewThemeId(t.id);
            }}
            onMouseLeave={() => {
              restorePersistedTheme();
            }}
            onSelect={() => {
              setThemeId(t.id);
              onClose();
            }}
          >
            <Palette size={15} className="cmdk-icon" />
            <span className="cmdk-row-label">{t.name}</span>
            {themeId === t.id && (
              <span className="cmdk-row-shortcut opacity-60">current</span>
            )}
          </Command.Item>
        ))}
      </Command.Group>
    </>
  );
}

// ── New-agent sub-scope ────────────────────────────────────────────────────

export function NewAgentScope({ go, search }: { go: GoFn; search: string }) {
  const createMut = useCreateAgent();
  const trimmed = search.trim();
  const valid = SLUG_PATTERN.test(trimmed);
  const busy = createMut.isPending;

  const handleCreate = () => {
    if (!valid || busy) return;
    createMut.mutate(
      { slug: trimmed, displayName: deriveDisplayName(trimmed) },
      {
        onSuccess: (created) => {
          go({ to: "/agent/$slug", params: { slug: created.slug } });
        },
      },
    );
  };

  // The parent Command sets shouldFilter={false} while in this scope, so the
  // rows below render verbatim regardless of what's typed in the input.
  return (
    <Command.Group heading="Create agent">
      <Command.Item value="__new-agent-create" onSelect={handleCreate}>
        <Plus size={15} className="cmdk-icon" />
        <span className="cmdk-row-label">
          {trimmed
            ? `Create agent "${trimmed}"`
            : "Type a slug, then press Enter…"}
        </span>
        <span className="cmdk-row-meta">
          {!trimmed
            ? "lowercase, letters/digits/hyphens"
            : valid
              ? "ready"
              : "invalid slug"}
        </span>
        {busy && <span className="cmdk-row-shortcut">creating…</span>}
      </Command.Item>
      {createMut.error && (
        <Command.Item value="__new-agent-error" disabled>
          <X size={15} className="cmdk-icon text-error" />
          <span className="cmdk-row-meta">{createMut.error.message}</span>
        </Command.Item>
      )}
    </Command.Group>
  );
}

function deriveDisplayName(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
