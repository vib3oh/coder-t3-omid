import type { RoadmapCard } from "@t3tools/contracts";

export const ROADMAP_COLUMNS = [
  ["backlog", "Backlog", "Ideas worth keeping"],
  ["upNext", "Up Next", "Prioritized and ready to start"],
  ["building", "Building", "Linked threads in progress"],
  ["inReview", "In Review", "Your review and agent review"],
  ["parked", "Parked", "Draft PRs in archived threads"],
  ["done", "Done", "Merged or marked complete"],
] as const;

interface RoadmapThread {
  readonly archivedAt: string | null;
  readonly pullRequests: ReadonlyArray<{
    readonly source: string;
    readonly snapshot: { readonly state: string; readonly isDraft: boolean } | null;
  }>;
}

export type RoadmapColumn = ReturnType<typeof roadmapColumn>;

function pullRequests(thread: RoadmapThread | null | undefined) {
  return (
    thread?.pullRequests
      .filter((pr) => pr.source !== "stack-dismissed")
      .flatMap((pr) => (pr.snapshot ? [pr.snapshot] : [])) ?? []
  );
}

export function roadmapColumn(card: RoadmapCard, thread?: RoadmapThread | null) {
  if (card.completed) return "done";
  if (!thread) return card.lane;
  const snapshots = pullRequests(thread);
  const open = snapshots.filter((pr) => pr.state === "open");
  if (open.some((pr) => !pr.isDraft)) return "ready";
  if (open.length > 0) return thread.archivedAt ? "parked" : "reviewing";
  if (snapshots.some((pr) => pr.state === "merged")) return "done";
  return thread.archivedAt ? card.lane : "building";
}

export function roadmapDropAction(
  card: RoadmapCard,
  target: RoadmapColumn,
  thread?: RoadmapThread | null,
) {
  const snapshots = pullRequests(thread);
  const open = snapshots.filter((pr) => pr.state === "open");
  if (
    (target === "building" || target === "reviewing" || target === "ready") &&
    open.length === 0 &&
    snapshots.some((pr) => pr.state === "merged")
  )
    return {
      type: "blocked",
      message: "This work is already merged. Create a new card for follow-up work.",
    } as const;
  if (target === "building") return { type: "work", mode: "build" } as const;
  if (target === "reviewing" || target === "ready")
    return thread
      ? ({ type: "work", mode: "review" } as const)
      : ({
          type: "blocked",
          message: "Start building or link an existing thread before requesting review.",
        } as const);
  if (target === "parked")
    return open.length > 0 && open.every((pr) => pr.isDraft) && thread
      ? ({ type: "park" } as const)
      : ({
          type: "blocked",
          message: "Only work with a draft pull request can be parked.",
        } as const);
  if (target === "done")
    return open.length > 0
      ? ({
          type: "blocked",
          message: "Merge the linked pull request before completing this card.",
        } as const)
      : ({ type: "complete" } as const);
  if (open.length > 0 || snapshots.some((pr) => pr.state === "merged")) {
    return {
      type: "blocked",
      message:
        "This card follows its pull request. Resolve or unlink that work before returning it to planning.",
    } as const;
  }
  return {
    type: "plan",
    lane: target,
    archiveThread: Boolean(thread && !thread.archivedAt && !card.completed),
  } as const;
}

export function roadmapWorkPrompt(card: RoadmapCard, mode: "build" | "review") {
  return [
    mode === "build"
      ? "Implement this roadmap item in the current project."
      : "Review the existing work for this roadmap item. Fix actionable findings and run the relevant checks. Keep the pull request as a draft during agent review, then mark it ready for human review when the work is reviewed and passing. Do not merge it.",
    card.title,
    card.summary,
    card.specPath ? `Full spec: ${card.specPath}` : "",
    ...(card.acceptanceCriteria ?? []).map(
      (criterion) => `- [${criterion.checked ? "x" : " "}] ${criterion.text}`,
    ),
    `Roadmap card: ${card.id}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function roadmapSpecTarget(value: string) {
  const path = value.trim();
  if (/^https?:\/\//i.test(path)) {
    try {
      const url = new URL(path);
      return { kind: "url", url: url.href } as const;
    } catch {
      return { kind: "invalid" } as const;
    }
  }
  if (
    !path ||
    /^[a-z][a-z\d+.-]*:/i.test(path) ||
    /^[\\/]/.test(path) ||
    path.split(/[\\/]/).includes("..")
  )
    return { kind: "invalid" } as const;
  return { kind: "file", path } as const;
}

function mergeCriteria(original: RoadmapCard, draft: RoadmapCard, latest: RoadmapCard) {
  const before = new Map((original.acceptanceCriteria ?? []).map((row) => [row.id, row]));
  const current = new Map((latest.acceptanceCriteria ?? []).map((row) => [row.id, row]));
  return [
    ...(draft.acceptanceCriteria ?? []).flatMap((row) => {
      const old = before.get(row.id);
      const remote = current.get(row.id);
      if (!old) return [row];
      if (!remote) return row.text === old.text && row.checked === old.checked ? [] : [row];
      return [
        {
          ...row,
          text: row.text === old.text ? remote.text : row.text,
          checked: row.checked === old.checked ? remote.checked : row.checked,
        },
      ];
    }),
    ...(latest.acceptanceCriteria ?? []).filter(
      (row) =>
        !before.has(row.id) &&
        !(draft.acceptanceCriteria ?? []).some((local) => local.id === row.id),
    ),
  ];
}

export function moveRoadmapCard(
  cards: ReadonlyArray<RoadmapCard>,
  id: string,
  lane: RoadmapCard["lane"],
  beforeId?: string,
) {
  const card = cards.find((candidate) => candidate.id === id);
  if (!card || id === beforeId) return cards;
  const next = cards.filter((candidate) => candidate.id !== id);
  const before = beforeId ? next.findIndex((candidate) => candidate.id === beforeId) : -1;
  next.splice(before < 0 ? next.length : before, 0, { ...card, lane });
  return next;
}

export function mergeRoadmapEdit(
  original: RoadmapCard,
  draft: RoadmapCard,
  latest: RoadmapCard,
): RoadmapCard {
  return {
    id: latest.id,
    title: draft.title === original.title ? latest.title : draft.title,
    summary: draft.summary === original.summary ? latest.summary : draft.summary,
    type: draft.type === original.type ? latest.type : draft.type,
    effort: draft.effort === original.effort ? latest.effort : draft.effort,
    lane: draft.lane === original.lane ? latest.lane : draft.lane,
    threadId: draft.threadId === original.threadId ? latest.threadId : draft.threadId,
    completed: draft.completed === original.completed ? latest.completed : draft.completed,
    archived: draft.archived === original.archived ? latest.archived : draft.archived,
    specPath: draft.specPath === original.specPath ? latest.specPath : draft.specPath,
    ...(original.acceptanceCriteria || draft.acceptanceCriteria || latest.acceptanceCriteria
      ? { acceptanceCriteria: mergeCriteria(original, draft, latest) }
      : {}),
  };
}
