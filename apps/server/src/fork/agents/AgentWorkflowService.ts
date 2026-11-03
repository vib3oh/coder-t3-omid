import {
  AgentWorkflowError,
  type AgentActionIntent,
  type AgentAssignment,
  type AgentAssignmentControlInput,
  type AgentAssignmentResultInput,
  type AgentAssignmentStartInput,
  type AgentArtifact,
  type AgentRolePreset,
  type AgentRoleSaveInput,
  type AgentRoleSnapshot,
  type AgentSpecSnapshot,
  type AgentRolesReadInput,
  type AgentRolesReadResult,
  type AgentTeamAckInput,
  type AgentTeamMessage,
  type AgentTeamMessageInput,
  type AgentWorkflow,
  type AgentWorkflowControlInput,
  type AgentWorkflowListInput,
  type AgentWorkflowListResult,
  type AgentWorkflowProject,
  type AgentWorkflowReadInput,
  type AgentWorkflowSettingsInput,
  type AgentWorkflowStartInput,
  type CommandId,
  type MessageId,
  type NodeId,
  type ProjectId,
  type RunId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as AgentWorkflowStore from "./AgentWorkflowStore.ts";
import {
  assignmentIsActive,
  blockingQuestionCycle,
  expectedRoleOutputKind,
  latestImplementation,
  workflowSummary,
} from "./WorkflowRules.ts";

export type AgentWorkflowActor =
  | { readonly type: "user" }
  | { readonly type: "agent"; readonly threadId: ThreadId; readonly runId: RunId }
  | { readonly type: "system" };

type Failure = AgentWorkflowError;
type PreparedAssignment = {
  readonly workflow: AgentWorkflow;
  readonly assignment: AgentAssignment;
  readonly intent: AgentActionIntent;
  readonly replayed: boolean;
};
type PreparedMessage = {
  readonly workflow: AgentWorkflow;
  readonly message: AgentTeamMessage;
  readonly intent: AgentActionIntent;
  readonly replayed: boolean;
};

export class AgentWorkflowService extends Context.Service<
  AgentWorkflowService,
  {
    readonly roles: (
      input: typeof AgentRolesReadInput.Type,
    ) => Effect.Effect<typeof AgentRolesReadResult.Type, Failure>;
    readonly saveRole: (
      input: typeof AgentRoleSaveInput.Type,
    ) => Effect.Effect<typeof AgentRolesReadResult.Type, Failure>;
    readonly settings: (
      input: typeof AgentWorkflowSettingsInput.Type,
    ) => Effect.Effect<typeof AgentRolesReadResult.Type, Failure>;
    readonly list: (
      input: typeof AgentWorkflowListInput.Type,
    ) => Effect.Effect<typeof AgentWorkflowListResult.Type, Failure>;
    readonly read: (
      input: typeof AgentWorkflowReadInput.Type,
    ) => Effect.Effect<AgentWorkflow, Failure>;
    readonly create: (input: {
      readonly input: AgentWorkflowStartInput;
      readonly workflowId: string;
      readonly managerThreadId: ThreadId;
      readonly commandId: CommandId;
      readonly managerRole?: AgentRoleSnapshot;
      readonly managerBrief?: string;
      readonly specSnapshot?: AgentSpecSnapshot | null;
      readonly baseRef?: string | null;
    }) => Effect.Effect<AgentWorkflow, Failure>;
    readonly acceptLaunch: (input: {
      readonly projectId: ProjectId;
      readonly workflowId: string;
      readonly workspacePath: string | null;
      readonly baseRef: string | null;
    }) => Effect.Effect<AgentWorkflow, Failure>;
    readonly failIntent: (input: {
      readonly projectId: ProjectId;
      readonly workflowId: string;
      readonly intentId: string;
    }) => Effect.Effect<AgentWorkflow, Failure>;
    readonly prepareAssignment: (input: {
      readonly input: AgentAssignmentStartInput;
      readonly actor: AgentWorkflowActor;
      readonly role: AgentRoleSnapshot;
      readonly compiledBrief?: string;
      readonly commandId: CommandId;
    }) => Effect.Effect<PreparedAssignment, Failure>;
    readonly controlAssignment: (input: {
      readonly input: AgentAssignmentControlInput;
      readonly actor: AgentWorkflowActor;
    }) => Effect.Effect<AgentWorkflow, Failure>;
    readonly recordCheckpoint: (input: {
      readonly projectId: ProjectId;
      readonly workflowId: string;
      readonly assignmentId: string;
      readonly actor: AgentWorkflowActor;
      readonly ref: string;
      readonly commitSha: string;
    }) => Effect.Effect<AgentWorkflow, Failure>;
    readonly acceptAssignment: (input: {
      readonly projectId: ProjectId;
      readonly workflowId: string;
      readonly assignmentId: string;
      readonly intentId: string;
      readonly childThreadId: ThreadId;
      readonly taskId: NodeId;
      readonly parentRunId: RunId;
      readonly workspacePath?: string | null;
      readonly baseRef?: string | null;
    }) => Effect.Effect<AgentWorkflow, Failure>;
    readonly result: (input: {
      readonly input: AgentAssignmentResultInput;
      readonly actor: AgentWorkflowActor;
      readonly contentHash: string;
      readonly verified: boolean;
      readonly verifiedRequiredChecks?: ReadonlyArray<string>;
    }) => Effect.Effect<AgentWorkflow, Failure>;
    readonly message: (input: {
      readonly input: AgentTeamMessageInput;
      readonly actor: AgentWorkflowActor;
      readonly commandId: CommandId;
      readonly messageId: MessageId;
    }) => Effect.Effect<PreparedMessage, Failure>;
    readonly delivery: (input: {
      readonly projectId: ProjectId;
      readonly workflowId: string;
      readonly messageId: string;
      readonly delivery: "queued" | "submitted" | "failed";
      readonly taskId?: NodeId;
      readonly childThreadId?: ThreadId;
      readonly parentRunId?: RunId;
    }) => Effect.Effect<AgentWorkflow, Failure>;
    readonly ack: (input: {
      readonly input: AgentTeamAckInput;
      readonly actor: AgentWorkflowActor;
    }) => Effect.Effect<AgentWorkflow, Failure>;
    readonly control: (input: {
      readonly input: AgentWorkflowControlInput;
      readonly actor: AgentWorkflowActor;
    }) => Effect.Effect<AgentWorkflow, Failure>;
    readonly expireQuestions: (
      input: typeof AgentWorkflowReadInput.Type,
    ) => Effect.Effect<AgentWorkflow, Failure>;
  }
>()("t3/fork/agents/AgentWorkflowService") {}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function replaceWorkflow(state: AgentWorkflowProject, workflow: AgentWorkflow, now: number) {
  const next = { ...workflow, revision: workflow.revision + 1, updatedAt: now };
  return {
    state: { ...state, workflows: state.workflows.map((row) => (row.id === next.id ? next : row)) },
    workflow: next,
  };
}

const lookup = Effect.fn("AgentWorkflowService.lookup")(function* (
  state: AgentWorkflowProject,
  id: string,
) {
  const workflow = state.workflows.find((row) => row.id === id);
  if (!workflow) return yield* new AgentWorkflowError({ reason: "not_found" });
  return workflow;
});

function manager(workflow: AgentWorkflow, actor: AgentWorkflowActor) {
  return actor.type === "agent" && actor.threadId === workflow.managerThreadId;
}

function participant(workflow: AgentWorkflow, actor: AgentWorkflowActor) {
  return actor.type !== "agent" || currentThread(workflow, actor.threadId);
}

function currentThread(workflow: AgentWorkflow, threadId: ThreadId) {
  return (
    threadId === workflow.managerThreadId ||
    workflow.assignments.some(
      (row) =>
        row.generation === workflow.generation &&
        row.state !== "cancelled" &&
        row.state !== "ready" &&
        row.state !== "failed" &&
        row.attempts.at(-1)?.childThreadId === threadId,
    )
  );
}

const replay = Effect.fn("AgentWorkflowService.replay")(function* (
  workflow: AgentWorkflow,
  requestId: string,
  fingerprint: string,
) {
  const prior = workflow.intents.find((row) => row.requestId === requestId);
  if (prior && prior.fingerprint !== fingerprint)
    return yield* new AgentWorkflowError({ reason: "idempotency_conflict" });
  return prior;
});

function intent(
  operation: AgentActionIntent["operation"],
  requestId: string,
  fingerprint: string,
  workflow: AgentWorkflow,
  commandId: CommandId,
  entityId: string,
  now: number,
): AgentActionIntent {
  return {
    id: `${operation}-${fingerprint.slice(0, 32)}`,
    requestId,
    fingerprint,
    generation: workflow.generation,
    operation,
    targetAttemptId: null,
    state: "pending",
    commandId,
    entityId,
    createdAt: now,
  };
}

const make = Effect.gen(function* () {
  const store = yield* AgentWorkflowStore.AgentWorkflowStore;
  const crypto = yield* Crypto.Crypto;
  const fingerprint = Effect.fn("AgentWorkflowService.fingerprint")(function* (
    operation: string,
    value: unknown,
  ) {
    return Hex.encode(
      yield* crypto
        .digest("SHA-256", new TextEncoder().encode(canonical([operation, value])))
        .pipe(Effect.orDie),
    );
  });

  const roles: AgentWorkflowService["Service"]["roles"] = Effect.fn("AgentWorkflowService.roles")(
    function* (input) {
      const state = yield* store.read(input.projectId);
      return { revision: state.roleRevision ?? 0, enabled: state.enabled, roles: state.roles };
    },
  );
  const saveRole: AgentWorkflowService["Service"]["saveRole"] = Effect.fn(
    "AgentWorkflowService.saveRole",
  )(function* (input) {
    return yield* store.update(input.projectId, (state) =>
      Effect.gen(function* () {
        if ((state.roleRevision ?? 0) !== input.expectedRevision)
          return yield* new AgentWorkflowError({ reason: "conflict" });
        if (!input.role.mission.trim() || !input.role.instructions.trim())
          return yield* new AgentWorkflowError({
            reason: "invalid",
            detail: "A role needs a purpose and working instructions.",
          });
        if (input.role.outputKind !== expectedRoleOutputKind[input.role.kind])
          return yield* new AgentWorkflowError({
            reason: "invalid",
            detail: `The ${input.role.kind} role must produce ${expectedRoleOutputKind[input.role.kind]} artifacts.`,
          });
        const old = state.roles.find((row) => row.id === input.role.id);
        if (!old && state.roles.length >= 100)
          return yield* new AgentWorkflowError({ reason: "limit" });
        const role: AgentRolePreset = { ...input.role, version: (old?.version ?? 0) + 1 };
        const nextRoles = old
          ? state.roles.map((row) => (row.id === role.id ? role : row))
          : [...state.roles, role];
        return {
          state: { ...state, roleRevision: (state.roleRevision ?? 0) + 1, roles: nextRoles },
          result: {
            revision: (state.roleRevision ?? 0) + 1,
            enabled: state.enabled,
            roles: nextRoles,
          },
        };
      }),
    );
  });
  const settings: AgentWorkflowService["Service"]["settings"] = Effect.fn(
    "AgentWorkflowService.settings",
  )(function* (input) {
    return yield* store.update(input.projectId, (state) =>
      Effect.gen(function* () {
        if ((state.roleRevision ?? 0) !== input.expectedRevision)
          return yield* new AgentWorkflowError({ reason: "conflict" });
        return {
          state: { ...state, roleRevision: (state.roleRevision ?? 0) + 1, enabled: input.enabled },
          result: {
            revision: (state.roleRevision ?? 0) + 1,
            enabled: input.enabled,
            roles: state.roles,
          },
        };
      }),
    );
  });
  const read: AgentWorkflowService["Service"]["read"] = Effect.fn("AgentWorkflowService.read")(
    function* (input) {
      return yield* lookup(yield* store.read(input.projectId), input.workflowId);
    },
  );
  const list: AgentWorkflowService["Service"]["list"] = Effect.fn("AgentWorkflowService.list")(
    function* (input) {
      const state = yield* store.read(input.projectId);
      return {
        enabled: state.enabled,
        workflows: state.workflows.map(workflowSummary),
      };
    },
  );

  const create: AgentWorkflowService["Service"]["create"] = Effect.fn(
    "AgentWorkflowService.create",
  )(function* ({
    input,
    workflowId,
    managerThreadId,
    commandId,
    managerRole,
    specSnapshot,
    managerBrief,
    baseRef,
  }) {
    const hash = yield* fingerprint("launch", input);
    const now = yield* Clock.currentTimeMillis;
    return yield* store.update(input.projectId, (state) =>
      Effect.gen(function* () {
        for (const candidate of state.workflows) {
          const previous = yield* replay(candidate, input.requestId, hash);
          if (previous) return { state, result: candidate };
        }
        if (!state.enabled) return yield* new AgentWorkflowError({ reason: "disabled" });
        if (!input.title.trim() || !input.objective.trim())
          return yield* new AgentWorkflowError({
            reason: "invalid",
            detail: "A workflow needs a title and objective.",
          });
        for (const kind of ["planner", "builder", "reviewer"] as const) {
          if (
            !state.roles.some(
              (role) => role.id === input.roleIds[kind] && role.kind === kind && role.enabled,
            )
          )
            return yield* new AgentWorkflowError({ reason: "invalid" });
        }
        if (state.workflows.length >= 100 || state.workflows.some((row) => row.id === workflowId))
          return yield* new AgentWorkflowError({ reason: "limit" });
        if (
          input.cardId &&
          state.workflows.some(
            (row) =>
              row.cardId === input.cardId &&
              row.status !== "completed" &&
              row.status !== "failed" &&
              row.status !== "cancelled",
          )
        )
          return yield* new AgentWorkflowError({ reason: "writer_busy" });
        const workflow: AgentWorkflow = {
          id: workflowId,
          projectId: input.projectId,
          title: input.title,
          objective: input.objective,
          managerThreadId,
          managerRole: managerRole ?? null,
          managerBrief: managerBrief ?? managerRole?.role.instructions ?? "",
          roleIds: input.roleIds,
          specSnapshot: specSnapshot ?? null,
          sourceThreadId: input.sourceThreadId,
          cardId: input.cardId,
          cardRevision: input.cardRevision,
          generation: 0,
          revision: 0,
          status: "draft",
          limits: input.limits,
          modelSelection: input.modelSelection,
          runtimeMode: input.runtimeMode,
          interactionMode: input.interactionMode,
          workspaceStrategy: input.workspaceStrategy,
          workspacePath: null,
          baseRef: baseRef ?? null,
          criteria: input.criteria,
          requiredChecks: [
            ...new Set(
              (input.requiredChecks ?? []).map((command) => command.trim()).filter(Boolean),
            ),
          ],
          createdAt: now,
          updatedAt: now,
          assignments: [],
          messages: [],
          artifacts: [],
          intents: [],
          participants: [
            { id: "manager", threadId: managerThreadId, roleId: "planner", assignmentId: null },
          ],
        };
        const withIntent = {
          ...workflow,
          intents: [intent("launch", input.requestId, hash, workflow, commandId, workflow.id, now)],
        };
        return {
          state: { ...state, workflows: [...state.workflows, withIntent] },
          result: withIntent,
        };
      }),
    );
  });
  const acceptLaunch: AgentWorkflowService["Service"]["acceptLaunch"] = Effect.fn(
    "AgentWorkflowService.acceptLaunch",
  )(function* (input) {
    const now = yield* Clock.currentTimeMillis;
    return yield* store.update(input.projectId, (state) =>
      Effect.gen(function* () {
        const workflow = yield* lookup(state, input.workflowId);
        if (workflow.status !== "draft" && workflow.status !== "running")
          return { state, result: workflow };
        if (
          workflow.status === "running" &&
          workflow.workspacePath !== null &&
          workflow.baseRef !== null
        )
          return { state, result: workflow };
        const changed = replaceWorkflow(
          state,
          {
            ...workflow,
            status: "running",
            workspacePath: workflow.workspacePath ?? input.workspacePath,
            baseRef: workflow.baseRef ?? input.baseRef,
            intents: workflow.intents.map((row) =>
              row.operation === "launch" ? { ...row, state: "accepted" } : row,
            ),
          },
          now,
        );
        return { state: changed.state, result: changed.workflow };
      }),
    );
  });

  const failIntent: AgentWorkflowService["Service"]["failIntent"] = Effect.fn(
    "AgentWorkflowService.failIntent",
  )(function* (input) {
    const now = yield* Clock.currentTimeMillis;
    return yield* store.update(input.projectId, (state) =>
      Effect.gen(function* () {
        const workflow = yield* lookup(state, input.workflowId);
        const action = workflow.intents.find((row) => row.id === input.intentId);
        if (!action) return yield* new AgentWorkflowError({ reason: "not_found" });
        if (action.state === "accepted" || action.state === "failed")
          return { state, result: workflow };
        if (action.generation !== workflow.generation || workflow.status === "cancelled")
          return yield* new AgentWorkflowError({ reason: "stale" });
        const changed = replaceWorkflow(
          state,
          {
            ...workflow,
            status: action.operation === "launch" ? "failed" : workflow.status,
            intents: workflow.intents.map((row) =>
              row.id === action.id && row.state !== "accepted" ? { ...row, state: "failed" } : row,
            ),
            assignments:
              action.operation === "assignment"
                ? workflow.assignments.map((row) =>
                    row.id === action.entityId &&
                    (!action.targetAttemptId || row.attempts.at(-1)?.id === action.targetAttemptId)
                      ? { ...row, state: "failed" }
                      : row,
                  )
                : workflow.assignments,
          },
          now,
        );
        return { state: changed.state, result: changed.workflow };
      }),
    );
  });

  const controlAssignment: AgentWorkflowService["Service"]["controlAssignment"] = Effect.fn(
    "AgentWorkflowService.controlAssignment",
  )(function* ({ input, actor }) {
    const hash = yield* fingerprint("assignment-control", {
      input,
      actor: actor.type === "agent" ? actor.threadId : actor.type,
    });
    const now = yield* Clock.currentTimeMillis;
    return yield* store.update(input.projectId, (state) =>
      Effect.gen(function* () {
        const workflow = yield* lookup(state, input.workflowId);
        if (actor.type !== "user" && !manager(workflow, actor))
          return yield* new AgentWorkflowError({ reason: "forbidden" });
        if (yield* replay(workflow, input.requestId, hash)) return { state, result: workflow };
        if (workflow.status === "cancelled" || workflow.status === "completed")
          return yield* new AgentWorkflowError({ reason: "stale" });
        const assignment = workflow.assignments.find((row) => row.id === input.assignmentId);
        if (!assignment) return yield* new AgentWorkflowError({ reason: "not_found" });
        if (input.action === "cancel" && assignment.state === "cancelled")
          return { state, result: workflow };
        if (input.action === "retry" && assignment.state === "ready")
          return { state, result: workflow };
        if (
          (input.action === "cancel" && assignment.state === "accepted") ||
          (input.action === "retry" &&
            assignment.state !== "failed" &&
            assignment.state !== "needs_changes" &&
            assignment.state !== "cancelled")
        )
          return yield* new AgentWorkflowError({ reason: "conflict" });
        const attempt = assignment.attempts.at(-1);
        const threadId = attempt?.childThreadId;
        const messages =
          input.action === "cancel"
            ? workflow.messages.map((row) =>
                row.questionState === "pending" &&
                (row.senderThreadId === threadId || row.recipientThreadId === threadId)
                  ? { ...row, questionState: "cancelled" as const }
                  : row,
              )
            : workflow.messages;
        const changed = replaceWorkflow(
          state,
          {
            ...workflow,
            assignments: workflow.assignments.map((row) =>
              row.id === assignment.id
                ? { ...row, state: input.action === "cancel" ? "cancelled" : "ready" }
                : row.state === "awaiting_peer" &&
                    !messages.some(
                      (message) =>
                        message.senderThreadId === row.attempts.at(-1)?.childThreadId &&
                        message.blocking &&
                        message.questionState === "pending",
                    )
                  ? { ...row, state: "awaiting_result" }
                  : row,
            ),
            messages,
            intents: [
              ...workflow.intents.map((row) =>
                input.action === "cancel" &&
                row.operation === "assignment" &&
                row.entityId === assignment.id &&
                row.state === "pending"
                  ? { ...row, state: "cancelled" as const }
                  : row,
              ),
              {
                ...intent(
                  "control",
                  input.requestId,
                  hash,
                  workflow,
                  attempt?.commandId ?? workflow.intents[0]!.commandId,
                  assignment.id,
                  now,
                ),
                state: "accepted",
                targetAttemptId: attempt?.id ?? null,
              },
            ],
          },
          now,
        );
        return { state: changed.state, result: changed.workflow };
      }),
    );
  });

  const recordCheckpoint: AgentWorkflowService["Service"]["recordCheckpoint"] = Effect.fn(
    "AgentWorkflowService.recordCheckpoint",
  )(function* (input) {
    const now = yield* Clock.currentTimeMillis;
    return yield* store.update(input.projectId, (state) =>
      Effect.gen(function* () {
        const workflow = yield* lookup(state, input.workflowId);
        const assignment = workflow.assignments.find((row) => row.id === input.assignmentId);
        if (!assignment) return yield* new AgentWorkflowError({ reason: "not_found" });
        if (
          input.actor.type !== "agent" ||
          assignment.attempts.at(-1)?.childThreadId !== input.actor.threadId ||
          !assignment.writeResponsibility
        )
          return yield* new AgentWorkflowError({ reason: "forbidden" });
        if (
          assignment.generation !== workflow.generation ||
          !assignmentIsActive(assignment.state) ||
          workflow.status === "cancelled"
        )
          return yield* new AgentWorkflowError({ reason: "stale" });
        if (!input.ref.trim() || !input.commitSha.trim())
          return yield* new AgentWorkflowError({ reason: "invalid" });
        if (
          assignment.checkpoint?.ref === input.ref &&
          assignment.checkpoint.commitSha === input.commitSha
        )
          return { state, result: workflow };
        const changed = replaceWorkflow(
          state,
          {
            ...workflow,
            assignments: workflow.assignments.map((row) =>
              row.id === assignment.id
                ? { ...row, checkpoint: { ref: input.ref, commitSha: input.commitSha } }
                : row,
            ),
          },
          now,
        );
        return { state: changed.state, result: changed.workflow };
      }),
    );
  });

  const prepareAssignment: AgentWorkflowService["Service"]["prepareAssignment"] = Effect.fn(
    "AgentWorkflowService.prepareAssignment",
  )(function* ({ input, actor, role: proposedRole, commandId, compiledBrief }) {
    const hash = yield* fingerprint("assignment", input);
    const now = yield* Clock.currentTimeMillis;
    return yield* store.update(input.projectId, (state) =>
      Effect.gen(function* () {
        const workflow = yield* lookup(state, input.workflowId);
        if (!manager(workflow, actor) || actor.type !== "agent")
          return yield* new AgentWorkflowError({ reason: "forbidden" });
        const old = workflow.assignments.find((row) => row.id === input.assignmentId);
        const role = old?.role ?? proposedRole;
        if (
          old &&
          (old.role.role.id !== input.roleId ||
            old.objective !== input.objective ||
            canonical(old.criteria) !== canonical(input.criteria) ||
            canonical(old.inputArtifactIds) !== canonical(input.inputArtifactIds) ||
            canonical(old.dependencies) !== canonical(input.dependencies) ||
            (input.modelSelection !== undefined &&
              canonical(input.modelSelection) !== canonical(old.role.modelSelection)))
        )
          return yield* new AgentWorkflowError({
            reason: "conflict",
            detail:
              "A retry preserves the assignment's responsibility and model. Use a new assignment id for changed work.",
          });
        if (role.role.outputKind !== expectedRoleOutputKind[role.role.kind])
          return yield* new AgentWorkflowError({
            reason: "invalid",
            detail: `The ${role.role.kind} role must produce ${expectedRoleOutputKind[role.role.kind]} artifacts.`,
          });
        const prior = yield* replay(workflow, input.requestId, hash);
        if (prior) {
          const assignment = workflow.assignments.find((row) => row.id === prior.entityId);
          if (!assignment) return yield* new AgentWorkflowError({ reason: "invalid" });
          return { state, result: { workflow, assignment, intent: prior, replayed: true } };
        }
        if (input.generation !== workflow.generation)
          return yield* new AgentWorkflowError({ reason: "stale" });
        if (!state.enabled) return yield* new AgentWorkflowError({ reason: "disabled" });
        if (workflow.status !== "running")
          return yield* new AgentWorkflowError({ reason: "dependency" });
        if (
          !role.role.enabled ||
          role.role.id !== input.roleId ||
          role.skills.some(
            (row) => row.required && (row.state === "missing" || row.state === "unsupported"),
          )
        )
          return yield* new AgentWorkflowError({ reason: "missing_skill" });
        if (
          role.role.requiredSkills.some(
            (id) =>
              !role.skills.some(
                (skill) =>
                  skill.id === id &&
                  skill.required &&
                  (skill.state === "loaded" || skill.state === "on_demand"),
              ),
          )
        )
          return yield* new AgentWorkflowError({ reason: "missing_skill" });
        if (
          (role.role.kind === "planner" ||
            role.role.kind === "builder" ||
            role.role.kind === "reviewer") &&
          workflow.roleIds[role.role.kind] !== role.role.id
        )
          return yield* new AgentWorkflowError({ reason: "invalid" });
        const active = workflow.assignments.filter((row) => assignmentIsActive(row.state));
        if (
          active.length >= workflow.limits.maxConcurrent ||
          workflow.assignments.reduce((count, row) => count + row.attempts.length, 0) >=
            workflow.limits.maxAttempts ||
          (role.role.kind === "reviewer" &&
            workflow.artifacts.filter(
              (artifact) => artifact.kind === "review" && artifact.validation === "verified",
            ).length >=
              workflow.limits.maxReviewRounds + 1)
        )
          return yield* new AgentWorkflowError({ reason: "limit" });
        const writer = role.role.kind === "builder" || role.role.kind === "debugger";
        if (
          new Set(input.criteria.map((row) => row.id)).size !== input.criteria.length ||
          input.criteria.some((row) => !row.text.trim()) ||
          ((writer || role.role.kind === "reviewer" || role.role.kind === "planner") &&
            input.criteria.length === 0) ||
          ((writer || role.role.kind === "reviewer") &&
            input.criteria.some(
              (criterion) =>
                !workflow.criteria.some(
                  (row) => row.id === criterion.id && row.text === criterion.text,
                ),
            )) ||
          (role.role.kind === "reviewer" &&
            workflow.criteria.some(
              (criterion) =>
                !input.criteria.some(
                  (row) => row.id === criterion.id && row.text === criterion.text,
                ),
            ))
        )
          return yield* new AgentWorkflowError({
            reason: "evidence",
            detail:
              "Assignments need nonempty criteria with unique IDs and text. Implementation criteria must come from the frozen workflow; the final Reviewer must cover every workflow criterion.",
          });
        if (
          (writer &&
            active.some((row) => row.writeResponsibility || row.role.role.kind === "reviewer")) ||
          (role.role.kind === "reviewer" && active.some((row) => row.writeResponsibility))
        )
          return yield* new AgentWorkflowError({ reason: "writer_busy" });
        if (
          input.dependencies.some(
            (id) => !workflow.assignments.some((row) => row.id === id && row.state === "accepted"),
          ) ||
          input.inputArtifactIds.some(
            (id) =>
              !workflow.artifacts.some((row) => row.id === id && row.validation === "verified"),
          )
        )
          return yield* new AgentWorkflowError({ reason: "dependency" });
        if (
          writer &&
          !workflow.assignments.some(
            (row) => row.role.role.kind === "planner" && row.state === "accepted",
          )
        )
          return yield* new AgentWorkflowError({ reason: "dependency" });
        const implementation = latestImplementation(workflow);
        if (
          role.role.kind === "reviewer" &&
          (!implementation || !input.inputArtifactIds.includes(implementation.id))
        )
          return yield* new AgentWorkflowError({ reason: "dependency" });
        if (old && old.state !== "needs_changes" && old.state !== "failed" && old.state !== "ready")
          return yield* new AgentWorkflowError({ reason: "conflict" });
        const assignment: AgentAssignment = {
          id: input.assignmentId,
          compiledBrief: old?.compiledBrief ?? compiledBrief ?? role.role.instructions,
          generation: workflow.generation,
          role,
          objective: input.objective,
          criteria: input.criteria,
          inputArtifactIds: input.inputArtifactIds,
          requiredChecks: workflow.requiredChecks,
          dependencies: input.dependencies,
          state: "dispatching",
          writeResponsibility: writer,
          workspacePath: workflow.workspacePath,
          baseRef: role.role.kind === "reviewer" ? implementation!.headRef : workflow.baseRef,
          checkpoint: null,
          attempts: [
            ...(old?.attempts ?? []),
            {
              id: `attempt-${hash.slice(0, 32)}`,
              ordinal: old?.attempts.length ?? 0,
              commandId,
              parentRunId: actor.runId,
              taskId: null,
              childThreadId: null,
              createdAt: now,
            },
          ],
          artifactIds: old?.artifactIds ?? [],
        };
        const action = {
          ...intent("assignment", input.requestId, hash, workflow, commandId, assignment.id, now),
          targetAttemptId: assignment.attempts.at(-1)!.id,
        };
        const changed = replaceWorkflow(
          state,
          {
            ...workflow,
            assignments: old
              ? workflow.assignments.map((row) => (row.id === assignment.id ? assignment : row))
              : [...workflow.assignments, assignment],
            intents: [...workflow.intents, action],
          },
          now,
        );
        return {
          state: changed.state,
          result: { workflow: changed.workflow, assignment, intent: action, replayed: false },
        };
      }),
    );
  });

  const acceptAssignment: AgentWorkflowService["Service"]["acceptAssignment"] = Effect.fn(
    "AgentWorkflowService.acceptAssignment",
  )(function* (input) {
    const now = yield* Clock.currentTimeMillis;
    return yield* store.update(input.projectId, (state) =>
      Effect.gen(function* () {
        const workflow = yield* lookup(state, input.workflowId);
        const action = workflow.intents.find(
          (row) =>
            row.id === input.intentId &&
            row.operation === "assignment" &&
            row.entityId === input.assignmentId,
        );
        const assignment = workflow.assignments.find((row) => row.id === input.assignmentId);
        if (!action || !assignment) return yield* new AgentWorkflowError({ reason: "not_found" });
        if (action.generation !== workflow.generation || workflow.status === "cancelled")
          return yield* new AgentWorkflowError({ reason: "stale" });
        const previous = assignment.attempts.at(-1);
        if (action.targetAttemptId && previous?.id !== action.targetAttemptId)
          return yield* new AgentWorkflowError({ reason: "stale" });
        if (!previous || previous.parentRunId !== input.parentRunId)
          return yield* new AgentWorkflowError({ reason: "stale" });
        if (
          previous.taskId &&
          (previous.taskId !== input.taskId || previous.childThreadId !== input.childThreadId)
        )
          return yield* new AgentWorkflowError({ reason: "idempotency_conflict" });
        if (action.state === "accepted") return { state, result: workflow };
        const updated: AgentAssignment = {
          ...assignment,
          state: "awaiting_result",
          workspacePath: input.workspacePath ?? assignment.workspacePath,
          baseRef: input.baseRef ?? assignment.baseRef,
          attempts: assignment.attempts.map((row) =>
            row.id === previous.id
              ? { ...row, taskId: input.taskId, childThreadId: input.childThreadId }
              : row,
          ),
        };
        const changed = replaceWorkflow(
          state,
          {
            ...workflow,
            assignments: workflow.assignments.map((row) => (row.id === updated.id ? updated : row)),
            participants: [
              ...workflow.participants.filter((row) => row.threadId !== input.childThreadId),
              {
                id: previous.id,
                threadId: input.childThreadId,
                roleId: assignment.role.role.id,
                assignmentId: assignment.id,
              },
            ],
            intents: workflow.intents.map((row) =>
              row.id === action.id ? { ...row, state: "accepted" } : row,
            ),
          },
          now,
        );
        return { state: changed.state, result: changed.workflow };
      }),
    );
  });

  const result: AgentWorkflowService["Service"]["result"] = Effect.fn(
    "AgentWorkflowService.result",
  )(function* ({ input, actor, contentHash, verified, verifiedRequiredChecks }) {
    const hash = yield* fingerprint("result", input);
    const now = yield* Clock.currentTimeMillis;
    return yield* store.update(input.projectId, (state) =>
      Effect.gen(function* () {
        const workflow = yield* lookup(state, input.workflowId);
        const assignment = workflow.assignments.find((row) => row.id === input.assignmentId);
        if (!assignment) return yield* new AgentWorkflowError({ reason: "not_found" });
        const attempt = assignment.attempts.at(-1);
        if (actor.type !== "agent" || attempt?.childThreadId !== actor.threadId)
          return yield* new AgentWorkflowError({ reason: "forbidden" });
        const previous = yield* replay(workflow, input.requestId, hash);
        if (previous) return { state, result: workflow };
        if (
          input.generation !== workflow.generation ||
          assignment.generation !== input.generation ||
          workflow.status === "cancelled"
        )
          return yield* new AgentWorkflowError({ reason: "stale" });
        if (!assignmentIsActive(assignment.state))
          return yield* new AgentWorkflowError({ reason: "conflict" });
        const report = input.artifact;
        if (
          report.outcome !== "blocked" &&
          assignment.writeResponsibility &&
          assignment.checkpoint &&
          report.headRef !== assignment.checkpoint.commitSha
        )
          return yield* new AgentWorkflowError({
            reason: "evidence",
            detail: "The result must reference the captured assignment checkpoint.",
          });
        if (report.kind !== assignment.role.role.outputKind)
          return yield* new AgentWorkflowError({ reason: "evidence" });
        if (
          report.outcome === "accepted" &&
          workflow.messages.some(
            (row) =>
              row.senderThreadId === actor.threadId &&
              row.blocking &&
              row.questionState === "pending",
          )
        )
          return yield* new AgentWorkflowError({ reason: "dependency" });
        if (report.outcome === "accepted" && (!report.content.trim() || !report.summary.trim()))
          return yield* new AgentWorkflowError({ reason: "evidence" });
        if (
          (assignment.writeResponsibility || assignment.role.role.kind === "reviewer") &&
          report.outcome === "accepted"
        ) {
          if (
            verified &&
            assignment.requiredChecks.some((command) => !verifiedRequiredChecks?.includes(command))
          )
            return yield* new AgentWorkflowError({
              reason: "evidence",
              detail: "A configured required check has no verified execution evidence.",
            });
          if (
            !report.headRef ||
            (assignment.requiredChecks.length === 0 &&
              !report.checks.some((row) => row.required && row.status === "passed")) ||
            report.checks.some(
              (row) =>
                row.required &&
                (row.status !== "passed" ||
                  row.revision !== report.headRef ||
                  !row.evidence.trim()),
            ) ||
            assignment.criteria.some(
              (criterion) =>
                !report.criteria.some(
                  (row) => row.id === criterion.id && row.passed && row.evidence.length > 0,
                ),
            )
          )
            return yield* new AgentWorkflowError({ reason: "evidence" });
        }
        if (assignment.role.role.kind === "reviewer") {
          if (
            report.outcome === "accepted" &&
            (workflow.messages.some((row) => row.questionState === "pending") ||
              workflow.assignments.some(
                (row) =>
                  row.id !== assignment.id && row.state !== "accepted" && row.state !== "cancelled",
              ))
          )
            return yield* new AgentWorkflowError({
              reason: "dependency",
              detail:
                "Resolve outstanding assignments and questions before completing the workflow.",
            });
          const implementation = latestImplementation(workflow);
          if (
            report.outcome !== "blocked" &&
            (!implementation ||
              report.reviewedHead !== implementation.headRef ||
              report.headRef !== implementation.headRef)
          )
            return yield* new AgentWorkflowError({ reason: "review_stale" });
          if (
            report.outcome === "accepted" &&
            report.findings.some((row) => row.severity !== "suggestion")
          )
            return yield* new AgentWorkflowError({ reason: "evidence" });
        }
        const artifact: AgentArtifact = {
          ...report,
          id: `artifact-${hash.slice(0, 32)}`,
          version: assignment.artifactIds.length + 1,
          assignmentId: assignment.id,
          producerThreadId: actor.threadId,
          producerRunId: actor.runId,
          contentHash,
          validation: verified && report.outcome !== "blocked" ? "verified" : "unverified",
          createdAt: now,
        };
        const nextState =
          report.outcome === "blocked"
            ? "awaiting_user"
            : !verified
              ? "validating"
              : report.outcome === "accepted"
                ? "accepted"
                : "needs_changes";
        const reviewRounds =
          workflow.artifacts.filter((row) => row.kind === "review" && row.validation === "verified")
            .length + (artifact.kind === "review" && artifact.validation === "verified" ? 1 : 0);
        const completed =
          assignment.role.role.kind === "reviewer" &&
          verified &&
          report.outcome === "accepted" &&
          reviewRounds <= workflow.limits.maxReviewRounds + 1;
        const changed = replaceWorkflow(
          state,
          {
            ...workflow,
            criteria:
              assignment.role.role.kind === "planner" &&
              verified &&
              report.outcome === "accepted" &&
              workflow.criteria.length === 0
                ? assignment.criteria
                : workflow.criteria,
            status:
              reviewRounds > workflow.limits.maxReviewRounds + 1
                ? "failed"
                : completed
                  ? "completed"
                  : workflow.status,
            assignments: workflow.assignments.map((row) =>
              row.id === assignment.id
                ? { ...row, state: nextState, artifactIds: [...row.artifactIds, artifact.id] }
                : assignment.role.role.kind === "reviewer" &&
                    verified &&
                    report.outcome === "needs_changes" &&
                    row.state === "accepted" &&
                    row.writeResponsibility
                  ? { ...row, state: "needs_changes" }
                  : row,
            ),
            artifacts: [...workflow.artifacts, artifact],
            intents: [
              ...workflow.intents.map((row) =>
                completed &&
                row.operation === "message" &&
                row.state === "pending" &&
                workflow.messages.find((message) => message.id === row.entityId)?.kind !==
                  "question"
                  ? { ...row, state: "cancelled" as const }
                  : row,
              ),
              {
                ...intent(
                  "result",
                  input.requestId,
                  hash,
                  workflow,
                  attempt!.commandId,
                  artifact.id,
                  now,
                ),
                state: "accepted",
              },
            ],
          },
          now,
        );
        return { state: changed.state, result: changed.workflow };
      }),
    );
  });

  const message: AgentWorkflowService["Service"]["message"] = Effect.fn(
    "AgentWorkflowService.message",
  )(function* ({ input, actor, commandId, messageId }) {
    const senderThreadId = actor.type === "agent" ? actor.threadId : null;
    const hash = yield* fingerprint("message", { input, origin: actor.type, senderThreadId });
    const now = yield* Clock.currentTimeMillis;
    return yield* store.update(input.projectId, (state) =>
      Effect.gen(function* () {
        const workflow = yield* lookup(state, input.workflowId);
        if (!participant(workflow, actor))
          return yield* new AgentWorkflowError({ reason: "forbidden" });
        const previous = yield* replay(workflow, input.requestId, hash);
        if (previous) {
          const priorMessage = workflow.messages.find((row) => row.id === previous.entityId);
          if (!priorMessage) return yield* new AgentWorkflowError({ reason: "invalid" });
          return {
            state,
            result: { workflow, message: priorMessage, intent: previous, replayed: true },
          };
        }
        if (
          input.generation !== workflow.generation ||
          workflow.status === "cancelled" ||
          workflow.status === "completed"
        )
          return yield* new AgentWorkflowError({ reason: "stale" });
        if (!currentThread(workflow, input.toThreadId))
          return yield* new AgentWorkflowError({ reason: "forbidden" });
        if (workflow.messages.length >= workflow.limits.maxMessages)
          return yield* new AgentWorkflowError({ reason: "limit" });
        if (
          (input.assignmentId &&
            !workflow.assignments.some((row) => row.id === input.assignmentId)) ||
          input.artifactIds.some((id) => !workflow.artifacts.some((row) => row.id === id))
        )
          return yield* new AgentWorkflowError({ reason: "not_found" });
        if (
          (input.kind === "answer") !== (input.replyTo !== null) ||
          (input.blocking && input.kind !== "question")
        )
          return yield* new AgentWorkflowError({ reason: "invalid" });
        const question = input.replyTo
          ? workflow.messages.find((row) => row.id === input.replyTo)
          : undefined;
        if (
          input.kind === "answer" &&
          (!question ||
            question.kind !== "question" ||
            question.questionState !== "pending" ||
            question.generation !== workflow.generation ||
            (question.expiresAt !== null && question.expiresAt <= now) ||
            question.senderThreadId !== input.toThreadId ||
            (actor.type === "agent" && question.recipientThreadId !== actor.threadId))
        )
          return yield* new AgentWorkflowError({ reason: "forbidden" });
        if (
          input.kind === "question" &&
          input.blocking &&
          senderThreadId &&
          blockingQuestionCycle(workflow.messages, senderThreadId, input.toThreadId)
        )
          return yield* new AgentWorkflowError({ reason: "question_cycle" });
        const id = `message-${hash.slice(0, 32)}`;
        const relatedAssignment = workflow.assignments.find((row) => row.id === input.assignmentId);
        const revisionRef =
          relatedAssignment?.checkpoint?.commitSha ??
          relatedAssignment?.baseRef ??
          workflow.baseRef;
        const last = workflow.messages.at(-1);
        const sameGroup =
          actor.type === "agent" &&
          input.kind === "update" &&
          last?.kind === "update" &&
          last.origin === "agent" &&
          last.delivery !== "failed" &&
          last.generation === workflow.generation &&
          last.senderThreadId === senderThreadId &&
          last.recipientThreadId === input.toThreadId &&
          last.assignmentId === input.assignmentId &&
          last.replyTo === input.replyTo &&
          last.revisionRef === revisionRef &&
          canonical([...last.artifactIds].sort()) === canonical([...input.artifactIds].sort());
        const message: AgentTeamMessage = {
          id,
          groupId: sameGroup ? (last.groupId ?? last.id) : id,
          revisionRef,
          generation: workflow.generation,
          origin: actor.type,
          senderThreadId,
          recipientThreadId: input.toThreadId,
          assignmentId: input.assignmentId,
          kind: input.kind,
          summary:
            input.summary.trim() ||
            (input.kind === "question" ? "An agent has a question." : "An agent sent an update."),
          text: input.text,
          artifactIds: input.artifactIds,
          replyTo: input.replyTo,
          blocking: input.blocking,
          delivery: "persisted",
          questionState: input.kind === "question" ? "pending" : null,
          createdAt: now,
          expiresAt: input.kind === "question" ? now + workflow.limits.questionTimeoutMs : null,
          commandId,
          messageId,
        };
        const action = intent(
          "message",
          input.requestId,
          hash,
          workflow,
          commandId,
          message.id,
          now,
        );
        const changed = replaceWorkflow(
          state,
          {
            ...workflow,
            messages: [
              ...workflow.messages.map((row) =>
                row.id === question?.id
                  ? {
                      ...row,
                      questionState: "answered" as const,
                      ...(actor.type === "agent" ? { delivery: "acknowledged" as const } : {}),
                    }
                  : row,
              ),
              message,
            ],
            assignments: workflow.assignments.map((row) => {
              const ownsSender =
                senderThreadId && row.attempts.at(-1)?.childThreadId === senderThreadId;
              const answeredSender =
                question?.senderThreadId &&
                row.attempts.at(-1)?.childThreadId === question.senderThreadId;
              return input.kind === "question" &&
                input.blocking &&
                ownsSender &&
                assignmentIsActive(row.state)
                ? { ...row, state: "awaiting_peer" }
                : input.kind === "answer" &&
                    answeredSender &&
                    row.state === "awaiting_peer" &&
                    !workflow.messages.some(
                      (pending) =>
                        pending.id !== question?.id &&
                        pending.senderThreadId === question?.senderThreadId &&
                        pending.blocking &&
                        pending.questionState === "pending",
                    )
                  ? { ...row, state: "awaiting_result" }
                  : row;
            }),
            intents: [
              ...workflow.intents.map((row) =>
                row.operation === "message" &&
                row.entityId === question?.id &&
                row.state !== "accepted"
                  ? {
                      ...row,
                      state:
                        actor.type === "agent" ? ("accepted" as const) : ("cancelled" as const),
                    }
                  : row,
              ),
              action,
            ],
          },
          now,
        );
        return {
          state: changed.state,
          result: { workflow: changed.workflow, message, intent: action, replayed: false },
        };
      }),
    );
  });

  const delivery: AgentWorkflowService["Service"]["delivery"] = Effect.fn(
    "AgentWorkflowService.delivery",
  )(function* (input) {
    const now = yield* Clock.currentTimeMillis;
    return yield* store.update(input.projectId, (state) =>
      Effect.gen(function* () {
        const workflow = yield* lookup(state, input.workflowId);
        const message = workflow.messages.find((row) => row.id === input.messageId);
        if (!message) return yield* new AgentWorkflowError({ reason: "not_found" });
        if (message.generation !== workflow.generation || workflow.status === "cancelled")
          return yield* new AgentWorkflowError({ reason: "stale" });
        const delivery =
          message.delivery === "acknowledged" ||
          (message.delivery === "submitted" && input.delivery === "queued")
            ? message.delivery
            : input.delivery;
        const targetState =
          delivery === "failed" ? "failed" : delivery === "queued" ? "pending" : "accepted";
        const continuation = workflow.assignments.some(
          (row) =>
            input.taskId &&
            input.childThreadId &&
            input.parentRunId &&
            row.generation === workflow.generation &&
            row.state !== "cancelled" &&
            row.state !== "ready" &&
            row.state !== "failed" &&
            row.attempts.at(-1)?.childThreadId === input.childThreadId &&
            !row.attempts.some((attempt) => attempt.taskId === input.taskId),
        );
        if (
          delivery === message.delivery &&
          !continuation &&
          workflow.intents.every(
            (row) =>
              row.operation !== "message" ||
              row.entityId !== message.id ||
              row.state === "accepted" ||
              row.state === targetState,
          )
        )
          return { state, result: workflow };
        const changed = replaceWorkflow(
          state,
          {
            ...workflow,
            messages: workflow.messages.map((row) =>
              row.id === message.id ? { ...row, delivery } : row,
            ),
            intents: workflow.intents.map((row) =>
              row.operation === "message" && row.entityId === message.id
                ? {
                    ...row,
                    state: row.state === "accepted" ? "accepted" : targetState,
                  }
                : row,
            ),
            assignments: workflow.assignments.map((row) =>
              input.taskId &&
              input.childThreadId &&
              input.parentRunId &&
              row.generation === workflow.generation &&
              row.state !== "cancelled" &&
              row.state !== "ready" &&
              row.state !== "failed" &&
              row.attempts.at(-1)?.childThreadId === input.childThreadId &&
              !row.attempts.some((attempt) => attempt.taskId === input.taskId)
                ? {
                    ...row,
                    attempts: [
                      ...row.attempts,
                      {
                        id: `continuation-${message.id}`,
                        ordinal: row.attempts.length,
                        commandId: message.commandId,
                        parentRunId: input.parentRunId,
                        taskId: input.taskId,
                        childThreadId: input.childThreadId,
                        createdAt: now,
                      },
                    ],
                  }
                : row,
            ),
          },
          now,
        );
        return { state: changed.state, result: changed.workflow };
      }),
    );
  });

  const ack: AgentWorkflowService["Service"]["ack"] = Effect.fn("AgentWorkflowService.ack")(
    function* ({ input, actor }) {
      const hash = yield* fingerprint("ack", { input, actor });
      const now = yield* Clock.currentTimeMillis;
      return yield* store.update(input.projectId, (state) =>
        Effect.gen(function* () {
          const workflow = yield* lookup(state, input.workflowId);
          const message = workflow.messages.find((row) => row.id === input.messageId);
          if (!message) return yield* new AgentWorkflowError({ reason: "not_found" });
          if (
            actor.type !== "agent" ||
            !participant(workflow, actor) ||
            actor.threadId !== message.recipientThreadId
          )
            return yield* new AgentWorkflowError({ reason: "forbidden" });
          if (yield* replay(workflow, input.requestId, hash)) return { state, result: workflow };
          if (input.generation !== workflow.generation || message.generation !== input.generation)
            return yield* new AgentWorkflowError({ reason: "stale" });
          const changed = replaceWorkflow(
            state,
            {
              ...workflow,
              messages: workflow.messages.map((row) =>
                row.id === message.id ? { ...row, delivery: "acknowledged" } : row,
              ),
              intents: [
                ...workflow.intents.map((row) =>
                  row.operation === "message" && row.entityId === message.id
                    ? { ...row, state: "accepted" as const }
                    : row,
                ),
                {
                  ...intent(
                    "ack",
                    input.requestId,
                    hash,
                    workflow,
                    message.commandId,
                    message.id,
                    now,
                  ),
                  state: "accepted",
                },
              ],
            },
            now,
          );
          return { state: changed.state, result: changed.workflow };
        }),
      );
    },
  );
  const control: AgentWorkflowService["Service"]["control"] = Effect.fn(
    "AgentWorkflowService.control",
  )(function* ({ input, actor }) {
    const hash = yield* fingerprint("control", {
      input,
      actor: actor.type === "agent" ? actor.threadId : actor.type,
    });
    const now = yield* Clock.currentTimeMillis;
    return yield* store.update(input.projectId, (state) =>
      Effect.gen(function* () {
        const workflow = yield* lookup(state, input.workflowId);
        if (actor.type !== "user" && actor.type !== "system" && !manager(workflow, actor))
          return yield* new AgentWorkflowError({ reason: "forbidden" });
        if (input.limits && actor.type !== "user")
          return yield* new AgentWorkflowError({ reason: "forbidden" });
        if (yield* replay(workflow, input.requestId, hash)) return { state, result: workflow };
        const action = input.action;
        if (action === "cancel" && workflow.status === "cancelled")
          return { state, result: workflow };
        if (
          (action === "resume" &&
            workflow.status !== "paused" &&
            workflow.status !== "waiting_user") ||
          (action === "retry" && workflow.status !== "failed") ||
          (action === "pause" &&
            workflow.status !== "running" &&
            workflow.status !== "waiting_user") ||
          (action === "cancel" &&
            (workflow.status === "completed" || workflow.status === "cancelled"))
        )
          return yield* new AgentWorkflowError({ reason: "conflict" });
        const generation =
          action === "cancel" || action === "retry" ? workflow.generation + 1 : workflow.generation;
        const nextStatus =
          action === "cancel" ? "cancelled" : action === "pause" ? "paused" : "running";
        const commandId = workflow.intents[0]!.commandId;
        const changed = replaceWorkflow(
          state,
          {
            ...workflow,
            status: nextStatus,
            generation,
            limits: input.limits ?? workflow.limits,
            assignments:
              action === "cancel" || action === "retry"
                ? workflow.assignments.map((row) =>
                    assignmentIsActive(row.state) ? { ...row, state: "cancelled" } : row,
                  )
                : workflow.assignments,
            messages:
              action === "cancel" || action === "retry"
                ? workflow.messages.map((row) =>
                    row.questionState === "pending" ? { ...row, questionState: "cancelled" } : row,
                  )
                : workflow.messages,
            intents: [
              ...workflow.intents.map((row) =>
                action === "retry" && row.operation === "launch" && row.state !== "accepted"
                  ? { ...row, state: "pending" as const, generation }
                  : (action === "cancel" || action === "retry") && row.state === "pending"
                    ? { ...row, state: "cancelled" as const }
                    : row,
              ),
              {
                ...intent("control", input.requestId, hash, workflow, commandId, workflow.id, now),
                state: "accepted",
              },
            ],
          },
          now,
        );
        return { state: changed.state, result: changed.workflow };
      }),
    );
  });
  const expireQuestions: AgentWorkflowService["Service"]["expireQuestions"] = Effect.fn(
    "AgentWorkflowService.expireQuestions",
  )(function* (input) {
    const now = yield* Clock.currentTimeMillis;
    return yield* store.update(input.projectId, (state) =>
      Effect.gen(function* () {
        const workflow = yield* lookup(state, input.workflowId);
        if (workflow.status === "cancelled" || workflow.status === "completed")
          return { state, result: workflow };
        if (
          !workflow.messages.some(
            (row) =>
              row.questionState === "pending" && row.expiresAt !== null && row.expiresAt <= now,
          )
        )
          return { state, result: workflow };
        const expiredSenders = new Set(
          workflow.messages
            .filter(
              (row) =>
                row.questionState === "pending" && row.expiresAt !== null && row.expiresAt <= now,
            )
            .map((row) => row.senderThreadId),
        );
        const changed = replaceWorkflow(
          state,
          {
            ...workflow,
            status: workflow.status === "running" ? "waiting_user" : workflow.status,
            messages: workflow.messages.map((row) =>
              row.questionState === "pending" && row.expiresAt !== null && row.expiresAt <= now
                ? { ...row, questionState: "expired" }
                : row,
            ),
            assignments: workflow.assignments.map((row) =>
              row.state === "awaiting_peer" &&
              expiredSenders.has(row.attempts.at(-1)?.childThreadId ?? null)
                ? { ...row, state: "awaiting_user" }
                : row,
            ),
          },
          now,
        );
        return { state: changed.state, result: changed.workflow };
      }),
    );
  });
  return AgentWorkflowService.of({
    roles,
    saveRole,
    settings,
    list,
    read,
    create,
    acceptLaunch,
    failIntent,
    prepareAssignment,
    controlAssignment,
    recordCheckpoint,
    acceptAssignment,
    result,
    message,
    delivery,
    ack,
    control,
    expireQuestions,
  });
});

export const layer = Layer.effect(AgentWorkflowService, make);
