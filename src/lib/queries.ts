import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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

export function useWorkspaceFiles(slug: string) {
  return useQuery({
    queryKey: queryKeys.workspaceFiles(slug),
    queryFn: () => listWorkspaceFiles(slug),
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
    queryFn: async () => {
      const t0 = performance.now();
      const data = await listMcpServers(slug);
      // Diagnostic: every fetch logs here, so a missing log after a
      // chat-driven connect proves the panel isn't refetching live.
      // eslint-disable-next-line no-console
      console.debug("[useMcpServers] fetched", {
        slug,
        count: data.length,
        states: data.map((s) => `${s.name}:${s.state}`),
        ms: Math.round(performance.now() - t0),
      });
      return data;
    },
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
