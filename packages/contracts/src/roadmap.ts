import * as Schema from "effect/Schema";
import { NonNegativeInt, ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ThreadPullRequestLink } from "./threadPullRequest.ts";

export const RoadmapCard = Schema.Struct({
  id: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  summary: Schema.String.check(Schema.isMaxLength(20_000)),
  type: Schema.Literals(["feature", "bug", "chore", "spike"]),
  effort: Schema.Literals(["XS", "S", "M", "L", "XL"]),
  lane: Schema.Literals(["backlog", "upNext"]),
  threadId: Schema.NullOr(ThreadId),
  completed: Schema.Boolean,
  archived: Schema.Boolean,
});
export type RoadmapCard = typeof RoadmapCard.Type;

export const RoadmapBoard = Schema.Struct({
  version: Schema.Literal(1),
  revision: NonNegativeInt,
  cards: Schema.Array(RoadmapCard).check(Schema.isMaxLength(10_000)),
});
export type RoadmapBoard = typeof RoadmapBoard.Type;

export const RoadmapLinkedThread = Schema.Struct({
  id: ThreadId,
  title: Schema.String,
  archivedAt: Schema.NullOr(Schema.String),
  pullRequests: Schema.Array(ThreadPullRequestLink),
});
export type RoadmapLinkedThread = typeof RoadmapLinkedThread.Type;

export const RoadmapView = Schema.Struct({
  board: RoadmapBoard,
  linkedThreads: Schema.Array(RoadmapLinkedThread),
});
export type RoadmapView = typeof RoadmapView.Type;

export const RoadmapReadInput = Schema.Struct({ projectId: ProjectId });
export const RoadmapSaveInput = Schema.Struct({
  projectId: ProjectId,
  expectedRevision: NonNegativeInt,
  cards: RoadmapBoard.fields.cards,
});
export type RoadmapSaveInput = typeof RoadmapSaveInput.Type;

export class RoadmapError extends Schema.TaggedError<RoadmapError>()("RoadmapError", {
  reason: Schema.Literals(["conflict", "invalid", "storage"]),
}) {
  override get message(): string {
    switch (this.reason) {
      case "conflict":
        return "This roadmap changed elsewhere. Reload the board before saving again.";
      case "invalid":
        return "The roadmap data is invalid. The saved board has not been changed.";
      case "storage":
        return "The roadmap could not be read or saved. The saved board has not been changed.";
    }
  }
}
