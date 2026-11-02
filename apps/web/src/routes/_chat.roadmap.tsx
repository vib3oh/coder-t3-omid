import { createFileRoute } from "@tanstack/react-router";
import { RoadmapPage } from "../roadmap/RoadmapPage";

export const Route = createFileRoute("/_chat/roadmap")({ component: RoadmapPage });
