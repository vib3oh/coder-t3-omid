import { describe, expect, it } from "vite-plus/test";
import {
  communicationStatus,
  groupCommunications,
  type CommunicationMessage,
} from "./communication.ts";

const names = new Map([
  ["builder", "Builder"],
  ["planner", "Planner"],
]);

function update(id: string, changes: Partial<CommunicationMessage> = {}): CommunicationMessage {
  return {
    id,
    assignmentId: "build-1",
    generation: 1,
    senderId: "builder",
    recipientId: "planner",
    kind: "update",
    summary: "Checks are running",
    text: "The targeted checks are running.",
    createdAt: 1,
    delivery: "submitted",
    replyTo: null,
    revision: "head-1",
    ...changes,
  };
}

describe("agent communication presentation", () => {
  it("keeps a stable row for related updates without duplicating correlated message ids", () => {
    const first = update("first");
    const groups = groupCommunications(
      [first, first, update("second", { summary: "Web checks passed; native checks are pending" })],
      names,
    );
    expect(groups).toMatchObject([
      {
        id: "first",
        summary: "Web checks passed; native checks are pending",
        messages: [{ id: "first" }, { id: "second" }],
      },
    ]);
    expect(communicationStatus(groups[0]!.latest)).toBe("Sent");
    expect(
      groupCommunications([first, { ...first, delivery: "acknowledged" }], names),
    ).toMatchObject([
      {
        id: "first",
        messages: [{ id: "first", delivery: "acknowledged" }],
        latest: { delivery: "acknowledged" },
      },
    ]);
    const series = [
      update("one", { groupId: "series" }),
      update("two", { groupId: "series" }),
      update("three", { groupId: "series" }),
    ];
    expect(groupCommunications(series.slice(0, 2), names)[0]!.id).toBe("group:series");
    expect(groupCommunications(series.slice(1), names)[0]!.id).toBe("group:series");
    const interrupted = groupCommunications(
      [series[0]!, { ...series[1]!, delivery: "failed" }, series[2]!],
      names,
    );
    expect(interrupted).toHaveLength(3);
    expect(new Set(interrupted.map((group) => group.id)).size).toBe(3);
  });

  it.each([
    { kind: "question", questionState: "open" },
    { kind: "result" },
    { delivery: "failed" },
    { revision: "head-2" },
    { generation: 2 },
    { replyTo: "another-question" },
    { recipientId: "reviewer" },
    { groupId: "a-different-semantic-group" },
  ] satisfies ReadonlyArray<Partial<CommunicationMessage>>)(
    "preserves a separate row across semantic boundary %j",
    (changes) => {
      const groups = groupCommunications([update("first"), update("second", changes)], names);
      expect(groups).toHaveLength(2);
      expect(groups[0]!.latest.id).toBe("first");
      expect(groups[1]!.latest.id).toBe("second");
    },
  );

  it("uses a factual fallback and keeps transport receipt separate from work completion", () => {
    const question = update("question", {
      kind: "question",
      questionState: "open",
      summary: " ",
      delivery: "acknowledged",
    });
    expect(groupCommunications([question], names)[0]).toMatchObject({
      summary: "Builder asked Planner a question",
      needsAttention: true,
    });
    expect(communicationStatus(question)).toBe("Awaiting answer");
    expect(communicationStatus({ ...question, questionState: "answered" })).toBe("Answered");
    expect(communicationStatus({ ...question, delivery: "failed" })).toBe("Delivery failed");
  });
});
