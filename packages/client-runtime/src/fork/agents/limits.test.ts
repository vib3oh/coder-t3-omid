import { describe, expect, it } from "vite-plus/test";
import { DEFAULT_AGENT_WORKFLOW_LIMITS } from "@t3tools/contracts";
import { parseWorkflowLimits, workflowLimitDraft } from "./limits.ts";

describe("workflow limit editing", () => {
  it("preserves millisecond precision and rejects incomplete or invalid user input", () => {
    const limits = {
      ...DEFAULT_AGENT_WORKFLOW_LIMITS,
      maxReviewRounds: 0,
      questionTimeoutMs: 1_001,
    };
    const draft = workflowLimitDraft(limits);
    expect(parseWorkflowLimits(draft)).toEqual(limits);
    expect(
      parseWorkflowLimits({ ...draft, questionTimeoutSeconds: "1.5" })?.questionTimeoutMs,
    ).toBe(1_500);
    for (const invalid of [
      { maxReviewRounds: " " },
      { maxAttempts: "1.5" },
      { maxConcurrent: "9" },
      { questionTimeoutSeconds: "not a number" },
      { questionTimeoutSeconds: "0.9999" },
      { questionTimeoutSeconds: "604800.0001" },
      { maxMessages: "Infinity" },
    ])
      expect(parseWorkflowLimits({ ...draft, ...invalid })).toBeNull();
  });
});
