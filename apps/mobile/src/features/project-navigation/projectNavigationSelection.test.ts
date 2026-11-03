import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { scopedProjectKey } from "../../lib/scopedEntities";
import { resolveProjectNavigationTarget } from "./projectNavigationSelection";

describe("project navigation selection", () => {
  it("preserves an explicit environment even when another machine has the same project id", () => {
    const local = { environmentId: EnvironmentId.make("local"), id: ProjectId.make("same") };
    const remote = { environmentId: EnvironmentId.make("remote"), id: ProjectId.make("same") };
    const projects = [local, remote];
    const remembered = { environmentId: local.environmentId, projectId: local.id };
    const initialTarget = { environmentId: remote.environmentId, projectId: remote.id };

    expect(
      resolveProjectNavigationTarget({ projects, selected: undefined, initialTarget, remembered }),
    ).toBe(remote);
    expect(
      resolveProjectNavigationTarget({
        projects: [local],
        selected: undefined,
        initialTarget,
        remembered,
      }),
    ).toBeUndefined();
    expect(
      resolveProjectNavigationTarget({ projects, selected: null, initialTarget, remembered }),
    ).toBeUndefined();
    expect(
      resolveProjectNavigationTarget({
        projects,
        selected: scopedProjectKey(local.environmentId, local.id),
        initialTarget,
        remembered,
      }),
    ).toBe(local);
    expect(resolveProjectNavigationTarget({ projects, selected: undefined, remembered })).toBe(
      local,
    );
  });
});
