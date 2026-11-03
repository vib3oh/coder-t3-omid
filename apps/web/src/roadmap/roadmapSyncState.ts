import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import { WS_METHODS, type EnvironmentId, type ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type { AtomRegistry } from "effect/reactivity";
import { connectionAtomRuntime } from "../connection/runtime";
import { roadmapRead } from "./roadmapState";

export const roadmapSyncRead = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "Hypercoder roadmap sync",
  tag: WS_METHODS.roadmapSyncRead,
  staleTimeMs: 0,
});

export const roadmapSyncDetail = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "Roadmap sync differences",
  tag: WS_METHODS.roadmapSyncDetail,
  staleTimeMs: 0,
  idleTtlMs: 0,
});

const refresh = (
  target: { environmentId: EnvironmentId; input: { projectId: ProjectId } },
  registry: AtomRegistry.AtomRegistry,
) => {
  const queryTarget = {
    environmentId: target.environmentId,
    input: { projectId: target.input.projectId },
  };
  registry.refresh(roadmapRead(queryTarget));
  registry.refresh(roadmapSyncRead(queryTarget));
  return Effect.void;
};

export const roadmapSyncConnect = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "Connect Hypercoder roadmap",
  tag: WS_METHODS.roadmapSyncConnect,
  onSuccess: refresh,
});

export const roadmapSyncRun = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "Sync Hypercoder roadmap",
  tag: WS_METHODS.roadmapSyncRun,
  onSuccess: refresh,
});

export const roadmapSyncResolve = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "Resolve roadmap sync conflict",
  tag: WS_METHODS.roadmapSyncResolve,
  onSuccess: refresh,
});

export const roadmapSyncDisconnect = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "Disconnect Hypercoder roadmap",
  tag: WS_METHODS.roadmapSyncDisconnect,
  onSuccess: refresh,
});
