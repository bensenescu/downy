import { useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  type AgentRecord,
  CreateAgentResponseSchema,
  ListAgentsResponseSchema,
  UpdateAgentResponseSchema,
} from "./api-schemas";
import { queryKeys } from "./query-keys";

export const DEFAULT_SLUG = "default";

// ── Selected-slug store (URL-backed) ──────────────────────────────────────
//
// Slug is parsed from the active pathname (`/agent/:slug/...`). Anywhere
// outside an agent-scoped route — `/settings`, `/`, etc. — falls back to
// "default". Switching agents is a real router navigation, not a localStorage
// write, so URLs are stable, the back button works, and bookmarks survive.

const AGENT_SLUG_RE = /^\/agent\/([^/]+)/;

function parseSlugFromPath(pathname: string): string {
  const m = AGENT_SLUG_RE.exec(pathname);
  if (!m) return DEFAULT_SLUG;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return DEFAULT_SLUG;
  }
}

export function useCurrentAgentSlug(): string {
  return useRouterState({
    select: (s) => parseSlugFromPath(s.location.pathname),
  });
}

// ── Server I/O ─────────────────────────────────────────────────────────────

async function fetchAgents(opts?: {
  archived?: boolean;
}): Promise<AgentRecord[]> {
  const url = opts?.archived ? "/api/agents?archived=1" : "/api/agents";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`listAgents failed: ${String(res.status)}`);
  const data = ListAgentsResponseSchema.parse(await res.json());
  return data.agents;
}

async function postAgent(input: {
  slug: string;
  displayName: string;
}): Promise<AgentRecord> {
  const res = await fetch("/api/agents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`createAgent failed (${String(res.status)}): ${text}`);
  }
  const data = CreateAgentResponseSchema.parse(await res.json());
  return data.agent;
}

async function patchAgent(
  slug: string,
  body: { displayName?: string; isPrivate?: boolean },
): Promise<AgentRecord> {
  const res = await fetch(`/api/agents/${encodeURIComponent(slug)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`patchAgent failed: ${String(res.status)}`);
  const data = UpdateAgentResponseSchema.parse(await res.json());
  return data.agent;
}

async function postArchive(
  slug: string,
  archive: boolean,
): Promise<AgentRecord> {
  const action = archive ? "archive" : "unarchive";
  const res = await fetch(`/api/agents/${encodeURIComponent(slug)}/${action}`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`${action}Agent failed: ${String(res.status)}`);
  const data = UpdateAgentResponseSchema.parse(await res.json());
  return data.agent;
}

// ── Read hooks ─────────────────────────────────────────────────────────────

/**
 * Active (non-archived) agents. Shared cache key — every consumer reads from
 * the same `["agents"]` cache. Mutation hooks below invalidate this so any
 * create/rename/archive flips the dropdown / sidebar / list pages without
 * each component knowing about the others.
 */
export function useAgents() {
  const q = useQuery({
    queryKey: queryKeys.agents(),
    queryFn: () => fetchAgents(),
  });
  return q.data ?? [];
}

/**
 * Archived agents — used by the restore page in Settings. Separate query key
 * so it doesn't collide with the active-agents cache.
 */
export function useArchivedAgents() {
  return useQuery({
    queryKey: ["agents", "archived"],
    queryFn: () => fetchAgents({ archived: true }),
  });
}

// ── Mutation hooks ─────────────────────────────────────────────────────────

/** Invalidate every variant of the agents cache after a write. */
function useInvalidateAgents() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: queryKeys.agents() });
    void qc.invalidateQueries({ queryKey: ["agents", "archived"] });
  };
}

export function useCreateAgent() {
  const invalidate = useInvalidateAgents();
  return useMutation({
    mutationFn: postAgent,
    onSuccess: invalidate,
  });
}

export function useSetAgentPrivate() {
  const invalidate = useInvalidateAgents();
  return useMutation({
    mutationFn: (vars: { slug: string; isPrivate: boolean }) =>
      patchAgent(vars.slug, { isPrivate: vars.isPrivate }),
    onSuccess: invalidate,
  });
}

export function useRenameAgent() {
  const invalidate = useInvalidateAgents();
  return useMutation({
    mutationFn: (vars: { slug: string; displayName: string }) =>
      patchAgent(vars.slug, { displayName: vars.displayName }),
    onSuccess: invalidate,
  });
}

/**
 * First non-archived agent's slug, or null when there are none. Used as a
 * fallback target by routes that need *some* agent to link to (e.g. `/`,
 * `/settings`) but can't assume a specific slug exists.
 */
export function useFallbackAgentSlug(): string | null {
  const agents = useAgents();
  return agents[0]?.slug ?? null;
}

export function useArchiveAgent() {
  const invalidate = useInvalidateAgents();
  return useMutation({
    mutationFn: (slug: string) => postArchive(slug, true),
    onSuccess: invalidate,
  });
}

export function useUnarchiveAgent() {
  const invalidate = useInvalidateAgents();
  return useMutation({
    mutationFn: (slug: string) => postArchive(slug, false),
    onSuccess: invalidate,
  });
}
