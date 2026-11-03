import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  CommandId,
  DEFAULT_AGENT_WORKFLOW_LIMITS,
  EnvironmentId,
  MessageId,
  NodeId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  RunId,
  RoadmapError,
  RuntimeRequestId,
  ThreadId,
  type AgentRolePreset,
  type AgentArtifactInput,
  type AgentRoleSnapshot,
  type AgentWorkflow,
  type AgentWorkflowStartInput,
  type OrchestrationV2Run,
  type OrchestrationV2RuntimeRequest,
  type OrchestrationV2ServerCommand,
  type OrchestrationV2StoredEvent,
  type OrchestrationV2ThreadProjection,
  type RoadmapBoard,
  type ServerProvider,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import { FetchHttpClient } from "effect/http";
import * as ServerConfig from "../../config.ts";
import * as CheckpointStore from "../../checkpointing/CheckpointStore.ts";
import type { McpInvocationScope } from "../../mcp/McpInvocationContext.ts";
import * as Native from "../../mcp/OrchestratorMcpService.ts";
import { idleThreadProjection, liveThreadShell } from "../../mcp/McpToolAccess.testkit.ts";
import * as Threads from "../../orchestration-v2/ThreadManagementService.ts";
import * as Launch from "../../orchestration-v2/ThreadLaunchService.ts";
import * as Events from "../../persistence/OrchestrationEventStore.ts";
import * as Projects from "../../project/ProjectService.ts";
import * as Providers from "../../provider/ProviderRegistry.ts";
import * as Roadmap from "../../roadmap/RoadmapService.ts";
import * as Git from "../../vcs/GitVcsDriver.ts";
import * as Workspace from "../../workspace/WorkspaceFileSystem.ts";
import * as Skills from "../skills/BuiltinSkillService.ts";
import * as Core from "./AgentWorkflowService.ts";
import * as Store from "./AgentWorkflowStore.ts";
import * as Evidence from "./WorkflowEvidence.ts";
import * as Runtime from "./AgentWorkflowRuntimeService.ts";

const projectId = ProjectId.make("project:workflow-runtime");
const managerThreadId = ThreadId.make("thread:manager");
const providerId = ProviderInstanceId.make("codex");
const selection = { instanceId: providerId, model: "fixture-model" };
const criteria = [{ id: "criterion", text: "Deliver the accepted behavior" }];
const input: AgentWorkflowStartInput = {
  projectId,
  requestId: "start",
  title: "A native workflow",
  objective: "Deliver a bounded change",
  roleIds: { planner: "planner", builder: "builder", reviewer: "reviewer" },
  sourceThreadId: null,
  cardId: null,
  cardRevision: null,
  criteria,
  modelSelection: selection,
  runtimeMode: "full-access",
  interactionMode: "default",
  workspaceStrategy: { type: "worktree", baseRef: "HEAD" },
  limits: DEFAULT_AGENT_WORKFLOW_LIMITS,
};

function scope(threadId = managerThreadId): McpInvocationScope {
  return {
    environmentId: EnvironmentId.make("environment:fixture"),
    requestNamespace: "session:fixture",
    thread: { threadId, providerInstanceId: providerId, providerSessionId: "session:fixture" },
    client: undefined,
    capabilities: new Set(["orchestration"]),
    issuedAt: 1,
  };
}

function projection(
  threadId: ThreadId,
  status: OrchestrationV2Run["status"] = "completed",
  runId = RunId.make(`run:${threadId}`),
  taskId?: NodeId,
): OrchestrationV2ThreadProjection {
  const shell = { ...liveThreadShell(threadId), projectId, worktreePath: "/fixture/worktree" };
  return {
    ...idleThreadProjection(shell),
    runs: [
      {
        id: runId,
        threadId,
        providerInstanceId: providerId,
        status,
        ...(taskId ? { delegatedTaskId: taskId } : {}),
      } as OrchestrationV2Run,
    ],
  };
}

function roleSnapshot(role: AgentRolePreset): AgentRoleSnapshot {
  return {
    role,
    instructionHash: "fixture-instructions",
    modelSelection: selection,
    capabilities: [],
    skills: role.requiredSkills.map((id) => ({
      id,
      version: "1",
      contentHash: "fixture-skill",
      path: `/fixture/skills/${id}/SKILL.md`,
      source: "builtin",
      state: "on_demand",
      required: true,
      reason: null,
    })),
  };
}

function runtimeRequest(
  kind: OrchestrationV2RuntimeRequest["kind"],
  status: OrchestrationV2RuntimeRequest["status"] = "pending",
): OrchestrationV2RuntimeRequest {
  return {
    id: RuntimeRequestId.make(`request:${kind}`),
    nodeId: NodeId.make(`node:${kind}`),
    providerTurnId: null,
    nativeRequestRef: null,
    kind,
    status,
    responseCapability: { type: "message" },
    createdAt: DateTime.makeUnsafe("2026-01-01T00:00:00Z"),
    resolvedAt: null,
  };
}

function nativeMessage(
  id: MessageId,
  threadId: ThreadId,
  runId: RunId,
  text: string,
): OrchestrationV2ThreadProjection["messages"][number] {
  const time = DateTime.makeUnsafe("2026-01-01T00:00:00Z");
  return {
    id,
    threadId,
    runId,
    nodeId: null,
    role: "user",
    text,
    attachments: [],
    streaming: false,
    createdAt: time,
    updatedAt: time,
    createdBy: "agent",
    creationSource: "mcp",
  };
}

const baseLayer = Core.layer.pipe(
  Layer.provideMerge(Store.layer),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-workflow-runtime-" })),
  Layer.provideMerge(NodeServices.layer),
);

const fixture = Effect.fn("test.workflowRuntimeFixture")(function* (
  options: {
    readonly failInitialLaunch?: boolean;
    readonly failFirstReservation?: boolean;
    readonly deferWorkspacePreparation?: boolean;
    readonly queueNativeMessages?: boolean;
  } = {},
) {
  const core = yield* Core.AgentWorkflowService;
  const store = yield* Store.AgentWorkflowStore;
  yield* core.settings({ projectId, expectedRevision: 0, enabled: true });
  const records = yield* Ref.make(new Map<ThreadId, OrchestrationV2ThreadProjection>());
  const nativeEvents = yield* Ref.make<ReadonlyArray<OrchestrationV2StoredEvent>>([]);
  const launches = yield* Ref.make<ReadonlyArray<Launch.ThreadLaunchInput>>([]);
  const nativeTasks = yield* Ref.make<ReadonlyArray<NodeId>>([]);
  const nativeRequests = yield* Ref.make<
    ReadonlyArray<Parameters<Native.OrchestratorMcpService["Service"]["delegateTask"]>[1]>
  >([]);
  const commands = yield* Ref.make<ReadonlyArray<OrchestrationV2ServerCommand>>([]);
  const sent = yield* Ref.make<ReadonlyArray<Threads.ThreadManagementSendInput>>([]);
  const dirty = yield* Ref.make(false);
  const dirtyPaths = yield* Ref.make<ReadonlySet<string>>(new Set());
  const head = yield* Ref.make("head-one");
  const heads = yield* Ref.make<ReadonlyMap<string, string>>(new Map());
  const gitReads = yield* Ref.make<ReadonlyArray<string>>([]);
  const reservations = yield* Ref.make(0);
  const board = yield* Ref.make<RoadmapBoard>({ version: 1, revision: 3, cards: [] });
  const spec = yield* Ref.make("An immutable accepted specification.");
  const provider = {
    instanceId: providerId,
    driver: "codex",
    enabled: true,
    installed: true,
    availability: "available",
    models: [{ slug: selection.model }],
    skills: [],
  } as unknown as ServerProvider;
  const project = {
    id: projectId,
    title: "Fixture",
    workspaceRoot: "/fixture/project",
    defaultModelSelection: selection,
    scripts: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    deletedAt: null,
  };
  const getRecords: Threads.ThreadManagementService["Service"]["getThreadRecords"] = (threadId) =>
    Ref.get(records).pipe(Effect.map((all) => all.get(threadId) ?? projection(threadId)));
  const put = (value: OrchestrationV2ThreadProjection) =>
    Ref.update(records, (all) => new Map(all).set(value.thread.id, value));
  const recordNativeTask = (childThreadId: ThreadId, taskId: NodeId, result: string | null) =>
    Effect.gen(function* () {
      const parent = (yield* Ref.get(records)).get(managerThreadId)!;
      const time = DateTime.makeUnsafe("2026-01-01T00:00:00Z");
      const task: OrchestrationV2ThreadProjection["subagents"][number] = {
        id: taskId,
        threadId: managerThreadId,
        runId: parent.runs.find(Threads.isActiveRun)?.id ?? RunId.make("manager-run"),
        parentNodeId: NodeId.make(`parent:${taskId}`),
        origin: "app_owned",
        createdBy: "agent",
        driver: ProviderDriverKind.make("codex"),
        providerInstanceId: providerId,
        providerThreadId: null,
        childThreadId,
        nativeTaskRef: null,
        prompt: "Fixture task",
        title: null,
        model: selection.model,
        status: result === null ? "running" : "completed",
        result,
        startedAt: time,
        completedAt: result === null ? null : time,
        updatedAt: time,
      };
      yield* put({
        ...parent,
        subagents: [...parent.subagents.filter((row) => row.id !== taskId), task],
      });
    });
  const ports = Layer.mergeAll(
    Layer.mock(Projects.ProjectService)({
      getById: (id) => Effect.succeed(id === projectId ? Option.some(project) : Option.none()),
    }),
    Layer.mock(Providers.ProviderRegistry)({
      refreshWorkspaceSnapshot: () => Effect.succeed([provider]),
    }),
    Layer.mock(Threads.ThreadManagementService)({
      getThreadRecords: getRecords,
      getThreadShell: (id) =>
        Ref.get(records).pipe(
          Effect.map((all) =>
            all.has(id)
              ? {
                  ...liveThreadShell(id),
                  projectId,
                  worktreePath: all.get(id)!.thread.worktreePath,
                  pendingRuntimeRequest:
                    all
                      .get(id)
                      ?.runtimeRequests.find(
                        (request) =>
                          request.status === "pending" && request.kind !== "dynamic_tool_call",
                      ) ?? null,
                }
              : null,
          ),
        ),
      dispatch: (command) =>
        Effect.gen(function* () {
          yield* Ref.update(commands, (all) => [...all, command]);
          if (command.type === "queued-run.cancel") {
            const current = (yield* Ref.get(records)).get(command.threadId);
            if (current)
              yield* put({
                ...current,
                runs: current.runs.map((run) =>
                  run.id === command.runId ? { ...run, status: "cancelled" } : run,
                ),
              });
          }
          if (command.type === "thread.stop") {
            const current = (yield* Ref.get(records)).get(command.threadId);
            if (current)
              yield* put({
                ...current,
                runs: current.runs.map((run) =>
                  Threads.isActiveRun(run) ? { ...run, status: "interrupted" } : run,
                ),
              });
          }
          return { sequence: 1 } as unknown as Effect.Success<
            ReturnType<Threads.ThreadManagementService["Service"]["dispatch"]>
          >;
        }),
      stopDelegatedTasks: ({ threadId }) =>
        Effect.gen(function* () {
          for (const current of (yield* Ref.get(records)).values()) {
            if (current.thread.lineage.parentThreadId === threadId)
              yield* put({
                ...current,
                runs: current.runs.map((run) => ({ ...run, status: "cancelled" })),
              });
          }
        }),
      sendToThread: (request) =>
        Effect.gen(function* () {
          const existing = (yield* Ref.get(sent)).find(
            (row) => row.commandId === request.commandId,
          );
          if (!existing) yield* Ref.update(sent, (all) => [...all, request]);
          const target =
            (yield* Ref.get(records)).get(request.threadId) ?? projection(request.threadId);
          const active = target.runs.some(Threads.isActiveRun);
          const oldTask = target.runs.at(-1)?.delegatedTaskId;
          const run = {
            id: RunId.make(`run:${request.messageId}`),
            threadId: request.threadId,
            providerInstanceId: providerId,
            status: active || options.queueNativeMessages ? "queued" : "running",
            ...(oldTask ? { delegatedTaskId: NodeId.make(`continued:${request.messageId}`) } : {}),
          } as OrchestrationV2Run;
          if (!existing)
            yield* put({
              ...target,
              runs: [...target.runs, run],
              messages: [
                ...target.messages,
                nativeMessage(request.messageId, request.threadId, run.id, request.text),
              ],
            });
          if (run.delegatedTaskId) {
            yield* recordNativeTask(request.threadId, run.delegatedTaskId, null);
          }
          return {
            run,
            delivery: run.status === "queued" ? "queued" : "started",
            projection: target,
          } as unknown as Threads.ThreadManagementSendResult;
        }),
    }),
    Layer.mock(Launch.ThreadLaunchService)({
      launch: (request) =>
        Effect.gen(function* () {
          const previous = yield* Ref.get(launches);
          yield* Ref.update(launches, (all) => [...all, request]);
          if (previous.length === 0) expect(request.reuseExistingThread).toBe(false);
          if (options.failInitialLaunch && previous.length === 0)
            return yield* new Launch.ThreadLaunchError({
              operation: "create-thread",
              commandId: request.commandId,
              projectId,
              cause: new Error("Authored launch failure"),
            });
          const started = projection(request.threadId!, "running");
          const accepted = {
            ...started,
            thread: {
              ...started.thread,
              worktreePath: options.deferWorkspacePreparation ? null : started.thread.worktreePath,
            },
            messages: request.initialMessage
              ? [
                  nativeMessage(
                    request.initialMessage.messageId!,
                    request.threadId!,
                    started.runs[0]!.id,
                    request.initialMessage.text,
                  ),
                ]
              : [],
          };
          yield* put(accepted);
          return {
            threadId: request.threadId!,
            projection: accepted,
            resumed: previous.length > 0,
          };
        }),
    }),
    Layer.mock(Native.OrchestratorMcpService)({
      delegateTask: (_scope, request) =>
        Effect.gen(function* () {
          yield* Ref.update(nativeRequests, (all) => [...all, request]);
          const created = NodeId.make(`native-task-${(yield* Ref.get(nativeTasks)).length + 1}`);
          yield* Ref.update(nativeTasks, (all) => [...all, created]);
          const childThreadId = ThreadId.make(`child:${created}`);
          const child = projection(childThreadId, "running", RunId.make(`run:${created}`), created);
          yield* put({
            ...child,
            thread: {
              ...child.thread,
              lineage: {
                rootThreadId: managerThreadId,
                parentThreadId: managerThreadId,
                relationshipToParent: "subagent",
              },
            },
          });
          return {
            taskId: created,
            childThreadId,
            next: "Yield to native completion.",
          } as unknown as Effect.Success<
            ReturnType<Native.OrchestratorMcpService["Service"]["delegateTask"]>
          >;
        }),
    }),
    Layer.mock(Events.OrchestrationEventStore)({
      readAgentEvents: (query) =>
        Stream.unwrap(
          Ref.get(nativeEvents).pipe(
            Effect.map((all) =>
              Stream.fromIterable(
                all.filter((row) => !query?.commandId || row.commandId === query.commandId),
              ),
            ),
          ),
        ),
    }),
    Layer.mock(Git.GitVcsDriver)({
      statusDetailsLocal: (cwd) =>
        Effect.gen(function* () {
          yield* Ref.update(gitReads, (all) => [...all, cwd]);
          return {
            isRepo: true,
            hasWorkingTreeChanges: (yield* Ref.get(dirty)) || (yield* Ref.get(dirtyPaths)).has(cwd),
          } as Effect.Success<ReturnType<Git.GitVcsDriver["Service"]["statusDetailsLocal"]>>;
        }),
      resolveCommit: (request) =>
        Effect.gen(function* () {
          yield* Ref.update(gitReads, (all) => [...all, request.cwd]);
          return {
            commitSha:
              request.revision === "HEAD"
                ? ((yield* Ref.get(heads)).get(request.cwd) ?? (yield* Ref.get(head)))
                : request.revision,
          };
        }),
    }),
    Layer.mock(CheckpointStore.CheckpointStore)({}),
    Layer.mock(Workspace.WorkspaceFileSystem)({
      readFile: (request) =>
        Ref.get(spec).pipe(
          Effect.map((contents) => ({
            contents,
            truncated: false,
            relativePath: request.relativePath,
            byteLength: new TextEncoder().encode(contents).byteLength,
          })),
        ),
    }),
    Layer.mock(Roadmap.RoadmapService)({
      read: () => Ref.get(board),
      save: (request) =>
        Effect.gen(function* () {
          const count = yield* Ref.getAndUpdate(reservations, (value) => value + 1);
          const current = yield* Ref.get(board);
          if (
            current.revision !== request.expectedRevision ||
            (options.failFirstReservation && count === 0)
          )
            return yield* new RoadmapError({ reason: "conflict" });
          const next = { ...current, revision: current.revision + 1, cards: request.cards };
          yield* Ref.set(board, next);
          return next;
        }),
    }),
    Layer.mock(Skills.BuiltinSkillService)({
      list: () => [],
      compileRole: (request) =>
        Effect.succeed({
          snapshot: roleSnapshot(request.role),
          ready: true,
          issues: [],
          brief: `Compiled ${request.role.instructions}`,
        }),
    }),
    Layer.mock(Evidence.WorkflowEvidence)({
      verify: () =>
        Effect.succeed({
          contentHash: "verified-content",
          verified: true,
          verifiedRequiredChecks: [],
        }),
    }),
    FetchHttpClient.layer,
  );
  const runtime = yield* Runtime.AgentWorkflowRuntimeService.pipe(
    Effect.provide(Runtime.layer.pipe(Layer.provide(ports))),
  );
  const seed = Effect.gen(function* () {
    yield* put(projection(managerThreadId, "running", RunId.make("manager-run")));
    const created = yield* core.create({
      input,
      workflowId: "workflow",
      managerThreadId,
      commandId: CommandId.make("initial-launch"),
      baseRef: "head-one",
      managerBrief: "Frozen manager brief",
    });
    return yield* core.acceptLaunch({
      projectId,
      workflowId: created.id,
      workspacePath: "/fixture/worktree",
      baseRef: "head-one",
    });
  });
  return {
    runtime: {
      ...runtime,
      startAssignment: (
        request: Parameters<typeof runtime.startAssignment>[0],
        caller: McpInvocationScope,
      ) => runtime.startAssignment(request, caller).pipe(Effect.provide(ports)),
    },
    core,
    store,
    records,
    nativeEvents,
    launches,
    nativeTasks,
    nativeRequests,
    commands,
    sent,
    dirty,
    dirtyPaths,
    heads,
    gitReads,
    head,
    board,
    spec,
    put,
    seed,
    recordNativeTask,
  };
});

const pendingAssignment = Effect.fn("test.pendingWorkflowAssignment")(function* (
  core: Core.AgentWorkflowService["Service"],
  workflow: AgentWorkflow,
  requestId = "assignment",
) {
  const role = (yield* core.roles({ projectId })).roles.find((row) => row.id === "planner")!;
  const assignmentInput = {
    projectId,
    workflowId: workflow.id,
    requestId,
    assignmentId: "plan",
    generation: workflow.generation,
    roleId: "planner",
    objective: "Prepare the specification",
    criteria,
    inputArtifactIds: [],
    dependencies: [],
  };
  const prepared = yield* core.prepareAssignment({
    input: assignmentInput,
    actor: { type: "agent", threadId: managerThreadId, runId: RunId.make("manager-run") },
    role: roleSnapshot(role),
    commandId: Native.stableCommandId({
      scope: scope(),
      requestKey: requestId,
      operation: "delegate-task",
    }),
    compiledBrief: "Frozen plan brief",
  });
  return { prepared, input: assignmentInput };
});

describe("AgentWorkflowRuntimeService", () => {
  it.effect("waits for native worktree preparation before binding the manager workspace", () =>
    Effect.gen(function* () {
      const f = yield* fixture({ deferWorkspacePreparation: true });
      const started = yield* f.runtime.start(input);
      expect(started.status).toBe("draft");
      expect(started.workspacePath).toBeNull();
      const pending = yield* f.core.read({ projectId, workflowId: started.id });
      expect(pending.intents.find((row) => row.operation === "launch")?.state).toBe("pending");
      yield* f.runtime.reconcile;
      expect((yield* f.core.read({ projectId, workflowId: started.id })).workspacePath).toBeNull();
      const native = (yield* Ref.get(f.records)).get(started.managerThreadId)!;
      yield* f.put({
        ...native,
        thread: { ...native.thread, worktreePath: "/fixture/prepared-worktree" },
      });
      yield* f.runtime.reconcile;
      expect(yield* f.core.read({ projectId, workflowId: started.id })).toMatchObject({
        status: "running",
        workspacePath: "/fixture/prepared-worktree",
        baseRef: "head-one",
      });
      expect(yield* Ref.get(f.launches)).toHaveLength(1);
      expect((yield* Ref.get(f.launches))[0]?.reuseExistingThread).toBe(false);
    }).pipe(Effect.provide(baseLayer)),
  );
  it.effect(
    "denies a live participant without orchestration capability before content access or dispatch",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        const workflow = yield* f.seed;
        const pending = yield* pendingAssignment(f.core, workflow);
        const previewScope: McpInvocationScope = { ...scope(), capabilities: new Set() };
        const denied = yield* Effect.all([
          f.runtime.read({ projectId, workflowId: workflow.id }, previewScope).pipe(Effect.flip),
          f.runtime
            .content(
              { projectId, workflowId: workflow.id, kind: "assignment", id: "plan" },
              previewScope,
            )
            .pipe(Effect.flip),
          f.runtime.startAssignment(pending.input, previewScope).pipe(Effect.flip),
        ]);
        expect(denied.map((error) => error.reason)).toEqual([
          "forbidden",
          "forbidden",
          "forbidden",
        ]);
        expect((yield* f.core.read({ projectId, workflowId: workflow.id })).revision).toBe(
          pending.prepared.workflow.revision,
        );
        expect(yield* Ref.get(f.nativeTasks)).toEqual([]);
        expect(yield* Ref.get(f.sent)).toEqual([]);
        expect(yield* Ref.get(f.launches)).toEqual([]);
      }).pipe(Effect.provide(baseLayer)),
  );

  it.effect.each([false, true])(
    "replays the frozen root launch after a shell-only partial launch (failure: %s)",
    (failInitialLaunch) =>
      Effect.gen(function* () {
        const f = yield* fixture({ failInitialLaunch });
        const workflow = yield* f.core.create({
          input,
          workflowId: "partial-launch",
          managerThreadId,
          commandId: CommandId.make("stable-root-command"),
          baseRef: "head-one",
          managerBrief: "Original compiled manager brief",
        });
        const shell = projection(managerThreadId);
        yield* f.put({ ...shell, runs: [] });
        expect(workflow.intents[0]?.state).toBe("pending");
        yield* f.runtime.reconcile;
        const launched = (yield* Ref.get(f.launches))[0]!;
        expect(launched.commandId).toBe("stable-root-command");
        expect(launched.threadId).toBe(managerThreadId);
        expect(launched.initialMessage?.text).toContain("Original compiled manager brief");
        expect(launched.initialMessage?.text).toContain(`Supervise workflow ${workflow.id}`);
        expect(launched.initialMessage?.text).toContain("omid_assignment_start");
        const recovered = yield* f.core.read({ projectId, workflowId: workflow.id });
        expect(recovered.status).toBe(failInitialLaunch ? "failed" : "running");
        expect(recovered.intents[0]?.state).toBe(failInitialLaunch ? "failed" : "accepted");
        expect(yield* Ref.get(f.sent)).toEqual([]);
      }).pipe(Effect.provide(baseLayer)),
  );

  it.effect(
    "derives human-input attention from native requests without persisting a duplicate workflow status",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        const workflow = yield* f.seed;
        const pending = yield* pendingAssignment(f.core, workflow);
        const childId = ThreadId.make("child-with-approval");
        const attached = yield* f.core.acceptAssignment({
          projectId,
          workflowId: workflow.id,
          assignmentId: "plan",
          intentId: pending.prepared.intent.id,
          childThreadId: childId,
          taskId: NodeId.make("plan-task"),
          parentRunId: RunId.make("manager-run"),
        });
        const manager = projection(managerThreadId, "running", RunId.make("manager-run"));
        yield* f.put({
          ...manager,
          runtimeRequests: [runtimeRequest("user_input"), runtimeRequest("dynamic_tool_call")],
        });
        const child = projection(childId, "running");
        yield* f.put({ ...child, runtimeRequests: [runtimeRequest("permission")] });
        const unrelated = projection(ThreadId.make("unrelated-thread"), "running");
        yield* f.put({ ...unrelated, runtimeRequests: [runtimeRequest("permission")] });
        const view = yield* f.runtime.read({ projectId, workflowId: workflow.id });
        expect(view.humanInputPending).toBe(true);
        expect(view.humanInputThreadIds).toEqual([managerThreadId, childId]);
        expect((yield* f.runtime.list({ projectId })).workflows[0]).toMatchObject({
          humanInputPending: true,
          humanInputThreadIds: [managerThreadId, childId],
        });
        expect((yield* f.core.read({ projectId, workflowId: workflow.id })).revision).toBe(
          attached.revision,
        );
        yield* f.put({
          ...manager,
          runtimeRequests: [
            runtimeRequest("user_input", "resolved"),
            runtimeRequest("dynamic_tool_call"),
          ],
        });
        yield* f.put({ ...child, runtimeRequests: [runtimeRequest("permission", "resolved")] });
        expect(yield* f.runtime.read({ projectId, workflowId: workflow.id })).toMatchObject({
          humanInputPending: false,
          humanInputThreadIds: [],
        });
        expect((yield* f.runtime.list({ projectId })).workflows[0]?.humanInputPending).toBe(false);
        expect((yield* f.core.read({ projectId, workflowId: workflow.id })).revision).toBe(
          attached.revision,
        );
      }).pipe(Effect.provide(baseLayer)),
  );
  it.effect(
    "recovers an accepted native dispatch before metadata attachment without launching another task",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        const workflow = yield* f.seed;
        const { prepared } = yield* pendingAssignment(f.core, workflow);
        const childThreadId = ThreadId.make("accepted-child");
        const taskId = NodeId.make("accepted-native-task");
        yield* Ref.set(f.nativeEvents, [
          {
            sequence: 1,
            commandId: prepared.intent.commandId,
            event: {
              type: "subagent.updated",
              payload: { origin: "app_owned", id: taskId, childThreadId },
            },
          } as unknown as OrchestrationV2StoredEvent,
        ]);
        yield* f.runtime.reconcile;
        const recovered = yield* f.core.read({ projectId, workflowId: workflow.id });
        expect(recovered.assignments[0]?.attempts[0]?.taskId).toBe(taskId);
        expect(recovered.assignments[0]?.state).toBe("awaiting_result");
        expect(recovered.intents.find((row) => row.id === prepared.intent.id)?.state).toBe(
          "accepted",
        );
        expect(yield* Ref.get(f.nativeTasks)).toEqual([]);
        yield* f.runtime.reconcile;
        expect((yield* f.core.read({ projectId, workflowId: workflow.id })).revision).toBe(
          recovered.revision,
        );
      }).pipe(Effect.provide(baseLayer)),
  );

  it.effect(
    "requires a fresh attempt when an unaccepted dispatch belongs to an expired manager run",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        const workflow = yield* f.seed;
        const pending = yield* pendingAssignment(f.core, workflow);
        yield* f.runtime.reconcile;
        expect(
          (yield* f.core.read({ projectId, workflowId: workflow.id })).assignments[0]?.state,
        ).toBe("dispatching");
        expect(yield* Ref.get(f.sent)).toEqual([]);
        yield* f.put(projection(managerThreadId, "running", RunId.make("new-manager-run")));
        yield* f.runtime.reconcile;
        expect(
          (yield* f.core.read({ projectId, workflowId: workflow.id })).assignments[0]?.state,
        ).toBe("failed");
        expect(
          yield* f.runtime.startAssignment(pending.input, scope()).pipe(Effect.flip),
        ).toMatchObject({ reason: "invalid" });
        expect(yield* Ref.get(f.nativeTasks)).toEqual([]);
        const fresh = yield* f.runtime.startAssignment(
          { ...pending.input, requestId: "fresh-attempt" },
          scope(),
        );
        const recovered = yield* f.core.read({ projectId, workflowId: workflow.id });
        expect(recovered.assignments[0]?.attempts).toHaveLength(2);
        expect(recovered.assignments[0]?.attempts[1]?.parentRunId).toBe("new-manager-run");
        expect(recovered.assignments[0]?.attempts[1]?.taskId).toBe(fresh.taskId);
      }).pipe(Effect.provide(baseLayer)),
  );

  it.effect(
    "rejects dirty inputs and stale cards before recording or launching workflow work",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        yield* Ref.set(f.dirty, true);
        expect(yield* f.runtime.start(input).pipe(Effect.flip)).toMatchObject({
          reason: "invalid",
        });
        yield* Ref.set(f.dirty, false);
        expect(
          yield* f.runtime
            .start({ ...input, requestId: "stale-card", cardId: "card", cardRevision: 2 })
            .pipe(Effect.flip),
        ).toMatchObject({ reason: "conflict" });
        expect((yield* f.store.read(projectId)).workflows).toEqual([]);
        expect(yield* Ref.get(f.launches)).toEqual([]);
      }).pipe(Effect.provide(baseLayer)),
  );

  it.effect(
    "validates and pins the stopped source thread's checkout instead of the clean project root",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        const sourceId = ThreadId.make("source-thread");
        const source = projection(sourceId, "completed");
        yield* f.put({ ...source, thread: { ...source.thread, worktreePath: "/fixture/source" } });
        yield* Ref.set(
          f.heads,
          new Map([
            ["/fixture/project", "root-head"],
            ["/fixture/source", "source-head"],
          ]),
        );
        yield* Ref.set(f.dirtyPaths, new Set(["/fixture/source"]));
        const request = { ...input, sourceThreadId: sourceId };
        expect(yield* f.runtime.start(request).pipe(Effect.flip)).toMatchObject({
          reason: "invalid",
        });
        expect((yield* f.store.read(projectId)).workflows).toEqual([]);
        expect(yield* Ref.get(f.launches)).toEqual([]);
        yield* Ref.set(f.dirtyPaths, new Set());
        yield* f.runtime.start(request);
        const frozen = (yield* f.store.read(projectId)).workflows[0]!;
        expect(frozen.baseRef).toBe("source-head");
        expect((yield* Ref.get(f.launches))[0]?.workspaceStrategy).toMatchObject({
          type: "worktree",
          baseRef: "source-head",
        });
        expect(yield* Ref.get(f.gitReads)).not.toContain("/fixture/project");
      }).pipe(Effect.provide(baseLayer)),
  );

  it.effect.each([false, true])(
    "does not bypass a failed card reservation after the board changes (other owner: %s)",
    (otherOwner) =>
      Effect.gen(function* () {
        const f = yield* fixture({ failFirstReservation: true });
        const card = {
          id: "card",
          title: "Task",
          summary: "Plan",
          type: "feature" as const,
          effort: "M" as const,
          lane: "upNext" as const,
          threadId: null,
          completed: false,
          archived: false,
          specPath: "spec.md",
          acceptanceCriteria: criteria.map((row) => ({ ...row, checked: false })),
        };
        yield* Ref.set(f.board, { version: 1, revision: 3, cards: [card] });
        const request = { ...input, cardId: "card", cardRevision: 3 };
        expect(yield* f.runtime.start(request).pipe(Effect.flip)).toMatchObject({
          reason: "storage",
        });
        const failed = (yield* f.store.read(projectId)).workflows[0]!;
        expect(failed.status).toBe("failed");
        const ownerId = ThreadId.make("other-card-owner");
        if (otherOwner) yield* f.put(projection(ownerId));
        const changed = {
          version: 1 as const,
          revision: 4,
          cards: [{ ...card, threadId: otherOwner ? ownerId : null }],
        };
        yield* Ref.set(f.board, changed);
        yield* f.runtime.start(request);
        yield* f.runtime.reconcile;
        expect(
          yield* f.runtime
            .control({
              projectId,
              workflowId: failed.id,
              requestId: "retry-reservation",
              action: "retry",
            })
            .pipe(Effect.flip),
        ).toMatchObject({ reason: "conflict" });
        yield* f.runtime.reconcile;
        const rejectedAgain = yield* f.core.read({ projectId, workflowId: failed.id });
        expect(rejectedAgain.status).toBe("failed");
        expect(rejectedAgain.intents.find((row) => row.operation === "launch")).toMatchObject({
          state: "failed",
          generation: rejectedAgain.generation,
        });
        expect(yield* Ref.get(f.launches)).toEqual([]);
        expect(yield* Ref.get(f.sent)).toEqual([]);
        expect(yield* Ref.get(f.board)).toEqual(changed);
      }).pipe(Effect.provide(baseLayer)),
  );

  it.effect("replays a pending attempt with its original compiled brief after role edits", () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const workflow = yield* f.seed;
      const pending = yield* pendingAssignment(f.core, workflow);
      const catalog = yield* f.core.roles({ projectId });
      const planner = catalog.roles.find((role) => role.id === "planner")!;
      yield* f.core.saveRole({
        projectId,
        expectedRevision: catalog.revision,
        role: { ...planner, instructions: "Instructions for future attempts only." },
      });
      const dispatched = yield* f.runtime.startAssignment(pending.input, scope());
      expect(dispatched.taskId).not.toBeNull();
      expect((yield* Ref.get(f.nativeRequests))[0]?.task).toContain("Frozen plan brief");
      expect((yield* Ref.get(f.nativeRequests))[0]?.task).not.toContain(
        "Instructions for future attempts only.",
      );
      expect(
        (yield* f.core.read({ projectId, workflowId: workflow.id })).assignments[0]?.compiledBrief,
      ).toBe("Frozen plan brief");
      const metadata = yield* f.runtime.read({ projectId, workflowId: workflow.id });
      expect(metadata.managerBrief).toBe("");
      expect(metadata.assignments[0]?.compiledBrief).toBe("");
      expect(metadata.assignments[0]?.role.role.instructions).toBe("");
      const fullAssignment = yield* f.runtime.content({
        projectId,
        workflowId: workflow.id,
        kind: "assignment",
        id: "plan",
      });
      expect(fullAssignment.text).toContain("Frozen plan brief");
      expect(fullAssignment.text).toContain(pending.prepared.assignment.role.role.instructions);
      expect(fullAssignment.text).not.toContain("Instructions for future attempts only.");
      const artifact: AgentArtifactInput = {
        kind: "spec",
        summary: "Frozen specification",
        content: "Original accepted specification content.",
        baseRef: "head-one",
        headRef: null,
        reviewedHead: null,
        outcome: "accepted",
        criteria: [{ id: "criterion", passed: true, evidence: ["Full criterion evidence"] }],
        checks: [
          {
            command: "check",
            revision: "head-one",
            status: "passed",
            evidence: "Full check evidence",
            required: false,
          },
        ],
        findings: [{ severity: "suggestion", location: "spec", reason: "Full finding" }],
        limitations: ["Full limitation"],
      };
      const delivered = yield* f.runtime.result(
        {
          projectId,
          workflowId: workflow.id,
          requestId: "plan-result",
          assignmentId: "plan",
          generation: 0,
          artifact,
        },
        scope(dispatched.childThreadId!),
      );
      expect(delivered.artifacts[0]).toMatchObject({
        content: "",
        criteria: [],
        checks: [],
        findings: [],
        limitations: [],
      });
      const fullArtifact = yield* f.runtime.content({
        projectId,
        workflowId: workflow.id,
        kind: "artifact",
        id: delivered.artifacts[0]!.id,
      });
      expect(fullArtifact.text).toBe(artifact.content);
      expect(fullArtifact.artifact).toMatchObject(artifact);
    }).pipe(Effect.provide(baseLayer)),
  );

  it.effect("pins a failed launch's accepted source and commit across a user retry", () =>
    Effect.gen(function* () {
      const f = yield* fixture({ failInitialLaunch: true });
      yield* Ref.set(f.board, {
        version: 1,
        revision: 3,
        cards: [
          {
            id: "card",
            title: "Task",
            summary: "Plan",
            type: "feature",
            effort: "M",
            lane: "upNext",
            threadId: null,
            completed: false,
            archived: false,
            specPath: "spec.md",
            acceptanceCriteria: criteria.map((row) => ({ ...row, checked: false })),
          },
        ],
      });
      expect(
        yield* f.runtime.start({ ...input, cardId: "card", cardRevision: 3 }).pipe(Effect.flip),
      ).toMatchObject({ reason: "storage" });
      const failed = (yield* f.store.read(projectId)).workflows[0]!;
      expect(failed.status).toBe("failed");
      yield* Ref.set(f.head, "moved-head");
      yield* Ref.set(f.spec, "Changed after the accepted launch.");
      yield* f.runtime.control({
        projectId,
        workflowId: failed.id,
        requestId: "retry",
        action: "retry",
      });
      const recovered = yield* f.core.read({ projectId, workflowId: failed.id });
      expect(recovered.baseRef).toBe("head-one");
      expect(recovered.specSnapshot?.content).toBe("An immutable accepted specification.");
      expect(recovered.workspacePath).toBe("/fixture/worktree");
      const metadata = yield* f.runtime.read({ projectId, workflowId: recovered.id });
      expect(metadata.managerBrief).toBe("");
      expect(metadata.managerRole?.role.instructions).toBe("");
      expect(metadata.specSnapshot?.content).toBe("");
      expect(
        (yield* f.runtime.content({
          projectId,
          workflowId: recovered.id,
          kind: "spec",
          id: recovered.id,
        })).text,
      ).toBe("An immutable accepted specification.");
      const launches = yield* Ref.get(f.launches);
      expect(launches[1]?.commandId).toBe(launches[0]?.commandId);
      expect(launches[1]?.workspaceStrategy).toMatchObject({
        type: "worktree",
        baseRef: "head-one",
      });
    }).pipe(Effect.provide(baseLayer)),
  );

  it.effect(
    "stamps user communications and settles native receipt replay without impersonating the manager",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        const workflow = yield* f.seed;
        const request = {
          projectId,
          workflowId: workflow.id,
          requestId: "human-update",
          generation: 0,
          toThreadId: managerThreadId,
          assignmentId: null,
          kind: "update" as const,
          summary: "Keep the original scope",
          text: "Please preserve the accepted criteria.",
          artifactIds: [],
          replyTo: null,
          blocking: false,
          senderThreadId: ThreadId.make("spoofed-agent"),
        };
        yield* f.runtime.message(request);
        const recorded = yield* f.core.read({ projectId, workflowId: workflow.id });
        const message = recorded.messages[0]!;
        expect(message.origin).toBe("user");
        expect(message.senderThreadId).toBeNull();
        expect(yield* Ref.get(f.sent)).toEqual([]);
        expect(message.delivery).toBe("persisted");
        yield* f.put(projection(managerThreadId, "completed", RunId.make("manager-run")));
        yield* f.runtime.reconcile;
        expect((yield* Ref.get(f.sent))[0]?.createdBy).toBe("user");
        yield* f.runtime.ack(
          {
            projectId,
            workflowId: workflow.id,
            requestId: "receipt",
            messageId: message.id,
            generation: 0,
          },
          scope(),
        );
        const received = yield* f.core.read({ projectId, workflowId: workflow.id });
        expect(received.messages[0]?.delivery).toBe("acknowledged");
        expect(
          received.intents.find((row) => row.entityId === message.id && row.operation === "message")
            ?.state,
        ).toBe("accepted");
        yield* f.runtime.reconcile;
        expect(yield* Ref.get(f.sent)).toHaveLength(1);
        expect((yield* f.core.read({ projectId, workflowId: workflow.id })).revision).toBe(
          received.revision,
        );
      }).pipe(Effect.provide(baseLayer)),
  );

  it.effect(
    "cancels the captured native attempt and keeps a retried attempt safe from stale cancellation replay",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        const workflow = yield* f.seed;
        const pending = yield* pendingAssignment(f.core, workflow);
        const oldChild = ThreadId.make("old-child");
        const oldTask = NodeId.make("old-task");
        const queued = projection(oldChild, "queued", RunId.make("old-queued"), oldTask);
        yield* f.put({
          ...queued,
          thread: {
            ...queued.thread,
            lineage: {
              rootThreadId: managerThreadId,
              parentThreadId: managerThreadId,
              relationshipToParent: "subagent",
            },
          },
        });
        yield* f.core.acceptAssignment({
          projectId,
          workflowId: workflow.id,
          assignmentId: "plan",
          intentId: pending.prepared.intent.id,
          childThreadId: oldChild,
          taskId: oldTask,
          parentRunId: RunId.make("manager-run"),
        });
        const cancel = {
          projectId,
          workflowId: workflow.id,
          assignmentId: "plan",
          requestId: "cancel-old",
          action: "cancel" as const,
        };
        yield* f.runtime.controlAssignment(cancel);
        expect((yield* Ref.get(f.records)).get(oldChild)?.runs[0]?.status).toBe("cancelled");
        expect(yield* Ref.get(f.commands)).toContainEqual(
          expect.objectContaining({
            type: "delegated_task.completion-delivery.dispose",
            taskId: oldTask,
          }),
        );
        yield* f.runtime.controlAssignment({ ...cancel, requestId: "retry-plan", action: "retry" });
        const fresh = yield* f.runtime.startAssignment(
          { ...pending.input, requestId: "new-attempt" },
          scope(),
        );
        yield* f.runtime.controlAssignment(cancel);
        expect((yield* Ref.get(f.records)).get(fresh.childThreadId!)?.runs[0]?.status).toBe(
          "running",
        );
        expect(
          (yield* f.core.read({ projectId, workflowId: workflow.id })).assignments[0]?.attempts,
        ).toHaveLength(2);
        yield* f.runtime.control({
          projectId,
          workflowId: workflow.id,
          requestId: "cancel-workflow",
          action: "cancel",
        });
        const cancelled = yield* f.core.read({ projectId, workflowId: workflow.id });
        expect(cancelled.generation).toBe(1);
        expect(cancelled.assignments[0]?.state).toBe("cancelled");
        expect((yield* Ref.get(f.records)).get(fresh.childThreadId!)?.runs[0]?.status).toBe(
          "cancelled",
        );
        expect(yield* Ref.get(f.commands)).toContainEqual(
          expect.objectContaining({
            type: "delegated_task.completion-delivery.dispose",
            taskId: fresh.taskId,
          }),
        );
      }).pipe(Effect.provide(baseLayer)),
  );

  it.effect(
    "defers a finished child's continuation at capacity and records its native parent before enforcing the attempt ceiling",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture({ queueNativeMessages: true });
        const workflow = yield* f.seed;
        const pending = yield* pendingAssignment(f.core, workflow);
        const childId = ThreadId.make("finished-planner");
        const taskId = NodeId.make("plan-task");
        yield* f.core.acceptAssignment({
          projectId,
          workflowId: workflow.id,
          assignmentId: "plan",
          intentId: pending.prepared.intent.id,
          childThreadId: childId,
          taskId,
          parentRunId: RunId.make("manager-run"),
        });
        yield* f.put(projection(childId, "completed", RunId.make("plan-run"), taskId));
        yield* f.recordNativeTask(childId, taskId, null);
        const designer = (yield* f.core.roles({ projectId })).roles.find(
          (role) => role.id === "designer",
        )!;
        const design = yield* f.core.prepareAssignment({
          input: {
            ...pending.input,
            assignmentId: "design",
            requestId: "design",
            roleId: "designer",
          },
          actor: { type: "agent", threadId: managerThreadId, runId: RunId.make("manager-run") },
          role: roleSnapshot(designer),
          commandId: CommandId.make("design"),
        });
        const designId = ThreadId.make("active-designer");
        const designTask = NodeId.make("design-task");
        yield* f.core.acceptAssignment({
          projectId,
          workflowId: workflow.id,
          assignmentId: "design",
          intentId: design.intent.id,
          childThreadId: designId,
          taskId: designTask,
          parentRunId: RunId.make("manager-run"),
        });
        yield* f.put(projection(designId, "running", RunId.make("design-run"), designTask));
        yield* f.core.control({
          input: { projectId, workflowId: workflow.id, requestId: "pause", action: "pause" },
          actor: { type: "user" },
        });
        yield* f.core.control({
          input: {
            projectId,
            workflowId: workflow.id,
            requestId: "resume",
            action: "resume",
            limits: { ...DEFAULT_AGENT_WORKFLOW_LIMITS, maxConcurrent: 1, maxAttempts: 3 },
          },
          actor: { type: "user" },
        });
        const request = {
          projectId,
          workflowId: workflow.id,
          requestId: "follow-up",
          generation: 0,
          toThreadId: childId,
          assignmentId: "plan",
          kind: "update" as const,
          summary: "Clarify the plan",
          text: "Confirm the proposed boundary.",
          artifactIds: [],
          replyTo: null,
          blocking: false,
        };
        yield* f.runtime.message(request, scope());
        expect(yield* Ref.get(f.sent)).toEqual([]);
        expect(
          (yield* f.core.read({ projectId, workflowId: workflow.id })).messages[0]?.delivery,
        ).toBe("persisted");
        yield* f.put(projection(designId, "completed", RunId.make("design-run"), designTask));
        yield* f.runtime.reconcile;
        expect(yield* Ref.get(f.sent)).toEqual([]);
        yield* f.recordNativeTask(childId, taskId, "The native task has finalized.");
        yield* f.runtime.reconcile;
        const resumed = yield* f.core.read({ projectId, workflowId: workflow.id });
        expect(yield* Ref.get(f.sent)).toHaveLength(1);
        expect(resumed.assignments[0]?.attempts).toHaveLength(2);
        expect(resumed.assignments[0]?.attempts[1]?.parentRunId).toBe("manager-run");
        const continued = (yield* Ref.get(f.records)).get(childId)!;
        yield* f.put({
          ...continued,
          runs: continued.runs.map((run) => ({ ...run, status: "completed" })),
        });
        yield* f.recordNativeTask(
          childId,
          resumed.assignments[0]!.attempts.at(-1)!.taskId!,
          "The continuation finalized.",
        );
        const duplicate = yield* f.runtime.message(request, scope());
        expect(duplicate.communication?.delivery).toBe("submitted");
        expect(yield* Ref.get(f.sent)).toHaveLength(1);
        const received = yield* f.core.read({ projectId, workflowId: workflow.id });
        expect(received.assignments[0]?.attempts).toHaveLength(2);
        yield* f.runtime.message(request, scope());
        expect((yield* f.core.read({ projectId, workflowId: workflow.id })).revision).toBe(
          received.revision,
        );
        expect(
          yield* f.runtime
            .message({ ...request, requestId: "over-budget" }, scope())
            .pipe(Effect.flip),
        ).toMatchObject({ reason: "limit" });
        expect(yield* Ref.get(f.sent)).toHaveLength(1);
      }).pipe(Effect.provide(baseLayer)),
  );
});
