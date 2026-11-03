import { OrchestratorMcpFailure, type ProjectId, type ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Store from "./AgentWorkflowStore.ts";

const DispatchPermit = Context.Reference<boolean>("t3/fork/agents/DispatchPermit", {
  defaultValue: () => false,
});

export const withWorkflowDispatchPermit = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provideService(DispatchPermit, true));

type Caller = { readonly thread: { readonly threadId: ThreadId } | undefined };

// Capture the optional store before native toolkit registration narrows request dependencies.
export const makeAgentWorkflowDispatchGuard = Effect.gen(function* () {
  const store = yield* Effect.serviceOption(Store.AgentWorkflowStore);
  return Effect.fn("AgentWorkflowDispatchGuard.check")(function* <R>(
    scope: Caller,
    callerProject: Effect.Effect<ProjectId, OrchestratorMcpFailure, R>,
  ) {
    if (!scope.thread || Option.isNone(store) || (yield* DispatchPermit)) return;
    const projectId = yield* callerProject;
    const state = yield* store.value.read(projectId).pipe(
      Effect.mapError(
        () =>
          new OrchestratorMcpFailure({
            code: "orchestration_error",
            message:
              "Workflow ownership could not be verified. Retry after the environment recovers.",
          }),
      ),
    );
    const callerThreadId = scope.thread.threadId;
    const owned = state.workflows.some(
      (workflow) =>
        workflow.status !== "completed" &&
        workflow.status !== "cancelled" &&
        (workflow.managerThreadId === callerThreadId ||
          workflow.participants.some((participant) => participant.threadId === callerThreadId)),
    );
    if (owned)
      return yield* new OrchestratorMcpFailure({
        code: "capability_denied",
        message:
          "This thread belongs to a supervised workflow. Start assignments with omid_assignment_start and communicate with omid_team_message so ownership and limits remain tracked.",
      });
  });
});
