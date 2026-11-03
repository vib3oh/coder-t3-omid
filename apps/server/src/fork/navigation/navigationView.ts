import {
  type AgentWorkflow,
  type NavigationThread,
  type NavigationWorktree,
  type OrchestrationV2ThreadShell,
  type ProjectId,
  type RoadmapBoard,
} from "@t3tools/contracts";
import { workflowCurrentThreadIds, workflowHumanInputThreadIds } from "../agents/WorkflowRules.ts";
import { roadmapColumn } from "@t3tools/shared/roadmapLifecycle";
import * as DateTime from "effect/DateTime";

const iso = (value: DateTime.Utc | null | undefined) => (value ? DateTime.formatIso(value) : null);
type MutableWorktree = { -readonly [K in keyof NavigationWorktree]: NavigationWorktree[K] };

const active = new Set(["queued", "preparing", "starting", "running", "working", "waiting"]);

function navigationThread(thread: OrchestrationV2ThreadShell): NavigationThread {
  return {
    id: thread.id,
    title: thread.title.slice(0, 200),
    providerInstanceId: thread.providerInstanceId,
    worktreePath: thread.worktreePath,
    branch: thread.branch,
    status: thread.status,
    hasPendingApprovals:
      thread.pendingRuntimeRequest !== null &&
      thread.pendingRuntimeRequest.kind !== "user_input" &&
      thread.pendingRuntimeRequest.kind !== "auth_refresh" &&
      thread.pendingRuntimeRequest.kind !== "dynamic_tool_call",
    hasPendingUserInput:
      thread.pendingRuntimeRequest?.kind === "user_input" || thread.hasActionableProposedPlan,
    archivedAt: iso(thread.archivedAt),
    settledAt: iso(thread.settledAt),
    snoozedUntil: iso(thread.snoozedUntil),
    pinnedAt: iso(thread.pinnedAt),
    updatedAt: DateTime.formatIso(thread.updatedAt),
    ...(thread.lastVisitedAt === undefined ? {} : { lastVisitedAt: iso(thread.lastVisitedAt) }),
    latestRunCompletedAt: iso(thread.latestRunCompletedAt),
    latestUserMessageAt: iso(thread.latestUserMessageAt),
    hasActionableProposedPlan: thread.hasActionableProposedPlan,
    pendingGuestMessageCount: thread.pendingGuestMessageCount ?? 0,
  };
}

export function navigationWorktrees(input: {
  readonly projectId: ProjectId;
  readonly workspaceRoot: string;
  readonly threads: ReadonlyArray<OrchestrationV2ThreadShell>;
  readonly board: RoadmapBoard | null;
  readonly workflows: ReadonlyArray<AgentWorkflow>;
  readonly paths: ReadonlyMap<
    string,
    { readonly canonical: string; readonly exists: boolean | null }
  >;
  readonly inventoriedPaths: ReadonlyArray<string>;
  readonly now: number;
}): NavigationWorktree[] {
  const canonical = (path: string) => input.paths.get(path)?.canonical ?? path;
  const mainPath = canonical(input.workspaceRoot);
  const rows = new Map<string, MutableWorktree>();
  const shells = new Map(
    input.threads
      .filter((t) => t.projectId === input.projectId && t.deletedAt === null)
      .map((t) => [t.id, t]),
  );
  const preparing = new Set(
    input.workflows
      .filter((w) => w.workspaceStrategy.type === "worktree" && w.workspacePath === null)
      .map((w) => w.managerThreadId),
  );
  const row = (path: string | null, preparingId?: string) => {
    const normalized = path === null ? null : canonical(path);
    const key =
      normalized === null
        ? `preparing:${preparingId}`
        : normalized === mainPath
          ? "main"
          : `worktree:${normalized}`;
    let current = rows.get(key);
    if (current) return current;
    current = {
      key,
      path: normalized,
      label:
        normalized === null
          ? "Preparing worktree"
          : normalized === mainPath
            ? "Main checkout"
            : (normalized.split(/[\\/]/).filter(Boolean).at(-1) ?? normalized),
      branch: null,
      isMain: key === "main",
      availability:
        normalized === null
          ? "preparing"
          : input.paths.get(path!)?.exists === false
            ? "missing"
            : input.paths.get(path!)?.exists === true
              ? "available"
              : "unknown",
      stage: "building",
      completion: null,
      cards: [],
      workflows: [],
      threads: [],
      attentionCount: 0,
      threadCount: 0,
      threadNextOffset: null,
    };
    rows.set(key, current);
    return current;
  };
  row(input.workspaceRoot);
  for (const path of input.inventoriedPaths) row(path);
  const threadRows = new Map<string, MutableWorktree>();
  for (const thread of shells.values()) {
    const target = row(
      thread.worktreePath ?? (preparing.has(thread.id) ? null : input.workspaceRoot),
      thread.id,
    );
    target.threads = [...target.threads, navigationThread(thread)];
    if (!target.branch && thread.branch) target.branch = thread.branch;
    threadRows.set(thread.id, target);
  }
  for (const card of input.board?.cards ?? []) {
    if (card.archived || !card.threadId) continue;
    const target = threadRows.get(card.threadId);
    const thread = shells.get(card.threadId);
    if (!target || !thread) continue;
    const stage = roadmapColumn(card, {
      archivedAt: iso(thread.archivedAt),
      pullRequests: thread.pullRequests ?? [],
    });
    target.cards = [...target.cards, { id: card.id, title: card.title, stage }];
  }
  for (const workflow of input.workflows) {
    const currentIds = new Set(workflowCurrentThreadIds(workflow));
    const humanIds = workflowHumanInputThreadIds(workflow, [...shells.values()]);
    const targets = new Set([...currentIds].flatMap((id) => threadRows.get(id) ?? []));
    if (targets.size === 0 && workflow.workspacePath) targets.add(row(workflow.workspacePath));
    for (const target of targets) {
      const card = input.board?.cards.find(
        (candidate) => candidate.id === workflow.cardId && !candidate.archived,
      );
      if (card && !target.cards.some((candidate) => candidate.id === card.id)) {
        const owner = card.threadId ? shells.get(card.threadId) : undefined;
        target.cards = [
          ...target.cards,
          {
            id: card.id,
            title: card.title,
            stage: roadmapColumn(
              card,
              owner
                ? { archivedAt: iso(owner.archivedAt), pullRequests: owner.pullRequests ?? [] }
                : null,
            ),
          },
        ];
      }
      target.workflows = [
        ...target.workflows,
        {
          id: workflow.id,
          title: workflow.title.slice(0, 200),
          status: workflow.status,
          currentStage:
            workflow.assignments.find(
              (assignment) =>
                assignment.generation === workflow.generation &&
                ["dispatching", "awaiting_result", "validating"].includes(assignment.state),
            )?.role.role.name ?? null,
          managerThreadId: workflow.managerThreadId,
          humanInputThreadIds: humanIds.filter((id) => threadRows.get(id) === target),
        },
      ];
    }
  }
  return [...rows.values()]
    .map((target) => {
      const native = [...shells.values()].filter((thread) => threadRows.get(thread.id) === target);
      const snapshots = native.flatMap((t) =>
        (t.pullRequests ?? [])
          .filter((pr) => pr.source !== "stack-dismissed")
          .flatMap((pr) => pr.snapshot ?? []),
      );
      const open = snapshots.filter((pr) => pr.state === "open");
      const cardStages = target.cards.map((card) => card.stage);
      const represented = new Set<string>(
        (input.board?.cards ?? []).filter((c) => !c.archived && c.threadId).map((c) => c.threadId!),
      );
      for (const workflow of input.workflows)
        if (workflow.cardId && target.cards.some((card) => card.id === workflow.cardId)) {
          for (const id of workflowCurrentThreadIds(workflow)) represented.add(id);
        }
      const building =
        cardStages.includes("building") ||
        native.some(
          (t) =>
            active.has(t.status) ||
            (!represented.has(t.id) &&
              t.archivedAt === null &&
              t.settledOverride !== "settled" &&
              !(t.pullRequests ?? []).some(
                (pr) => pr.source !== "stack-dismissed" && pr.snapshot?.state === "merged",
              )),
        );
      const merged = snapshots.some((pr) => pr.state === "merged");
      const done =
        merged || (cardStages.length > 0 && cardStages.every((stage) => stage === "done"));
      const parked =
        target.cards.some((c) => c.stage === "parked") ||
        (native.length > 0 &&
          native.every((t) => t.archivedAt !== null || t.settledOverride === "settled"));
      const draftActive = native.some(
        (thread) =>
          thread.archivedAt === null &&
          (thread.pullRequests ?? []).some(
            (pr) =>
              pr.source !== "stack-dismissed" &&
              pr.snapshot?.state === "open" &&
              pr.snapshot.isDraft,
          ),
      );
      const stage: NavigationWorktree["stage"] =
        open.some((pr) => !pr.isDraft) || cardStages.includes("ready")
          ? "ready"
          : draftActive || cardStages.includes("reviewing")
            ? "reviewing"
            : building
              ? "building"
              : open.length > 0 || cardStages.includes("parked")
                ? "parked"
                : done
                  ? "done"
                  : parked
                    ? "parked"
                    : "building";
      const attention = new Set(
        target.threads
          .filter(
            (thread) =>
              thread.archivedAt === null &&
              (thread.hasPendingApprovals ||
                thread.hasPendingUserInput ||
                thread.pendingGuestMessageCount > 0),
          )
          .map((thread) => thread.id),
      );
      for (const workflow of target.workflows)
        for (const id of workflow.humanInputThreadIds.length > 0
          ? workflow.humanInputThreadIds
          : workflow.status === "waiting_user"
            ? [workflow.managerThreadId]
            : []) {
          const thread = target.threads.find((t) => t.id === id);
          if (
            thread &&
            thread.archivedAt === null &&
            (workflow.humanInputThreadIds.includes(id) ||
              !thread.snoozedUntil ||
              Date.parse(thread.snoozedUntil) <= input.now)
          )
            attention.add(id);
        }
      const threads = [...target.threads].sort(
        (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
      );
      return {
        ...target,
        stage,
        completion: stage === "done" ? (merged ? "merged" : "completed") : null,
        label:
          !target.isMain && target.cards.length === 1
            ? target.cards[0]!.title
            : target.isMain
              ? target.label
              : (target.branch ?? target.label),
        threads,
        threadCount: threads.length,
        attentionCount: attention.size,
      } satisfies NavigationWorktree;
    })
    .sort(
      (a, b) =>
        Number(b.isMain) - Number(a.isMain) ||
        a.label.localeCompare(b.label) ||
        a.key.localeCompare(b.key),
    );
}
