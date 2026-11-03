import { AgentWorkflowLimits } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
const isWorkflowLimits = Schema.is(AgentWorkflowLimits);

export const WORKFLOW_LIMIT_FIELDS = [
  { key: "maxConcurrent", label: "Concurrent assignments", min: 1, max: 8 },
  { key: "maxAttempts", label: "Assignment attempts", min: 1, max: 100 },
  { key: "maxReviewRounds", label: "Correction rounds", min: 0, max: 10 },
  { key: "maxMessages", label: "Messages", min: 1, max: 2_000 },
  { key: "questionTimeoutSeconds", label: "Question timeout (seconds)", min: 1, max: 604_800 },
] as const;

export type WorkflowLimitDraft = Record<(typeof WORKFLOW_LIMIT_FIELDS)[number]["key"], string>;

export function workflowLimitDraft(limits: AgentWorkflowLimits): WorkflowLimitDraft {
  return {
    maxConcurrent: String(limits.maxConcurrent),
    maxAttempts: String(limits.maxAttempts),
    maxReviewRounds: String(limits.maxReviewRounds),
    maxMessages: String(limits.maxMessages),
    questionTimeoutSeconds: String(limits.questionTimeoutMs / 1_000),
  };
}

export function parseWorkflowLimits(draft: WorkflowLimitDraft): AgentWorkflowLimits | null {
  if (WORKFLOW_LIMIT_FIELDS.some(({ key }) => draft[key].trim() === "")) return null;
  const seconds = Number(draft.questionTimeoutSeconds);
  if (seconds < 1 || seconds > 604_800) return null;
  const limits = {
    maxConcurrent: Number(draft.maxConcurrent),
    maxAttempts: Number(draft.maxAttempts),
    maxReviewRounds: Number(draft.maxReviewRounds),
    maxMessages: Number(draft.maxMessages),
    questionTimeoutMs: Math.round(seconds * 1_000),
  };
  return isWorkflowLimits(limits) ? limits : null;
}
