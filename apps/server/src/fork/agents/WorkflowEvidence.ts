import {
  AgentWorkflowError,
  type AgentArtifactInput,
  type AgentAssignment,
  type AgentWorkflow,
  type OrchestrationV2TurnItem,
  type ProjectId,
  type RunId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ThreadManagement from "../../orchestration-v2/ThreadManagementService.ts";
import * as Git from "../../vcs/GitVcsDriver.ts";
import { skillContentHash } from "../skills/catalog.ts";
import { latestImplementation } from "./WorkflowRules.ts";

type CanonicalCommand = Extract<OrchestrationV2TurnItem, { readonly type: "command_execution" }>;
export type WorkflowEvidenceCommand = Pick<
  CanonicalCommand,
  "id" | "threadId" | "runId" | "type" | "input" | "status"
> &
  Partial<
    Pick<
      CanonicalCommand,
      "exitCode" | "output" | "outputIndicatesFailure" | "outputOmitted" | "monitor"
    >
  >;

export interface WorkflowEvidenceInput {
  readonly workflow: AgentWorkflow;
  readonly assignment: AgentAssignment;
  readonly artifact: AgentArtifactInput;
  readonly actorThreadId: ThreadId;
  readonly actorRunId: RunId;
}

export interface WorkflowEvidencePorts {
  readonly readThread: (
    threadId: ThreadId,
    runId: RunId,
  ) => Effect.Effect<
    {
      readonly projectId: ProjectId;
      readonly workspacePath: string | null;
      readonly runIds: ReadonlyArray<RunId>;
      readonly commands: ReadonlyArray<WorkflowEvidenceCommand>;
    },
    AgentWorkflowError
  >;
  readonly resolveCommit: (
    cwd: string,
    revision: string,
  ) => Effect.Effect<string, AgentWorkflowError>;
  readonly matchesSnapshot: (
    cwd: string,
    commitSha: string,
  ) => Effect.Effect<boolean, AgentWorkflowError>;
}

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

export function workflowCheckCommand(snapshotRef: string, command: string): string {
  const revision = quote(`${snapshotRef}^{commit}`);
  return `git rev-parse --verify ${revision} && (\n${command}\n) && printf '\\n' && git rev-parse --verify ${revision} && git diff --quiet ${quote(snapshotRef)} --`;
}

const commandInput = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({ command: Schema.optional(Schema.String), cmd: Schema.optional(Schema.String) }),
  ),
);

// Codex records a quoted shell invocation rather than the original script argument.
function shellScript(input: string): string | undefined {
  const prefix = /^(?:\/(?:[^/\s]+\/)*)?(?:bash|zsh|sh) -(?:lc|c) /u.exec(input);
  if (!prefix) return undefined;
  const argument = input.slice(prefix[0].length).trim();
  let quote: "'" | '"' | undefined;
  let script = "";
  for (let index = 0; index < argument.length; index++) {
    const char = argument[index]!;
    if (quote === "'") {
      if (char === "'") quote = undefined;
      else script += char;
    } else if (char === "\\") {
      const next = argument[++index];
      if (next === undefined) return undefined;
      if (next === "\n") continue;
      script += quote === '"' && !/[\\$`"\n]/u.test(next) ? `\\${next}` : next;
    } else if (char === quote) {
      quote = undefined;
    } else if (quote === '"') {
      if (char === "$" || char === "`") return undefined;
      script += char;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else {
      if (/[\s$`;&|()<>{}*?~#]/u.test(char)) return undefined;
      script += char;
    }
  }
  return quote === undefined ? script : undefined;
}

function matchesCommand(input: string, expected: string): boolean {
  if (input.trim() === expected) return true;
  if (shellScript(input.trim()) === expected) return true;
  const parsed = commandInput(input);
  return (
    Option.isSome(parsed) && (parsed.value.command === expected || parsed.value.cmd === expected)
  );
}

const failure = (detail: string, reason: AgentWorkflowError["reason"] = "evidence") =>
  new AgentWorkflowError({ reason, detail });

export const verifyWorkflowEvidence = Effect.fn("WorkflowEvidence.verify")(function* (
  ports: WorkflowEvidencePorts,
  input: WorkflowEvidenceInput,
) {
  const { workflow, assignment, artifact, actorThreadId, actorRunId } = input;
  const thread = yield* ports.readThread(actorThreadId, actorRunId);
  if (thread.projectId !== workflow.projectId || !thread.runIds.includes(actorRunId)) {
    return yield* failure(
      "The artifact producer does not belong to this project and run.",
      "forbidden",
    );
  }
  if (!artifact.content.trim() || !artifact.summary.trim()) {
    return yield* failure("The artifact must include its actual content and a readable summary.");
  }
  const contentHash = skillContentHash(artifact.content);
  if (artifact.outcome === "blocked")
    return { contentHash, verified: false, verifiedRequiredChecks: [] as string[] };
  const codeArtifact = assignment.writeResponsibility || assignment.role.role.kind === "reviewer";
  if (!codeArtifact && artifact.checks.length === 0) {
    return { contentHash, verified: true, verifiedRequiredChecks: [] as string[] };
  }
  const workspace = assignment.workspacePath ?? workflow.workspacePath;
  if (!workspace || thread.workspacePath !== workspace) {
    return yield* failure("The producer's native workspace does not match the assignment.");
  }
  const implementation =
    assignment.role.role.kind === "reviewer" ? latestImplementation(workflow) : undefined;
  if (
    assignment.role.role.kind === "reviewer" &&
    (!implementation ||
      artifact.reviewedHead !== implementation.headRef ||
      artifact.headRef !== implementation.headRef)
  ) {
    return yield* failure(
      "The review is not for the latest accepted implementation.",
      "review_stale",
    );
  }
  const producer = implementation
    ? workflow.assignments.find((row) => row.id === implementation.assignmentId)
    : assignment;
  const checkpoint = producer?.checkpoint;
  if (!checkpoint || artifact.headRef !== checkpoint.commitSha) {
    return yield* failure(
      "Capture an assignment snapshot and report its exact immutable commit SHA.",
    );
  }
  const pinned = yield* ports.resolveCommit(workspace, checkpoint.ref);
  if (pinned !== checkpoint.commitSha || !/^[0-9a-f]{40,64}$/.test(pinned)) {
    return yield* failure("The captured snapshot ref no longer resolves to the accepted revision.");
  }
  const expectedBase = implementation?.baseRef ?? assignment.baseRef ?? workflow.baseRef;
  if (
    !artifact.baseRef ||
    !expectedBase ||
    (yield* ports.resolveCommit(workspace, artifact.baseRef)) !==
      (yield* ports.resolveCommit(workspace, expectedBase))
  ) {
    return yield* failure("The artifact's base revision does not match its accepted input.");
  }
  if (!(yield* ports.matchesSnapshot(workspace, pinned))) {
    return yield* failure(
      "The working tree differs from the captured snapshot or contains uncaptured untracked files.",
    );
  }
  const requiredCommands = [...new Set(assignment.requiredChecks)];
  if (
    artifact.outcome === "accepted" &&
    codeArtifact &&
    requiredCommands.length === 0 &&
    !artifact.checks.some((check) => check.required && check.status === "passed")
  ) {
    return yield* failure(
      "An accepted code artifact needs a required check backed by native execution evidence.",
    );
  }
  if (
    artifact.outcome === "accepted" &&
    codeArtifact &&
    requiredCommands.some(
      (command) =>
        !artifact.checks.some((check) => check.command === command && check.status === "passed"),
    )
  ) {
    return yield* failure(
      "The artifact omits or skips a required check from the accepted assignment.",
    );
  }
  const verifiedRequiredChecks: string[] = [];
  for (const check of artifact.checks) {
    if (check.required && artifact.outcome === "accepted" && check.status !== "passed") {
      return yield* failure("A required check did not pass.");
    }
    if (check.status === "skipped") continue;
    if (check.revision !== pinned || !check.command.trim()) {
      return yield* failure("A check is not bound to the captured revision.");
    }
    const item =
      thread.commands.find((row) => row.id === check.evidence) ??
      thread.commands.find((row) => row.id === check.evidence.replace(/^turn-item:/, ""));
    if (
      !item ||
      item.threadId !== actorThreadId ||
      item.runId !== actorRunId ||
      item.monitor === true ||
      !matchesCommand(item.input, workflowCheckCommand(checkpoint.ref, check.command))
    ) {
      return yield* failure(
        "A check must reference the exact native command item from this producer run using the snapshot check wrapper.",
      );
    }
    if (check.status === "passed") {
      const output =
        item.output
          ?.split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean) ?? [];
      if (
        item.status !== "completed" ||
        item.exitCode !== 0 ||
        item.outputIndicatesFailure === true ||
        item.outputOmitted === true ||
        output[0] !== pinned ||
        output.at(-1) !== pinned
      ) {
        return yield* failure(
          "The canonical command did not complete successfully with matching snapshot markers.",
        );
      }
      if (requiredCommands.includes(check.command)) verifiedRequiredChecks.push(check.command);
    } else if (
      item.exitCode === 0 &&
      item.status !== "failed" &&
      item.outputIndicatesFailure !== true
    ) {
      return yield* failure("The claimed check failure does not match native execution evidence.");
    }
  }
  if (
    (yield* ports.resolveCommit(workspace, checkpoint.ref)) !== pinned ||
    !(yield* ports.matchesSnapshot(workspace, pinned))
  ) {
    return yield* failure("The workspace or snapshot changed during verification.");
  }
  return {
    contentHash,
    verified: true,
    verifiedRequiredChecks: [...new Set(verifiedRequiredChecks)],
  };
});

export class WorkflowEvidence extends Context.Service<
  WorkflowEvidence,
  {
    readonly verify: (input: WorkflowEvidenceInput) => Effect.Effect<
      {
        readonly contentHash: string;
        readonly verified: boolean;
        readonly verifiedRequiredChecks: ReadonlyArray<string>;
      },
      AgentWorkflowError
    >;
  }
>()("t3/fork/agents/WorkflowEvidence") {}

const make = Effect.gen(function* () {
  const git = yield* Git.GitVcsDriver;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const ports: WorkflowEvidencePorts = {
    readThread: Effect.fn("WorkflowEvidence.readProducer")(function* (threadId, runId) {
      const records = yield* threads.getThreadRecords(threadId, ["turnItems", "runs"]).pipe(
        Effect.mapError(
          (cause) =>
            new AgentWorkflowError({
              reason: "evidence",
              detail: "The native producer record could not be read.",
              cause,
            }),
        ),
      );
      const checkpoints = yield* threads.getCheckpointContext(threadId).pipe(
        Effect.mapError(
          (cause) =>
            new AgentWorkflowError({
              reason: "evidence",
              detail: "The native workspace context could not be read.",
              cause,
            }),
        ),
      );
      const rootScope = checkpoints.checkpointScopes.find(
        (scope) => scope.kind === "root_run" && scope.runId === runId,
      );
      return {
        projectId: records.thread.projectId,
        workspacePath: records.thread.worktreePath ?? rootScope?.cwd ?? null,
        runIds: records.runs.map((run) => run.id),
        commands: records.turnItems.filter(
          (item): item is CanonicalCommand => item.type === "command_execution",
        ),
      };
    }),
    resolveCommit: Effect.fn("WorkflowEvidence.resolveCommit")(function* (cwd, revision) {
      const result = yield* git.resolveCommit({ cwd, revision }).pipe(
        Effect.mapError(
          (cause) =>
            new AgentWorkflowError({
              reason: "evidence",
              detail: "A referenced Git revision could not be resolved.",
              cause,
            }),
        ),
      );
      return result.commitSha;
    }),
    matchesSnapshot: Effect.fn("WorkflowEvidence.matchesSnapshot")(function* (cwd, commitSha) {
      const result = yield* Effect.gen(function* () {
        const status = yield* git.statusDetailsLocal(cwd);
        if (!status.isRepo) return false;
        const changed = yield* git.execute({
          operation: "workflow-snapshot-diff",
          cwd,
          args: ["diff", "--quiet", commitSha, "--"],
          allowNonZeroExit: true,
        });
        if (changed.exitCode !== 0) return false;
        const untracked = yield* git.execute({
          operation: "workflow-snapshot-untracked",
          cwd,
          args: ["ls-files", "--others", "--exclude-standard", "-z"],
        });
        return (
          untracked.exitCode === 0 && !untracked.stdoutTruncated && untracked.stdout.length === 0
        );
      }).pipe(
        Effect.mapError(
          (cause) =>
            new AgentWorkflowError({
              reason: "evidence",
              detail: "The captured workspace could not be checked.",
              cause,
            }),
        ),
      );
      return result;
    }),
  };
  return WorkflowEvidence.of({
    // verifyWorkflowEvidence owns the operation span.
    verify: Effect.fnUntraced(function* (input: WorkflowEvidenceInput) {
      return yield* verifyWorkflowEvidence(ports, input);
    }),
  });
});

export const layer = Layer.effect(WorkflowEvidence, make);
