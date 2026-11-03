import { describe, expect, it } from "@effect/vitest";
import { ThreadId, type AgentTeamMessage } from "@t3tools/contracts";
import { blockingQuestionCycle, defaultAgentRoles } from "./WorkflowRules.ts";

describe("agent workflow rules", () => {
  it("rejects a circular blocking question without treating progress as a wait", () => {
    const a = ThreadId.make("a");
    const b = ThreadId.make("b");
    const c = ThreadId.make("c");
    const question = (from: typeof a, to: typeof a) =>
      ({
        origin: "agent",
        senderThreadId: from,
        recipientThreadId: to,
        kind: "question",
        blocking: true,
        questionState: "pending",
      }) as AgentTeamMessage;
    const pending = [question(a, b), question(b, c)];
    expect(blockingQuestionCycle(pending, c, a)).toBe(true);
    expect(blockingQuestionCycle([{ ...pending[0]!, kind: "update" }], b, a)).toBe(false);
    expect(blockingQuestionCycle([{ ...pending[0]!, questionState: "answered" }], b, a)).toBe(
      false,
    );
  });
  it("gives a reviewer inspection instructions without writer responsibility", () => {
    const reviewer = defaultAgentRoles().find((role) => role.kind === "reviewer");
    expect(reviewer?.instructions).toContain("Do not edit");
    expect(reviewer?.outputKind).toBe("review");
  });
});
