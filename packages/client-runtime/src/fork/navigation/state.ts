import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import * as EnvironmentRegistry from "../../connection/registry.ts";
import { createEnvironmentRpcQueryAtomFamily } from "../../state/runtime.ts";

export function createProjectNavigationState<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, E>,
) {
  const read = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "Project worktrees",
    tag: WS_METHODS.projectNavigationRead,
    staleTimeMs: 0,
    refreshIntervalMs: 5_000,
  });
  const page = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "Project worktree details",
    tag: WS_METHODS.projectNavigationRead,
    staleTimeMs: 0,
  });
  return { read, page };
}
