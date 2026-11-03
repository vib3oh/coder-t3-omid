import * as Schema from "effect/Schema";
import { ThreadId } from "./baseSchemas.ts";
import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";
import {
  AgentArtifact,
  AgentRoleSnapshot,
  AgentTeamMessage,
  AgentWorkflow,
  AgentWorkflowReadInput,
} from "./forkAgentWorkflows.ts";
import { ModelSelection } from "./modelSelection.ts";

export const AgentWorkflowReadPageInput = Schema.Struct({
  ...AgentWorkflowReadInput.fields,
  messageOffset: Schema.optional(NonNegativeInt),
  artifactOffset: Schema.optional(NonNegativeInt),
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
  search: Schema.optional(Schema.String.check(Schema.isMaxLength(200))),
});
export type AgentWorkflowReadPageInput = typeof AgentWorkflowReadPageInput.Type;
export const AgentCommunicationReceipt = Schema.Struct({
  id: Schema.String,
  nativeMessageId: Schema.String,
  senderName: Schema.String,
  recipientName: Schema.String,
  summary: Schema.String,
  kind: Schema.Literals(["update", "question", "answer", "handoff", "result"]),
  delivery: Schema.Literals(["persisted", "queued", "submitted", "acknowledged", "failed"]),
});
export const AgentTeamMessageResult = Schema.Struct({ communication: AgentCommunicationReceipt });
export const AgentWorkflowView = Schema.Struct({
  ...AgentWorkflow.fields,
  messageNextOffset: Schema.NullOr(NonNegativeInt),
  artifactNextOffset: Schema.NullOr(NonNegativeInt),
  pendingQuestions: Schema.Array(AgentTeamMessage),
  communication: Schema.optional(AgentCommunicationReceipt),
  humanInputPending: Schema.optional(Schema.Boolean),
  humanInputThreadIds: Schema.optional(Schema.Array(ThreadId)),
});
export type AgentWorkflowView = typeof AgentWorkflowView.Type;
export const AgentWorkflowContentInput = Schema.Struct({
  ...AgentWorkflowReadInput.fields,
  kind: Schema.Literals(["message", "artifact", "assignment", "spec"]),
  id: TrimmedNonEmptyString,
});
export type AgentWorkflowContentInput = typeof AgentWorkflowContentInput.Type;
export const AgentWorkflowContentResult = Schema.Struct({
  text: Schema.String,
  artifact: Schema.optional(AgentArtifact),
});

export const AgentSkillCatalogEntry = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
  aliases: Schema.Array(Schema.String),
  family: Schema.String,
  tier: Schema.Literals(["core", "extension"]),
  modes: Schema.Array(Schema.String),
  version: Schema.String,
  contentHash: Schema.String,
  requiredCapabilities: Schema.Array(Schema.String),
  dependencies: Schema.Array(Schema.String),
  userInvocationOnly: Schema.Boolean,
  deferredReason: Schema.NullOr(Schema.String),
  provenance: Schema.Array(Schema.String),
});
export const AgentSkillsReadResult = Schema.Struct({
  skills: Schema.Array(AgentSkillCatalogEntry),
});
export const AgentRolePreviewInput = Schema.Struct({
  projectId: AgentWorkflowReadInput.fields.projectId,
  roleId: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
});
export type AgentRolePreviewInput = typeof AgentRolePreviewInput.Type;
export const AgentRolePreviewResult = Schema.Struct({
  snapshot: AgentRoleSnapshot,
  ready: Schema.Boolean,
  issues: Schema.Array(Schema.String),
});
