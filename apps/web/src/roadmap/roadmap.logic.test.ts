import { describe, expect, it } from "vite-plus/test";
import {
  roadmapColumn,
  moveRoadmapCard,
  mergeRoadmapEdit,
  roadmapDropAction,
  roadmapSpecTarget,
  roadmapReadOnlyReason,
  roadmapSyncDiagnostics,
  roadmapOrderGuard,
} from "./roadmap.logic";
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
  it("uses only context diagnostics fields and rejects credential-bearing input", () => {
    const context = {
      source: "/project/context.json",
      backend: "http://127.0.0.1:3470",
      projectId: "remote",
      instanceId: "instance",
    };
    expect(roadmapSyncDiagnostics(JSON.stringify({ ...context, extra: "not forwarded" }))).toEqual({
      type: "valid",
      binding: {
        contextPath: context.source,
        backend: context.backend,
        projectId: context.projectId,
        instanceId: context.instanceId,
      },
    });
    expect(
      roadmapSyncDiagnostics(JSON.stringify({ ...context, nested: { authToken: "test-value" } })),
    ).toEqual({ type: "credentials" });
    expect(roadmapSyncDiagnostics(JSON.stringify({ ...context, source: "" }))).toEqual({
      type: "invalid",
    });
    expect(roadmapSyncDiagnostics("invalid")).toEqual({ type: "invalid" });
  });
  it("turns execution-lane drops into real work and keeps open PR work out of planning", () => {
    expect(roadmapDropAction(card, "building", null)).toEqual({ type: "work", mode: "build" });
    expect(roadmapDropAction(card, "reviewing", null).type).toBe("blocked");
    const thread = {
      archivedAt: null,
      pullRequests: [{ source: "manual", snapshot: { state: "open", isDraft: true } }],
    };
    expect(roadmapDropAction(card, "reviewing", thread)).toEqual({ type: "work", mode: "review" });
    expect(roadmapDropAction(card, "backlog", thread).type).toBe("blocked");
    expect(roadmapDropAction(card, "done", thread).type).toBe("blocked");
    expect(roadmapDropAction(card, "parked", thread)).toEqual({ type: "park" });
    expect(
      roadmapDropAction(card, "parked", {
        ...thread,
        pullRequests: [
          ...thread.pullRequests,
          { source: "manual", snapshot: { state: "open", isDraft: false } },
        ],
      }).type,
    ).toBe("blocked");
    expect(roadmapDropAction(card, "upNext", { archivedAt: null, pullRequests: [] })).toEqual({
      type: "plan",
      lane: "upNext",
      archiveThread: true,
    });
    expect(
      roadmapDropAction({ ...card, completed: true }, "backlog", {
        archivedAt: null,
        pullRequests: [],
      }),
    ).toEqual({ type: "plan", lane: "backlog", archiveThread: true });
    expect(roadmapDropAction(card, "done", null)).toEqual({ type: "complete" });
    expect(
      roadmapDropAction(card, "building", {
        archivedAt: null,
        pullRequests: [{ source: "manual", snapshot: { state: "merged", isDraft: false } }],
      }).type,
    ).toBe("blocked");
  });

  it("merges independent acceptance edits and additions after a conflict", () => {
    const original = {
      ...card,
      specPath: "old.md",
      acceptanceCriteria: [{ id: "a", text: "Works", checked: false }],
    };
    const draft = { ...original, acceptanceCriteria: [{ id: "a", text: "Works", checked: true }] };
    const latest = {
      ...original,
      specPath: "new.md",
      acceptanceCriteria: [
        { id: "a", text: "Works on mobile", checked: false },
        { id: "b", text: "Persists", checked: false },
      ],
    };
    expect(mergeRoadmapEdit(original, draft, latest)).toMatchObject({
      specPath: "new.md",
      acceptanceCriteria: [
        { id: "a", text: "Works on mobile", checked: true },
        { id: "b", text: "Persists", checked: false },
      ],
    });
  });

  it("accepts web or project-relative spec links and rejects unsafe destinations", () => {
    expect(roadmapSpecTarget("docs/roadmap/card.md")).toEqual({
      kind: "file",
      path: "docs/roadmap/card.md",
    });
    expect(roadmapSpecTarget("https://example.com/spec")).toEqual({
      kind: "url",
      url: "https://example.com/spec",
    });
    for (const path of [
      "javascript:alert(1)",
      "../secret",
      "//other-host/path",
      "/etc/passwd",
      "data:text/html,hello",
    ]) {
      expect(roadmapSpecTarget(path).kind).toBe("invalid");
    }
  });
  it("preserves another client's metadata when rebasing a title edit", () => {
    const latest = {
      ...card,
      completed: true,
      archived: true,
      effort: "XL" as const,
      type: "bug" as const,
      lane: "backlog" as const,
      sync: {
        source: "hypercoder" as const,
        externalId: "remote-card",
        status: "pending" as const,
        readOnly: false,
        reason: null,
        remoteColumn: null,
      },
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

  it("blocks sync-owned work and rank changes without treating remote execution as native work", () => {
    const locked: RoadmapCard = {
      ...card,
      sync: {
        source: "hypercoder",
        externalId: "external",
        status: "conflict",
        readOnly: false,
        reason: "Both titles changed",
        remoteColumn: "building",
      },
    };
    expect(roadmapReadOnlyReason(locked)).toBe("Both titles changed");
    expect(roadmapDropAction(locked, "building")).toEqual({
      type: "blocked",
      message: "Both titles changed",
    });
    expect(roadmapColumn(locked)).toBe("upNext");
    const cards = [{ ...card, id: "before" }, locked, { ...card, id: "after" }];
    expect(moveRoadmapCard(cards, "one", "backlog")).toBe(cards);
    expect(moveRoadmapCard(cards, "after", "backlog", "before")).toBe(cards);
    expect(moveRoadmapCard(cards, "before", "backlog")).toBe(cards);
    const unlocked = [...cards, { ...card, id: "last" }];
    expect(roadmapOrderGuard(unlocked)("last", "after")).toBe(true);
    expect(moveRoadmapCard(unlocked, "last", "backlog", "after").map((row) => row.id)).toEqual([
      "before",
      "one",
      "last",
      "after",
    ]);
    expect(roadmapReadOnlyReason({ ...locked, sync: undefined })).toBeNull();
  });
});
