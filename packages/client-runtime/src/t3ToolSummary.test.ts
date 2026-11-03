import { describe, expect, it } from "vite-plus/test";

import {
  summarizeT3ToolCalls,
  teamMessageToolIsRepresented,
  type T3ToolSummaryCall,
} from "./t3ToolSummary.ts";

function completed(input: unknown, output?: unknown): T3ToolSummaryCall {
  return { input, output, outcome: "completed" };
}

describe("summarizeT3ToolCalls", () => {
  it("reads provider result envelopes without treating JSON in the message as result data", () => {
    const result = { messageId: "message-1", threadId: "actual-thread" };
    const json = JSON.stringify(result);
    const outputs = [
      result,
      { structuredContent: result },
      [{ type: "text", text: json }],
      { content: [{ text: { text: json } }], isError: false },
      json,
    ];
    const calls = outputs.map((output) =>
      completed(
        {
          toolName: "t3_thread_send",
          args: { threadId: "input-thread", message: '{"threadId":"fake"}' },
        },
        output,
      ),
    );
    expect(summarizeT3ToolCalls("thread-send", calls).label).toBe("Sent 1 message to 1 thread");
    expect(
      summarizeT3ToolCalls("thread-send", [
        completed({ toolName: "t3_thread_send", args: { threadId: "input-thread" } }),
        completed({ threadId: "input-thread" }),
      ]).label,
    ).toBe("Sent 2 messages to 1 thread");
  });

  it("counts the pull requests batch link and unlink calls changed", () => {
    const urls = ["https://github.com/o/r/pull/1", "https://github.com/o/r/pull/1", "not-a-pr"];
    const links = completed({ urls }, { linkedCount: 1 });
    expect(summarizeT3ToolCalls("link-pr", [links, completed({ number: 3 })]).label).toBe(
      "Linked 2 pull requests",
    );
    expect(summarizeT3ToolCalls("link-pr", [completed({ urls }, {})]).label).toBe(
      "Linked pull requests",
    );
    const batch = completed({ states: ["merged"] }, { unlinkedCount: 2 });
    expect(summarizeT3ToolCalls("unlink-pr", [batch, completed({ number: 3 })]).label).toBe(
      "Unlinked 3 pull requests",
    );
    const uncounted = completed({ states: ["merged"] }, { isError: false });
    expect(summarizeT3ToolCalls("unlink-pr", [uncounted]).label).toBe("Unlinked pull requests");
  });

  it("excludes failed and unfinished sends even if the provider reports completed", () => {
    const calls: T3ToolSummaryCall[] = [
      completed({ threadId: "success" }, { messageId: "ok", threadId: "success" }),
      completed(
        { threadId: "failed" },
        { isError: true, structuredContent: { threadId: "failed" } },
      ),
      completed({ threadId: "failed" }, [
        { type: "text", text: JSON.stringify({ _tag: "OrchestratorMcpFailure" }) },
      ]),
      { input: { threadId: "cancelled" }, output: undefined, outcome: "unfinished" },
    ];
    expect(summarizeT3ToolCalls("thread-send", calls)).toEqual({
      label: "Sent 1 message to 1 thread",
      failedCount: 2,
    });
    expect(summarizeT3ToolCalls("thread-send", [calls[1]!])).toEqual({
      label: "Tried to send 1 message to 1 thread",
      failedCount: 1,
    });
  });

  it("does not confuse a child's failure or wait timeout with failure of the orchestration call", () => {
    const failedChild = { taskId: "task-1", status: "failed", summary: "command not found" };
    expect(
      summarizeT3ToolCalls("delegate", [completed({}, failedChild), completed({}, failedChild)]),
    ).toEqual({
      label: "Delegated 1 task",
      failedCount: 0,
    });
    expect(
      summarizeT3ToolCalls(
        "task-status",
        Array.from({ length: 4 }, () => completed({ taskId: "task-1" }, failedChild)),
      ).label,
    ).toBe("Checked task status 4 times");
    expect(
      summarizeT3ToolCalls("thread-wait", [
        completed({ threadId: "thread-1" }, { threadId: "thread-1", timedOut: true }),
      ]),
    ).toEqual({
      label: "Waited on 1 thread",
      failedCount: 0,
    });
  });

  it("keeps role summaries and delivery facts without mistaking submission for acceptance", () => {
    const communication = {
      id: "message",
      nativeMessageId: "native-message",
      senderName: "Builder",
      recipientName: "Planner",
      summary: "Web checks passed; native checks are pending",
      kind: "update",
      delivery: "queued",
    };
    const output = { content: [{ type: "text", text: JSON.stringify({ communication }) }] };
    expect(
      summarizeT3ToolCalls("team-message", [completed({ summary: "Different input" }, output)]),
    ).toEqual({
      label:
        "Builder → Planner: Web checks passed; native checks are pending · Queued for next turn",
      failedCount: 0,
    });
    expect(
      summarizeT3ToolCalls("team-message", [
        completed({}, { communication: { ...communication, delivery: "failed" } }),
      ]),
    ).toMatchObject({
      label: "Builder → Planner: Web checks passed; native checks are pending · Delivery failed",
      failedCount: 1,
    });
    expect(
      summarizeT3ToolCalls("assignment-result", [
        completed({ artifact: { summary: "Implementation ready for review" } }, {}),
      ]).label,
    ).toBe("Submitted assignment evidence: Implementation ready for review");
    expect(
      summarizeT3ToolCalls("assignment-start", [
        completed({ objective: "Fix the failing check\nwithout changing scope" }, {}),
      ]).label,
    ).toBe("Started 1 role assignment: Fix the failing check without changing scope");
    const item = {
      type: "dynamic_tool",
      status: "completed",
      toolName: "t3-code.omid_team_message",
      output,
    };
    expect(teamMessageToolIsRepresented(item, new Set(["native-message"]))).toBe(true);
    expect(teamMessageToolIsRepresented(item, new Set(["different-message"]))).toBe(false);
    for (const changed of [
      { status: "running" },
      { status: "failed" },
      { toolName: "other.omid_team_message" },
      { output: { isError: true, structuredContent: { communication } } },
      { output: { communication: { ...communication, delivery: "failed" } } },
    ])
      expect(
        teamMessageToolIsRepresented({ ...item, ...changed }, new Set(["native-message"])),
      ).toBe(false);
  });
});
