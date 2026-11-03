import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { scopedProjectKey } from "../../lib/scopedEntities";

type ProjectRef = { readonly environmentId: EnvironmentId; readonly projectId: ProjectId };

export function resolveProjectNavigationTarget<
  Project extends { readonly environmentId: EnvironmentId; readonly id: ProjectId },
>(input: {
  readonly projects: ReadonlyArray<Project>;
  readonly selected: string | null | undefined;
  readonly initialTarget?: Partial<ProjectRef> | undefined;
  readonly remembered?: { readonly environmentId: string; readonly projectId: string } | undefined;
}) {
  if (input.selected === null) return undefined;
  if (input.selected !== undefined) {
    return input.projects.find(
      (project) => scopedProjectKey(project.environmentId, project.id) === input.selected,
    );
  }
  const target =
    input.initialTarget?.projectId || input.initialTarget?.environmentId
      ? input.initialTarget
      : input.remembered;
  return input.projects.find(
    (project) => project.id === target?.projectId && project.environmentId === target.environmentId,
  );
}
