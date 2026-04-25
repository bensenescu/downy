import { useSyncExternalStore } from "react";

// Module-level state for whether the mobile mission-control drawer is open.
// Lives outside the panel itself because the Header — a separate subtree —
// needs to be able to open it from the hamburger pill.

let open = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): boolean {
  return open;
}

function getServerSnapshot(): boolean {
  return false;
}

export function useMobilePanelOpen(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function setMobilePanelOpen(next: boolean): void {
  if (open === next) return;
  open = next;
  emit();
}
