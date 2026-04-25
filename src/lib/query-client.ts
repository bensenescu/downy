import { QueryClient } from "@tanstack/react-query";

/**
 * One singleton query client per browser tab. Lives at module scope rather
 * than React state because queries should survive route changes / unmounts —
 * the whole point is shared cache.
 *
 * Defaults are tuned for an interactive app where the agent is mutating
 * server state in the background:
 *
 * - `staleTime: 30s` — server-driven mutations land via WebSocket-pushed
 *   `setQueryData` calls or explicit `invalidateQueries` from useMutation
 *   onSuccess. The polling-style refetch isn't load-bearing; 30s is enough
 *   to dedupe back-to-back component mounts without the cache going stale
 *   in any meaningful sense.
 * - `refetchOnWindowFocus: false` — same reason; WS + invalidation already
 *   keep things fresh, and refetch-on-focus produces visible loading flicker
 *   when tabbing back in.
 * - `retry: 1` — one retry catches transient hiccups. More than that hides
 *   real failures behind a long spinner.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
