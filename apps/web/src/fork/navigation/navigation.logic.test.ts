import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  changelogDestination,
  isScopedUtilityDestination,
  resolveExplicitProject,
  resolveNavigationRouteProject,
  resolveProjectGroupMember,
  roadmapDestination,
  workflowDestination,
} from "./navigation.logic";

const environmentId = EnvironmentId.make("local");
const projectId = ProjectId.make("project");

describe("scoped navigation destinations", () => {
  it("keeps each existing route's project contract and refuses unknown explicit projects", () => {
    const project = { id: projectId, environmentId };
    const roadmap = roadmapDestination(environmentId, projectId, "card");
    const changelog = changelogDestination(environmentId, projectId);
    const workflow = workflowDestination(environmentId, projectId, "workflow");
    expect(roadmap.search.card).toBe("card");
    expect(changelog.search.project).toBe(roadmap.search.project);
    expect(workflow.search).toEqual({ environmentId, projectId, workflowId: "workflow" });
    expect(resolveExplicitProject([project], roadmap.search.project)).toBe(project);
    expect(resolveExplicitProject([project], "unknown")).toBeUndefined();
    expect(resolveExplicitProject([project], undefined)).toBe(project);
    expect(
      isScopedUtilityDestination(
        `/roadmap?project=${encodeURIComponent(roadmap.search.project)}&card=card`,
        environmentId,
        projectId,
      ),
    ).toBe(true);
    expect(isScopedUtilityDestination("/changelog?project=other", environmentId, projectId)).toBe(
      false,
    );
    expect(isScopedUtilityDestination("//outside.invalid/roadmap", environmentId, projectId)).toBe(
      false,
    );
  });

  it("restores a group's physical member after switching away, including an offline member", () => {
    const local = { id: projectId, environmentId };
    const remote = { id: projectId, environmentId: EnvironmentId.make("remote") };
    const projects = [local, remote];
    const input = {
      projects,
      selectedProject: "other:project",
      rememberedProject: "remote:project",
      connectedEnvironmentIds: [environmentId],
    };
    expect(resolveProjectGroupMember(input)).toBe(remote);
    expect(resolveProjectGroupMember({ ...input, selectedProject: "local:project" })).toBe(local);
    expect(resolveProjectGroupMember({ ...input, rememberedProject: "deleted:project" })).toBe(
      local,
    );
  });

  it("keeps a draft's physical project authoritative when no persisted thread is routed", () => {
    const draft = { environmentId: EnvironmentId.make("remote"), projectId };
    const thread = { environmentId, projectId };
    expect(resolveNavigationRouteProject({ thread: null, draft, search: {} })).toBe(
      "remote:project",
    );
    expect(resolveNavigationRouteProject({ thread, draft, search: {} })).toBe("local:project");
    expect(
      resolveNavigationRouteProject({ thread: null, draft: null, search: { project: "missing" } }),
    ).toBe("missing");
  });
});
