import { useQuery } from "@tanstack/react-query";

import { getSystemStatus } from "./api-client";

export function useSystemStatusQuery() {
  return useQuery({
    queryKey: ["system-status"],
    queryFn: getSystemStatus,
    // Staticky info — the EXA secret won't be set/unset mid-session in any
    // realistic flow. One fetch on mount is enough; no need to refetch.
    staleTime: Infinity,
  });
}
