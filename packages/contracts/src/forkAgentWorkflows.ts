import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import {
  CommandId,
  MessageId,
  NodeId,
  NonNegativeInt,
  ProjectId,
  RunId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";
import { OrchestrationV2ThreadLaunchWorkspaceStrategy } from "./orchestrationV2.ts";
import { ProviderInteractionMode, RuntimeMode } from "./providerPolicy.ts";

const Id = TrimmedNonEmptyString.check(Schema.isMaxLength(200));
const ShortText = Schema.String.check(Schema.isMaxLength(2_000));
const Instructions = Schema.String.check(Schema.isMaxLength(40_000));
const Timestamp = Schema.Number;
const Ids = Schema.Array(Id).check(Schema.isMaxLength(100));
const CompiledBrief = Schema.String.check(Schema.isMaxLength(80_000)).pipe(
  Schema.withDecodingDefault(Effect.succeed("")),
);

export const AgentRoleKind = Schema.Literals([
  "planner",
  "designer",
  "builder",
  "debugger",
  "reviewer",
]);
export type AgentRoleKind = typeof AgentRoleKind.Type;
export const AgentArtifactKind = Schema.Literals([
  "spec",
  "design",
  "implementation",
  "debug",
  "review",
  "result",
]);
export type AgentArtifactKind = typeof AgentArtifactKind.Type;

export const AgentRolePreset = Schema.Struct({
  id: Id,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(100)),
  kind: AgentRoleKind,
  version: NonNegativeInt,
  mission: ShortText,
  instructions: Instructions,
  requiredSkills: Ids,
  optionalSkills: Ids,
  outputKind: AgentArtifactKind,
  modelSelection: Schema.NullOr(ModelSelection),
  enabled: Schema.Boolean,
});
export type AgentRolePreset = typeof AgentRolePreset.Type;

export const AgentSkillSnapshot = Schema.Struct({
  id: Id,
  version: Schema.String,
  contentHash: Schema.String,
  path: Schema.NullOr(Schema.String),
  source: Schema.Literals(["builtin", "native", "external"]),
  state: Schema.Literals(["loaded", "on_demand", "missing", "unsupported"]),
  required: Schema.Boolean,
  reason: Schema.NullOr(ShortText),
});
export type AgentSkillSnapshot = typeof AgentSkillSnapshot.Type;

export const AgentRoleSnapshot = Schema.Struct({
  role: AgentRolePreset,
  instructionHash: Schema.String,
  skills: Schema.Array(AgentSkillSnapshot).check(Schema.isMaxLength(100)),
  modelSelection: ModelSelection,
  capabilities: Ids,
});
export type AgentRoleSnapshot = typeof AgentRoleSnapshot.Type;

export const AgentWorkflowLimits = Schema.Struct({
  maxConcurrent: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 8 })),
  maxAttempts: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
  maxReviewRounds: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 10 })),
  maxMessages: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 2_000 })),
  questionTimeoutMs: Schema.Int.check(Schema.isBetween({ minimum: 1_000, maximum: 604_800_000 })),
});
export type AgentWorkflowLimits = typeof AgentWorkflowLimits.Type;
export const DEFAULT_AGENT_WORKFLOW_LIMITS: AgentWorkflowLimits = {
  maxConcurrent: 3,
  maxAttempts: 12,
  maxReviewRounds: 2,
  maxMessages: 500,
  questionTimeoutMs: 86_400_000,
};

export const AgentCriterion = Schema.Struct({ id: Id, text: ShortText });
export type AgentCriterion = typeof AgentCriterion.Type;

export const AgentArtifactInput = Schema.Struct({
  kind: AgentArtifactKind,
  summary: ShortText,
  content: Instructions,
  baseRef: Schema.NullOr(Id),
  headRef: Schema.NullOr(Id),
  reviewedHead: Schema.NullOr(Id),
  outcome: Schema.Literals(["accepted", "needs_changes", "blocked"]),
  criteria: Schema.Array(
    Schema.Struct({
      id: Id,
      passed: Schema.Boolean,
      evidence: Schema.Array(ShortText).check(Schema.isMaxLength(20)),
    }),
  ).check(Schema.isMaxLength(200)),
  checks: Schema.Array(
    Schema.Struct({
      command: ShortText,
      revision: Id,
      status: Schema.Literals(["passed", "failed", "skipped"]),
      evidence: ShortText,
      required: Schema.Boolean,
    }),
  ).check(Schema.isMaxLength(100)),
  findings: Schema.Array(
    Schema.Struct({
      severity: Schema.Literals(["critical", "important", "suggestion"]),
      location: ShortText,
      reason: ShortText,
    }),
  ).check(Schema.isMaxLength(100)),
  limitations: Schema.Array(ShortText).check(Schema.isMaxLength(100)),
});
export type AgentArtifactInput = typeof AgentArtifactInput.Type;
export const AgentArtifact = Schema.Struct({
  ...AgentArtifactInput.fields,
  id: Id,
  version: NonNegativeInt,
  assignmentId: Id,
  producerThreadId: ThreadId,
  producerRunId: Schema.NullOr(RunId),
  contentHash: Id,
  validation: Schema.Literals(["verified", "unverified", "rejected"]),
  createdAt: Timestamp,
});
export type AgentArtifact = typeof AgentArtifact.Type;

export const AgentAssignmentState = Schema.Literals([
  "ready",
  "dispatching",
  "awaiting_result",
  "awaiting_peer",
  "awaiting_user",
  "validating",
  "accepted",
  "needs_changes",
  "failed",
  "cancelled",
]);
export type AgentAssignmentState = typeof AgentAssignmentState.Type;
export const AgentAssignmentAttempt = Schema.Struct({
  id: Id,
  ordinal: NonNegativeInt,
  commandId: CommandId,
  parentRunId: RunId,
  taskId: Schema.NullOr(NodeId),
  childThreadId: Schema.NullOr(ThreadId),
  createdAt: Timestamp,
});
export type AgentAssignmentAttempt = typeof AgentAssignmentAttempt.Type;
export const AgentAssignment = Schema.Struct({
  id: Id,
  compiledBrief: CompiledBrief,
  generation: NonNegativeInt,
  role: AgentRoleSnapshot,
  objective: Instructions,
  criteria: Schema.Array(AgentCriterion).check(Schema.isMaxLength(200)),
  inputArtifactIds: Ids,
  requiredChecks: Schema.Array(ShortText).check(Schema.isMaxLength(100)),
  dependencies: Ids,
  state: AgentAssignmentState,
  writeResponsibility: Schema.Boolean,
  baseRef: Schema.NullOr(Id),
  checkpoint: Schema.NullOr(Schema.Struct({ ref: Id, commitSha: Id })),
  workspacePath: Schema.NullOr(Schema.String),
  attempts: Schema.Array(AgentAssignmentAttempt).check(Schema.isMaxLength(100)),
  artifactIds: Ids,
});
export type AgentAssignment = typeof AgentAssignment.Type;

export const AgentParticipant = Schema.Struct({
  id: Id,
  threadId: ThreadId,
  roleId: Id,
  assignmentId: Schema.NullOr(Id),
});
export type AgentParticipant = typeof AgentParticipant.Type;
export const AgentTeamMessageKind = Schema.Literals([
  "update",
  "question",
  "answer",
  "handoff",
  "result",
]);
export type AgentTeamMessageKind = typeof AgentTeamMessageKind.Type;
export const AgentTeamMessage = Schema.Struct({
  id: Id,
  groupId: Schema.optional(Id),
  revisionRef: Schema.optional(Schema.NullOr(Id)),
  generation: NonNegativeInt,
  origin: Schema.Literals(["agent", "user", "system"]),
  senderThreadId: Schema.NullOr(ThreadId),
  recipientThreadId: ThreadId,
  assignmentId: Schema.NullOr(Id),
  kind: AgentTeamMessageKind,
  summary: ShortText,
  text: Instructions,
  artifactIds: Ids,
  replyTo: Schema.NullOr(Id),
  blocking: Schema.Boolean,
  delivery: Schema.Literals(["persisted", "queued", "submitted", "acknowledged", "failed"]),
  questionState: Schema.NullOr(Schema.Literals(["pending", "answered", "expired", "cancelled"])),
  createdAt: Timestamp,
  expiresAt: Schema.NullOr(Timestamp),
  commandId: CommandId,
  messageId: MessageId,
});
export type AgentTeamMessage = typeof AgentTeamMessage.Type;

export const AgentActionIntent = Schema.Struct({
  id: Id,
  requestId: Id,
  fingerprint: Schema.String,
  generation: NonNegativeInt,
  operation: Schema.Literals(["launch", "assignment", "message", "control", "result", "ack"]),
  targetAttemptId: Schema.NullOr(Id),
  state: Schema.Literals(["pending", "accepted", "failed", "cancelled"]),
  commandId: CommandId,
  entityId: Id,
  createdAt: Timestamp,
});
export type AgentActionIntent = typeof AgentActionIntent.Type;
export const AgentWorkflowStatus = Schema.Literals([
  "draft",
  "running",
  "waiting_user",
  "paused",
  "completed",
  "failed",
  "cancelled",
]);
export type AgentWorkflowStatus = typeof AgentWorkflowStatus.Type;
export const AgentWorkflowRoleIds = Schema.Struct({ planner: Id, builder: Id, reviewer: Id });
export type AgentWorkflowRoleIds = typeof AgentWorkflowRoleIds.Type;
export const AgentSpecSnapshot = Schema.Struct({
  source: ShortText,
  content: Schema.String.check(Schema.isMaxLength(32_000)),
  contentHash: Id,
});
export type AgentSpecSnapshot = typeof AgentSpecSnapshot.Type;
export const AgentWorkflow = Schema.Struct({
  id: Id,
  projectId: ProjectId,
  title: ShortText,
  objective: Instructions,
  managerThreadId: ThreadId,
  managerBrief: CompiledBrief,
  managerRole: Schema.NullOr(AgentRoleSnapshot),
  roleIds: AgentWorkflowRoleIds,
  specSnapshot: Schema.NullOr(AgentSpecSnapshot),
  sourceThreadId: Schema.NullOr(ThreadId),
  cardId: Schema.NullOr(Id),
  cardRevision: Schema.NullOr(NonNegativeInt),
  generation: NonNegativeInt,
  revision: NonNegativeInt,
  status: AgentWorkflowStatus,
  limits: AgentWorkflowLimits,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  workspaceStrategy: OrchestrationV2ThreadLaunchWorkspaceStrategy,
  workspacePath: Schema.NullOr(Schema.String),
  baseRef: Schema.NullOr(Id),
  criteria: Schema.Array(AgentCriterion).check(Schema.isMaxLength(200)),
  createdAt: Timestamp,
  requiredChecks: Schema.Array(ShortText).check(Schema.isMaxLength(100)),
  updatedAt: Timestamp,
  assignments: Schema.Array(AgentAssignment).check(Schema.isMaxLength(100)),
  participants: Schema.Array(AgentParticipant).check(Schema.isMaxLength(101)),
  messages: Schema.Array(AgentTeamMessage).check(Schema.isMaxLength(2_000)),
  artifacts: Schema.Array(AgentArtifact).check(Schema.isMaxLength(500)),
  intents: Schema.Array(AgentActionIntent).check(Schema.isMaxLength(3_000)),
});
export type AgentWorkflow = typeof AgentWorkflow.Type;
export const AgentWorkflowSummary = Schema.Struct({
  humanInputPending: Schema.optional(Schema.Boolean),
  humanInputThreadIds: Schema.optional(Schema.Array(ThreadId)),
  id: Id,
  revision: NonNegativeInt,
  projectId: ProjectId,
  title: ShortText,
  objective: ShortText,
  managerThreadId: ThreadId,
  sourceThreadId: Schema.NullOr(ThreadId),
  status: AgentWorkflowStatus,
  updatedAt: Timestamp,
  assignmentCount: NonNegativeInt,
  acceptedCount: NonNegativeInt,
  pendingQuestions: NonNegativeInt,
  latestSummary: Schema.NullOr(ShortText),
  currentStage: Schema.NullOr(ShortText),
});
export type AgentWorkflowSummary = typeof AgentWorkflowSummary.Type;
export const AgentWorkflowProject = Schema.Struct({
  version: Schema.Literal(1),
  revision: NonNegativeInt,
  roleRevision: Schema.optional(NonNegativeInt),
  enabled: Schema.Boolean,
  roles: Schema.Array(AgentRolePreset).check(Schema.isMaxLength(100)),
  workflows: Schema.Array(AgentWorkflow).check(Schema.isMaxLength(100)),
});
export type AgentWorkflowProject = typeof AgentWorkflowProject.Type;

export const AgentRolesReadInput = Schema.Struct({ projectId: ProjectId });
export const AgentRolesReadResult = Schema.Struct({
  revision: NonNegativeInt,
  enabled: Schema.Boolean,
  roles: Schema.Array(AgentRolePreset),
});
export const AgentRoleSaveInput = Schema.Struct({
  projectId: ProjectId,
  expectedRevision: NonNegativeInt,
  role: AgentRolePreset,
});
export const AgentWorkflowSettingsInput = Schema.Struct({
  projectId: ProjectId,
  expectedRevision: NonNegativeInt,
  enabled: Schema.Boolean,
});
export const AgentWorkflowListInput = Schema.Struct({ projectId: ProjectId });
export const AgentWorkflowListResult = Schema.Struct({
  enabled: Schema.Boolean,
  workflows: Schema.Array(AgentWorkflowSummary),
});
export const AgentWorkflowReadInput = Schema.Struct({ projectId: ProjectId, workflowId: Id });
export const AgentWorkflowStartInput = Schema.Struct({
  projectId: ProjectId,
  requestId: Id,
  title: ShortText,
  objective: Instructions,
  roleIds: AgentWorkflowRoleIds,
  requiredChecks: Schema.optional(Schema.Array(ShortText).check(Schema.isMaxLength(100))),
  sourceThreadId: Schema.NullOr(ThreadId),
  cardId: Schema.NullOr(Id),
  cardRevision: Schema.NullOr(NonNegativeInt),
  criteria: Schema.Array(AgentCriterion).check(Schema.isMaxLength(200)),
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  workspaceStrategy: OrchestrationV2ThreadLaunchWorkspaceStrategy,
  limits: AgentWorkflowLimits,
});
export type AgentWorkflowStartInput = typeof AgentWorkflowStartInput.Type;
export const AgentWorkflowControlInput = Schema.Struct({
  ...AgentWorkflowReadInput.fields,
  requestId: Id,
  action: Schema.Literals(["pause", "resume", "cancel", "retry"]),
  limits: Schema.optional(AgentWorkflowLimits),
});
export type AgentWorkflowControlInput = typeof AgentWorkflowControlInput.Type;
export const AgentAssignmentStartInput = Schema.Struct({
  ...AgentWorkflowReadInput.fields,
  requestId: Id,
  assignmentId: Id,
  generation: NonNegativeInt,
  roleId: Id,
  objective: Instructions,
  criteria: Schema.Array(AgentCriterion).check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  inputArtifactIds: Ids,
  dependencies: Ids,
  modelSelection: Schema.optional(ModelSelection),
});
export type AgentAssignmentStartInput = typeof AgentAssignmentStartInput.Type;
export const AgentAssignmentControlInput = Schema.Struct({
  ...AgentWorkflowReadInput.fields,
  assignmentId: Id,
  requestId: Id,
  action: Schema.Literals(["cancel", "retry"]),
});
export type AgentAssignmentControlInput = typeof AgentAssignmentControlInput.Type;
export const AgentAssignmentResultInput = Schema.Struct({
  ...AgentWorkflowReadInput.fields,
  requestId: Id,
  assignmentId: Id,
  generation: NonNegativeInt,
  artifact: AgentArtifactInput,
});
export type AgentAssignmentResultInput = typeof AgentAssignmentResultInput.Type;
export const AgentTeamMessageInput = Schema.Struct({
  ...AgentWorkflowReadInput.fields,
  requestId: Id,
  generation: NonNegativeInt,
  toThreadId: ThreadId,
  assignmentId: Schema.NullOr(Id),
  kind: AgentTeamMessageKind,
  summary: ShortText,
  text: Instructions,
  artifactIds: Ids,
  replyTo: Schema.NullOr(Id),
  blocking: Schema.Boolean,
});
export type AgentTeamMessageInput = typeof AgentTeamMessageInput.Type;
export const AgentTeamAckInput = Schema.Struct({
  ...AgentWorkflowReadInput.fields,
  requestId: Id,
  generation: NonNegativeInt,
  messageId: Id,
});
export type AgentTeamAckInput = typeof AgentTeamAckInput.Type;

export class AgentWorkflowError extends Schema.TaggedError<AgentWorkflowError>()(
  "AgentWorkflowError",
  {
    reason: Schema.Literals([
      "conflict",
      "invalid",
      "storage",
      "not_found",
      "disabled",
      "forbidden",
      "stale",
      "limit",
      "dependency",
      "writer_busy",
      "question_cycle",
      "missing_skill",
      "review_stale",
      "evidence",
      "idempotency_conflict",
    ]),
    detail: Schema.optional(ShortText),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    const messages = {
      conflict: "The agent workflow changed. Reload before saving again.",
      invalid: "The agent workflow data is invalid.",
      storage: "The agent workflow could not be stored or read.",
      not_found: "The requested agent workflow item was not found.",
      disabled: "New agent workflows are disabled for this project.",
      forbidden: "This participant cannot perform that workflow operation.",
      stale: "This operation belongs to an earlier workflow generation.",
      limit: "The workflow reached its configured resource limit.",
      dependency: "The assignment's required inputs are not accepted.",
      writer_busy: "Another assignment owns write responsibility in this workflow.",
      question_cycle: "This question would create a circular or excessive wait.",
      missing_skill: "A required role skill is unavailable.",
      review_stale: "The review does not apply to the current implementation revision.",
      evidence: "The assignment result lacks applicable verified evidence.",
      idempotency_conflict: "This request id was already used with different content.",
    };
    return this.detail ?? messages[this.reason];
  }
}
