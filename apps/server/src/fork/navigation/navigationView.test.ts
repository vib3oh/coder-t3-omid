import { describe, expect, it } from "vite-plus/test";
import {
  DEFAULT_AGENT_WORKFLOW_LIMITS,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type AgentWorkflow,
  type OrchestrationV2ThreadShell,
  type RoadmapCard,
  type ThreadPullRequestLink,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { v2PullRequestThread } from "../../orchestration-v2/testkit/pullRequestFixtures.ts";
import { navigationWorktrees } from "./navigationView.ts";

const projectId = ProjectId.make("project");
const at = "2026-11-03T10:00:00.000Z";
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "test" };
const thread = (id: string, worktreePath: string | null = "/feature") =>
  v2PullRequestThread({
    id: ThreadId.make(id),
    projectId,
    title: id,
    modelSelection,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: "feature",
    worktreePath,
    pullRequests: [],
    latestUserMessageAt: null,
    createdAt: at,
    updatedAt: at,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
  });
const card = (id: string, threadId: string, completed = false): RoadmapCard => ({
  id,
  title: id,
  summary: "",
  type: "feature",
  effort: "S",
  lane: "upNext",
  threadId: ThreadId.make(threadId),
  completed,
  archived: false,
});
const workflow = (changes: Partial<AgentWorkflow> = {}): AgentWorkflow => ({
  id: "team",
  projectId,
  title: "Team",
  objective: "Goal",
  managerThreadId: ThreadId.make("manager"),
  managerBrief: "",
  managerRole: null,
  roleIds: { planner: "planner", builder: "builder", reviewer: "reviewer" },
  specSnapshot: null,
  sourceThreadId: ThreadId.make("source"),
  cardId: "card",
  cardRevision: 1,
  generation: 0,
  revision: 1,
  status: "running",
  limits: DEFAULT_AGENT_WORKFLOW_LIMITS,
  modelSelection,
  runtimeMode: "full-access",
  interactionMode: "default",
  workspaceStrategy: { type: "worktree", baseRef: "main" },
  workspacePath: "/feature",
  baseRef: "main",
  criteria: [],
  createdAt: 0,
  requiredChecks: [],
  updatedAt: 0,
  assignments: [],
  participants: [],
  messages: [],
  artifacts: [],
  intents: [],
  ...changes,
});
const view = (
  threads: ReadonlyArray<OrchestrationV2ThreadShell>,
  cards: RoadmapCard[] = [],
  workflows: AgentWorkflow[] = [],
) =>
  navigationWorktrees({
    projectId,
    workspaceRoot: "/main",
    threads,
    board: { version: 1, revision: 1, cards },
    workflows,
    paths: new Map([
      ["/main", { canonical: "/main", exists: true }],
      ["/feature", { canonical: "/feature", exists: true }],
    ]),
    inventoriedPaths: [],
    now: Date.parse(at),
  });

describe("project navigation relationships", () => {
  it("keeps physical project ownership, older archived work, and explicit completion evidence", () => {
    const owner = thread("owner");
    const foreign = { ...thread("foreign"), projectId: ProjectId.make("other") };
    const archived = { ...thread("archived"), archivedAt: DateTime.makeUnsafe(at) };
    const rows = view(
      [owner, foreign, archived],
      [card("done", "owner", true), card("old", "archived")],
    );
    expect(rows[0]?.key).toBe("main");
    const feature = rows[1]!;
    expect(feature.threads.map((t) => t.id)).toEqual(["archived", "owner"]);
    expect(feature.cards).toEqual([
      { id: "done", title: "done", stage: "done" },
      { id: "old", title: "old", stage: "upNext" },
    ]);
    expect(feature.completion).toBeNull();
    const completed = view([owner], [card("done", "owner", true)])[1]!;
    expect(completed).toMatchObject({ stage: "done", completion: "completed" });
    expect(view([{ ...owner, status: "running" }], [card("done", "owner", true)])[1]?.stage).toBe(
      "building",
    );
  });

  it("does not let a sibling's historical merge hide unrelated unfinished native work", () => {
    const merged = thread("merged");
    const pr: ThreadPullRequestLink = {
      host: "github.com",
      repository: "example/app",
      number: 1,
      url: "https://github.com/example/app/pull/1",
      source: "manual",
      linkedAt: at,
      stack: null,
      snapshot: {
        state: "merged",
        title: "Old change",
        headBranch: "old",
        baseBranch: "main",
        isDraft: false,
        updatedAt: at,
        syncedAt: at,
      },
    };
    expect(view([{ ...merged, pullRequests: [pr] }])[1]?.stage).toBe("done");
    expect(view([thread("new"), { ...merged, pullRequests: [pr] }])[1]?.stage).toBe("building");
    const ready: ThreadPullRequestLink = {
      ...pr,
      number: 2,
      snapshot: { ...pr.snapshot!, state: "open", isDraft: false },
    };
    expect(view([{ ...merged, pullRequests: [pr, ready] }])[1]?.stage).toBe("ready");
    expect(
      view([{ ...merged, pullRequests: [{ ...pr, source: "stack-dismissed" }] }])[1]?.stage,
    ).toBe("building");
  });

  it("uses workflow card identity without moving the source, and distinguishes preparing checkout", () => {
    const rows = view(
      [thread("source", null), thread("manager")],
      [card("card", "missing")],
      [workflow()],
    );
    expect(rows[0]?.threads.map((t) => t.id)).toEqual(["source"]);
    expect(rows[1]?.workflows[0]?.managerThreadId).toBe("manager");
    expect(rows[1]?.cards[0]).toEqual({ id: "card", title: "card", stage: "upNext" });
    const preparing = view([thread("manager", null)], [], [workflow({ workspacePath: null })]);
    expect(preparing.find((row) => row.key === "preparing:manager")).toMatchObject({
      availability: "preparing",
      path: null,
    });
  });

  it("keeps peer waiting separate from human attention, including paused and snoozed work", () => {
    expect(view([thread("manager")], [], [workflow()])[1]?.attentionCount).toBe(0);
    expect(
      view([thread("manager")], [], [workflow({ status: "waiting_user" })])[1]?.attentionCount,
    ).toBe(1);
    const sleeping = {
      ...thread("manager"),
      snoozedUntil: DateTime.makeUnsafe("2026-11-04T10:00:00Z"),
    };
    expect(view([sleeping], [], [workflow({ status: "waiting_user" })])[1]?.attentionCount).toBe(0);
    const actionable = { ...thread("manager"), hasActionableProposedPlan: true };
    expect(view([actionable], [], [workflow({ status: "paused" })])[1]?.attentionCount).toBe(1);
    expect(view([actionable])[1]?.threads[0]?.hasActionableProposedPlan).toBe(true);
  });
});
