import type { RoadmapCard, RoadmapSyncFields } from "@t3tools/contracts";
import * as NodeUtil from "node:util";

interface Snapshot {
  readonly fields: RoadmapSyncFields;
  readonly rank: number;
}

export const snapshot = (card: RoadmapCard, rank: number): Snapshot => ({
  rank,
  fields: {
    title: card.title,
    summary: card.summary,
    type: card.type,
    effort: card.effort,
    lane: card.lane,
    archived: card.archived,
    completed: card.completed,
    specPath: card.specPath ?? null,
    acceptanceCriteria: card.acceptanceCriteria ?? [],
  },
});

export const same = (left: unknown, right: unknown): boolean =>
  NodeUtil.isDeepStrictEqual(left, right);

const mergeCriteria = (
  baseline: RoadmapSyncFields["acceptanceCriteria"],
  local: RoadmapSyncFields["acceptanceCriteria"],
  remote: RoadmapSyncFields["acceptanceCriteria"],
  choice?: "local" | "remote",
) => {
  const result: Array<RoadmapSyncFields["acceptanceCriteria"][number]> = [];
  const conflicts: string[] = [];
  const baseById = new Map(baseline.map((criterion) => [criterion.id, criterion]));
  const localById = new Map(local.map((criterion) => [criterion.id, criterion]));
  const remoteById = new Map(remote.map((criterion) => [criterion.id, criterion]));
  for (const id of new Set([...localById.keys(), ...remoteById.keys(), ...baseById.keys()])) {
    const base = baseById.get(id);
    const left = localById.get(id);
    const right = remoteById.get(id);
    if (same(left, right)) {
      if (left) result.push(left);
      continue;
    }
    if (same(left, base)) {
      if (right) result.push(right);
      continue;
    }
    if (same(right, base)) {
      if (left) result.push(left);
      continue;
    }
    if (!left || !right || !base) {
      conflicts.push(`acceptanceCriteria.${id}`);
      const chosen = choice === "remote" ? right : left;
      if (chosen) result.push(chosen);
      continue;
    }
    let text = left.text;
    let checked = left.checked;
    if (left.text === base.text) text = right.text;
    else if (right.text !== base.text && right.text !== left.text) {
      conflicts.push(`acceptanceCriteria.${id}.text`);
      if (choice === "remote") text = right.text;
    }
    if (left.checked === base.checked) checked = right.checked;
    else if (right.checked !== base.checked && right.checked !== left.checked)
      conflicts.push(`acceptanceCriteria.${id}.checked`);
    result.push({ id, text, checked });
  }
  return { result, conflicts };
};

export const reconcile = (
  baseline: Snapshot,
  local: Snapshot,
  remote: Snapshot,
  choice?: "local" | "remote",
) => {
  const conflicts: string[] = [];
  const fields = { ...local.fields };
  const keys = [
    "title",
    "summary",
    "type",
    "effort",
    "lane",
    "archived",
    "completed",
    "specPath",
  ] as const;
  for (const key of keys) {
    const base = baseline.fields[key];
    const left = local.fields[key];
    const right = remote.fields[key];
    if (same(left, base)) Object.assign(fields, { [key]: right });
    else if (!same(right, base) && !same(left, right)) {
      conflicts.push(key);
      if (choice === "remote") Object.assign(fields, { [key]: right });
    }
  }
  const criteria = mergeCriteria(
    baseline.fields.acceptanceCriteria,
    local.fields.acceptanceCriteria,
    remote.fields.acceptanceCriteria,
    choice,
  );
  fields.acceptanceCriteria = criteria.result;
  conflicts.push(...criteria.conflicts);
  let rank = local.rank;
  if (local.rank === baseline.rank) rank = remote.rank;
  else if (remote.rank !== baseline.rank && local.rank !== remote.rank) {
    conflicts.push("rank");
    if (choice === "remote") rank = remote.rank;
  }
  const merged = { fields, rank };
  return {
    merged,
    conflicts,
    pull: !same(local, merged),
    push: !same(remote, merged),
  };
};
