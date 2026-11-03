import {
  CommandId,
  DEFAULT_AGENT_WORKFLOW_LIMITS,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type AgentAssignment,
  type AgentTeamMessage,
  type AgentWorkflow,
} from "@t3tools/contracts";
import { defaultAgentRoles } from "../../apps/server/src/fork/agents/WorkflowRules.ts";
import {
  assignmentInstructions,
  managerInstructions,
} from "../../apps/server/src/fork/agents/runtimeInstructions.ts";
import { compileBuiltinRole } from "../../apps/server/src/fork/skills/BuiltinSkillService.ts";
import { skillContentHash } from "../../apps/server/src/fork/skills/catalog.ts";

export type WorkflowEvalRole = "manager" | "builder" | "reviewer";

export function agentWorkflowFixture(kind: WorkflowEvalRole) {
  const manager = ThreadId.make("00000000-0000-4000-8000-000000000001");
  const worker = ThreadId.make("00000000-0000-4000-8000-000000000002");
  const planner = ThreadId.make("00000000-0000-4000-8000-000000000003");
  const selection = { instanceId: ProviderInstanceId.make("claudeAgent"), model: "fixture" };
  const role = defaultAgentRoles().find(
    (row) => row.kind === (kind === "manager" ? "planner" : kind),
  )!;
  const compile = (selectedRole: typeof role) =>
    compileBuiltinRole({
      role: selectedRole,
      modelSelection: selection,
      provider: "claudeAgent",
      nativeSkills: [],
      capabilities: ["filesystem", "git", "shell", "t3.threads"],
      delivery: "task-context",
      // Explicit task-context delivery needs no installed provider files.
      package: {
        version: "fixture",
        contentHash: "fixture",
        entries: [],
        codexRoot: "",
        claudePluginRoot: "",
      },
    });
  const compiled = compile(role);
  const base = "a".repeat(40);
  const head = "b".repeat(40);
  const assignment: AgentAssignment = {
    id: kind === "reviewer" ? "review-one" : "build-one",
    generation: 3,
    compiledBrief: compiled.brief,
    role: compiled.snapshot,
    objective: "Reject empty names in src/name.ts while preserving valid names.",
    criteria: [{ id: "AC-1", text: "Empty names produce a validation error." }],
    inputArtifactIds: kind === "reviewer" ? ["implementation-one"] : [],
    requiredChecks: ["vp test run src/name.test.ts"],
    dependencies: [],
    state: "awaiting_result",
    writeResponsibility: kind === "builder",
    baseRef: base,
    checkpoint: { ref: "refs/t3/agent-workflows/acme-build", commitSha: head },
    workspacePath: "/home/user/acme/app",
    attempts: [],
    artifactIds: [],
  };
  const question = (id: string, senderThreadId: ThreadId, text: string): AgentTeamMessage => ({
    id,
    generation: 3,
    origin: "agent",
    senderThreadId,
    recipientThreadId: worker,
    assignmentId: assignment.id,
    kind: "question",
    summary: text,
    text,
    artifactIds: [],
    replyTo: null,
    blocking: false,
    delivery: "submitted",
    questionState: "pending",
    createdAt: 0,
    expiresAt: null,
    commandId: CommandId.make(id),
    messageId: MessageId.make(id),
  });
  const questions =
    kind === "builder"
      ? [
          question("question-contract", planner, "Should an empty name return a validation error?"),
          question("question-layout", manager, "Do we need a new layout?"),
        ]
      : [];
  const workflow: AgentWorkflow = {
    id: "acme-workflow",
    projectId: ProjectId.make("00000000-0000-4000-8000-000000000010"),
    title: "Validate names",
    objective: "Reject empty names without changing the layout.",
    managerThreadId: manager,
    managerRole: null,
    managerBrief: kind === "manager" ? compiled.brief : "",
    roleIds: { planner: "planner", builder: "builder", reviewer: "reviewer" },
    specSnapshot: {
      source: "user",
      content: "Empty names return a validation error. Preserve layout.",
      contentHash: skillContentHash("Empty names return a validation error. Preserve layout."),
    },
    sourceThreadId: null,
    cardId: null,
    cardRevision: null,
    generation: 3,
    revision: 4,
    status: "running",
    limits: DEFAULT_AGENT_WORKFLOW_LIMITS,
    modelSelection: selection,
    runtimeMode: "auto-accept-edits",
    interactionMode: "default",
    workspaceStrategy: { type: "root" },
    workspacePath: "/home/user/acme/app",
    baseRef: base,
    criteria: assignment.criteria,
    requiredChecks: assignment.requiredChecks,
    createdAt: 0,
    updatedAt: 0,
    assignments:
      kind === "manager"
        ? []
        : kind === "reviewer"
          ? [
              {
                ...assignment,
                id: "build-one",
                role: compile(defaultAgentRoles().find((row) => row.kind === "builder")!).snapshot,
                writeResponsibility: true,
                state: "accepted",
                inputArtifactIds: [],
                artifactIds: ["implementation-one"],
              },
              assignment,
            ]
          : [assignment],
    participants: [
      { id: "manager", threadId: manager, roleId: "manager", assignmentId: null },
      {
        id: "planner",
        threadId: planner,
        roleId: kind === "reviewer" ? "builder" : "planner",
        assignmentId: kind === "reviewer" ? "build-one" : "plan-one",
      },
      {
        id: "builder",
        threadId: worker,
        roleId: kind === "reviewer" ? "reviewer" : "builder",
        assignmentId: assignment.id,
      },
    ],
    messages: questions,
    artifacts:
      kind === "reviewer"
        ? [
            {
              id: "implementation-one",
              version: 1,
              assignmentId: "build-one",
              producerThreadId: planner,
              producerRunId: null,
              contentHash: skillContentHash("src/name.ts rejects empty names."),
              validation: "verified",
              createdAt: 0,
              kind: "implementation",
              summary: "Added name validation",
              content: "src/name.ts rejects empty names.",
              baseRef: base,
              headRef: head,
              reviewedHead: null,
              outcome: "accepted",
              criteria: [{ id: "AC-1", passed: true, evidence: ["src/name.ts"] }],
              checks: [],
              findings: [],
              limitations: [],
            },
          ]
        : [],
    intents: [],
  };
  return {
    instructions:
      kind === "manager"
        ? managerInstructions(workflow)
        : assignmentInstructions(workflow, assignment, compiled.brief),
    view: {
      ...workflow,
      pendingQuestions: questions,
      messageNextOffset: null,
      artifactNextOffset: null,
    },
  };
}
