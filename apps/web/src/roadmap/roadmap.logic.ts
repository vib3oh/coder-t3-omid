import type { RoadmapCard } from "@t3tools/contracts";

export const ROADMAP_COLUMNS = [
  ["backlog", "Backlog", "Ideas worth keeping"],
  ["upNext", "Up Next", "Prioritized and ready to start"],
  ["building", "Building", "Linked threads in progress"],
  ["reviewing", "Agent reviewing", "Draft pull requests"],
  ["ready", "Your turn", "Ready for review"],
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

export function roadmapColumn(card: RoadmapCard, thread?: RoadmapThread | null) {
  if (card.completed) return "done";
  if (!thread) return card.lane;
  const snapshots = thread.pullRequests
    .filter((pr) => pr.source !== "stack-dismissed")
    .flatMap((pr) => (pr.snapshot ? [pr.snapshot] : []));
  const open = snapshots.filter((pr) => pr.state === "open");
  if (open.some((pr) => !pr.isDraft)) return "ready";
  if (open.length > 0) return thread.archivedAt ? "parked" : "reviewing";
  if (snapshots.some((pr) => pr.state === "merged")) return "done";
  return thread.archivedAt ? card.lane : "building";
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
  };
}
