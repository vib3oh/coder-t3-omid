interface RoadmapThread {
  readonly archivedAt: string | null;
  readonly pullRequests: ReadonlyArray<{
    readonly source: string;
    readonly snapshot: { readonly state: string; readonly isDraft: boolean } | null;
  }>;
}

export function roadmapColumn(
  card: { readonly completed: boolean; readonly lane: "backlog" | "upNext" },
  thread?: RoadmapThread | null,
) {
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
