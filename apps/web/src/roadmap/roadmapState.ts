import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import { WS_METHODS, ORCHESTRATION_V2_WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { connectionAtomRuntime } from "../connection/runtime";

export const roadmapRead = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "Roadmap",
  tag: WS_METHODS.roadmapRead,
  staleTimeMs: 0,
  refreshIntervalMs: 5_000,
});

export const roadmapLaunch = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "Start roadmap work",
  tag: ORCHESTRATION_V2_WS_METHODS.launchThread,
});

export const roadmapSave = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "Save roadmap",
  tag: WS_METHODS.roadmapSave,
  onSuccess: (target, registry) => {
    registry.refresh(
      roadmapRead({
        environmentId: target.environmentId,
        input: { projectId: target.input.projectId },
      }),
    );
    return Effect.void;
  },
});
