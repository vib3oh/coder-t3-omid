import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { AsyncResult } from "effect/reactivity";
import * as Option from "effect/Option";
import { Button } from "../../components/ui/button";
import { agentWorkflows } from "./agentWorkflowState";

export function ThreadWorkflowEntry({
  environmentId,
  projectId,
  threadId,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  threadId: ThreadId;
}) {
  const navigate = useNavigate();
  const result = useAtomValue(agentWorkflows.list({ environmentId, input: { projectId } }));
  const list = Option.getOrNull(AsyncResult.value(result));
  const linked = list?.workflows.find(
    (workflow) => workflow.managerThreadId === threadId || workflow.sourceThreadId === threadId,
  );
  if (!list?.enabled && !linked) return null;
  return (
    <div className="shrink-0 pl-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          void navigate({
            to: "/agent-workflows",
            search: {
              environmentId,
              projectId,
              ...(linked ? { workflowId: linked.id } : { sourceThreadId: threadId }),
            },
          })
        }
      >
        <span className="max-w-72 truncate">
          {linked
            ? `Workflow · ${linked.humanInputPending ? "Needs your input" : (linked.currentStage ?? linked.status.replaceAll("_", " "))}`
            : "Use agent workflow"}
          {linked?.latestSummary ? ` · ${linked.latestSummary}` : ""}
        </span>
      </Button>
    </div>
  );
}
