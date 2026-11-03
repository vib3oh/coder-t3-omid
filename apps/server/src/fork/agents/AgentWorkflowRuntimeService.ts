import {
  AgentWorkflowError,
  CommandId,
  MessageId,
  ThreadId,
  CheckpointRef,
  type AgentRolePreviewInput,
  type AgentRolePreviewResult,
  type AgentRoleSnapshot,
  type AgentRolePreset,
  type AgentWorkflowContentResult,
  type AgentWorkflow,
  type AgentWorkflowView,
  type AgentWorkflowReadPageInput,
  type AgentWorkflowContentInput,
  type AgentWorkflowStartInput,
  type AgentWorkflowControlInput,
  type AgentAssignmentStartInput,
  type AgentAssignmentResultInput,
  type AgentTeamMessageInput,
  type AgentTeamAckInput,
  type ProjectId,
  type AgentAssignmentControlInput,
} from "@t3tools/contracts";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as Scope from "effect/Scope";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/http";
import * as ProjectService from "../../project/ProjectService.ts";
import * as ProviderRegistry from "../../provider/ProviderRegistry.ts";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import * as ThreadLaunchService from "../../orchestration-v2/ThreadLaunchService.ts";
import * as OrchestrationEventStore from "../../persistence/OrchestrationEventStore.ts";
import * as GitVcsDriver from "../../vcs/GitVcsDriver.ts";
import * as CheckpointStore from "../../checkpointing/CheckpointStore.ts";
import * as WorkspaceFileSystem from "../../workspace/WorkspaceFileSystem.ts";
import * as RoadmapService from "../../roadmap/RoadmapService.ts";
import * as OrchestratorMcpService from "../../mcp/OrchestratorMcpService.ts";
import { requireThreadScope, type McpInvocationScope } from "../../mcp/McpInvocationContext.ts";
import { resolveRuntimeMode, resolveInteractionMode } from "../../mcp/delegatedTaskModes.ts";
import * as BuiltinSkillService from "../skills/BuiltinSkillService.ts";
import * as AgentWorkflowService from "./AgentWorkflowService.ts";
import * as AgentWorkflowStore from "./AgentWorkflowStore.ts";
import * as WorkflowEvidence from "./WorkflowEvidence.ts";
import { workflowSummary } from "./WorkflowRules.ts";
import { assignmentInstructions, managerInstructions } from "./runtimeInstructions.ts";
import { workflowView } from "./workflowView.ts";
import { withWorkflowDispatchPermit } from "./AgentWorkflowDispatchGuard.ts";
import { workflowCheckInstructions } from "./checkCommands.ts";

type Failure = AgentWorkflowError;
type Core = AgentWorkflowService.AgentWorkflowService["Service"];
type Actor = AgentWorkflowService.AgentWorkflowActor;

export class AgentWorkflowRuntimeService extends Context.Service<
  AgentWorkflowRuntimeService,
  {
    readonly roles: Core["roles"];
    readonly saveRole: Core["saveRole"];
    readonly settings: Core["settings"];
    readonly list: Core["list"];
    readonly skills: () => Effect.Effect<{
      skills: ReturnType<typeof BuiltinSkillService.listBuiltinSkills>;
    }>;
    readonly previewRole: (
      input: AgentRolePreviewInput,
    ) => Effect.Effect<typeof AgentRolePreviewResult.Type, Failure>;
    readonly read: (
      input: AgentWorkflowReadPageInput,
      scope?: McpInvocationScope,
    ) => Effect.Effect<AgentWorkflowView, Failure>;
    readonly content: (
      input: AgentWorkflowContentInput,
      scope?: McpInvocationScope,
    ) => Effect.Effect<typeof AgentWorkflowContentResult.Type, Failure>;
    readonly start: (input: AgentWorkflowStartInput) => Effect.Effect<AgentWorkflowView, Failure>;
    readonly control: (
      input: AgentWorkflowControlInput,
      scope?: McpInvocationScope,
    ) => Effect.Effect<AgentWorkflowView, Failure>;
    readonly controlAssignment: (
      input: AgentAssignmentControlInput,
      scope?: McpInvocationScope,
    ) => Effect.Effect<AgentWorkflowView, Failure>;
    readonly checks: (
      input: { projectId: ProjectId; workflowId: string; assignmentId: string },
      scope: McpInvocationScope,
    ) => Effect.Effect<
      {
        commands: ReadonlyArray<{
          id: string;
          input: string;
          status: string;
          exitCode: number | null;
        }>;
      },
      Failure
    >;
    readonly startAssignment: (
      input: AgentAssignmentStartInput,
      scope: McpInvocationScope,
    ) => Effect.Effect<
      { assignmentId: string; taskId: string | null; childThreadId: ThreadId | null; next: string },
      Failure,
      OrchestratorMcpService.OrchestratorMcpService
    >;
    readonly result: (
      input: AgentAssignmentResultInput,
      scope: McpInvocationScope,
    ) => Effect.Effect<AgentWorkflowView, Failure>;
    readonly message: (
      input: AgentTeamMessageInput,
      scope?: McpInvocationScope,
    ) => Effect.Effect<AgentWorkflowView, Failure>;
    readonly ack: (
      input: AgentTeamAckInput,
      scope: McpInvocationScope,
    ) => Effect.Effect<AgentWorkflowView, Failure>;
    readonly snapshot: (
      input: { projectId: ProjectId; workflowId: string; assignmentId: string; requestId: string },
      scope: McpInvocationScope,
    ) => Effect.Effect<{ ref: string; commitSha: string; checkInstructions: string }, Failure>;
    readonly reconcile: Effect.Effect<void, Failure>;
    readonly startRecovery: Effect.Effect<void, never, Scope.Scope>;
  }
>()("t3/fork/agents/AgentWorkflowRuntimeService") {}

const invalid = (detail: string) => new AgentWorkflowError({ reason: "invalid", detail });
const failure = (cause: unknown) => new AgentWorkflowError({ reason: "storage", cause });
const mapFailure = Effect.mapError(failure);
const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const make = Effect.gen(function* () {
  const core = yield* AgentWorkflowService.AgentWorkflowService;
  const store = yield* AgentWorkflowStore.AgentWorkflowStore;
  const projects = yield* ProjectService.ProjectService;
  const providers = yield* ProviderRegistry.ProviderRegistry;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const launch = yield* ThreadLaunchService.ThreadLaunchService;
  const events = yield* OrchestrationEventStore.OrchestrationEventStore;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const checkpoints = yield* CheckpointStore.CheckpointStore;
  const files = yield* WorkspaceFileSystem.WorkspaceFileSystem;
  const roadmap = yield* RoadmapService.RoadmapService;
  const skills = yield* BuiltinSkillService.BuiltinSkillService;
  const evidence = yield* WorkflowEvidence.WorkflowEvidence;
  const crypto = yield* Crypto.Crypto;
  const http = yield* Effect.serviceOption(HttpClient.HttpClient);
  const wake = yield* Queue.sliding<void>(1);
  const locks = yield* KeyedLock.make<string>();

  const hash = Effect.fn("AgentWorkflowRuntime.hash")(function* (text: string) {
    return Hex.encode(
      yield* crypto.digest("SHA-256", new TextEncoder().encode(text)).pipe(Effect.orDie),
    );
  });
  const project = Effect.fn("AgentWorkflowRuntime.project")(function* (id: ProjectId) {
    const found = yield* projects.getById(id).pipe(mapFailure);
    if (Option.isNone(found)) return yield* new AgentWorkflowError({ reason: "not_found" });
    return found.value;
  });
  const actor = Effect.fn("AgentWorkflowRuntime.actor")(function* (
    scope: McpInvocationScope,
  ): Effect.fn.Return<Extract<Actor, { type: "agent" }>, Failure> {
    if (!scope.capabilities.has("orchestration"))
      return yield* new AgentWorkflowError({
        reason: "forbidden",
        detail: "This credential cannot access agent orchestration.",
      });
    const caller = yield* requireThreadScope(scope, "agent workflows").pipe(mapFailure);
    const records = yield* threads
      .getThreadRecords(caller.thread.threadId, ["runs"])
      .pipe(mapFailure);
    const active = records.runs
      .filter(ThreadManagementService.isActiveRun)
      .toReversed()
      .find((run) => run.providerInstanceId === caller.thread.providerInstanceId);
    if (!active)
      return yield* new AgentWorkflowError({
        reason: "forbidden",
        detail: "This operation requires the calling agent's active native run.",
      });
    return { type: "agent", threadId: caller.thread.threadId, runId: active.id };
  });
  const authorizeRead = Effect.fn("AgentWorkflowRuntime.authorizeRead")(function* (
    workflow: AgentWorkflow,
    scope: McpInvocationScope,
  ) {
    if (!scope.capabilities.has("orchestration"))
      return yield* new AgentWorkflowError({
        reason: "forbidden",
        detail: "This credential cannot access agent orchestration.",
      });
    const caller = yield* requireThreadScope(scope, "agent workflows").pipe(mapFailure);
    if (!workflow.participants.some((p) => p.threadId === caller.thread.threadId))
      return yield* new AgentWorkflowError({ reason: "forbidden" });
  });
  const compile = Effect.fn("AgentWorkflowRuntime.compile")(function* (
    projectId: ProjectId,
    role: AgentRolePreset,
    selection: AgentWorkflow["modelSelection"],
    cwd?: string,
  ) {
    const ownedProject = yield* project(projectId);
    const workspace = cwd ?? ownedProject.workspaceRoot;
    const catalog = yield* providers.refreshWorkspaceSnapshot({
      instanceId: selection.instanceId,
      cwd: workspace,
    });
    const provider = catalog.find((p) => p.instanceId === selection.instanceId);
    if (
      !provider ||
      !provider.enabled ||
      !provider.installed ||
      provider.availability === "unavailable" ||
      !provider.models.some((m) => m.slug === selection.model)
    )
      return yield* invalid(
        "The selected provider/model is unavailable. Select an available model; no replacement was made.",
      );
    const nativeSkills =
      provider.workspaceSnapshots?.find((s) => s.cwd === workspace)?.skills ?? provider.skills;
    return yield* skills
      .compileRole({
        role,
        modelSelection: selection,
        provider: provider.driver,
        nativeSkills,
        capabilities: ["filesystem", "git", "shell", "t3.threads"],
        delivery: "native",
        invocation: "agent",
      })
      .pipe(mapFailure);
  });
  const previewRole = Effect.fn("AgentWorkflowRuntime.previewRole")(function* (
    input: AgentRolePreviewInput,
  ) {
    const roles = yield* core.roles(input);
    const role = roles.roles.find((r) => r.id === input.roleId);
    if (!role) return yield* new AgentWorkflowError({ reason: "not_found" });
    const compiled = yield* compile(
      input.projectId,
      role,
      role.modelSelection ?? input.modelSelection,
    );
    return { snapshot: compiled.snapshot, ready: compiled.ready, issues: compiled.issues };
  });
  const humanInputs = Effect.fn("AgentWorkflowRuntime.humanInputs")(function* (
    workflow: AgentWorkflow,
  ) {
    if (workflow.status === "completed" || workflow.status === "cancelled") return [];
    const pending: ThreadId[] = [];
    const currentThreads = workflow.assignments
      .filter((assignment) => assignment.generation === workflow.generation)
      .flatMap((assignment) => {
        const threadId = assignment.attempts.at(-1)?.childThreadId;
        return threadId ? [threadId] : [];
      });
    for (const threadId of new Set([workflow.managerThreadId, ...currentThreads])) {
      const shell = yield* threads.getThreadShell(threadId).pipe(mapFailure);
      if (shell?.pendingRuntimeRequest && shell.pendingRuntimeRequest.kind !== "dynamic_tool_call")
        pending.push(threadId);
    }
    return pending;
  });
  const list: Core["list"] = Effect.fn("AgentWorkflowRuntime.list")(function* (input) {
    const state = yield* store.read(input.projectId);
    const workflows = yield* Effect.forEach(state.workflows, (workflow) =>
      humanInputs(workflow).pipe(
        Effect.map((ids) => ({
          ...workflowSummary(workflow),
          humanInputPending: ids.length > 0,
          humanInputThreadIds: ids,
        })),
      ),
    );
    return { enabled: state.enabled, workflows };
  });
  const read = Effect.fn("AgentWorkflowRuntime.read")(function* (
    input: AgentWorkflowReadPageInput,
    scope?: McpInvocationScope,
  ) {
    yield* project(input.projectId);
    const workflow = yield* core.read(input);
    if (scope) yield* authorizeRead(workflow, scope);
    const humanInputThreadIds = yield* humanInputs(workflow);
    return {
      ...workflowView(workflow, input),
      humanInputPending: humanInputThreadIds.length > 0,
      humanInputThreadIds,
    };
  });
  const content = Effect.fn("AgentWorkflowRuntime.content")(function* (
    input: AgentWorkflowContentInput,
    scope?: McpInvocationScope,
  ) {
    yield* project(input.projectId);
    const workflow = yield* core.read(input);
    if (scope) yield* authorizeRead(workflow, scope);
    if (input.kind === "spec") {
      if (input.id !== workflow.id || !workflow.specSnapshot)
        return yield* new AgentWorkflowError({ reason: "not_found" });
      return { text: workflow.specSnapshot.content };
    }
    const item =
      input.kind === "message"
        ? workflow.messages.find((m) => m.id === input.id)
        : input.kind === "artifact"
          ? workflow.artifacts.find((a) => a.id === input.id)
          : workflow.assignments.find((a) => a.id === input.id);
    if (!item) return yield* new AgentWorkflowError({ reason: "not_found" });
    if (input.kind === "artifact" && "content" in item)
      return { text: item.content, artifact: item };
    return {
      text:
        input.kind === "message" && "text" in item
          ? item.text
          : input.kind === "artifact" && "content" in item
            ? item.content
            : yield* encodeJson(item).pipe(mapFailure),
    };
  });

  const wakeManager = Effect.fn("AgentWorkflowRuntime.wakeManager")(function* (
    workflow: AgentWorkflow,
    key: string,
    text: string,
  ) {
    if (
      workflow.status === "cancelled" ||
      workflow.status === "completed" ||
      workflow.status === "paused"
    )
      return;
    yield* threads
      .sendToThread({
        projectId: workflow.projectId,
        threadId: workflow.managerThreadId,
        commandId: CommandId.make(
          `agent-workflow:${workflow.id}:wake:${workflow.generation}:${key}`,
        ),
        messageId: MessageId.make(
          `agent-workflow:${workflow.id}:wake:${workflow.generation}:${key}`,
        ),
        text,
        attachments: [],
        mode: "queue",
        createdBy: "system",
        creationSource: "server",
      })
      .pipe(mapFailure);
  });
  const reserveCard = Effect.fn("AgentWorkflowRuntime.reserveCard")(function* (
    workflow: AgentWorkflow,
  ) {
    if (!workflow.cardId) return;
    const board = yield* roadmap.read({ projectId: workflow.projectId }).pipe(mapFailure);
    const card = board.cards.find((row) => row.id === workflow.cardId);
    if (!card)
      return yield* new AgentWorkflowError({
        reason: "conflict",
        detail: "The accepted roadmap card no longer exists.",
      });
    if (card.threadId === workflow.managerThreadId) return;
    if (board.revision !== workflow.cardRevision)
      return yield* new AgentWorkflowError({
        reason: "conflict",
        detail:
          "The card changed before its workflow reservation. Reconcile the saved card and start a new workflow.",
      });
    if (card.threadId) {
      const owner = yield* threads.getThreadShell(card.threadId).pipe(mapFailure);
      if (owner && owner.deletedAt === null)
        return yield* new AgentWorkflowError({
          reason: "conflict",
          detail: "Another thread owns this card. Its link was preserved.",
        });
    }
    yield* roadmap
      .save({
        projectId: workflow.projectId,
        expectedRevision: board.revision,
        cards: board.cards.map((row) =>
          row.id === workflow.cardId ? { ...row, threadId: workflow.managerThreadId } : row,
        ),
      })
      .pipe(mapFailure);
  });
  const bindManagerWorkspace = Effect.fn("AgentWorkflowRuntime.bindManagerWorkspace")(function* (
    workflow: AgentWorkflow,
  ) {
    const manager = yield* threads.getThreadShell(workflow.managerThreadId).pipe(mapFailure);
    if (!manager) return workflow;
    const records = yield* threads
      .getThreadRecords(workflow.managerThreadId, ["runs"])
      .pipe(mapFailure);
    const initialRun =
      records.runs.find((run) => run.userMessageId === `agent-workflow:${workflow.id}:initial`) ??
      records.runs.at(-1);
    if (initialRun?.status === "failed" || initialRun?.status === "cancelled")
      return yield* core.failIntent({
        projectId: workflow.projectId,
        workflowId: workflow.id,
        intentId: workflow.intents.find((intent) => intent.operation === "launch")!.id,
      });
    if (
      initialRun?.status === "preparing" ||
      initialRun?.status === "queued" ||
      (workflow.workspaceStrategy.type === "worktree" && !manager.worktreePath)
    )
      return workflow;
    const workspacePath =
      manager.worktreePath ??
      (workflow.workspaceStrategy.type === "existing_worktree"
        ? workflow.workspaceStrategy.worktreePath
        : (yield* project(workflow.projectId)).workspaceRoot);
    return yield* core.acceptLaunch({
      projectId: workflow.projectId,
      workflowId: workflow.id,
      workspacePath,
      baseRef: workflow.baseRef,
    });
  });
  const launchManager = Effect.fn("AgentWorkflowRuntime.launchManager")(function* (
    workflow: AgentWorkflow,
  ) {
    yield* reserveCard(workflow);
    const commandId = workflow.intents.find((i) => i.operation === "launch")!.commandId;
    const existing = yield* threads.getThreadShell(workflow.managerThreadId).pipe(mapFailure);
    if (existing) {
      const records = yield* threads
        .getThreadRecords(workflow.managerThreadId, ["messages", "runs"], {
          messageIds: [MessageId.make(`agent-workflow:${workflow.id}:initial`)],
        })
        .pipe(mapFailure);
      const initial = records.messages.find(
        (message) => message.id === `agent-workflow:${workflow.id}:initial`,
      );
      if (initial) return yield* bindManagerWorkspace(workflow);
    }
    yield* launch
      .launch({
        commandId,
        threadId: workflow.managerThreadId,
        reuseExistingThread: false,
        projectId: workflow.projectId,
        title: `Team: ${workflow.title}`,
        modelSelection: workflow.managerRole?.modelSelection ?? workflow.modelSelection,
        runtimeMode: workflow.runtimeMode,
        interactionMode: workflow.interactionMode,
        workspaceStrategy:
          workflow.workspaceStrategy.type === "worktree" && workflow.baseRef
            ? { ...workflow.workspaceStrategy, baseRef: workflow.baseRef }
            : workflow.workspaceStrategy,
        initialMessage: {
          messageId: MessageId.make(`agent-workflow:${workflow.id}:initial`),
          text: `${workflow.managerBrief}\n\n${managerInstructions(workflow)}`,
          attachments: [],
        },
        createdBy: "user",
        creationSource: "web",
      })
      .pipe(mapFailure);
    return yield* bindManagerWorkspace(workflow);
  });
  const start = Effect.fn("AgentWorkflowRuntime.start")(function* (input: AgentWorkflowStartInput) {
    const ownedProject = yield* project(input.projectId);
    const state = yield* store.read(input.projectId);
    const prior = state.workflows.find((w) =>
      w.intents.some((i) => i.operation === "launch" && i.requestId === input.requestId),
    );
    if (prior) {
      const replayed = yield* core.create({
        input,
        workflowId: prior.id,
        managerThreadId: prior.managerThreadId,
        commandId: prior.intents[0]!.commandId,
      });
      return workflowView(replayed.status === "draft" ? yield* launchManager(replayed) : replayed);
    }
    let sourceRoot: string | null = null;
    let sourceHead: string | null = null;
    if (input.sourceThreadId) {
      const source = yield* threads
        .getThreadRecords(input.sourceThreadId, ["runs"])
        .pipe(mapFailure);
      if (source.thread.projectId !== input.projectId)
        return yield* new AgentWorkflowError({ reason: "forbidden" });
      if (
        source.runs.some(
          (run) => ThreadManagementService.isActiveRun(run) || run.status === "queued",
        )
      )
        return yield* invalid(
          "The source thread still has native work. Finish or cancel it before handing responsibility to a workflow.",
        );
      sourceRoot = source.thread.worktreePath ?? ownedProject.workspaceRoot;
      const sourceStatus = yield* git.statusDetailsLocal(sourceRoot).pipe(mapFailure);
      if (!sourceStatus.isRepo || sourceStatus.hasWorkingTreeChanges)
        return yield* invalid(
          "The source thread checkout has uncommitted inputs. Commit its intended work before starting a workflow.",
        );
      sourceHead = (yield* git
        .resolveCommit({ cwd: sourceRoot, revision: "HEAD" })
        .pipe(mapFailure)).commitSha;
    }
    const cwd =
      input.workspaceStrategy.type === "existing_worktree"
        ? input.workspaceStrategy.worktreePath
        : input.workspaceStrategy.type === "worktree"
          ? (sourceRoot ?? ownedProject.workspaceRoot)
          : ownedProject.workspaceRoot;
    const status = yield* git.statusDetailsLocal(cwd).pipe(mapFailure);
    if (!status.isRepo || status.hasWorkingTreeChanges)
      return yield* invalid(
        "Start from a committed, clean checkout so the workflow cannot omit uncommitted inputs.",
      );
    const revision =
      input.workspaceStrategy.type === "worktree" ? input.workspaceStrategy.baseRef : "HEAD";
    const baseRef = (yield* git.resolveCommit({ cwd, revision }).pipe(mapFailure)).commitSha;
    if (sourceHead && sourceHead !== baseRef)
      return yield* invalid(
        "The selected base differs from the source thread's committed HEAD. Reconcile those inputs before starting; no source work was omitted.",
      );
    let specSnapshot: AgentWorkflow["specSnapshot"] = null;
    const currentBoard = input.cardId ? yield* roadmap.read(input).pipe(mapFailure) : null;
    if (currentBoard) {
      const card = currentBoard.cards.find((c) => c.id === input.cardId);
      if (!card || currentBoard.revision !== input.cardRevision)
        return yield* new AgentWorkflowError({
          reason: "conflict",
          detail: "The roadmap card changed. Reload its spec and criteria before starting.",
        });
      const criteria = card.acceptanceCriteria ?? [];
      if (
        criteria.length !== input.criteria.length ||
        criteria.some(
          (criterion) =>
            !input.criteria.some((row) => row.id === criterion.id && row.text === criterion.text),
        )
      )
        return yield* invalid("The assignment criteria must match the saved roadmap card.");
      if (card.threadId) {
        const linked = yield* threads.getThreadShell(card.threadId).pipe(mapFailure);
        if (linked && linked.deletedAt === null)
          return yield* invalid(
            "This card already has linked work. Start from that stopped thread or use a new card; its owner was not replaced.",
          );
      }
      if (card.specPath) {
        let text: string;
        if (/^https?:\/\//i.test(card.specPath)) {
          if (Option.isNone(http))
            return yield* invalid(
              "This environment cannot resolve HTTP specs. Use a project-relative spec file.",
            );
          const response = yield* http.value
            .get(card.specPath)
            .pipe(Effect.timeout("15 seconds"), mapFailure);
          if (response.status < 200 || response.status >= 300)
            return yield* invalid("The linked spec could not be read. No workflow was started.");
          const bytes = yield* response.stream.pipe(
            Stream.runFoldEffect(
              () => new Uint8Array(),
              (previous, chunk) => {
                if (previous.byteLength + chunk.byteLength > 128_000)
                  return Effect.fail(invalid("The accepted spec exceeds the download limit."));
                const next = new Uint8Array(previous.byteLength + chunk.byteLength);
                next.set(previous);
                next.set(chunk, previous.byteLength);
                return Effect.succeed(next);
              },
            ),
            Effect.timeout("15 seconds"),
            mapFailure,
          );
          text = new TextDecoder().decode(bytes);
        } else {
          const loaded = yield* files
            .readFile({ cwd, relativePath: card.specPath })
            .pipe(mapFailure);
          if (loaded.truncated)
            return yield* invalid(
              "The linked spec is truncated. Use a bounded accepted spec before starting.",
            );
          text = loaded.contents;
        }
        if (text.length > 32_000)
          return yield* invalid(
            "The accepted spec exceeds 32,000 characters. Link a focused feature spec.",
          );
        specSnapshot = { source: card.specPath, content: text, contentHash: yield* hash(text) };
      }
    }
    const roles = yield* core.roles(input);
    let managerRole: AgentRoleSnapshot | undefined;
    let managerBrief = "";
    for (const stage of ["planner", "builder", "reviewer"] as const) {
      const role = roles.roles.find((r) => r.id === input.roleIds[stage] && r.kind === stage);
      if (!role) return yield* invalid(`Select a ${stage} role for this stage.`);
      const ready = yield* compile(
        input.projectId,
        role,
        role.modelSelection ?? input.modelSelection,
        cwd,
      );
      if (!ready.ready)
        return yield* new AgentWorkflowError({
          reason: "missing_skill",
          detail: ready.issues.join("; ").slice(0, 2_000),
        });
      if (stage === "planner") {
        managerRole = ready.snapshot;
        managerBrief = ready.brief;
      }
    }
    const id = `workflow-${(yield* hash(`${input.projectId}:${input.requestId}`)).slice(0, 32)}`;
    const workflow = yield* core.create({
      input,
      workflowId: id,
      managerThreadId: ThreadId.make(`thread-${id}`),
      commandId: CommandId.make(`agent-workflow:${id}:launch`),
      ...(managerRole === undefined ? {} : { managerRole }),
      managerBrief,
      specSnapshot,
      baseRef,
    });
    const nativeLaunch = launchManager(workflow);
    return workflowView(
      yield* nativeLaunch.pipe(
        Effect.tapError(() =>
          core.failIntent({
            projectId: input.projectId,
            workflowId: workflow.id,
            intentId: workflow.intents[0]!.id,
          }),
        ),
      ),
    );
  });

  const reconcileAssignment = Effect.fn("AgentWorkflowRuntime.reconcileAssignment")(function* (
    workflow: AgentWorkflow,
    intent: AgentWorkflow["intents"][number],
  ) {
    const stored = yield* events
      .readAgentEvents({ commandId: intent.commandId, eventType: "subagent.updated", limit: 10 })
      .pipe(Stream.runCollect, mapFailure);
    const task = stored.find(
      (e) => e.event.type === "subagent.updated" && e.event.payload.origin === "app_owned",
    );
    if (task?.event.type !== "subagent.updated" || task.event.payload.childThreadId === null)
      return null;
    const assignment = workflow.assignments.find((a) => a.id === intent.entityId)!;
    return yield* core.acceptAssignment({
      projectId: workflow.projectId,
      workflowId: workflow.id,
      assignmentId: assignment.id,
      intentId: intent.id,
      childThreadId: task.event.payload.childThreadId,
      taskId: task.event.payload.id,
      parentRunId: assignment.attempts.at(-1)!.parentRunId,
      workspacePath: workflow.workspacePath,
      baseRef: assignment.baseRef ?? workflow.baseRef,
    });
  });
  const startAssignment = Effect.fn("AgentWorkflowRuntime.startAssignment")(function* (
    input: AgentAssignmentStartInput,
    scope: McpInvocationScope,
  ) {
    const caller = yield* actor(scope);
    let workflow = yield* core.read(input);
    if (workflow.workspacePath === null) workflow = yield* bindManagerWorkspace(workflow);
    if (workflow.workspacePath === null)
      return yield* invalid(
        "The native workflow checkout is still preparing. Wait for its native preparation to finish before dispatching assignments.",
      );
    const priorIntent = workflow.intents.find(
      (i) => i.operation === "assignment" && i.requestId === input.requestId,
    );
    const priorAssignment = workflow.assignments.find((a) => a.id === input.assignmentId);
    const role =
      priorAssignment?.role.role ??
      (yield* core.roles(input)).roles.find((r) => r.id === input.roleId);
    if (!role) return yield* new AgentWorkflowError({ reason: "not_found" });
    const compiled = priorAssignment
      ? {
          snapshot: priorAssignment.role,
          brief: priorAssignment.compiledBrief,
          ready: true,
          issues: [],
        }
      : yield* compile(
          input.projectId,
          role,
          input.modelSelection ?? role.modelSelection ?? workflow.modelSelection,
          workflow.workspacePath ?? undefined,
        );
    if (!compiled.ready)
      return yield* new AgentWorkflowError({
        reason: "missing_skill",
        detail: compiled.issues.join("; ").slice(0, 2_000),
      });
    let activeNative = 0;
    for (const assignment of workflow.assignments) {
      const previous = assignment.attempts.at(-1)?.childThreadId;
      const replaying = workflow.intents.some(
        (i) =>
          i.operation === "assignment" &&
          i.requestId === input.requestId &&
          i.entityId === assignment.id,
      );
      if (!previous || replaying) continue;
      const records = yield* threads.getThreadRecords(previous, ["runs"]).pipe(mapFailure);
      if (
        records.runs.some(
          (run) => ThreadManagementService.isActiveRun(run) || run.status === "queued",
        )
      ) {
        activeNative++;
        if (assignment.writeResponsibility || assignment.role.role.kind === "reviewer")
          return yield* new AgentWorkflowError({
            reason: "writer_busy",
            detail:
              "The previous writer/reviewer still has an active native turn. Wait for native completion before transferring responsibility.",
          });
      }
    }
    if (!priorIntent && activeNative >= workflow.limits.maxConcurrent)
      return yield* new AgentWorkflowError({ reason: "limit" });
    const commandId = OrchestratorMcpService.stableCommandId({
      scope,
      requestKey: input.requestId,
      operation: "delegate-task",
    });
    const prepared = yield* core.prepareAssignment({
      input,
      actor: caller,
      role: compiled.snapshot,
      commandId,
      compiledBrief: compiled.brief,
    });
    const accepted = prepared.replayed
      ? yield* reconcileAssignment(prepared.workflow, prepared.intent)
      : null;
    const existing = (accepted ?? prepared.workflow).assignments.find(
      (a) => a.id === input.assignmentId,
    )!;
    if (existing.attempts.at(-1)?.taskId)
      return {
        assignmentId: existing.id,
        taskId: existing.attempts.at(-1)!.taskId,
        childThreadId: existing.attempts.at(-1)!.childThreadId,
        next: "The existing native task owns this attempt. Its completion wakes the manager; end your turn without polling.",
      };
    if (prepared.replayed && existing.attempts.at(-1)?.parentRunId !== caller.runId)
      return yield* invalid(
        "The previous parent run ended before dispatch was accepted. Re-read the workflow and start a fresh attempt with a new request id.",
      );
    if (priorAssignment) {
      const available = yield* compile(
        input.projectId,
        existing.role.role,
        existing.role.modelSelection,
        workflow.workspacePath ?? undefined,
      );
      if (!available.ready || available.snapshot.instructionHash !== existing.role.instructionHash)
        return yield* new AgentWorkflowError({
          reason: "missing_skill",
          detail:
            "The pending attempt's immutable skill snapshot is unavailable. Start a fresh attempt explicitly; no new instructions were substituted.",
        });
      if (prepared.replayed && commandId !== prepared.intent.commandId)
        return yield* invalid(
          "The pending dispatch belongs to a different native session. Start a fresh attempt rather than duplicate work.",
        );
    }
    const native = yield* OrchestratorMcpService.OrchestratorMcpService;
    const delegated = yield* native
      .delegateTask(scope, {
        task: assignmentInstructions(prepared.workflow, existing, existing.compiledBrief),
        target: {
          providerInstanceId: existing.role.modelSelection.instanceId,
          model: existing.role.modelSelection.model,
          ...(existing.role.modelSelection.options === undefined
            ? {}
            : { options: existing.role.modelSelection.options }),
        },
        role:
          role.kind === "reviewer"
            ? "review"
            : role.kind === "builder" || role.kind === "debugger"
              ? "implementation"
              : role.kind === "designer"
                ? "design"
                : "research",
        title: `${role.name}: ${input.objective.slice(0, 100)}`,
        isolation: "shared",
        mode: "async",
        clientRequestId: input.requestId,
      })
      .pipe(
        withWorkflowDispatchPermit,
        mapFailure,
        Effect.tapError(() =>
          core.failIntent({
            projectId: input.projectId,
            workflowId: input.workflowId,
            intentId: prepared.intent.id,
          }),
        ),
      );
    if (delegated.childThreadId === null)
      return yield* invalid("The supervised workflow requires a local app-owned child thread.");
    yield* core.acceptAssignment({
      projectId: input.projectId,
      workflowId: input.workflowId,
      assignmentId: input.assignmentId,
      intentId: prepared.intent.id,
      childThreadId: delegated.childThreadId,
      taskId: delegated.taskId,
      parentRunId: caller.runId,
      workspacePath: workflow.workspacePath,
      baseRef: workflow.baseRef,
    });
    return {
      assignmentId: existing.id,
      taskId: delegated.taskId,
      childThreadId: delegated.childThreadId,
      next:
        delegated.next ?? "End your turn. Native task completion wakes this manager; do not poll.",
    };
  });
  const result = Effect.fn("AgentWorkflowRuntime.result")(function* (
    input: AgentAssignmentResultInput,
    scope: McpInvocationScope,
  ) {
    const caller = yield* actor(scope);
    const workflow = yield* core.read(input);
    const assignment = workflow.assignments.find((a) => a.id === input.assignmentId);
    if (!assignment) return yield* new AgentWorkflowError({ reason: "not_found" });
    const verified = yield* evidence.verify({
      workflow,
      assignment,
      artifact: input.artifact,
      actorThreadId: caller.threadId,
      actorRunId: caller.runId,
    });
    return workflowView(yield* core.result({ input, actor: caller, ...verified }));
  });
  const participantName = (workflow: AgentWorkflow, threadId: ThreadId | null) => {
    const name =
      threadId === workflow.managerThreadId
        ? workflow.managerRole?.role.name
        : workflow.assignments.find((a) =>
            a.attempts.some((attempt) => attempt.childThreadId === threadId),
          )?.role.role.name;
    return (name ?? "Agent").replace(/\s+/g, " ").slice(0, 100);
  };
  const deliverMessage = Effect.fn("AgentWorkflowRuntime.deliverMessage")(function* (
    workflow: AgentWorkflow,
    message: AgentWorkflow["messages"][number],
  ) {
    if (workflow.status === "cancelled" || message.generation !== workflow.generation)
      return workflow;
    const target = yield* threads.getThreadShell(message.recipientThreadId).pipe(mapFailure);
    if (!target || target.projectId !== workflow.projectId)
      return yield* new AgentWorkflowError({ reason: "forbidden" });
    yield* resolveRuntimeMode(workflow.runtimeMode, target.runtimeMode).pipe(mapFailure);
    yield* resolveInteractionMode(workflow.interactionMode, target.interactionMode).pipe(
      mapFailure,
    );
    const sender =
      message.origin === "user" ? "You" : participantName(workflow, message.senderThreadId);
    const recipient = participantName(workflow, message.recipientThreadId);
    const receiptRecords = yield* threads
      .getThreadRecords(message.recipientThreadId, ["messages", "runs"], {
        messageIds: [message.messageId],
      })
      .pipe(mapFailure);
    const nativeMessage = receiptRecords.messages.find((row) => row.id === message.messageId);
    if (nativeMessage?.runId) {
      const nativeRun = receiptRecords.runs.find((row) => row.id === nativeMessage.runId);
      if (nativeRun) {
        const task = nativeRun.delegatedTaskId
          ? (yield* threads
              .getThreadRecords(workflow.managerThreadId, ["subagents"], {
                subagentIds: [nativeRun.delegatedTaskId],
              })
              .pipe(mapFailure)).subagents.find((row) => row.id === nativeRun.delegatedTaskId)
          : undefined;
        return yield* core.delivery({
          projectId: workflow.projectId,
          workflowId: workflow.id,
          messageId: message.id,
          delivery: nativeRun.status === "queued" ? "queued" : "submitted",
          childThreadId: message.recipientThreadId,
          ...(task?.runId ? { taskId: task.id, parentRunId: task.runId } : {}),
        });
      }
    }
    const recipientRecords = yield* threads
      .getThreadRecords(message.recipientThreadId, ["runs"])
      .pipe(mapFailure);
    if (
      recipientRecords.runs.some(
        (run) => ThreadManagementService.isActiveRun(run) || run.status === "queued",
      )
    )
      return workflow;
    const isContinuation = message.recipientThreadId !== workflow.managerThreadId;
    if (isContinuation) {
      if (workflow.status !== "running") return workflow;
      const recipientAssignment = workflow.assignments.find(
        (row) => row.attempts.at(-1)?.childThreadId === message.recipientThreadId,
      );
      if (
        !recipientAssignment ||
        recipientAssignment.state === "cancelled" ||
        recipientAssignment.state === "failed" ||
        recipientAssignment.state === "ready"
      )
        return yield* invalid(
          "This assignment no longer owns a runnable attempt. Ask the manager to dispatch a fresh assignment.",
        );
      const lastTaskId = recipientAssignment.attempts.at(-1)?.taskId;
      if (!lastTaskId) return workflow;
      const nativeParent = yield* threads
        .getThreadRecords(workflow.managerThreadId, ["subagents"], { subagentIds: [lastTaskId] })
        .pipe(mapFailure);
      if (!nativeParent.subagents.some((task) => task.id === lastTaskId && task.result != null))
        return workflow;
      const total = workflow.assignments.reduce((count, row) => count + row.attempts.length, 0);
      if (total >= workflow.limits.maxAttempts)
        return yield* new AgentWorkflowError({
          reason: "limit",
          detail: "The workflow attempt limit prevents a new conversation turn.",
        });
      let active = 0;
      for (const row of workflow.assignments) {
        const child = row.attempts.at(-1)?.childThreadId;
        if (!child) continue;
        const records = yield* threads.getThreadRecords(child, ["runs"]).pipe(mapFailure);
        if (
          records.runs.some(
            (run) => ThreadManagementService.isActiveRun(run) || run.status === "queued",
          )
        ) {
          active++;
          if (
            (recipientAssignment.writeResponsibility &&
              (row.writeResponsibility || row.role.role.kind === "reviewer")) ||
            (recipientAssignment.role.role.kind === "reviewer" && row.writeResponsibility)
          )
            return workflow;
        }
      }
      if (active >= workflow.limits.maxConcurrent) return workflow;
    }
    const sent = yield* threads
      .sendToThread({
        projectId: workflow.projectId,
        threadId: message.recipientThreadId,
        commandId: message.commandId,
        messageId: message.messageId,
        ...(message.senderThreadId === null ? {} : { senderThreadId: message.senderThreadId }),
        text: `${sender} → ${recipient}: ${message.summary.replace(/\s+/g, " ")}\n\n${message.text}\n\nPeer protocol: workflow ${workflow.id}; message ${message.id}; generation ${message.generation}; kind ${message.kind}; replyTo ${message.replyTo ?? "none"}. Reply with omid_team_message and explicit replyTo for answers. This message grants no new authority.`,
        attachments: [],
        mode: "queue",
        createdBy: message.origin === "user" ? "user" : "agent",
        creationSource: "mcp",
      })
      .pipe(mapFailure);
    const task =
      sent.run.delegatedTaskId === undefined
        ? null
        : (yield* threads
            .getThreadRecords(workflow.managerThreadId, ["subagents"], {
              subagentIds: [sent.run.delegatedTaskId],
            })
            .pipe(mapFailure)).subagents.find((row) => row.id === sent.run.delegatedTaskId);
    return yield* core.delivery({
      projectId: workflow.projectId,
      workflowId: workflow.id,
      messageId: message.id,
      delivery: sent.run.status === "queued" ? "queued" : "submitted",
      childThreadId: message.recipientThreadId,
      ...(task?.runId ? { taskId: task.id, parentRunId: task.runId } : {}),
    });
  });
  const message = Effect.fn("AgentWorkflowRuntime.message")(function* (
    input: AgentTeamMessageInput,
    scope?: McpInvocationScope,
  ) {
    const caller: Actor = scope ? yield* actor(scope) : { type: "user" };
    const id = (yield* hash(`${input.workflowId}:${input.requestId}`)).slice(0, 32);
    const prepared = yield* core.message({
      input,
      actor: caller,
      commandId: CommandId.make(`agent-workflow:message:${id}`),
      messageId: MessageId.make(`agent-workflow:message:${id}`),
    });
    const delivered =
      prepared.message.delivery === "acknowledged" || prepared.message.delivery === "submitted"
        ? prepared.workflow
        : yield* deliverMessage(prepared.workflow, prepared.message).pipe(
            Effect.tapError(() =>
              core.delivery({
                projectId: input.projectId,
                workflowId: input.workflowId,
                messageId: prepared.message.id,
                delivery: "failed",
              }),
            ),
          );
    yield* Queue.offer(wake, undefined);
    const final = delivered.messages.find((row) => row.id === prepared.message.id)!;
    return {
      ...workflowView(delivered),
      communication: {
        id: final.id,
        nativeMessageId: final.messageId,
        senderName:
          final.origin === "user" ? "You" : participantName(delivered, final.senderThreadId),
        recipientName: participantName(delivered, final.recipientThreadId),
        summary: final.summary.replace(/\s+/g, " "),
        kind: final.kind,
        delivery: final.delivery,
      },
    };
  });
  const ack = Effect.fn("AgentWorkflowRuntime.ack")(function* (
    input: AgentTeamAckInput,
    scope: McpInvocationScope,
  ) {
    return workflowView(yield* core.ack({ input, actor: yield* actor(scope) }));
  });
  const stopOwned = Effect.fn("AgentWorkflowRuntime.stopOwned")(function* (
    workflow: AgentWorkflow,
    requestId: string,
  ) {
    for (const assignment of workflow.assignments) {
      for (const attempt of assignment.attempts) {
        if (attempt.taskId)
          yield* threads
            .dispatch({
              type: "delegated_task.completion-delivery.dispose",
              commandId: CommandId.make(`agent-workflow:${workflow.id}:dispose:${attempt.taskId}`),
              parentThreadId: workflow.managerThreadId,
              taskId: attempt.taskId,
            })
            .pipe(mapFailure);
      }
    }
    const ownedThreads = new Set([
      workflow.managerThreadId,
      ...workflow.assignments.flatMap((row) =>
        row.attempts.flatMap((attempt) => (attempt.childThreadId ? [attempt.childThreadId] : [])),
      ),
    ]);
    for (const threadId of ownedThreads) {
      if (!(yield* threads.getThreadShell(threadId).pipe(mapFailure))) continue;
      const records = yield* threads.getThreadRecords(threadId, ["runs"]).pipe(mapFailure);
      for (const run of records.runs)
        if (run.status === "queued")
          yield* threads
            .dispatch({
              type: "queued-run.cancel",
              threadId,
              runId: run.id,
              commandId: CommandId.make(`agent-workflow:${workflow.id}:cancel-queue:${run.id}`),
            })
            .pipe(mapFailure);
    }
    if (!(yield* threads.getThreadShell(workflow.managerThreadId).pipe(mapFailure))) return;
    yield* threads
      .dispatch({
        type: "thread.stop",
        threadId: workflow.managerThreadId,
        commandId: CommandId.make(`agent-workflow:${workflow.id}:stop:${requestId}`),
        stopDelegatedTasks: true,
      })
      .pipe(mapFailure);
    yield* threads
      .stopDelegatedTasks({
        threadId: workflow.managerThreadId,
        commandId: CommandId.make(`agent-workflow:${workflow.id}:children-stop:${requestId}`),
        reason: "Workflow cancelled",
      })
      .pipe(mapFailure);
  });
  const control = Effect.fn("AgentWorkflowRuntime.control")(function* (
    input: AgentWorkflowControlInput,
    scope?: McpInvocationScope,
  ) {
    const workflow = yield* core.control({
      input,
      actor: scope ? yield* actor(scope) : { type: "user" },
    });
    if (input.action === "cancel") yield* stopOwned(workflow, input.requestId);
    if (input.action === "resume" || input.action === "retry") {
      const manager = yield* threads.getThreadShell(workflow.managerThreadId).pipe(mapFailure);
      const records =
        manager &&
        input.action === "retry" &&
        workflow.intents.some(
          (intent) => intent.operation === "launch" && intent.state !== "accepted",
        )
          ? yield* threads.getThreadRecords(workflow.managerThreadId, ["runs"]).pipe(mapFailure)
          : null;
      const failedPreparation = records?.runs
        .toReversed()
        .find((run) => run.status === "failed" && run.workspacePreparation !== undefined);
      if (failedPreparation) {
        yield* Effect.gen(function* () {
          yield* reserveCard(workflow);
          yield* launch
            .retryPreparation({
              commandId: CommandId.make(
                `agent-workflow:${workflow.id}:retry-preparation:${input.requestId}`,
              ),
              threadId: workflow.managerThreadId,
              runId: failedPreparation.id,
            })
            .pipe(mapFailure);
        }).pipe(
          Effect.tapError(() =>
            core.failIntent({
              projectId: workflow.projectId,
              workflowId: workflow.id,
              intentId: workflow.intents.find((intent) => intent.operation === "launch")!.id,
            }),
          ),
        );
      } else if (
        !manager ||
        !workflow.workspacePath ||
        workflow.intents.some(
          (intent) => intent.operation === "launch" && intent.state !== "accepted",
        )
      )
        yield* launchManager(workflow).pipe(
          Effect.tapError(() =>
            core.failIntent({
              projectId: workflow.projectId,
              workflowId: workflow.id,
              intentId: workflow.intents.find((intent) => intent.operation === "launch")!.id,
            }),
          ),
        );
      else
        yield* wakeManager(
          workflow,
          input.requestId,
          "The user resumed this workflow. Re-read its current generation, accepted evidence and limits before continuing.",
        );
    }
    yield* Queue.offer(wake, undefined);
    return workflowView(yield* core.read(input));
  });
  const snapshot = Effect.fn("AgentWorkflowRuntime.snapshot")(function* (
    input: { projectId: ProjectId; workflowId: string; assignmentId: string; requestId: string },
    scope: McpInvocationScope,
  ) {
    const caller = yield* actor(scope);
    const workflow = yield* core.read(input);
    const assignment = workflow.assignments.find((a) => a.id === input.assignmentId);
    if (
      !assignment?.writeResponsibility ||
      assignment.attempts.at(-1)?.childThreadId !== caller.threadId ||
      assignment.generation !== workflow.generation ||
      workflow.status !== "running" ||
      !["awaiting_result", "running"].includes(assignment.state) ||
      !workflow.workspacePath
    )
      return yield* new AgentWorkflowError({ reason: "forbidden" });
    const ref = CheckpointRef.make(
      `refs/t3/workflows/${(yield* hash(`${workflow.id}:${assignment.id}:${input.requestId}`)).slice(0, 40)}`,
    );
    if (
      !(yield* checkpoints
        .hasCheckpointRef({ cwd: workflow.workspacePath, checkpointRef: ref })
        .pipe(mapFailure))
    )
      yield* checkpoints
        .captureCheckpoint({ cwd: workflow.workspacePath, checkpointRef: ref })
        .pipe(mapFailure);
    const { commitSha } = yield* git
      .resolveCommit({ cwd: workflow.workspacePath, revision: ref })
      .pipe(mapFailure);
    yield* core.recordCheckpoint({ ...input, actor: caller, ref, commitSha });
    return {
      ref,
      commitSha,
      checkInstructions: workflowCheckInstructions({ ref, commitSha }, assignment.requiredChecks),
    };
  });

  const checks = Effect.fn("AgentWorkflowRuntime.checks")(function* (
    input: { projectId: ProjectId; workflowId: string; assignmentId: string },
    scope: McpInvocationScope,
  ) {
    const caller = yield* actor(scope);
    const workflow = yield* core.read(input);
    const assignment = workflow.assignments.find((row) => row.id === input.assignmentId);
    if (assignment?.attempts.at(-1)?.childThreadId !== caller.threadId)
      return yield* new AgentWorkflowError({ reason: "forbidden" });
    const records = yield* threads
      .getThreadRecords(caller.threadId, ["turnItems"])
      .pipe(mapFailure);
    return {
      commands: records.turnItems
        .flatMap((item) =>
          item.type === "command_execution" && item.runId === caller.runId
            ? [
                {
                  id: item.id,
                  input: item.input,
                  status: item.status,
                  exitCode: item.exitCode ?? null,
                },
              ]
            : [],
        )
        .slice(-30),
    };
  });
  const controlAssignment = Effect.fn("AgentWorkflowRuntime.controlAssignment")(function* (
    input: AgentAssignmentControlInput,
    scope?: McpInvocationScope,
  ) {
    const workflow = yield* core.controlAssignment({
      input,
      actor: scope ? yield* actor(scope) : { type: "user" },
    });
    const intent = workflow.intents.find(
      (i) => i.operation === "control" && i.requestId === input.requestId,
    );
    const assignment = workflow.assignments.find((a) => a.id === input.assignmentId);
    const attempt = assignment?.attempts.find((a) => a.id === intent?.targetAttemptId);
    if (input.action === "cancel" && attempt?.childThreadId && attempt.taskId) {
      const records = yield* threads
        .getThreadRecords(attempt.childThreadId, ["runs"])
        .pipe(mapFailure);
      for (const run of records.runs) {
        if (run.delegatedTaskId !== attempt.taskId) continue;
        if (run.status === "queued")
          yield* threads
            .dispatch({
              type: "queued-run.cancel",
              threadId: attempt.childThreadId,
              runId: run.id,
              commandId: CommandId.make(`agent-workflow:cancel:${attempt.id}:${run.id}`),
            })
            .pipe(mapFailure);
        else if (ThreadManagementService.isActiveRun(run))
          yield* threads
            .dispatch({
              type: "thread.stop",
              threadId: attempt.childThreadId,
              commandId: CommandId.make(`agent-workflow:cancel:${attempt.id}:${run.id}`),
              stopDelegatedTasks: true,
            })
            .pipe(mapFailure);
      }
      yield* threads
        .dispatch({
          type: "delegated_task.completion-delivery.dispose",
          parentThreadId: workflow.managerThreadId,
          taskId: attempt.taskId,
          commandId: CommandId.make(`agent-workflow:dispose:${attempt.taskId}`),
        })
        .pipe(mapFailure);
    }
    if (input.action === "retry")
      yield* wakeManager(
        workflow,
        input.requestId,
        `The user requested retry of assignment ${input.assignmentId}. Re-read its current state, then use a fresh request id for the next native attempt.`,
      );
    return workflowView(workflow);
  });

  const reconcile = Effect.gen(function* () {
    for (const projectId of yield* store.listProjects()) {
      const state = yield* store.read(projectId).pipe(Effect.option);
      if (Option.isNone(state)) {
        yield* Effect.logWarning("Agent workflow project could not be read", { projectId });
        continue;
      }
      for (const storedWorkflow of state.value.workflows)
        yield* locks
          .withLock(
            `${projectId}:${storedWorkflow.id}`,
            Effect.gen(function* () {
              let workflow = yield* core.read({ projectId, workflowId: storedWorkflow.id });
              if (workflow.status === "cancelled") {
                yield* stopOwned(workflow, `recovery-${workflow.generation}`);
                return;
              }
              if (workflow.status === "completed") return;
              workflow = yield* core.expireQuestions({ projectId, workflowId: workflow.id });
              for (const intent of workflow.intents.filter(
                (i) => i.state === "pending" && i.generation === workflow.generation,
              )) {
                if (intent.operation === "assignment") {
                  const recovered = yield* reconcileAssignment(workflow, intent);
                  if (recovered) workflow = recovered;
                  else {
                    const parentRunId = workflow.assignments
                      .find((row) => row.id === intent.entityId)
                      ?.attempts.find(
                        (attempt) => attempt.id === intent.targetAttemptId,
                      )?.parentRunId;
                    const manager = yield* threads
                      .getThreadRecords(workflow.managerThreadId, ["runs"])
                      .pipe(mapFailure);
                    if (
                      manager.runs.some(
                        (run) => run.id === parentRunId && ThreadManagementService.isActiveRun(run),
                      )
                    )
                      continue;
                    workflow = yield* core.failIntent({
                      projectId,
                      workflowId: workflow.id,
                      intentId: intent.id,
                    });
                    yield* wakeManager(
                      workflow,
                      intent.id,
                      "An assignment dispatch was not accepted before recovery. Re-read and start a new attempt under your current active run; do not reuse an expired run.",
                    );
                  }
                } else if (intent.operation === "message") {
                  const pending = workflow.messages.find((m) => m.id === intent.entityId);
                  if (pending)
                    workflow = yield* deliverMessage(workflow, pending).pipe(
                      Effect.catch((error) =>
                        Effect.gen(function* () {
                          const failed = yield* core.delivery({
                            projectId,
                            workflowId: workflow.id,
                            messageId: pending.id,
                            delivery: "failed",
                          });
                          yield* wakeManager(
                            failed,
                            intent.id,
                            `Message ${pending.id} could not be delivered (${error.reason}). Inspect its failed delivery; do not assume the recipient received it.`,
                          );
                          return failed;
                        }),
                      ),
                    );
                } else if (intent.operation === "launch" && workflow.status !== "paused") {
                  workflow = yield* launchManager(workflow).pipe(
                    Effect.catch(() =>
                      core.failIntent({ projectId, workflowId: workflow.id, intentId: intent.id }),
                    ),
                  );
                }
              }
            }),
          )
          .pipe(
            Effect.catch((error) =>
              Effect.logWarning("Agent workflow recovery failed", {
                workflowId: storedWorkflow.id,
                reason: error.reason,
              }),
            ),
          );
    }
  });
  const startRecovery = Effect.gen(function* () {
    const loop = Effect.forever(
      Effect.gen(function* () {
        yield* reconcile.pipe(
          Effect.catch((error) =>
            Effect.logWarning("Agent workflow recovery failed", { reason: error.reason }),
          ),
        );
        let deadline: number | null = null;
        for (const projectId of yield* store.listProjects().pipe(Effect.orElseSucceed(() => []))) {
          const state = yield* store.read(projectId).pipe(Effect.option);
          if (Option.isNone(state)) continue;
          for (const workflow of state.value.workflows) {
            if (workflow.status === "cancelled" || workflow.status === "completed") continue;
            for (const message of workflow.messages)
              if (message.questionState === "pending" && message.expiresAt !== null)
                deadline =
                  deadline === null ? message.expiresAt : Math.min(deadline, message.expiresAt);
          }
        }
        const wait =
          deadline === null
            ? Effect.never
            : Effect.sleep(Math.max(1, deadline - (yield* Clock.currentTimeMillis)));
        yield* Effect.raceFirst(Queue.take(wake), wait);
      }),
    );
    yield* Effect.forkScoped(
      threads.streamDomainEvents.pipe(
        Stream.filter(
          (event) =>
            (event.type === "run.updated" && event.payload.status !== "queued") ||
            (event.type === "subagent.updated" && event.payload.result !== null),
        ),
        Stream.runForEach(() => Queue.offer(wake, undefined)),
        Effect.catch((error) => Effect.logWarning("Agent workflow event wake stopped", { error })),
      ),
    );
    yield* Effect.forkScoped(loop);
  });

  return AgentWorkflowRuntimeService.of({
    roles: core.roles,
    saveRole: core.saveRole,
    settings: core.settings,
    list,
    skills: Effect.fn("AgentWorkflowRuntime.skills")(() =>
      Effect.succeed({ skills: skills.list() }),
    ),
    previewRole,
    read,
    content,
    start: Effect.fn("AgentWorkflowRuntime.startLocked")(function* (
      input: AgentWorkflowStartInput,
    ) {
      const id = `workflow-${(yield* hash(`${input.projectId}:${input.requestId}`)).slice(0, 32)}`;
      return yield* locks.withLock(`${input.projectId}:${id}`, start(input));
    }),
    control: Effect.fn("AgentWorkflowRuntime.controlLocked")((input, scope) =>
      locks.withLock(`${input.projectId}:${input.workflowId}`, control(input, scope)),
    ),
    controlAssignment: Effect.fn("AgentWorkflowRuntime.controlAssignmentLocked")((input, scope) =>
      locks.withLock(`${input.projectId}:${input.workflowId}`, controlAssignment(input, scope)),
    ),
    checks,
    startAssignment: Effect.fn("AgentWorkflowRuntime.startAssignmentLocked")((input, scope) =>
      locks.withLock(`${input.projectId}:${input.workflowId}`, startAssignment(input, scope)),
    ),
    result: Effect.fn("AgentWorkflowRuntime.resultLocked")((input, scope) =>
      locks.withLock(`${input.projectId}:${input.workflowId}`, result(input, scope)),
    ),
    message: Effect.fn("AgentWorkflowRuntime.messageLocked")((input, scope) =>
      locks.withLock(`${input.projectId}:${input.workflowId}`, message(input, scope)),
    ),
    ack,
    snapshot: Effect.fn("AgentWorkflowRuntime.snapshotLocked")((input, scope) =>
      locks.withLock(`${input.projectId}:${input.workflowId}`, snapshot(input, scope)),
    ),
    reconcile,
    startRecovery,
  });
});

export const layer = Layer.effect(AgentWorkflowRuntimeService, make);
