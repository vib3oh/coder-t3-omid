import { createFileRoute } from "@tanstack/react-router";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { AgentWorkflowsPage } from "../fork/agents/AgentWorkflowsPage";

export interface AgentWorkflowSearch {
  environmentId?: EnvironmentId;
  projectId?: ProjectId;
  sourceThreadId?: ThreadId;
  workflowId?: string;
  cardId?: string;
  roles?: boolean;
}

export const Route = createFileRoute("/_chat/agent-workflows")({
  component: AgentWorkflowsPage,
  validateSearch: (value: Record<string, unknown>): AgentWorkflowSearch => ({
    ...(typeof value.environmentId === "string"
      ? { environmentId: EnvironmentId.make(value.environmentId) }
      : {}),
    ...(typeof value.projectId === "string" ? { projectId: ProjectId.make(value.projectId) } : {}),
    ...(typeof value.sourceThreadId === "string"
      ? { sourceThreadId: ThreadId.make(value.sourceThreadId) }
      : {}),
    ...(typeof value.workflowId === "string" ? { workflowId: value.workflowId } : {}),
    ...(typeof value.cardId === "string" ? { cardId: value.cardId } : {}),
    ...(value.roles === true || value.roles === "true" ? { roles: true } : {}),
  }),
});
