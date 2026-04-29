import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import {
  deleteMcpServer,
  deleteWorkspaceFile,
  listBackgroundTasks,
  listCoreFiles,
  listMcpServers,
  listSkills,
  listWorkspaceFiles,
  readCoreFile,
  readUserFile,
  readWorkspaceFile,
  writeCoreFile,
  writeUserFile,
  writeWorkspaceFile,
} from "./api-client";
import { queryKeys } from "./query-keys";

type AgentMessageSocket = {
  addEventListener(type: "message", listener: (e: MessageEvent) => void): void;
  removeEventListener(
    type: "message",
    listener: (e: MessageEvent) => void,
  ): void;
};

/**
 * Listen for the agents-SDK-emitted `cf_agent_mcp_servers` frame on the given
 * socket and invalidate the per-slug mcpServers query so consumers refetch our
 * serialized shape (which includes tool names, etc — richer than the SDK frame).
 *
 * Connect/disconnect inside the agent triggers this frame automatically; we
 * just have to translate it into a query-cache invalidation.
 */
export function useMcpServersLiveSync(
  agent: AgentMessageSocket,
  slug: string,
): void {
  const qc = useQueryClient();
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (typeof e.data !== "string") return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(e.data);
      } catch {
        return;
      }
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        !("type" in parsed) ||
        parsed.type !== "cf_agent_mcp_servers"
      ) {
        return;
      }
      void qc.invalidateQueries({ queryKey: queryKeys.mcpServers(slug) });
    };
    agent.addEventListener("message", onMessage);
    return () => {
      agent.removeEventListener("message", onMessage);
    };
  }, [agent, qc, slug]);
}

/**
 * Read hooks. Each is a thin wrapper over `useQuery` with the right key
 * factory and the matching api-client function as `queryFn`. Components
 * that consume these don't need to know about react-query at all — they
 * see `{ data, isLoading, error }` and the cache is shared automatically.
 */

export function useAgentSkills(slug: string) {
  return useQuery({
    queryKey: queryKeys.skills(slug),
    queryFn: () => listSkills(slug),
  });
}

export function useWorkspaceFiles(
  slug: string,
  opts?: { enabled?: boolean; refetchOnMount?: boolean | "always" },
) {
  return useQuery({
    queryKey: queryKeys.workspaceFiles(slug),
    queryFn: () => listWorkspaceFiles(slug),
    enabled: opts?.enabled ?? true,
    refetchOnMount: opts?.refetchOnMount,
  });
}

export function useWorkspaceFile(
  slug: string,
  path: string,
  opts?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: queryKeys.workspaceFile(slug, path),
    queryFn: () => readWorkspaceFile(slug, path),
    enabled: opts?.enabled ?? true,
  });
}

export function useMcpServers(slug: string) {
  return useQuery({
    queryKey: queryKeys.mcpServers(slug),
    queryFn: () => listMcpServers(slug),
  });
}

export function useBackgroundTasks(slug: string) {
  return useQuery({
    queryKey: queryKeys.backgroundTasks(slug),
    queryFn: () => listBackgroundTasks(slug),
  });
}

export function useCoreFiles(slug: string) {
  return useQuery({
    queryKey: queryKeys.coreFiles(slug),
    queryFn: () => listCoreFiles(slug),
  });
}

export function useCoreFile(slug: string, path: string) {
  return useQuery({
    queryKey: queryKeys.coreFile(slug, path),
    queryFn: () => readCoreFile(slug, path),
  });
}

export function useUserFile() {
  return useQuery({
    queryKey: queryKeys.userFile(),
    queryFn: () => readUserFile(),
  });
}

/**
 * Mutation hooks. Each invalidates the queries it could plausibly affect.
 * `onSuccess` here keeps the invalidation right next to the write — far
 * easier to keep in sync than scattering invalidate calls at every callsite.
 */

export function useWriteWorkspaceFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { slug: string; path: string; content: string }) =>
      writeWorkspaceFile(vars.slug, vars.path, vars.content),
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({
        queryKey: queryKeys.workspaceFiles(vars.slug),
      });
      void qc.invalidateQueries({
        queryKey: queryKeys.workspaceFile(vars.slug, vars.path),
      });
      // A skill SKILL.md edit goes through this same write path; the
      // sidebar / index page reads from the skills query, so refresh it too.
      if (vars.path.startsWith("skills/")) {
        void qc.invalidateQueries({ queryKey: queryKeys.skills(vars.slug) });
      }
    },
  });
}

export function useDeleteWorkspaceFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { slug: string; path: string }) =>
      deleteWorkspaceFile(vars.slug, vars.path),
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({
        queryKey: queryKeys.workspaceFiles(vars.slug),
      });
      void qc.invalidateQueries({
        queryKey: queryKeys.workspaceFile(vars.slug, vars.path),
      });
      if (vars.path.startsWith("skills/")) {
        void qc.invalidateQueries({ queryKey: queryKeys.skills(vars.slug) });
      }
    },
  });
}

export function useWriteCoreFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { slug: string; path: string; content: string }) =>
      writeCoreFile(vars.slug, vars.path, vars.content),
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.coreFiles(vars.slug) });
      void qc.invalidateQueries({
        queryKey: queryKeys.coreFile(vars.slug, vars.path),
      });
    },
  });
}

export function useDeleteMcpServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { slug: string; id: string }) =>
      deleteMcpServer(vars.slug, vars.id),
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.mcpServers(vars.slug) });
    },
  });
}

export function useWriteUserFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: string) => writeUserFile(content),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.userFile() });
    },
  });
}
