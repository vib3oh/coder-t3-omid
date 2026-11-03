import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import { WS_METHODS } from "@t3tools/contracts";
import { connectionAtomRuntime } from "../connection/runtime";

export const changelogRead = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "Changelog",
  tag: WS_METHODS.changelogRead,
  staleTimeMs: 0,
  refreshIntervalMs: 30_000,
});
export const changelogShare = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "Share changelog",
  tag: WS_METHODS.changelogShare,
});
