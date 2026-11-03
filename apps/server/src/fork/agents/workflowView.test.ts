import { describe, expect, it } from "@effect/vitest";
import { workflowMessagePage } from "./workflowView.ts";

describe("workflowMessagePage", () => {
  it("starts at recent exchanges, keeps chronological order and searches hidden content", () => {
    const messages = [
      { id: "a", summary: "Waiting", text: "native device is locked", questionState: "pending" },
      { id: "b", summary: "Building", text: "Build started", questionState: null },
      { id: "c", summary: "Built", text: "Build passed", questionState: null },
    ];
    expect(workflowMessagePage(messages, 0, 2)).toEqual({
      items: messages.slice(1),
      nextOffset: 2,
    });
    expect(workflowMessagePage(messages, 2, 2)).toEqual({
      items: messages.slice(0, 1),
      nextOffset: null,
    });
    expect(workflowMessagePage(messages, 0, 2, "device")).toEqual({
      items: messages.slice(0, 1),
      nextOffset: null,
    });
    expect(workflowMessagePage(messages, 10, 2)).toEqual({ items: [], nextOffset: null });
  });
});
