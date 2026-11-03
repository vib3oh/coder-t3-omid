import * as Schema from "effect/Schema";
import { IsoDateTime, NonNegativeInt, PositiveInt, ProjectId, ThreadId } from "./baseSchemas.ts";

export const ChangelogType = Schema.Literals(["feature", "bug", "chore", "spike", "untyped"]);
export type ChangelogType = typeof ChangelogType.Type;
export const ChangelogEntry = Schema.Struct({
  id: Schema.String,
  threadId: ThreadId,
  archived: Schema.Boolean,
  title: Schema.String,
  summary: Schema.String,
  type: ChangelogType,
  pullNumber: PositiveInt,
  url: Schema.String,
  at: IsoDateTime,
});
export type ChangelogEntry = typeof ChangelogEntry.Type;
export const ChangelogReadInput = Schema.Struct({
  projectId: ProjectId,
  since: IsoDateTime,
  until: IsoDateTime,
});
export const ChangelogView = Schema.Struct({
  entries: Schema.Array(ChangelogEntry),
  undatedCount: NonNegativeInt,
  shareId: Schema.NullOr(Schema.String),
});
export const ChangelogShareInput = Schema.Struct({
  projectId: ProjectId,
  title: Schema.String.check(Schema.isMaxLength(200)),
  since: IsoDateTime,
  until: IsoDateTime,
  type: Schema.NullOr(ChangelogType),
  query: Schema.String.check(Schema.isMaxLength(200)),
  summaries: Schema.Boolean,
  timeZone: Schema.String.check(Schema.isMaxLength(128)),
  enabled: Schema.Boolean,
});
export type ChangelogShareInput = typeof ChangelogShareInput.Type;
export const ChangelogShareResult = Schema.Struct({ shareId: Schema.NullOr(Schema.String) });
export class ChangelogError extends Schema.TaggedError<ChangelogError>()("ChangelogError", {
  cause: Schema.Defect(),
}) {
  override get message() {
    return "The changelog could not be loaded or shared. Try again.";
  }
}
