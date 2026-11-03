import { useAtomValue } from "@effect/atom-react";
import {
  communicationStatus,
  workflowCommunications,
  type CommunicationMessage,
} from "@t3tools/client-runtime/fork/agents/communication";
import type { AgentWorkflow, EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import * as Option from "effect/Option";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";
import { agentWorkflows } from "./agentWorkflowState";

export function WorkflowContent({
  environmentId,
  workflow,
  kind,
  id,
}: {
  environmentId: EnvironmentId;
  workflow: Pick<AgentWorkflow, "projectId" | "id">;
  kind: "message" | "artifact" | "assignment" | "spec";
  id: string;
}) {
  const result = useAtomValue(
    agentWorkflows.content({
      environmentId,
      input: {
        projectId: workflow.projectId,
        workflowId: workflow.id,
        kind,
        id,
      },
    }),
  );
  const content = Option.getOrNull(AsyncResult.value(result));
  if (!content)
    return (
      <p
        role={AsyncResult.isFailure(result) ? "alert" : "status"}
        className="text-sm text-muted-foreground"
      >
        {AsyncResult.isFailure(result)
          ? "Could not load the original content. Check your connection and permission."
          : "Loading content…"}
      </p>
    );
  return <p className="whitespace-pre-wrap break-words text-sm">{content.text}</p>;
}

export function AgentCommunication({
  environmentId,
  workflow,
  canReply,
  pending,
  onReply,
}: {
  environmentId: EnvironmentId;
  workflow: AgentWorkflow;
  canReply: boolean;
  pending: boolean;
  onReply: (question: CommunicationMessage, text: string) => Promise<boolean>;
}) {
  const presentation = workflowCommunications(workflow);
  return (
    <div className="space-y-2" aria-label="Agent communications">
      {presentation.groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Agents’ updates, questions and handoffs appear here.
        </p>
      ) : null}
      {presentation.groups.map((group) => (
        <CommunicationRow
          key={group.id}
          environmentId={environmentId}
          workflow={workflow}
          group={group}
          names={presentation.names}
          canReply={canReply}
          pending={pending}
          onReply={onReply}
        />
      ))}
    </div>
  );
}

function CommunicationRow({
  environmentId,
  workflow,
  group,
  names,
  canReply,
  pending,
  onReply,
}: {
  environmentId: EnvironmentId;
  workflow: AgentWorkflow;
  group: ReturnType<typeof workflowCommunications>["groups"][number];
  names: ReadonlyMap<string, string>;
  canReply: boolean;
  pending: boolean;
  onReply: (question: CommunicationMessage, text: string) => Promise<boolean>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [answer, setAnswer] = useState("");
  const message = group.latest;
  const original = workflow.messages.find((entry) => entry.id === message.id);
  return (
    <details
      className="rounded-lg border border-border bg-card"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary className="cursor-pointer rounded-lg px-4 py-3 focus-visible:outline-2 focus-visible:outline-ring">
        <span className="inline-grid w-[calc(100%_-_1rem)] grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 align-middle text-sm">
          <span className="col-start-1 row-start-1 truncate font-medium sm:col-span-2">
            {names.get(message.senderId) ?? "Agent"} → {names.get(message.recipientId) ?? "Agent"}
          </span>
          <span className="col-span-2 row-start-2 truncate sm:col-span-1">{group.summary}</span>
          <span
            className={
              group.needsAttention
                ? "col-start-2 row-start-1 shrink-0 text-xs font-medium text-foreground sm:row-start-2"
                : "col-start-2 row-start-1 shrink-0 text-xs text-muted-foreground sm:row-start-2"
            }
          >
            {communicationStatus(message)}
          </span>
          {group.messages.length > 1 ? (
            <span className="col-span-2 text-xs text-muted-foreground">
              {group.messages.length} updates
            </span>
          ) : null}
        </span>
      </summary>
      {expanded ? (
        <div className="space-y-4 border-t border-border p-4">
          <p className="text-xs text-muted-foreground">
            The summary is sender-reported. Delivery status describes transport, not task
            completion.
          </p>
          {message.delivery === "failed" ? (
            <p className="text-sm">
              Delivery stopped.{" "}
              <Link
                to="/$environmentId/$threadId"
                params={{
                  environmentId,
                  threadId: original?.senderThreadId ?? workflow.managerThreadId,
                }}
                className="text-primary underline"
              >
                {original?.senderThreadId
                  ? "Open the sender conversation"
                  : "Open the planner conversation"}
              </Link>{" "}
              to resolve the failure and request another send.
            </p>
          ) : null}
          {message.questionState === "expired" ? (
            <p className="text-sm">
              This question expired. Resume the workflow or open the planner conversation to resolve
              the blocking decision.
            </p>
          ) : null}
          {group.messages.map((entry) => (
            <article key={entry.id} className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>{entry.summary || group.summary}</span>
                <time dateTime={new Date(entry.createdAt).toISOString()}>
                  {new Date(entry.createdAt).toLocaleString()}
                </time>
              </div>
              <WorkflowContent
                environmentId={environmentId}
                workflow={workflow}
                kind="message"
                id={entry.id}
              />
              {workflow.messages
                .find((message) => message.id === entry.id)
                ?.artifactIds.map((id) => (
                  <ReferencedArtifact
                    key={id}
                    environmentId={environmentId}
                    workflow={workflow}
                    id={id}
                  />
                ))}
            </article>
          ))}
          {message.kind === "question" && message.questionState === "open" ? (
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                void onReply(message, answer).then((sent) => {
                  if (sent) setAnswer("");
                });
              }}
            >
              <label
                className="block text-sm font-medium"
                htmlFor={`workflow-answer-${message.id}`}
              >
                Answer as you
              </label>
              <Textarea
                id={`workflow-answer-${message.id}`}
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                maxLength={40_000}
                disabled={!canReply || pending}
              />
              <p className="text-xs text-muted-foreground">
                Your answer is attributed to you. Waiting for a peer does not require you to
                intervene.
              </p>
              <Button
                type="submit"
                variant="outline"
                size="sm"
                disabled={!canReply || pending || !answer.trim()}
              >
                Send answer
              </Button>
            </form>
          ) : null}
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer py-2">
              Diagnostics and original delivery facts
            </summary>
            <pre className="overflow-auto whitespace-pre-wrap break-all">
              {JSON.stringify(
                workflow.messages.filter((entry) =>
                  group.messages.some((row) => row.id === entry.id),
                ),
                null,
                2,
              )}
            </pre>
          </details>
        </div>
      ) : null}
    </details>
  );
}

function ReferencedArtifact({
  environmentId,
  workflow,
  id,
}: {
  environmentId: EnvironmentId;
  workflow: AgentWorkflow;
  id: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details className="text-sm" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer py-2">
        Referenced artifact
        {workflow.artifacts.find((artifact) => artifact.id === id)?.summary
          ? `: ${workflow.artifacts.find((artifact) => artifact.id === id)!.summary}`
          : ""}
      </summary>
      {open ? (
        <WorkflowContent
          environmentId={environmentId}
          workflow={workflow}
          kind="artifact"
          id={id}
        />
      ) : null}
    </details>
  );
}
