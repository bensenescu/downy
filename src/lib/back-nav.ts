import type { LinkProps } from "@tanstack/react-router";
import { useLocation } from "@tanstack/react-router";

// Where a "Back" button should land. `href` is a plain pathname (e.g.
// `/agent/default/workspace`) so consumers don't have to thread typed route
// params through state — the back button is a simple <Link to={href}>.
export type BackHint = {
  href: string;
  label: string;
};

// Read a back hint stashed in router state by the page that linked here.
// Detail pages reachable from multiple parents (e.g. a workspace file is
// reachable from chat, the workspace index, and the mission-control panel)
// pass `fallback` as the default destination when state is absent — direct
// URL hits, reloads, deep links.
export function useBackHint(fallback: BackHint): BackHint {
  const back = useLocation({
    select: (s) =>
      // eslint-disable-next-line typescript/no-unsafe-type-assertion -- our own keys; we control everything that goes into state.back via withBack().
      (s.state as { back?: BackHint }).back,
  });
  return back ?? fallback;
}

// We attach a `back` payload to router state so detail pages can render
// "Back to <wherever>". TanStack's `HistoryState` augmentation point lives
// in `@tanstack/history`, which pnpm doesn't hoist into our resolution
// path, so we cast at this boundary rather than declare a cross-package
// module augmentation. Returns the state-updater branch of Link's prop so
// the back hint merges with whatever is already in state.
export function withBack(hint: BackHint): LinkProps["state"] {
  // eslint-disable-next-line typescript/no-unsafe-type-assertion -- HistoryState is augmented externally; we round-trip our own `back` payload.
  return ((prev: object) => ({
    ...prev,
    back: hint,
  })) as unknown as LinkProps["state"];
}
