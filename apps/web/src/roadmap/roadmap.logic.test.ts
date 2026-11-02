import { describe, expect, it } from "vite-plus/test";
import { roadmapColumn, moveRoadmapCard, mergeRoadmapEdit } from "./roadmap.logic";
import type { RoadmapCard } from "@t3tools/contracts";

const card: RoadmapCard = {
  id: "one",
  title: "Board",
  summary: "",
  type: "feature",
  effort: "M",
  lane: "upNext",
  threadId: null,
  completed: false,
  archived: false,
};

describe("roadmap lifecycle", () => {
  it("preserves another client's metadata when rebasing a title edit", () => {
    const latest = {
      ...card,
      completed: true,
      archived: true,
      effort: "XL" as const,
      type: "bug" as const,
      lane: "backlog" as const,
    };
    expect(mergeRoadmapEdit(card, { ...card, title: "My edited title" }, latest)).toEqual({
      ...latest,
      title: "My edited title",
    });
    expect(
      mergeRoadmapEdit(card, { ...card, summary: "My brief" }, { ...card, title: "Their title" }),
    ).toEqual({ ...card, title: "Their title", summary: "My brief" });
  });
  it.each([
    [null, "upNext"],
    [{ archivedAt: null, pullRequests: [] }, "building"],
    [{ archivedAt: "archived", pullRequests: [] }, "upNext"],
    [
      {
        archivedAt: null,
        pullRequests: [{ source: "manual", snapshot: { state: "open", isDraft: true } }],
      },
      "reviewing",
    ],
    [
      {
        archivedAt: "archived",
        pullRequests: [{ source: "manual", snapshot: { state: "open", isDraft: true } }],
      },
      "parked",
    ],
    [
      {
        archivedAt: "archived",
        pullRequests: [{ source: "manual", snapshot: { state: "open", isDraft: false } }],
      },
      "ready",
    ],
    [
      {
        archivedAt: null,
        pullRequests: [{ source: "manual", snapshot: { state: "merged", isDraft: false } }],
      },
      "done",
    ],
    [
      {
        archivedAt: null,
        pullRequests: [
          { source: "stack-dismissed", snapshot: { state: "merged", isDraft: false } },
        ],
      },
      "building",
    ],
  ] as const)("derives workflow from linked work: %j", (thread, column) => {
    expect(roadmapColumn(card, thread)).toBe(column);
  });

  it("keeps open work visible when a previous PR merged and preserves explicit completion", () => {
    const thread = {
      archivedAt: null,
      pullRequests: [
        { source: "manual", snapshot: { state: "merged", isDraft: false } },
        { source: "manual", snapshot: { state: "open", isDraft: true } },
      ],
    };
    expect(roadmapColumn(card, thread)).toBe("reviewing");
    expect(roadmapColumn({ ...card, completed: true }, thread)).toBe("done");
  });

  it("ranks cards relative to another without losing other lanes or archived cards", () => {
    const cards = [card, { ...card, id: "two" }, { ...card, id: "archived", archived: true }];
    expect(moveRoadmapCard(cards, "two", "backlog", "one").map((c) => [c.id, c.lane])).toEqual([
      ["two", "backlog"],
      ["one", "upNext"],
      ["archived", "upNext"],
    ]);
    expect(moveRoadmapCard(cards, "missing", "backlog")).toEqual(cards);
  });
});
