import { createAgentWorkflowState } from "@t3tools/client-runtime/fork/agents/state";
import { connectionAtomRuntime } from "../../connection/runtime";

export const agentWorkflows = createAgentWorkflowState(connectionAtomRuntime);
