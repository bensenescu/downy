import type { NavigateOptions } from "@tanstack/react-router";

// All scopes the palette can be in. `null` means root (no scope).
export type Scope =
  | null
  | "agents"
  | "workspace"
  | "skills"
  | "mcp"
  | "identity"
  | "settings"
  | "actions"
  | "themes"
  | "new-agent";

// Scopes the user can Tab into (everything except null and the slug-input
// sub-mode). Keeps SCOPE_LABEL exhaustive without dragging in the synthetic
// new-agent flow.
export type ScopeKey = Exclude<Scope, null | "new-agent">;

const SCOPE_KEYS: readonly ScopeKey[] = [
  "agents",
  "workspace",
  "skills",
  "mcp",
  "identity",
  "settings",
  "actions",
  "themes",
];

export function isScopeKey(value: string): value is ScopeKey {
  return (SCOPE_KEYS as readonly string[]).includes(value);
}

// Resolve a row's value (after stripping SCOPE_PREFIX) to a ScopeKey.
// Allows synthetic suffixes like "agents:suggested" to share the same
// destination scope without colliding on cmdk's value-based dedup.
export function resolveScopeKey(rest: string): ScopeKey | null {
  const head = rest.split(":")[0];
  return isScopeKey(head) ? head : null;
}

// Marker used as the cmdk `value` for category rows. Tab on a row whose value
// starts with this prefix enters the corresponding scope. cmdk filters rows
// by visible text + `keywords`, not by `value`, so the marker doesn't pollute
// user-facing matching.
export const SCOPE_PREFIX = "__scope:";

// Closure that wraps `useNavigate()` and resets palette state on call.
// Scope components only navigate via this — they don't see the navigate fn
// directly, which keeps "open palette → click → palette closes" guaranteed.
export type GoFn = (target: NavigateOptions) => void;
