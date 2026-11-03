import type { AgentWorkflow } from "@t3tools/contracts";

export interface CommunicationMessage {
  readonly id: string;
  readonly assignmentId: string | null;
  readonly generation: number;
  readonly senderId: string;
  readonly recipientId: string;
  readonly kind: "update" | "question" | "answer" | "handoff" | "result";
  readonly summary: string;
  readonly text: string;
  readonly createdAt: number;
  readonly delivery: "persisted" | "queued" | "submitted" | "acknowledged" | "failed";
  readonly questionState?: "open" | "answered" | "expired" | "cancelled" | undefined;
  readonly replyTo: string | null;
  readonly revision: string | null;
  readonly groupId?: string | undefined;
}

export function workflowCommunications(workflow: AgentWorkflow) {
  const names = new Map<string, string>([
    ["user", "You"],
    ["system", "T3"],
    [workflow.managerThreadId, workflow.managerRole?.role.name ?? "Planner"],
  ]);
  for (const participant of workflow.participants) {
    const assignment = workflow.assignments.find((entry) => entry.id === participant.assignmentId);
    names.set(
      participant.threadId,
      assignment?.role.role.name ??
        (participant.threadId === workflow.managerThreadId
          ? (workflow.managerRole?.role.name ?? "Planner")
          : "Agent"),
    );
  }
  const messages: CommunicationMessage[] = workflow.messages.map((message) => ({
    id: message.id,
    assignmentId: message.assignmentId,
    generation: message.generation,
    senderId: message.senderThreadId ?? message.origin,
    recipientId: message.recipientThreadId,
    kind: message.kind,
    summary: message.summary,
    text: message.text,
    createdAt: message.createdAt,
    delivery: message.delivery,
    questionState:
      message.questionState === null
        ? undefined
        : message.questionState === "pending"
          ? "open"
          : message.questionState,
    replyTo: message.replyTo,
    revision:
      message.revisionRef ??
      (message.artifactIds.length > 0 ? [...message.artifactIds].sort().join(":") : null),
    groupId: message.groupId,
  }));
  return { names, messages, groups: groupCommunications(messages, names) };
}

export interface CommunicationGroup {
  readonly id: string;
  readonly messages: ReadonlyArray<CommunicationMessage>;
  readonly latest: CommunicationMessage;
  readonly summary: string;
  readonly needsAttention: boolean;
}

const DELIVERY_LABELS = {
  persisted: "Saved",
  queued: "Queued for the next turn",
  submitted: "Sent",
  acknowledged: "Received",
  failed: "Delivery failed",
} as const;

export function communicationStatus(message: CommunicationMessage) {
  if (message.delivery === "failed") return DELIVERY_LABELS.failed;
  if (message.questionState === "answered") return "Answered";
  if (message.questionState === "expired") return "Question expired";
  if (message.questionState === "cancelled") return "Question cancelled";
  if (message.kind === "question" && message.questionState === "open") return "Awaiting answer";
  return DELIVERY_LABELS[message.delivery];
}

function summaryFor(message: CommunicationMessage, names: ReadonlyMap<string, string>) {
  const supplied = message.summary.trim().replace(/\s+/g, " ");
  if (supplied) return supplied;
  const sender = names.get(message.senderId) ?? "An agent";
  const recipient = names.get(message.recipientId) ?? "another participant";
  if (message.kind === "question") return `${sender} asked ${recipient} a question`;
  if (message.kind === "answer") return `${sender} answered ${recipient}`;
  if (message.kind === "handoff") return `${sender} handed work to ${recipient}`;
  if (message.kind === "result") return `${sender} shared a result with ${recipient}`;
  return `${sender} updated ${recipient}`;
}

function canGroup(left: CommunicationMessage, right: CommunicationMessage) {
  return (
    left.kind === "update" &&
    right.kind === "update" &&
    left.delivery !== "failed" &&
    right.delivery !== "failed" &&
    left.assignmentId !== null &&
    left.assignmentId === right.assignmentId &&
    left.generation === right.generation &&
    left.senderId === right.senderId &&
    left.recipientId === right.recipientId &&
    left.replyTo === right.replyTo &&
    left.revision === right.revision &&
    left.groupId === right.groupId
  );
}

export function groupCommunications(
  messages: ReadonlyArray<CommunicationMessage>,
  names: ReadonlyMap<string, string>,
): ReadonlyArray<CommunicationGroup> {
  const seen = new Set<string>();
  const latestById = new Map(messages.map((message) => [message.id, message]));
  const groups: CommunicationGroup[] = [];
  const groupIds = new Set<string>();
  for (const original of messages) {
    if (seen.has(original.id)) continue;
    seen.add(original.id);
    const message = latestById.get(original.id)!;
    const previous = groups.at(-1);
    const needsAttention =
      message.delivery === "failed" ||
      (message.kind === "question" &&
        (message.questionState === "open" || message.questionState === "expired"));
    const extendsPrevious = previous !== undefined && canGroup(previous.latest, message);
    const candidateId = message.groupId
      ? message.kind === "update" && message.delivery !== "failed"
        ? `group:${message.groupId}`
        : `message:${message.id}`
      : message.id;
    const groupId = extendsPrevious
      ? previous.id
      : groupIds.has(candidateId)
        ? `${candidateId}:segment:${message.id}`
        : candidateId;
    groupIds.add(groupId);
    const group = {
      id: groupId,
      messages: extendsPrevious ? [...previous.messages, message] : [message],
      latest: message,
      summary: summaryFor(message, names),
      needsAttention,
    };
    if (extendsPrevious) groups[groups.length - 1] = group;
    else groups.push(group);
  }
  return groups;
}
