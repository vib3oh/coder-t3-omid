import { scopedProjectKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";

export function roadmapDestination(
  environmentId: EnvironmentId,
  projectId: ProjectId,
  card?: string,
) {
  return {
    to: "/roadmap" as const,
    search: { project: scopedProjectKey({ environmentId, projectId }), ...(card ? { card } : {}) },
  };
}

export function changelogDestination(environmentId: EnvironmentId, projectId: ProjectId) {
  return {
    to: "/changelog" as const,
    search: { project: scopedProjectKey({ environmentId, projectId }) },
  };
}

export function workflowDestination(
  environmentId: EnvironmentId,
  projectId: ProjectId,
  workflowId?: string,
) {
  return {
    to: "/agent-workflows" as const,
    search: { environmentId, projectId, ...(workflowId ? { workflowId } : {}) },
  };
}

export function resolveExplicitProject<T extends { environmentId: EnvironmentId; id: ProjectId }>(
  projects: readonly T[],
  selected: string | undefined,
): T | undefined {
  return selected === undefined
    ? projects[0]
    : projects.find(
        (project) =>
          scopedProjectKey({ environmentId: project.environmentId, projectId: project.id }) ===
          selected,
      );
}

export const WORKTREE_SECTIONS = [
  ["pinned", "Pinned"],
  ["ready", "Your review"],
  ["reviewing", "Agent review"],
  ["building", "Building"],
  ["done", "Done"],
  ["parked", "Parked / Settled"],
] as const;

export const WORKTREE_STAGE_LABELS = {
  ready: "Your review",
  reviewing: "Agent review",
  building: "Building",
  done: "Done",
  parked: "Parked / Settled",
} as const;

export function isScopedUtilityDestination(
  href: string,
  environmentId: EnvironmentId,
  projectId: ProjectId,
): boolean {
  if (!href.startsWith("/") || href.startsWith("//")) return false;
  try {
    const url = new URL(href, "https://navigation.invalid");
    if (url.pathname === "/roadmap" || url.pathname === "/changelog")
      return (
        url.searchParams.get("project") === scopedProjectKey({ environmentId, projectId }) &&
        url.searchParams.get("detached") !== "true"
      );
    return (
      url.pathname === "/agent-workflows" &&
      url.searchParams.get("environmentId") === environmentId &&
      url.searchParams.get("projectId") === projectId
    );
  } catch {
    return false;
  }
}
