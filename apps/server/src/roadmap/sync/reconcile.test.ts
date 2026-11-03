import { describe, expect, it } from "@effect/vitest";
import type { RoadmapSyncFields } from "@t3tools/contracts";
import { reconcile } from "./reconcile.ts";

const fields: RoadmapSyncFields = {
  title: "Plan",
  summary: "",
  type: "feature",
  effort: "M",
  lane: "backlog",
  archived: false,
  completed: false,
  specPath: null,
  acceptanceCriteria: [{ id: "first", text: "Original", checked: false }],
};

describe("roadmap sync comparison", () => {
  it("detects deletion versus criterion edits, preserving independent additions", () => {
    const baseline = { fields, rank: 0 };
    const local = {
      fields: {
        ...fields,
        acceptanceCriteria: [{ id: "local", text: "Local addition", checked: false }],
      },
      rank: 0,
    };
    const remote = {
      fields: {
        ...fields,
        acceptanceCriteria: [
          { id: "first", text: "Remote edit", checked: false },
          { id: "remote", text: "Remote addition", checked: true },
        ],
      },
      rank: 0,
    };
    const result = reconcile(baseline, local, remote);
    expect(result.conflicts).toEqual(["acceptanceCriteria.first"]);
    expect(result.merged.fields.acceptanceCriteria.map((row) => row.id)).toEqual([
      "local",
      "remote",
    ]);
  });

  it("pulls one-sided rank changes and reports divergent ranks without choosing a winner", () => {
    const baseline = { fields, rank: 0 };
    const oneSided = reconcile(baseline, baseline, { fields, rank: 2 });
    expect(oneSided).toMatchObject({ merged: { rank: 2 }, pull: true, push: false, conflicts: [] });
    const divergent = reconcile(baseline, { fields, rank: 1 }, { fields, rank: 2 });
    expect(divergent.conflicts).toEqual(["rank"]);
    expect(divergent.merged.rank).toBe(1);
  });
});
