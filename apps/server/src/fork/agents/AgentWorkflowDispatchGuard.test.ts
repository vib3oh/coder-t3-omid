import { assert, it } from "@effect/vitest";
import {
  AgentWorkflowError,
  OrchestratorMcpFailure,
  ProjectId,
  ThreadId,
  type AgentWorkflowProject,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Store from "./AgentWorkflowStore.ts";
import {
  makeAgentWorkflowDispatchGuard,
  withWorkflowDispatchPermit,
} from "./AgentWorkflowDispatchGuard.ts";

const projectId = ProjectId.make("workflow-project");
const threadId = ThreadId.make("workflow-manager");
const scope = { thread: { threadId } };

it.effect(
  "captures workflow ownership before native tool dependency narrowing and confines permits to their effect",
  () =>
    Effect.gen(function* () {
      const state = yield* Ref.make({
        workflows: [
          {
            id: "workflow",
            status: "running",
            managerThreadId: threadId,
            participants: [{ threadId: ThreadId.make("workflow-child") }],
          },
        ],
      } as unknown as AgentWorkflowProject);
      const guard = yield* makeAgentWorkflowDispatchGuard.pipe(
        Effect.provideService(
          Store.AgentWorkflowStore,
          Store.AgentWorkflowStore.of({
            read: () => Ref.get(state),
            listProjects: () => Effect.succeed([projectId]),
            update: () => Effect.die("read-only guard"),
          }),
        ),
      );
      const check = () => guard(scope, Effect.succeed(projectId));
      assert.equal((yield* check().pipe(Effect.flip)).code, "capability_denied");
      const [permitted, denied] = yield* Effect.all([
        withWorkflowDispatchPermit(check()).pipe(Effect.as("permitted")),
        check().pipe(Effect.flip),
      ]);
      assert.equal(permitted, "permitted");
      assert.equal(denied.code, "capability_denied");
      assert.equal(
        (yield* guard(
          { thread: { threadId: ThreadId.make("workflow-child") } },
          Effect.succeed(projectId),
        ).pipe(Effect.flip)).code,
        "capability_denied",
      );
      yield* guard({ thread: { threadId: ThreadId.make("ordinary") } }, Effect.succeed(projectId));
      yield* Ref.update(state, (current) => ({
        ...current,
        workflows: current.workflows.map((row) => ({ ...row, status: "completed" as const })),
      }));
      yield* check();
    }),
);

it.effect(
  "preserves ordinary dispatch without the extension and fails closed when ownership storage fails",
  () =>
    Effect.gen(function* () {
      const absent = yield* makeAgentWorkflowDispatchGuard;
      yield* absent(scope, Effect.die("ordinary dispatch does not read extension ownership"));
      const failure = new OrchestratorMcpFailure({
        code: "orchestration_error",
        message: "Unavailable",
      });
      const guarded = yield* makeAgentWorkflowDispatchGuard.pipe(
        Effect.provideService(
          Store.AgentWorkflowStore,
          Store.AgentWorkflowStore.of({
            read: () => Effect.fail(new AgentWorkflowError({ reason: "storage" })),
            listProjects: () => Effect.succeed([]),
            update: () => Effect.die("read-only guard"),
          }),
        ),
      );
      assert.equal(
        (yield* guarded(scope, Effect.succeed(projectId)).pipe(Effect.flip)).code,
        failure.code,
      );
      yield* guarded(
        { thread: undefined },
        Effect.die("external client has no participant identity"),
      );
    }),
);
