import * as Schema from "effect/Schema";
import { NonNegativeInt, ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";

const Text = TrimmedNonEmptyString.check(Schema.isMaxLength(2_000));
export const RoadmapSyncBinding = Schema.Struct({
  contextPath: Text,
  backend: TrimmedNonEmptyString.check(Schema.isMaxLength(253)),
  projectId: Text,
  instanceId: Text,
});
export type RoadmapSyncBinding = typeof RoadmapSyncBinding.Type;

export const RoadmapSyncFields = Schema.Struct({
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  summary: Schema.String.check(Schema.isMaxLength(20_000)),
  type: Schema.Literals(["feature", "bug", "chore", "spike"]),
  effort: Schema.Literals(["XS", "S", "M", "L", "XL"]),
  lane: Schema.Literals(["backlog", "upNext"]),
  archived: Schema.Boolean,
  completed: Schema.Boolean,
  specPath: Schema.NullOr(Text),
  acceptanceCriteria: Schema.Array(
    Schema.Struct({
      id: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
      text: Text,
      checked: Schema.Boolean,
    }),
  ).check(Schema.isMaxLength(200)),
});
export type RoadmapSyncFields = typeof RoadmapSyncFields.Type;

export const RoadmapCardSync = Schema.Struct({
  source: Schema.Literal("hypercoder"),
  externalId: Schema.NullOr(Text),
  status: Schema.Literals(["synced", "pending", "conflict", "unsupported", "failed"]),
  readOnly: Schema.Boolean,
  reason: Schema.NullOr(Text),
  remoteColumn: Schema.NullOr(Text),
});
export type RoadmapCardSync = typeof RoadmapCardSync.Type;

export const RoadmapSyncRow = Schema.Struct({
  cardId: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  externalId: Schema.NullOr(Text),
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  status: Schema.Literals([
    "pulled",
    "pushed",
    "unchanged",
    "pending",
    "conflict",
    "unsupported",
    "failed",
  ]),
  reason: Schema.NullOr(Text),
  conflictingFields: Schema.Array(Text),
});
export type RoadmapSyncRow = typeof RoadmapSyncRow.Type;

export const RoadmapSyncCapabilities = Schema.Struct({
  conditionalWrites: Schema.Boolean,
  create: Schema.Boolean,
  update: Schema.Boolean,
  archive: Schema.Boolean,
  rank: Schema.Boolean,
});
export type RoadmapSyncCapabilities = typeof RoadmapSyncCapabilities.Type;

export const RoadmapSyncStatus = Schema.Struct({
  revision: NonNegativeInt,
  binding: Schema.NullOr(RoadmapSyncBinding),
  connection: Schema.Literals(["disconnected", "ready", "unavailable", "blocked"]),
  lastSyncedAt: Schema.NullOr(Schema.String),
  lastRunId: Schema.NullOr(Text),
  message: Schema.NullOr(Text),
  capabilities: RoadmapSyncCapabilities,
  rows: Schema.Array(RoadmapSyncRow).check(Schema.isMaxLength(10_000)),
  counts: Schema.Struct({
    pulled: NonNegativeInt,
    pushed: NonNegativeInt,
    unchanged: NonNegativeInt,
    conflicts: NonNegativeInt,
    unsupported: NonNegativeInt,
    failed: NonNegativeInt,
  }),
});
export type RoadmapSyncStatus = typeof RoadmapSyncStatus.Type;

export const RoadmapSyncDetail = Schema.Struct({
  cardId: Text,
  local: Schema.NullOr(RoadmapSyncFields),
  remote: Schema.NullOr(RoadmapSyncFields),
  baseline: Schema.NullOr(RoadmapSyncFields),
  localRank: Schema.optional(Schema.NullOr(NonNegativeInt)),
  remoteRank: Schema.optional(Schema.NullOr(NonNegativeInt)),
  baselineRank: Schema.optional(Schema.NullOr(NonNegativeInt)),
  conflictingFields: Schema.Array(Text),
});
export type RoadmapSyncDetail = typeof RoadmapSyncDetail.Type;

export const RoadmapSyncReadInput = Schema.Struct({ projectId: ProjectId });
export const RoadmapSyncConnectInput = Schema.Struct({
  projectId: ProjectId,
  expectedRevision: NonNegativeInt,
  binding: RoadmapSyncBinding,
});
export const RoadmapSyncRunInput = Schema.Struct({
  projectId: ProjectId,
  expectedRevision: NonNegativeInt,
});
export const RoadmapSyncDetailInput = Schema.Struct({ projectId: ProjectId, cardId: Text });
export const RoadmapSyncResolveInput = Schema.Struct({
  projectId: ProjectId,
  expectedRevision: NonNegativeInt,
  cardId: Text,
  choice: Schema.Literals(["local", "remote"]),
});
export const RoadmapSyncDisconnectInput = RoadmapSyncRunInput;

export class RoadmapSyncError extends Schema.TaggedError<RoadmapSyncError>()("RoadmapSyncError", {
  reason: Schema.Literals([
    "unavailable",
    "invalid",
    "mismatch",
    "conflict",
    "unsupported",
    "storage",
  ]),
}) {
  override get message(): string {
    switch (this.reason) {
      case "unavailable":
        return "Hypercoder is unavailable. Keep it running and signed in on this environment.";
      case "invalid":
        return "The Hypercoder connection or roadmap data is invalid.";
      case "mismatch":
        return "This Hypercoder context belongs to a different project or app instance.";
      case "conflict":
        return "The roadmap or sync state changed. Refresh before trying again.";
      case "unsupported":
        return "Hypercoder cannot safely apply this change. The card remains read-only.";
      case "storage":
        return "The roadmap sync state could not be saved.";
    }
  }
}
