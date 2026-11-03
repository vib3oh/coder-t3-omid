import type {
  AgentWorkflow,
  AgentWorkflowReadPageInput,
  AgentWorkflowView,
} from "@t3tools/contracts";

export function workflowMessagePage<A extends { readonly summary: string; readonly text: string }>(
  messages: ReadonlyArray<A>,
  offset: number,
  limit: number,
  search?: string,
) {
  const query = search?.trim().toLocaleLowerCase();
  const matched = query
    ? messages.filter((message) =>
        `${message.summary}\n${message.text}`.toLocaleLowerCase().includes(query),
      )
    : messages;
  const end = Math.max(0, matched.length - offset);
  const start = Math.max(0, end - limit);
  return { items: matched.slice(start, end), nextOffset: start > 0 ? offset + limit : null };
}

export function workflowView(
  workflow: AgentWorkflow,
  input: Partial<AgentWorkflowReadPageInput> = {},
): AgentWorkflowView {
  const limit = Math.min(100, Math.max(1, input.limit ?? 50));
  const page = workflowMessagePage(
    workflow.messages,
    input.messageOffset ?? 0,
    limit,
    input.search,
  );
  const artifactEnd = Math.max(0, workflow.artifacts.length - (input.artifactOffset ?? 0));
  const artifactStart = Math.max(0, artifactEnd - limit);
  const messageMetadata = (message: AgentWorkflow["messages"][number]) => ({
    ...message,
    summary: message.summary.slice(0, 240),
    text: "",
  });
  return {
    ...workflow,
    objective: workflow.objective.slice(0, 2_000),
    specSnapshot: workflow.specSnapshot === null ? null : { ...workflow.specSnapshot, content: "" },
    managerBrief: "",
    managerRole:
      workflow.managerRole === null
        ? null
        : { ...workflow.managerRole, role: { ...workflow.managerRole.role, instructions: "" } },
    assignments: workflow.assignments.map((assignment) => ({
      ...assignment,
      objective: assignment.objective.slice(0, 2_000),
      compiledBrief: "",
      role: { ...assignment.role, role: { ...assignment.role.role, instructions: "" } },
    })),
    messages: page.items.map(messageMetadata),
    artifacts: workflow.artifacts.slice(artifactStart, artifactEnd).map((artifact) => ({
      ...artifact,
      summary: artifact.summary.slice(0, 240),
      content: "",
      criteria: [],
      checks: [],
      findings: [],
      limitations: [],
    })),
    intents: [],
    messageNextOffset: page.nextOffset,
    artifactNextOffset: artifactStart > 0 ? (input.artifactOffset ?? 0) + limit : null,
    pendingQuestions: workflow.messages
      .filter((message) => message.questionState === "pending")
      .map(messageMetadata),
  };
}
