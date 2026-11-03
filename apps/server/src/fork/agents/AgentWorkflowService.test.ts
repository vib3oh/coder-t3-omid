import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  CommandId,
  DEFAULT_AGENT_WORKFLOW_LIMITS,
  MessageId,
  NodeId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type AgentArtifactInput,
  type AgentRolePreset,
  type AgentRoleSnapshot,
  type AgentWorkflow,
  type AgentWorkflowStartInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";
import * as ServerConfig from "../../config.ts";
import * as Service from "./AgentWorkflowService.ts";
import * as Store from "./AgentWorkflowStore.ts";

const layer = Service.layer.pipe(
  Layer.provideMerge(Store.layer),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-agent-workflow-test-" })),
  Layer.provideMerge(NodeServices.layer),
);
const projectId = ProjectId.make("project");
const managerThreadId = ThreadId.make("manager");
const manager = {
  type: "agent" as const,
  threadId: managerThreadId,
  runId: RunId.make("manager-run"),
};
const criteria = [{ id: "criterion", text: "Preserve the requested behavior" }];
const start: AgentWorkflowStartInput = {
  projectId,
  requestId: "start",
  title: "A verified change",
  objective: "Implement the accepted change",
  roleIds: { planner: "planner", builder: "builder", reviewer: "reviewer" },
  sourceThreadId: null,
  cardId: null,
  cardRevision: null,
  criteria,
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6-luna" },
  runtimeMode: "auto-accept-edits",
  interactionMode: "default",
  workspaceStrategy: { type: "worktree", baseRef: "base" },
  limits: DEFAULT_AGENT_WORKFLOW_LIMITS,
};

function snapshot(role: AgentRolePreset): AgentRoleSnapshot {
  return {
    role,
    instructionHash: "instructions",
    modelSelection: start.modelSelection,
    capabilities: [],
    skills: role.requiredSkills.map((id) => ({
      id,
      version: "1",
      contentHash: "content",
      path: `/skills/${id}/SKILL.md`,
      source: "builtin",
      state: "on_demand",
      required: true,
      reason: null,
    })),
  };
}

const setupWithCriteria = Effect.fn("test.setupWithCriteria")(function* (
  workflowCriteria = criteria,
) {
  const service = yield* Service.AgentWorkflowService;
  const settings = yield* service.roles({ projectId });
  yield* service.settings({ projectId, expectedRevision: settings.revision, enabled: true });
  const created = yield* service.create({
    input: { ...start, criteria: workflowCriteria },
    workflowId: "workflow",
    managerThreadId,
    commandId: CommandId.make("launch"),
    baseRef: "base",
    specSnapshot: {
      source: "spec.md",
      content: "Original accepted specification",
      contentHash: "original-spec-hash",
    },
  });
  const workflow = yield* service.acceptLaunch({
    projectId,
    workflowId: created.id,
    workspacePath: "/worktree",
    baseRef: "base",
  });
  return { service, workflow };
});
const setup = setupWithCriteria();

const prepare = Effect.fn("test.prepareAssignment")(function* (
  service: Service.AgentWorkflowService["Service"],
  workflow: AgentWorkflow,
  roleId: string,
  id: string,
  inputs: string[] = [],
  dependencies: string[] = [],
  assignmentCriteria = criteria,
) {
  const role = (yield* service.roles({ projectId })).roles.find((row) => row.id === roleId)!;
  return yield* service.prepareAssignment({
    input: {
      projectId,
      workflowId: workflow.id,
      requestId: `start-${id}`,
      assignmentId: id,
      generation: workflow.generation,
      roleId,
      objective: `Perform ${roleId}`,
      criteria: assignmentCriteria,
      inputArtifactIds: inputs,
      dependencies,
    },
    actor: manager,
    role: snapshot(role),
    commandId: CommandId.make(`command-${id}`),
  });
});

const dispatch = Effect.fn("test.dispatchAssignment")(function* (
  service: Service.AgentWorkflowService["Service"],
  workflow: AgentWorkflow,
  roleId: string,
  id: string,
  inputs: string[] = [],
  dependencies: string[] = [],
  assignmentCriteria = criteria,
) {
  const prepared = yield* prepare(
    service,
    workflow,
    roleId,
    id,
    inputs,
    dependencies,
    assignmentCriteria,
  );
  const actor = {
    type: "agent" as const,
    threadId: ThreadId.make(`thread-${id}`),
    runId: RunId.make(`run-${id}`),
  };
  const accepted = yield* service.acceptAssignment({
    projectId,
    workflowId: workflow.id,
    assignmentId: id,
    intentId: prepared.intent.id,
    childThreadId: actor.threadId,
    taskId: NodeId.make(`task-${id}`),
    parentRunId: manager.runId,
  });
  return {
    workflow: accepted,
    actor,
    assignment: accepted.assignments.find((row) => row.id === id)!,
  };
});

function report(kind: AgentArtifactInput["kind"], head: string | null = null): AgentArtifactInput {
  return {
    kind,
    summary: "The requested behavior was verified",
    content: "Specification and concrete evidence.",
    baseRef: "base",
    headRef: head,
    reviewedHead: kind === "review" ? head : null,
    outcome: "accepted",
    criteria: [{ id: "criterion", passed: true, evidence: ["execution-item"] }],
    checks: head
      ? [
          {
            command: "vp test run relevant.test.ts",
            revision: head,
            status: "passed",
            evidence: "execution-item",
            required: true,
          },
        ]
      : [],
    findings: [],
    limitations: [],
  };
}

const plan = Effect.fn("test.acceptPlan")(function* (
  service: Service.AgentWorkflowService["Service"],
  workflow: AgentWorkflow,
) {
  const task = yield* dispatch(service, workflow, "planner", "plan");
  return yield* service.result({
    input: {
      projectId,
      workflowId: workflow.id,
      requestId: "plan-result",
      assignmentId: "plan",
      generation: workflow.generation,
      artifact: report("spec"),
    },
    actor: task.actor,
    contentHash: "plan-hash",
    verified: true,
  });
});

describe("AgentWorkflowService", () => {
  it.effect(
    "scopes implementation criteria to its stage while retaining every final review criterion",
    () =>
      Effect.gen(function* () {
        const reviewCriterion = {
          id: "review",
          text: "An independent reviewer verifies the exact implementation.",
        };
        const allCriteria = [...criteria, reviewCriterion];
        const { service, workflow } = yield* setupWithCriteria(allCriteria);
        const planned = yield* plan(service, workflow);
        expect(
          yield* prepare(
            service,
            planned,
            "builder",
            "unknown",
            [],
            ["plan"],
            [{ id: "unknown", text: "Unaccepted scope" }],
          ).pipe(Effect.flip),
        ).toMatchObject({ reason: "evidence" });
        const built = yield* dispatch(service, planned, "builder", "build", [], ["plan"], criteria);
        const first = yield* service.result({
          input: {
            projectId,
            workflowId: workflow.id,
            requestId: "build-result",
            assignmentId: "build",
            generation: 0,
            artifact: report("implementation", "head-one"),
          },
          actor: built.actor,
          contentHash: "implementation",
          verified: true,
        });
        expect(first.status).toBe("running");
        expect(first.criteria).toEqual(allCriteria);
        expect(
          yield* prepare(
            service,
            first,
            "reviewer",
            "incomplete-review",
            [first.artifacts.at(-1)!.id],
            ["build"],
            criteria,
          ).pipe(Effect.flip),
        ).toMatchObject({ reason: "evidence" });
        const reviewed = yield* dispatch(
          service,
          first,
          "reviewer",
          "review",
          [first.artifacts.at(-1)!.id],
          ["build"],
          allCriteria,
        );
        const resultInput = {
          projectId,
          workflowId: workflow.id,
          requestId: "review-result",
          assignmentId: "review",
          generation: 0,
          artifact: report("review", "head-one"),
        };
        expect(
          yield* service
            .result({
              input: resultInput,
              actor: reviewed.actor,
              contentHash: "review",
              verified: true,
            })
            .pipe(Effect.flip),
        ).toMatchObject({ reason: "evidence" });
        const done = yield* service.result({
          input: {
            ...resultInput,
            artifact: {
              ...resultInput.artifact,
              criteria: [
                ...resultInput.artifact.criteria,
                {
                  id: reviewCriterion.id,
                  passed: true,
                  evidence: ["Independent inspection of head-one"],
                },
              ],
            },
          },
          actor: reviewed.actor,
          contentHash: "review",
          verified: true,
        });
        expect(done.status).toBe("completed");
      }).pipe(Effect.provide(layer)),
  );
  it.effect.each(["planner", "designer", "builder", "debugger", "reviewer"] as const)(
    "rejects incompatible %s outputs in saved roles and dispatch snapshots",
    (kind) =>
      Effect.gen(function* () {
        const { service, workflow } = yield* setup;
        const catalog = yield* service.roles({ projectId });
        const role = catalog.roles.find((row) => row.kind === kind)!;
        const expected = {
          planner: "spec",
          designer: "design",
          builder: "implementation",
          debugger: "implementation",
          reviewer: "review",
        } as const;
        const malformed: AgentRolePreset = {
          ...role,
          outputKind: kind === "reviewer" ? "implementation" : "review",
        };
        expect(
          yield* service
            .saveRole({ projectId, expectedRevision: catalog.revision, role: malformed })
            .pipe(Effect.flip),
        ).toMatchObject({ reason: "invalid" });
        expect(
          yield* service
            .prepareAssignment({
              input: {
                projectId,
                workflowId: workflow.id,
                requestId: "malformed",
                assignmentId: "malformed",
                generation: workflow.generation,
                roleId: malformed.id,
                objective: "Return the wrong output",
                criteria,
                inputArtifactIds: [],
                dependencies: [],
              },
              actor: manager,
              role: snapshot(malformed),
              commandId: CommandId.make("malformed"),
            })
            .pipe(Effect.flip),
        ).toMatchObject({ reason: "invalid" });
        expect(
          (yield* service.roles({ projectId })).roles.find((row) => row.id === role.id)?.outputKind,
        ).toBe(expected[kind]);
      }).pipe(Effect.provide(layer)),
  );

  it.effect(
    "preserves immutable role snapshots and accepted dispatches across retries and a fresh store",
    () =>
      Effect.gen(function* () {
        const { service, workflow } = yield* setup;
        const replayedLaunch = yield* service.create({
          input: start,
          workflowId: "replacement",
          managerThreadId,
          commandId: CommandId.make("launch"),
          baseRef: "moved-head",
          specSnapshot: {
            source: "spec.md",
            content: "Changed specification",
            contentHash: "changed-spec-hash",
          },
        });
        expect(replayedLaunch.id).toBe(workflow.id);
        expect(replayedLaunch.baseRef).toBe("base");
        expect(replayedLaunch.specSnapshot?.content).toBe("Original accepted specification");
        const state = yield* service.roles({ projectId });
        const prepared = yield* prepare(service, workflow, "planner", "plan");
        expect((yield* service.roles({ projectId })).revision).toBe(state.revision);
        const planner = state.roles.find((row) => row.id === "planner")!;
        const saved = yield* service.saveRole({
          projectId,
          expectedRevision: state.revision,
          role: { ...planner, instructions: "New instructions" },
        });
        expect(saved.roles.find((row) => row.id === "planner")?.version).toBe(2);
        const replayed = yield* service.prepareAssignment({
          input: {
            projectId,
            workflowId: workflow.id,
            requestId: "start-plan",
            assignmentId: "plan",
            generation: 0,
            roleId: "planner",
            objective: "Perform planner",
            criteria,
            inputArtifactIds: [],
            dependencies: [],
          },
          actor: manager,
          role: snapshot(saved.roles.find((row) => row.id === "planner")!),
          commandId: CommandId.make("command-plan"),
        });
        expect(replayed.replayed).toBe(true);
        expect(replayed.assignment.role).toEqual(prepared.assignment.role);
        const fresh = yield* Store.AgentWorkflowStore.pipe(
          Effect.provide(Layer.fresh(Store.layer)),
        );
        expect((yield* fresh.read(projectId)).workflows[0]?.assignments[0]?.role.role.version).toBe(
          1,
        );
        expect(yield* fresh.listProjects()).toEqual([projectId]);
        yield* service.failIntent({
          projectId,
          workflowId: workflow.id,
          intentId: prepared.intent.id,
        });
        const retryInput = {
          projectId,
          workflowId: workflow.id,
          requestId: "fresh-plan",
          assignmentId: "plan",
          generation: 0,
          roleId: "planner",
          objective: "Perform planner",
          criteria,
          inputArtifactIds: [],
          dependencies: [],
        };
        const retried = yield* service.prepareAssignment({
          input: retryInput,
          actor: manager,
          role: snapshot(saved.roles.find((row) => row.id === "planner")!),
          compiledBrief: "Newly compiled instructions",
          commandId: CommandId.make("fresh-command"),
        });
        expect(retried.assignment.role).toEqual(prepared.assignment.role);
        expect(retried.assignment.compiledBrief).toBe(prepared.assignment.compiledBrief);
        expect(retried.assignment.attempts).toHaveLength(2);
        yield* service.failIntent({
          projectId,
          workflowId: workflow.id,
          intentId: retried.intent.id,
        });
        const changedInputs = [
          { objective: "Expanded responsibility" },
          { criteria: [{ id: "criterion", text: "Different criterion" }] },
          { inputArtifactIds: ["different-artifact"] },
          { dependencies: ["different-task"] },
          { roleId: "designer" },
          { modelSelection: { ...start.modelSelection, model: "different-model" } },
        ];
        for (const [index, change] of changedInputs.entries())
          expect(
            yield* service
              .prepareAssignment({
                input: { ...retryInput, ...change, requestId: `changed-${index}` },
                actor: manager,
                role: snapshot(saved.roles.find((row) => row.id === "planner")!),
                commandId: CommandId.make(`changed-${index}`),
              })
              .pipe(Effect.flip),
          ).toMatchObject({ reason: "conflict" });
        expect(
          yield* service
            .saveRole({ projectId, expectedRevision: state.revision, role: planner })
            .pipe(Effect.flip),
        ).toMatchObject({ reason: "conflict" });
      }).pipe(Effect.provide(layer)),
  );

  it.effect(
    "blocks disabled starts and incomplete prerequisites while retaining history and controls",
    () =>
      Effect.gen(function* () {
        const service = yield* Service.AgentWorkflowService;
        expect(
          yield* service
            .create({
              input: start,
              workflowId: "workflow",
              managerThreadId,
              commandId: CommandId.make("launch"),
            })
            .pipe(Effect.flip),
        ).toMatchObject({ reason: "disabled" });
        const { workflow } = yield* setup;
        expect(
          yield* prepare(service, workflow, "builder", "build").pipe(Effect.flip),
        ).toMatchObject({ reason: "dependency" });
        const roles = yield* service.roles({ projectId });
        const role = roles.roles.find((row) => row.id === "planner")!;
        expect(
          yield* service
            .prepareAssignment({
              input: {
                projectId,
                workflowId: workflow.id,
                requestId: "missing-skills",
                assignmentId: "bad",
                generation: 0,
                roleId: role.id,
                objective: "plan",
                criteria,
                inputArtifactIds: [],
                dependencies: [],
              },
              actor: manager,
              role: { ...snapshot(role), skills: [] },
              commandId: CommandId.make("bad"),
            })
            .pipe(Effect.flip),
        ).toMatchObject({ reason: "missing_skill" });
        yield* service.settings({ projectId, expectedRevision: roles.revision, enabled: false });
        expect((yield* service.read({ projectId, workflowId: workflow.id })).status).toBe(
          "running",
        );
        expect(
          (yield* service.control({
            input: { projectId, workflowId: workflow.id, requestId: "pause", action: "pause" },
            actor: { type: "user" },
          })).status,
        ).toBe("paused");
      }).pipe(Effect.provide(layer)),
  );

  it.effect("enforces one writer and current-head independent review", () =>
    Effect.gen(function* () {
      const { service, workflow } = yield* setup;
      const planned = yield* plan(service, workflow);
      const built = yield* dispatch(service, planned, "builder", "build", [], ["plan"]);
      const receipt = built.workflow.intents.find(
        (row) => row.operation === "assignment" && row.entityId === "build",
      )!;
      const lateFailure = yield* service.failIntent({
        projectId,
        workflowId: workflow.id,
        intentId: receipt.id,
      });
      expect(lateFailure.revision).toBe(built.workflow.revision);
      expect(lateFailure.assignments.find((row) => row.id === "build")?.state).toBe(
        "awaiting_result",
      );
      expect(
        yield* prepare(service, built.workflow, "debugger", "debug", [], ["plan"]).pipe(
          Effect.flip,
        ),
      ).toMatchObject({ reason: "writer_busy" });
      const accepted = yield* service.result({
        input: {
          projectId,
          workflowId: workflow.id,
          requestId: "build-result",
          assignmentId: "build",
          generation: 0,
          artifact: report("implementation", "head-one"),
        },
        actor: built.actor,
        contentHash: "build-hash",
        verified: true,
      });
      const implementation = accepted.artifacts.find((row) => row.kind === "implementation")!;
      const reviewed = yield* dispatch(
        service,
        accepted,
        "reviewer",
        "review",
        [implementation.id],
        ["build"],
      );
      expect(
        yield* service
          .result({
            input: {
              projectId,
              workflowId: workflow.id,
              requestId: "wrong-head",
              assignmentId: "review",
              generation: 0,
              artifact: report("review", "head-other"),
            },
            actor: reviewed.actor,
            contentHash: "review-hash",
            verified: true,
          })
          .pipe(Effect.flip),
      ).toMatchObject({ reason: "review_stale" });
      const pending = yield* service.message({
        input: {
          projectId,
          workflowId: workflow.id,
          requestId: "review-question",
          generation: 0,
          toThreadId: reviewed.actor.threadId,
          assignmentId: "review",
          kind: "question",
          summary: "Confirm the remaining limitation",
          text: "Please confirm the limitation.",
          artifactIds: [],
          replyTo: null,
          blocking: true,
        },
        actor: manager,
        commandId: CommandId.make("review-question"),
        messageId: MessageId.make("review-question"),
      });
      expect(
        yield* service
          .result({
            input: {
              projectId,
              workflowId: workflow.id,
              requestId: "blocked-review-result",
              assignmentId: "review",
              generation: 0,
              artifact: report("review", "head-one"),
            },
            actor: reviewed.actor,
            contentHash: "review-hash",
            verified: true,
          })
          .pipe(Effect.flip),
      ).toMatchObject({ reason: "dependency" });
      yield* service.message({
        input: {
          projectId,
          workflowId: workflow.id,
          requestId: "review-answer",
          generation: 0,
          toThreadId: managerThreadId,
          assignmentId: "review",
          kind: "answer",
          summary: "The limitation is documented",
          text: "Confirmed and documented.",
          artifactIds: [],
          replyTo: pending.message.id,
          blocking: false,
        },
        actor: reviewed.actor,
        commandId: CommandId.make("review-answer"),
        messageId: MessageId.make("review-answer"),
      });
      const done = yield* service.result({
        input: {
          projectId,
          workflowId: workflow.id,
          requestId: "review-result",
          assignmentId: "review",
          generation: 0,
          artifact: report("review", "head-one"),
        },
        actor: reviewed.actor,
        contentHash: "review-hash",
        verified: true,
      });
      expect(done.status).toBe("completed");
      expect(done.artifacts.at(-1)?.producerThreadId).toBe(reviewed.actor.threadId);
      expect(
        done.intents.find((row) => row.operation === "message" && row.requestId === "review-answer")
          ?.state,
      ).toBe("cancelled");
      expect(done.messages.find((row) => row.replyTo === pending.message.id)?.delivery).toBe(
        "persisted",
      );
    }).pipe(Effect.provide(layer)),
  );

  it.effect(
    "blocks another review dispatch once the permitted correction rounds are consumed",
    () =>
      Effect.gen(function* () {
        const { service, workflow } = yield* setup;
        yield* service.control({
          input: { projectId, workflowId: workflow.id, requestId: "pause", action: "pause" },
          actor: { type: "user" },
        });
        yield* service.control({
          input: {
            projectId,
            workflowId: workflow.id,
            requestId: "resume",
            action: "resume",
            limits: { ...DEFAULT_AGENT_WORKFLOW_LIMITS, maxReviewRounds: 0 },
          },
          actor: { type: "user" },
        });
        const planned = yield* plan(service, workflow);
        const built = yield* dispatch(service, planned, "builder", "build", [], ["plan"]);
        const first = yield* service.result({
          input: {
            projectId,
            workflowId: workflow.id,
            requestId: "build-result",
            assignmentId: "build",
            generation: 0,
            artifact: report("implementation", "head-one"),
          },
          actor: built.actor,
          contentHash: "first-implementation",
          verified: true,
        });
        const reviewed = yield* dispatch(
          service,
          first,
          "reviewer",
          "review",
          [first.artifacts.at(-1)!.id],
          ["build"],
        );
        const rejected = yield* service.result({
          input: {
            projectId,
            workflowId: workflow.id,
            requestId: "review-result",
            assignmentId: "review",
            generation: 0,
            artifact: {
              ...report("review", "head-one"),
              outcome: "needs_changes",
              findings: [
                {
                  severity: "important",
                  location: "implementation",
                  reason: "A criterion is incomplete.",
                },
              ],
            },
          },
          actor: reviewed.actor,
          contentHash: "review-report",
          verified: true,
        });
        const repair = yield* dispatch(service, rejected, "builder", "repair", [], ["plan"]);
        const repaired = yield* service.result({
          input: {
            projectId,
            workflowId: workflow.id,
            requestId: "repair-result",
            assignmentId: "repair",
            generation: 0,
            artifact: report("implementation", "head-two"),
          },
          actor: repair.actor,
          contentHash: "second-implementation",
          verified: true,
        });
        expect(
          yield* prepare(
            service,
            repaired,
            "reviewer",
            "another-review",
            [repaired.artifacts.at(-1)!.id],
            ["repair"],
          ).pipe(Effect.flip),
        ).toMatchObject({ reason: "limit" });
        expect(
          (yield* service.read({ projectId, workflowId: workflow.id })).assignments,
        ).toHaveLength(4);
      }).pipe(Effect.provide(layer)),
  );

  it.effect(
    "retains failed dispatch intent for explicit bounded retry without letting agents widen limits",
    () =>
      Effect.gen(function* () {
        const { service, workflow } = yield* setup;
        const prepared = yield* prepare(service, workflow, "planner", "plan");
        const failed = yield* service.failIntent({
          projectId,
          workflowId: workflow.id,
          intentId: prepared.intent.id,
        });
        expect(failed.assignments[0]?.state).toBe("failed");
        yield* service.control({
          input: { projectId, workflowId: workflow.id, requestId: "pause", action: "pause" },
          actor: { type: "user" },
        });
        expect(
          yield* service
            .control({
              input: {
                projectId,
                workflowId: workflow.id,
                requestId: "agent-widen",
                action: "resume",
                limits: { ...DEFAULT_AGENT_WORKFLOW_LIMITS, maxAttempts: 99 },
              },
              actor: manager,
            })
            .pipe(Effect.flip),
        ).toMatchObject({ reason: "forbidden" });
        const resumed = yield* service.control({
          input: {
            projectId,
            workflowId: workflow.id,
            requestId: "resume",
            action: "resume",
            limits: { ...DEFAULT_AGENT_WORKFLOW_LIMITS, maxAttempts: 1 },
          },
          actor: { type: "user" },
        });
        const role = (yield* service.roles({ projectId })).roles.find(
          (row) => row.id === "planner",
        )!;
        expect(
          yield* service
            .prepareAssignment({
              input: {
                projectId,
                workflowId: workflow.id,
                requestId: "retry-plan",
                assignmentId: "plan",
                generation: resumed.generation,
                roleId: "planner",
                objective: "Perform planner",
                criteria,
                inputArtifactIds: [],
                dependencies: [],
              },
              actor: manager,
              role: snapshot(role),
              commandId: CommandId.make("retry-command"),
            })
            .pipe(Effect.flip),
        ).toMatchObject({ reason: "limit" });
        const persisted = yield* service.read({ projectId, workflowId: workflow.id });
        expect(persisted.assignments[0]?.attempts).toHaveLength(1);
        expect(persisted.intents.find((row) => row.id === prepared.intent.id)?.state).toBe(
          "failed",
        );
      }).pipe(Effect.provide(layer)),
  );

  it.effect("does not accept terminal claims, failed checks or unverified evidence", () =>
    Effect.gen(function* () {
      const { service, workflow } = yield* setup;
      const planned = yield* plan(service, workflow);
      const built = yield* dispatch(service, planned, "builder", "build", [], ["plan"]);
      expect(built.workflow.assignments.find((row) => row.id === "build")?.state).toBe(
        "awaiting_result",
      );
      const submission = {
        projectId,
        workflowId: workflow.id,
        requestId: "failed-result",
        assignmentId: "build",
        generation: 0,
        artifact: {
          ...report("implementation", "head-one"),
          checks: [
            {
              command: "check",
              revision: "head-one",
              status: "failed" as const,
              evidence: "execution-item",
              required: true,
            },
          ],
        },
      };
      expect(
        yield* service
          .result({ input: submission, actor: built.actor, contentHash: "failed", verified: true })
          .pipe(Effect.flip),
      ).toMatchObject({ reason: "evidence" });
      const pending = yield* service.result({
        input: {
          ...submission,
          requestId: "unverified-result",
          artifact: report("implementation", "head-one"),
        },
        actor: built.actor,
        contentHash: "unverified",
        verified: false,
      });
      expect(pending.assignments.find((row) => row.id === "build")?.state).toBe("validating");
      expect(pending.status).toBe("running");
      expect(pending.artifacts.at(-1)?.validation).toBe("unverified");
    }).pipe(Effect.provide(layer)),
  );

  it.effect.each(["builder", "reviewer"] as const)(
    "retains a blocked %s report without claiming revision verification or stage acceptance",
    (roleId) =>
      Effect.gen(function* () {
        const { service, workflow } = yield* setup;
        const planned = yield* plan(service, workflow);
        const built = yield* dispatch(service, planned, "builder", "build", [], ["plan"]);
        let producer = built;
        if (roleId === "builder")
          yield* service.recordCheckpoint({
            projectId,
            workflowId: workflow.id,
            assignmentId: "build",
            actor: built.actor,
            ref: "refs/t3/workflows/writer",
            commitSha: "head-one",
          });
        else {
          const accepted = yield* service.result({
            input: {
              projectId,
              workflowId: workflow.id,
              requestId: "implementation",
              assignmentId: "build",
              generation: 0,
              artifact: report("implementation", "head-one"),
            },
            actor: built.actor,
            contentHash: "implementation",
            verified: true,
          });
          producer = yield* dispatch(
            service,
            accepted,
            "reviewer",
            "review",
            [accepted.artifacts.at(-1)!.id],
            ["build"],
          );
        }
        const retained = yield* service.result({
          input: {
            projectId,
            workflowId: workflow.id,
            requestId: "blocked-result",
            assignmentId: producer.assignment.id,
            generation: 0,
            artifact: {
              ...report(producer.assignment.role.role.outputKind),
              outcome: "blocked",
              summary: "Verification is blocked",
              content: "The required environment is unavailable.",
              criteria: [],
              checks: [],
              limitations: ["No revision-bound verification was possible."],
            },
          },
          actor: producer.actor,
          contentHash: "blocked-content",
          verified: true,
        });
        expect(retained.assignments.find((row) => row.id === producer.assignment.id)?.state).toBe(
          "awaiting_user",
        );
        expect(retained.artifacts.at(-1)).toMatchObject({
          outcome: "blocked",
          validation: "unverified",
          headRef: null,
          reviewedHead: null,
          contentHash: "blocked-content",
        });
        expect(retained.status).toBe("running");
      }).pipe(Effect.provide(layer)),
  );

  it.effect(
    "correlates concurrent questions and authenticates human answers without impersonating agents",
    () =>
      Effect.gen(function* () {
        const { service, workflow } = yield* setup;
        const asker = yield* dispatch(service, workflow, "planner", "plan");
        const recipient = yield* dispatch(service, asker.workflow, "designer", "design");
        const send = (
          requestId: string,
          toThreadId: ThreadId,
          kind: "question" | "answer" | "update",
          actor: Service.AgentWorkflowActor,
          replyTo: string | null = null,
        ) =>
          service.message({
            input: {
              projectId,
              workflowId: workflow.id,
              requestId,
              generation: 0,
              toThreadId,
              assignmentId: "plan",
              kind,
              summary: requestId,
              text: requestId,
              artifactIds: [],
              replyTo,
              blocking: kind === "question",
            },
            actor,
            commandId: CommandId.make(requestId),
            messageId: MessageId.make(requestId),
          });
        const first = yield* send(
          "first-question",
          recipient.actor.threadId,
          "question",
          asker.actor,
        );
        const second = yield* send("second-question", managerThreadId, "question", asker.actor);
        const receipt = yield* service.ack({
          input: {
            projectId,
            workflowId: workflow.id,
            requestId: "first-receipt",
            messageId: first.message.id,
            generation: 0,
          },
          actor: recipient.actor,
        });
        expect(receipt.intents.find((row) => row.id === first.intent.id)?.state).toBe("accepted");
        const unchanged = yield* service.delivery({
          projectId,
          workflowId: workflow.id,
          messageId: first.message.id,
          delivery: "queued",
        });
        expect(unchanged.revision).toBe(receipt.revision);
        expect(unchanged.messages.find((row) => row.id === first.message.id)?.delivery).toBe(
          "acknowledged",
        );
        yield* send("progress", asker.actor.threadId, "update", recipient.actor);
        expect(
          (yield* service.read({ projectId, workflowId: workflow.id })).messages.filter(
            (row) => row.questionState === "pending",
          ),
        ).toHaveLength(2);
        expect(
          yield* send(
            "wrong-sender",
            asker.actor.threadId,
            "answer",
            manager,
            first.message.id,
          ).pipe(Effect.flip),
        ).toMatchObject({ reason: "forbidden" });
        const answered = yield* send(
          "first-answer",
          asker.actor.threadId,
          "answer",
          recipient.actor,
          first.message.id,
        );
        expect(answered.workflow.assignments.find((row) => row.id === "plan")?.state).toBe(
          "awaiting_peer",
        );
        expect(answered.workflow.intents.find((row) => row.id === first.intent.id)?.state).toBe(
          "accepted",
        );
        const human = yield* send(
          "human-answer",
          asker.actor.threadId,
          "answer",
          { type: "user" },
          second.message.id,
        );
        expect(human.message.origin).toBe("user");
        expect(human.message.senderThreadId).toBeNull();
        expect(human.workflow.intents.find((row) => row.id === second.intent.id)?.state).toBe(
          "cancelled",
        );
        expect(human.workflow.assignments.find((row) => row.id === "plan")?.state).toBe(
          "awaiting_result",
        );
        expect(
          (yield* send(
            "human-answer",
            asker.actor.threadId,
            "answer",
            { type: "user" },
            second.message.id,
          )).replayed,
        ).toBe(true);
        expect(
          yield* send("human-answer", asker.actor.threadId, "update", { type: "user" }).pipe(
            Effect.flip,
          ),
        ).toMatchObject({ reason: "idempotency_conflict" });
        expect(
          yield* send("outsider", managerThreadId, "update", {
            type: "agent",
            threadId: ThreadId.make("outsider"),
            runId: RunId.make("outside-run"),
          }).pipe(Effect.flip),
        ).toMatchObject({ reason: "forbidden" });
      }).pipe(Effect.provide(layer)),
  );

  it.effect(
    "expires waits with TestClock and cancels pending work without accepting late results",
    () =>
      Effect.gen(function* () {
        const { service, workflow } = yield* setup;
        const asker = yield* dispatch(service, workflow, "planner", "plan");
        const question = yield* service.message({
          input: {
            projectId,
            workflowId: workflow.id,
            requestId: "question",
            generation: 0,
            toThreadId: managerThreadId,
            assignmentId: "plan",
            kind: "question",
            summary: "Need a scope decision",
            text: "Which option?",
            artifactIds: [],
            replyTo: null,
            blocking: true,
          },
          actor: asker.actor,
          commandId: CommandId.make("question"),
          messageId: MessageId.make("question"),
        });
        yield* TestClock.adjust(DEFAULT_AGENT_WORKFLOW_LIMITS.questionTimeoutMs);
        const expired = yield* service.expireQuestions({ projectId, workflowId: workflow.id });
        expect(expired.messages.find((row) => row.id === question.message.id)?.questionState).toBe(
          "expired",
        );
        expect(expired.status).toBe("waiting_user");
        const cancelled = yield* service.control({
          input: { projectId, workflowId: workflow.id, requestId: "cancel", action: "cancel" },
          actor: { type: "user" },
        });
        expect(cancelled.generation).toBe(1);
        expect(cancelled.assignments[0]?.state).toBe("cancelled");
        expect(
          yield* service
            .result({
              input: {
                projectId,
                workflowId: workflow.id,
                requestId: "late-result",
                assignmentId: "plan",
                generation: 0,
                artifact: report("spec"),
              },
              actor: asker.actor,
              contentHash: "late",
              verified: true,
            })
            .pipe(Effect.flip),
        ).toMatchObject({ reason: "stale" });
      }).pipe(Effect.provide(layer)),
  );

  it.effect(
    "recovers a failed initial launch with pinned inputs and keeps repeated cancellation stable",
    () =>
      Effect.gen(function* () {
        const service = yield* Service.AgentWorkflowService;
        yield* service.settings({ projectId, expectedRevision: 0, enabled: true });
        const created = yield* service.create({
          input: start,
          workflowId: "workflow",
          managerThreadId,
          commandId: CommandId.make("launch"),
          baseRef: "pinned-base",
        });
        yield* service.failIntent({
          projectId,
          workflowId: created.id,
          intentId: created.intents[0]!.id,
        });
        const retried = yield* service.control({
          input: { projectId, workflowId: created.id, requestId: "retry-launch", action: "retry" },
          actor: { type: "user" },
        });
        expect(retried.workspacePath).toBeNull();
        expect(retried.intents.find((row) => row.operation === "launch")).toMatchObject({
          state: "pending",
          generation: retried.generation,
          commandId: "launch",
        });
        const accepted = yield* service.acceptLaunch({
          projectId,
          workflowId: created.id,
          workspacePath: "/recovered-worktree",
          baseRef: "moved-branch",
        });
        expect(accepted.workspacePath).toBe("/recovered-worktree");
        expect(accepted.baseRef).toBe("pinned-base");
        const cancelled = yield* service.control({
          input: { projectId, workflowId: created.id, requestId: "cancel-once", action: "cancel" },
          actor: { type: "user" },
        });
        expect(
          (yield* service.control({
            input: {
              projectId,
              workflowId: created.id,
              requestId: "cancel-recovery",
              action: "cancel",
            },
            actor: { type: "user" },
          })).generation,
        ).toBe(cancelled.generation);
        expect(
          (yield* service.acceptLaunch({
            projectId,
            workflowId: created.id,
            workspacePath: "/other",
            baseRef: "other",
          })).status,
        ).toBe("cancelled");
      }).pipe(Effect.provide(layer)),
  );

  it.effect(
    "binds checkpoints and cancellation to the current assignment attempt while retaining evidence",
    () =>
      Effect.gen(function* () {
        const { service, workflow } = yield* setup;
        const planned = yield* plan(service, workflow);
        const built = yield* dispatch(service, planned, "builder", "build", [], ["plan"]);
        expect(
          yield* service
            .recordCheckpoint({
              projectId,
              workflowId: workflow.id,
              assignmentId: "build",
              actor: manager,
              ref: "refs/t3/snapshot",
              commitSha: "snapshot-head",
            })
            .pipe(Effect.flip),
        ).toMatchObject({ reason: "forbidden" });
        yield* service.recordCheckpoint({
          projectId,
          workflowId: workflow.id,
          assignmentId: "build",
          actor: built.actor,
          ref: "refs/t3/snapshot",
          commitSha: "snapshot-head",
        });
        expect(
          yield* service
            .result({
              input: {
                projectId,
                workflowId: workflow.id,
                requestId: "wrong-snapshot",
                assignmentId: "build",
                generation: 0,
                artifact: report("implementation", "old-head"),
              },
              actor: built.actor,
              contentHash: "hash",
              verified: true,
            })
            .pipe(Effect.flip),
        ).toMatchObject({ reason: "evidence" });
        yield* service.result({
          input: {
            projectId,
            workflowId: workflow.id,
            requestId: "pending-evidence",
            assignmentId: "build",
            generation: 0,
            artifact: report("implementation", "snapshot-head"),
          },
          actor: built.actor,
          contentHash: "hash",
          verified: false,
        });
        const cancelInput = {
          projectId,
          workflowId: workflow.id,
          assignmentId: "build",
          requestId: "cancel-build",
          action: "cancel" as const,
        };
        const cancelled = yield* service.controlAssignment({
          input: cancelInput,
          actor: { type: "user" },
        });
        const targetAttempt = cancelled.intents.find(
          (row) => row.requestId === cancelInput.requestId,
        )?.targetAttemptId;
        expect(targetAttempt).toBe(built.assignment.attempts[0]?.id);
        yield* service.controlAssignment({
          input: { ...cancelInput, requestId: "retry-build", action: "retry" },
          actor: manager,
        });
        const builder = (yield* service.roles({ projectId })).roles.find(
          (row) => row.id === "builder",
        )!;
        const prepared = yield* service.prepareAssignment({
          input: {
            projectId,
            workflowId: workflow.id,
            requestId: "new-build-attempt",
            assignmentId: "build",
            generation: 0,
            roleId: "builder",
            objective: "Perform builder",
            criteria,
            inputArtifactIds: [],
            dependencies: ["plan"],
          },
          actor: manager,
          role: snapshot(builder),
          commandId: CommandId.make("new-build-command"),
        });
        expect(prepared.assignment.artifactIds).toHaveLength(1);
        expect(prepared.assignment.checkpoint).toBeNull();
        const previousIntent = built.workflow.intents.find(
          (row) => row.entityId === "build" && row.operation === "assignment",
        )!;
        expect(
          yield* service
            .acceptAssignment({
              projectId,
              workflowId: workflow.id,
              assignmentId: "build",
              intentId: previousIntent.id,
              childThreadId: built.actor.threadId,
              taskId: NodeId.make("task-build"),
              parentRunId: manager.runId,
            })
            .pipe(Effect.flip),
        ).toMatchObject({ reason: "stale" });
        expect(
          (yield* service.controlAssignment({
            input: cancelInput,
            actor: { type: "user" },
          })).assignments.find((row) => row.id === "build")?.state,
        ).toBe("dispatching");
      }).pipe(Effect.provide(layer)),
  );

  it.effect(
    "requires server-derived coverage of configured checks despite self-reported success",
    () =>
      Effect.gen(function* () {
        const { service } = yield* setup;
        const checked = yield* service.create({
          input: { ...start, requestId: "checked-start", requiredChecks: ["vp run check:changed"] },
          workflowId: "checked-workflow",
          managerThreadId,
          commandId: CommandId.make("checked-launch"),
        });
        const ready = yield* service.acceptLaunch({
          projectId,
          workflowId: checked.id,
          workspacePath: "/checked-worktree",
          baseRef: "base",
        });
        const planned = yield* plan(service, ready);
        const built = yield* dispatch(service, planned, "builder", "checked-build", [], ["plan"]);
        const artifact = {
          ...report("implementation", "head"),
          checks: [
            {
              command: "vp run check:changed",
              revision: "head",
              status: "passed" as const,
              required: false,
              evidence: "native-item",
            },
          ],
        };
        const input = {
          projectId,
          workflowId: checked.id,
          requestId: "checked-result",
          assignmentId: "checked-build",
          generation: 0,
          artifact,
        };
        expect(
          yield* service
            .result({
              input,
              actor: built.actor,
              contentHash: "checked-hash",
              verified: true,
              verifiedRequiredChecks: [],
            })
            .pipe(Effect.flip),
        ).toMatchObject({ reason: "evidence" });
        const accepted = yield* service.result({
          input,
          actor: built.actor,
          contentHash: "checked-hash",
          verified: true,
          verifiedRequiredChecks: ["vp run check:changed"],
        });
        expect(accepted.assignments.find((row) => row.id === "checked-build")?.state).toBe(
          "accepted",
        );
      }).pipe(Effect.provide(layer)),
  );

  it.effect("preserves corrupt or failed-write stores and releases the project save lock", () =>
    Effect.gen(function* () {
      const { service } = yield* setup;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const config = yield* ServerConfig.ServerConfig;
      const before = yield* service.roles({ projectId });
      let fail = true;
      const brokenStore = yield* Store.AgentWorkflowStore.pipe(
        Effect.provide(Layer.fresh(Store.layer)),
        Effect.provideService(FileSystem.FileSystem, {
          ...fs,
          rename: (from, to) =>
            fail ? fs.rename(path.join(config.stateDir, "missing"), to) : fs.rename(from, to),
        }),
      );
      expect(
        yield* brokenStore
          .update(projectId, (state) =>
            Effect.succeed({ state: { ...state, enabled: false }, result: undefined }),
          )
          .pipe(Effect.flip),
      ).toMatchObject({ reason: "storage" });
      expect(yield* service.roles({ projectId })).toEqual(before);
      fail = false;
      yield* brokenStore.update(projectId, (state) =>
        Effect.succeed({ state: { ...state, enabled: false }, result: undefined }),
      );
      expect((yield* service.roles({ projectId })).enabled).toBe(false);
      const file = path.join(config.stateDir, "extensions", "agents", "project-project.json");
      yield* fs.writeFileString(file, "broken-json");
      expect(yield* service.roles({ projectId }).pipe(Effect.flip)).toMatchObject({
        reason: "invalid",
      });
      expect(yield* fs.readFileString(file)).toBe("broken-json");
    }).pipe(Effect.provide(layer)),
  );
});
