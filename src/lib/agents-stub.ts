import { useSyncExternalStore } from "react";

type AgentStub = {
  id: string;
  name: string;
};

const AGENTS_KEY = "openclaw:agents";
const SELECTED_KEY = "openclaw:selected-agent-id";
const CHANGE_EVENT = "openclaw:agents-change";

const DEFAULT_AGENT: AgentStub = { id: "default", name: "Default agent" };

function isAgentStub(v: unknown): v is AgentStub {
  if (typeof v !== "object" || v === null) return false;
  if (!("id" in v) || !("name" in v)) return false;
  return typeof v.id === "string" && typeof v.name === "string";
}

function readAgents(): AgentStub[] {
  if (typeof window === "undefined") return [DEFAULT_AGENT];
  const raw = window.localStorage.getItem(AGENTS_KEY);
  if (!raw) return [DEFAULT_AGENT];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [DEFAULT_AGENT];
    const list = parsed.filter(isAgentStub);
    return list.length > 0 ? list : [DEFAULT_AGENT];
  } catch {
    return [DEFAULT_AGENT];
  }
}

function readSelectedId(): string {
  if (typeof window === "undefined") return DEFAULT_AGENT.id;
  return window.localStorage.getItem(SELECTED_KEY) ?? DEFAULT_AGENT.id;
}

function subscribe(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}

// Cache the snapshots so useSyncExternalStore sees referentially stable values
// between renders that didn't actually change. The store fires CHANGE_EVENT on
// writes, which busts the cache.
let agentsCache: AgentStub[] | null = null;
let selectedCache: string | null = null;

function getAgentsSnapshot(): AgentStub[] {
  if (agentsCache === null) agentsCache = readAgents();
  return agentsCache;
}

function getSelectedSnapshot(): string {
  if (selectedCache === null) selectedCache = readSelectedId();
  return selectedCache;
}

if (typeof window !== "undefined") {
  const bust = () => {
    agentsCache = null;
    selectedCache = null;
  };
  window.addEventListener("storage", bust);
  window.addEventListener(CHANGE_EVENT, bust);
}

export function useAgents(): AgentStub[] {
  return useSyncExternalStore(subscribe, getAgentsSnapshot, () => [
    DEFAULT_AGENT,
  ]);
}

export function useSelectedAgentId(): string {
  return useSyncExternalStore(
    subscribe,
    getSelectedSnapshot,
    () => DEFAULT_AGENT.id,
  );
}

export function setSelectedAgentId(id: string): void {
  window.localStorage.setItem(SELECTED_KEY, id);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
