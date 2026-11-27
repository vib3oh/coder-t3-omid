import { WS_METHODS, type ProjectNavigationReadInput } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import * as EnvironmentRegistry from "../../connection/registry.ts";
import { request } from "../../rpc/client.ts";
import { createEnvironmentRpcQueryAtomFamily } from "../../state/runtime.ts";

export function createProjectNavigationState<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, E>,
) {
  const execute = (input: ProjectNavigationReadInput) =>
    request(WS_METHODS.projectNavigationRead, { ...input, supportsIdleStage: true });
  const read = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: WS_METHODS.projectNavigationRead,
    tag: WS_METHODS.projectNavigationRead,
    execute,
    staleTimeMs: 0,
    refreshIntervalMs: 5_000,
  });
  const page = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "projectNavigation.page",
    tag: WS_METHODS.projectNavigationRead,
    execute,
    staleTimeMs: 0,
  });
  return { read, page };
}
