import * as Schema from "effect/Schema";
import { NonNegativeInt, ProjectId, ThreadId } from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";
import { AgentWorkflowStatus } from "./forkAgentWorkflows.ts";

const Text = Schema.String;
const NullableText = Schema.NullOr(Text);
export const NavigationStage = Schema.Literals([
  "building",
  "ready",
  "reviewing",
  "done",
  "parked",
]);
export const NavigationThread = Schema.Struct({
  id: ThreadId,
  title: Text,
  providerInstanceId: ProviderInstanceId,
  worktreePath: NullableText,
  branch: NullableText,
  status: NullableText,
  hasPendingApprovals: Schema.Boolean,
  hasPendingUserInput: Schema.Boolean,
  archivedAt: NullableText,
  settledAt: NullableText,
  snoozedUntil: NullableText,
  pinnedAt: NullableText,
  updatedAt: Text,
  lastVisitedAt: Schema.optional(NullableText),
  latestRunCompletedAt: NullableText,
  latestUserMessageAt: NullableText,
  hasActionableProposedPlan: Schema.Boolean,
  pendingGuestMessageCount: NonNegativeInt,
});
export type NavigationThread = typeof NavigationThread.Type;
export const NavigationWorktree = Schema.Struct({
  key: Text,
  path: NullableText,
  label: Text,
  branch: NullableText,
  isMain: Schema.Boolean,
  availability: Schema.Literals(["available", "missing", "preparing", "unknown"]),
  stage: NavigationStage,
  completion: Schema.NullOr(Schema.Literals(["merged", "completed"])),
  cards: Schema.Array(
    Schema.Struct({
      id: Text,
      title: Text,
      stage: Schema.Literals([
        "backlog",
        "upNext",
        "building",
        "ready",
        "reviewing",
        "parked",
        "done",
      ]),
    }),
  ),
  workflows: Schema.Array(
    Schema.Struct({
      id: Text,
      title: Text,
      status: AgentWorkflowStatus,
      currentStage: NullableText,
      managerThreadId: ThreadId,
      humanInputThreadIds: Schema.Array(ThreadId),
    }),
  ),
  threads: Schema.Array(NavigationThread),
  attentionCount: NonNegativeInt,
  cardCount: Schema.optional(NonNegativeInt),
  cardNextOffset: Schema.optional(Schema.NullOr(NonNegativeInt)),
  workflowCount: Schema.optional(NonNegativeInt),
  workflowNextOffset: Schema.optional(Schema.NullOr(NonNegativeInt)),
  threadCount: NonNegativeInt,
  threadNextOffset: Schema.NullOr(NonNegativeInt),
});
export type NavigationWorktree = typeof NavigationWorktree.Type;
export const ProjectNavigationReadInput = Schema.Struct({
  projectId: ProjectId,
  revealThreadId: Schema.optional(ThreadId),
  cursor: Schema.optional(Text.check(Schema.isMaxLength(2_000))),
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
  worktreeKey: Schema.optional(Text.check(Schema.isMaxLength(8_000))),
  threadOffset: Schema.optional(NonNegativeInt),
  cardOffset: Schema.optional(NonNegativeInt),
  workflowOffset: Schema.optional(NonNegativeInt),
});
export type ProjectNavigationReadInput = typeof ProjectNavigationReadInput.Type;
const Availability = Schema.Literals(["available", "unavailable"]);
export const ProjectNavigationReadResult = Schema.Struct({
  projectId: ProjectId,
  revision: Text,
  observedAt: Text,
  sources: Schema.Struct({
    threads: Availability,
    roadmap: Availability,
    workflows: Availability,
    git: Availability,
  }),
  worktrees: Schema.Array(NavigationWorktree),
  nextCursor: NullableText,
  totalWorktrees: NonNegativeInt,
  attentionCount: NonNegativeInt,
  complete: Schema.Boolean,
});
export type ProjectNavigationReadResult = typeof ProjectNavigationReadResult.Type;
export class ProjectNavigationError extends Schema.TaggedError<ProjectNavigationError>()(
  "ProjectNavigationError",
  {
    reason: Schema.Literals(["not_found", "storage", "stale_cursor"]),
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "not_found":
        return "This project is unavailable.";
      case "storage":
        return "Project work could not be read.";
      case "stale_cursor":
        return "Project work changed. Reload the list to continue.";
    }
  }
}
