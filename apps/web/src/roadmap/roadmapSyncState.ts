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
  label: WS_METHODS.roadmapSyncRead,
  tag: WS_METHODS.roadmapSyncRead,
  staleTimeMs: 0,
});

export const roadmapSyncDetail = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: WS_METHODS.roadmapSyncDetail,
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
  label: WS_METHODS.roadmapSyncConnect,
  tag: WS_METHODS.roadmapSyncConnect,
  onSuccess: refresh,
});

export const roadmapSyncRun = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: WS_METHODS.roadmapSyncRun,
  tag: WS_METHODS.roadmapSyncRun,
  onSuccess: refresh,
});

export const roadmapSyncResolve = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: WS_METHODS.roadmapSyncResolve,
  tag: WS_METHODS.roadmapSyncResolve,
  onSuccess: refresh,
});

export const roadmapSyncDisconnect = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: WS_METHODS.roadmapSyncDisconnect,
  tag: WS_METHODS.roadmapSyncDisconnect,
  onSuccess: refresh,
});
