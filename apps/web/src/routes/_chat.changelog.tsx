import { createFileRoute } from "@tanstack/react-router";
import { ChangelogPage } from "../roadmap/ChangelogPage";

export const Route = createFileRoute("/_chat/changelog")({
  validateSearch: (raw: Record<string, unknown>): { project?: string } =>
    typeof raw.project === "string" ? { project: raw.project.slice(0, 512) } : {},
  component: ChangelogPage,
});
