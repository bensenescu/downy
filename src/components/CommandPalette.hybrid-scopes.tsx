import { Command } from "cmdk";
import { useQueries } from "@tanstack/react-query";
import { FileText, Sparkles } from "lucide-react";
import { useMemo } from "react";

import { encodePath, listSkills, listWorkspaceFiles } from "../lib/api-client";
import { useAgents } from "../lib/agents";
import { useAgentSkills, useWorkspaceFiles } from "../lib/queries";
import { queryKeys } from "../lib/query-keys";

import type { GoFn } from "./CommandPalette.types";

import type { AgentRecord } from "../lib/api-schemas";

// Hybrid scopes (Workspace, Skills): show the current agent's items first,
// and lazily fan out to every other agent when the user has typed at least
// two characters. Cross-agent fetching is React-Query'd so cached results are
// reused without re-fetching across opens.

function useOtherAgentsWorkspaceFiles(
  currentSlug: string,
  agents: AgentRecord[],
  enabled: boolean,
) {
  const others = useMemo(
    () => agents.filter((a) => a.slug !== currentSlug),
    [agents, currentSlug],
  );
  const queries = useQueries({
    queries: others.map((a) => ({
      queryKey: queryKeys.workspaceFiles(a.slug),
      queryFn: () => listWorkspaceFiles(a.slug),
      enabled,
    })),
  });
  return others.map((agent, i) => ({ agent, query: queries[i] }));
}

export function WorkspaceScope({
  go,
  currentSlug,
  search,
}: {
  go: GoFn;
  currentSlug: string;
  search: string;
}) {
  const { data: files = [] } = useWorkspaceFiles(currentSlug);
  const allAgents = useAgents();
  const enabled = search.trim().length >= 2;
  const others = useOtherAgentsWorkspaceFiles(currentSlug, allAgents, enabled);
  const anyOtherLoading = others.some(
    (o) => o.query.isFetching && !o.query.data,
  );

  // Most-recently-updated first. cmdk re-sorts by relevance score once the
  // user types, so this ordering only governs the initial open state — which
  // matches what the WorkspaceSection sidebar does (preview shows most-recent
  // entries).
  const sortedFiles = useMemo(() => {
    const copy = [...files];
    // eslint-disable-next-line unicorn/no-array-sort -- copy is local.
    copy.sort((a, b) => b.updatedAt - a.updatedAt);
    return copy;
  }, [files]);

  return (
    <>
      <Command.Group heading={`Files in ${currentSlug}`}>
        <Command.Item
          value={`${currentSlug}:workspace:overview`}
          keywords={["overview", "all", "browse", "manage", "list"]}
          onSelect={() => {
            go({
              to: "/agent/$slug/workspace",
              params: { slug: currentSlug },
            });
          }}
        >
          <FileText size={15} className="cmdk-icon" />
          <span className="cmdk-row-label">Workspace overview</span>
          <span className="cmdk-row-meta">All files</span>
        </Command.Item>
        {sortedFiles.map((f) => {
          const display = f.path.replace(/^\/+/, "");
          return (
            <Command.Item
              key={f.path}
              value={`${currentSlug}:${f.path}`}
              keywords={[display, f.name, currentSlug]}
              onSelect={() => {
                go({
                  to: "/agent/$slug/workspace/$",
                  params: { slug: currentSlug, _splat: encodePath(display) },
                });
              }}
            >
              <FileText size={15} className="cmdk-icon" />
              <span className="cmdk-row-label cmdk-row-mono">{display}</span>
              <span className="cmdk-row-meta">
                {f.type === "directory" ? "dir" : ""}
              </span>
            </Command.Item>
          );
        })}
        {files.length === 0 && (
          <Command.Item value="__empty-current" disabled>
            <span className="cmdk-row-meta">No files in this agent.</span>
          </Command.Item>
        )}
      </Command.Group>

      {enabled && (
        <Command.Group heading="Other agents">
          {anyOtherLoading && (
            <Command.Loading>Searching other agents…</Command.Loading>
          )}
          {others.flatMap(({ agent, query }) => {
            const sorted = [...(query.data ?? [])];
            // eslint-disable-next-line unicorn/no-array-sort -- copy is local.
            sorted.sort((a, b) => b.updatedAt - a.updatedAt);
            return sorted.map((f) => {
              const display = f.path.replace(/^\/+/, "");
              return (
                <Command.Item
                  key={`${agent.slug}:${f.path}`}
                  value={`${agent.slug}:${f.path}`}
                  keywords={[display, f.name, agent.slug, agent.displayName]}
                  onSelect={() => {
                    go({
                      to: "/agent/$slug/workspace/$",
                      params: {
                        slug: agent.slug,
                        _splat: encodePath(display),
                      },
                    });
                  }}
                >
                  <FileText size={15} className="cmdk-icon" />
                  <span className="cmdk-row-label cmdk-row-mono">
                    {display}
                  </span>
                  <span className="cmdk-row-meta">{agent.slug}</span>
                </Command.Item>
              );
            });
          })}
        </Command.Group>
      )}
    </>
  );
}

function useOtherAgentsSkills(
  currentSlug: string,
  agents: AgentRecord[],
  enabled: boolean,
) {
  const others = useMemo(
    () => agents.filter((a) => a.slug !== currentSlug),
    [agents, currentSlug],
  );
  const queries = useQueries({
    queries: others.map((a) => ({
      queryKey: queryKeys.skills(a.slug),
      queryFn: () => listSkills(a.slug),
      enabled,
    })),
  });
  return others.map((agent, i) => ({ agent, query: queries[i] }));
}

export function SkillsScope({
  go,
  currentSlug,
  search,
}: {
  go: GoFn;
  currentSlug: string;
  search: string;
}) {
  const { data: skills = [] } = useAgentSkills(currentSlug);
  const allAgents = useAgents();
  const enabled = search.trim().length >= 2;
  const others = useOtherAgentsSkills(currentSlug, allAgents, enabled);
  const anyOtherLoading = others.some(
    (o) => o.query.isFetching && !o.query.data,
  );

  return (
    <>
      <Command.Group heading={`Skills in ${currentSlug}`}>
        <Command.Item
          value={`${currentSlug}:skills:overview`}
          keywords={["overview", "all", "browse", "manage", "list"]}
          onSelect={() => {
            go({
              to: "/agent/$slug/skills",
              params: { slug: currentSlug },
            });
          }}
        >
          <Sparkles size={15} className="cmdk-icon" />
          <span className="cmdk-row-label">Skills overview</span>
          <span className="cmdk-row-meta">All skills</span>
        </Command.Item>
        {skills.map((s) => (
          <Command.Item
            key={s.name}
            value={`${currentSlug}:skill:${s.name}`}
            keywords={[s.name, s.description, currentSlug]}
            onSelect={() => {
              go({
                to: "/agent/$slug/skills/$name",
                params: { slug: currentSlug, name: s.name },
              });
            }}
          >
            <Sparkles size={15} className="cmdk-icon" />
            <span className="cmdk-row-label">{s.name}</span>
            <span className="cmdk-row-meta">{s.description}</span>
          </Command.Item>
        ))}
        {skills.length === 0 && (
          <Command.Item value="__empty-current-skills" disabled>
            <span className="cmdk-row-meta">No skills in this agent yet.</span>
          </Command.Item>
        )}
      </Command.Group>

      {enabled && (
        <Command.Group heading="Other agents">
          {anyOtherLoading && (
            <Command.Loading>Searching other agents…</Command.Loading>
          )}
          {others.flatMap(({ agent, query }) =>
            (query.data ?? []).map((s) => (
              <Command.Item
                key={`${agent.slug}:${s.name}`}
                value={`${agent.slug}:skill:${s.name}`}
                keywords={[
                  s.name,
                  s.description,
                  agent.slug,
                  agent.displayName,
                ]}
                onSelect={() => {
                  go({
                    to: "/agent/$slug/skills/$name",
                    params: { slug: agent.slug, name: s.name },
                  });
                }}
              >
                <Sparkles size={15} className="cmdk-icon" />
                <span className="cmdk-row-label">{s.name}</span>
                <span className="cmdk-row-meta">{agent.slug}</span>
              </Command.Item>
            )),
          )}
        </Command.Group>
      )}
    </>
  );
}
