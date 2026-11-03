import { createFileRoute } from "@tanstack/react-router";
import { RoadmapPage } from "../roadmap/RoadmapPage";

export const Route = createFileRoute("/_chat/roadmap")({
  component: RoadmapPage,
  validateSearch: (raw: Record<string, unknown>): { project?: string; card?: string } => ({
    ...(typeof raw.project === "string" ? { project: raw.project.slice(0, 512) } : {}),
    ...(typeof raw.card === "string" ? { card: raw.card.slice(0, 128) } : {}),
  }),
});
