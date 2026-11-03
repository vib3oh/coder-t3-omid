import { createProjectNavigationState } from "@t3tools/client-runtime/fork/navigation/state";
import { connectionAtomRuntime } from "../../connection/runtime";

export const projectNavigation = createProjectNavigationState(connectionAtomRuntime);
