import type {
  AgentArtifact,
  AgentRolePreset,
  AgentTeamMessage,
  AgentWorkflow,
  AgentWorkflowSummary,
  ThreadId,
} from "@t3tools/contracts";

export const expectedRoleOutputKind = {
  planner: "spec",
  designer: "design",
  builder: "implementation",
  debugger: "implementation",
  reviewer: "review",
} as const;

export function workflowSummary(workflow: AgentWorkflow): AgentWorkflowSummary {
  return {
    id: workflow.id,
    revision: workflow.revision,
    projectId: workflow.projectId,
    title: workflow.title,
    objective: workflow.objective.slice(0, 2_000),
    managerThreadId: workflow.managerThreadId,
    sourceThreadId: workflow.sourceThreadId,
    status: workflow.status,
    updatedAt: workflow.updatedAt,
    assignmentCount: workflow.assignments.length,
    acceptedCount: workflow.assignments.filter((row) => row.state === "accepted").length,
    pendingQuestions: workflow.messages.filter((row) => row.questionState === "pending").length,
    latestSummary:
      workflow.messages.find((row) => row.questionState === "pending")?.summary ??
      workflow.artifacts.at(-1)?.summary ??
      workflow.messages.at(-1)?.summary ??
      null,
    currentStage:
      workflow.assignments.find((row) => assignmentIsActive(row.state))?.role.role.name ?? null,
  };
}

export function defaultAgentRoles(): AgentRolePreset[] {
  return [
    {
      id: "planner",
      name: "Planner",
      kind: "planner",
      version: 1,
      mission: "Turn the user's objective into bounded, verifiable assignments.",
      instructions:
        "Preserve the user's scope. Prepare an accepted specification with criteria, dependencies and open decisions. Resolve only questions already answered by the user or repository. Delegate implementation and independent review; do not implement the whole task yourself.",
      requiredSkills: ["vibe-spec", "vibe-status", "t3-spec-audit", "vibe-worktrees"],
      optionalSkills: ["vibe-prd", "vibe-issue", "t3-roadmap"],
      outputKind: "spec",
      modelSelection: null,
      enabled: true,
    },
    {
      id: "designer",
      name: "Designer",
      kind: "designer",
      version: 1,
      mission: "Resolve interaction and visual decisions before implementation.",
      instructions:
        "Describe the relevant user flow, states, accessibility and implementation constraints. Use the existing product's design system. Return a design artifact and identify unresolved choices; do not silently expand product scope.",
      requiredSkills: ["vibe-design", "vibe-spec"],
      optionalSkills: ["vibe-screenshot"],
      outputKind: "design",
      modelSelection: null,
      enabled: true,
    },
    {
      id: "builder",
      name: "Builder",
      kind: "builder",
      version: 1,
      mission: "Implement the accepted specification and prove its behavior.",
      instructions:
        "Implement only the accepted assignment. Preserve repository instructions and existing native services. Report the exact base/head, criteria evidence, checks and limitations. Do not claim completion from a stopped process or grant yourself publishing or merge authority.",
      requiredSkills: ["vibe-build", "vibe-worktrees"],
      optionalSkills: ["vibe-patch", "vibe-publish", "t3-mobile"],
      outputKind: "implementation",
      modelSelection: null,
      enabled: true,
    },
    {
      id: "debugger",
      name: "Debugger",
      kind: "debugger",
      version: 1,
      mission: "Reproduce the failure, identify its cause and verify a bounded fix.",
      instructions:
        "Establish reproduction and causal evidence before editing. Make the smallest fix within the accepted scope, run focused regression verification, and return the exact revision and remaining limitations.",
      requiredSkills: ["t3-debug", "vibe-patch"],
      optionalSkills: ["t3-mobile", "vibe-screenshot"],
      outputKind: "implementation",
      modelSelection: null,
      enabled: true,
    },
    {
      id: "reviewer",
      name: "Reviewer",
      kind: "reviewer",
      version: 1,
      mission: "Independently inspect the exact implementation revision.",
      instructions:
        "Do not edit code, repair findings, publish, mark a PR ready or merge. Inspect the pinned base/head with fresh context. Verify each finding against source and evidence, report checks and limitations, and return accepted or needs_changes tied to the reviewed head. A role prompt does not establish a filesystem sandbox.",
      requiredSkills: ["vibe-review"],
      optionalSkills: ["vibe-screenshot", "t3-mobile"],
      outputKind: "review",
      modelSelection: null,
      enabled: true,
    },
  ];
}

export function blockingQuestionCycle(
  messages: ReadonlyArray<AgentTeamMessage>,
  sender: ThreadId,
  recipient: ThreadId,
): boolean {
  const visit = (current: ThreadId, visited: Set<ThreadId>, depth: number): boolean => {
    if (current === sender || depth >= 8) return true;
    if (visited.has(current)) return false;
    visited.add(current);
    return messages.some(
      (message) =>
        message.kind === "question" &&
        message.blocking &&
        message.questionState === "pending" &&
        message.senderThreadId === current &&
        visit(message.recipientThreadId, visited, depth + 1),
    );
  };
  return visit(recipient, new Set(), 0);
}

export function latestImplementation(workflow: AgentWorkflow): AgentArtifact | undefined {
  return [...workflow.artifacts].reverse().find((artifact) => {
    const assignment = workflow.assignments.find((row) => row.id === artifact.assignmentId);
    return (
      assignment?.state === "accepted" &&
      artifact.validation === "verified" &&
      artifact.outcome === "accepted" &&
      artifact.headRef !== null &&
      (assignment?.role.role.kind === "builder" || assignment?.role.role.kind === "debugger")
    );
  });
}

export function assignmentIsActive(state: AgentWorkflow["assignments"][number]["state"]): boolean {
  return (
    state === "dispatching" ||
    state === "awaiting_result" ||
    state === "awaiting_peer" ||
    state === "awaiting_user" ||
    state === "validating"
  );
}
