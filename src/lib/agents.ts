import { useRouterState } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";

import {
  type AgentRecord,
  ListAgentsResponseSchema,
  CreateAgentResponseSchema,
  UpdateAgentResponseSchema,
} from "./api-schemas";

export type { AgentRecord };

const AGENTS_EVENT = "openclaw:agents-change";
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

// ── Agents list store (server-backed, refreshed on writes) ────────────────

let agentsCache: AgentRecord[] | null = null;
let inflightFetch: Promise<AgentRecord[]> | null = null;

function notifyAgentsChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(AGENTS_EVENT));
}

function subscribeAgents(cb: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(AGENTS_EVENT, cb);
  return () => {
    window.removeEventListener(AGENTS_EVENT, cb);
  };
}

async function fetchActiveAgents(): Promise<AgentRecord[]> {
  if (inflightFetch) return inflightFetch;
  inflightFetch = (async () => {
    const res = await fetch("/api/agents");
    if (!res.ok) throw new Error(`listAgents failed: ${String(res.status)}`);
    const data = ListAgentsResponseSchema.parse(await res.json());
    agentsCache = data.agents;
    notifyAgentsChange();
    return data.agents;
  })().finally(() => {
    inflightFetch = null;
  });
  return inflightFetch;
}

export function useAgents(): AgentRecord[] {
  const snapshot = useSyncExternalStore(
    subscribeAgents,
    () => agentsCache,
    () => null,
  );
  if (snapshot === null && typeof window !== "undefined") {
    void fetchActiveAgents().catch((err: unknown) => {
      console.error("useAgents fetch failed", err);
    });
  }
  return snapshot ?? [];
}

export async function refreshAgents(): Promise<AgentRecord[]> {
  agentsCache = null;
  return fetchActiveAgents();
}

export async function listAgents(opts?: {
  archived?: boolean;
}): Promise<AgentRecord[]> {
  const url = opts?.archived ? "/api/agents?archived=1" : "/api/agents";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`listAgents failed: ${String(res.status)}`);
  const data = ListAgentsResponseSchema.parse(await res.json());
  return data.agents;
}

export async function createAgent(input: {
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
  await refreshAgents();
  return data.agent;
}

export async function renameAgent(
  slug: string,
  displayName: string,
): Promise<AgentRecord> {
  return patchAgent(slug, { displayName });
}

export async function setAgentPrivate(
  slug: string,
  isPrivate: boolean,
): Promise<AgentRecord> {
  return patchAgent(slug, { isPrivate });
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
  await refreshAgents();
  return data.agent;
}

export async function archiveAgent(slug: string): Promise<AgentRecord> {
  const res = await fetch(`/api/agents/${encodeURIComponent(slug)}/archive`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`archiveAgent failed: ${String(res.status)}`);
  const data = UpdateAgentResponseSchema.parse(await res.json());
  await refreshAgents();
  return data.agent;
}

export async function unarchiveAgent(slug: string): Promise<AgentRecord> {
  const res = await fetch(`/api/agents/${encodeURIComponent(slug)}/unarchive`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`unarchiveAgent failed: ${String(res.status)}`);
  const data = UpdateAgentResponseSchema.parse(await res.json());
  await refreshAgents();
  return data.agent;
}
