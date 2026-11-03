import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Runtime from "../../../fork/agents/AgentWorkflowRuntimeService.ts";
import * as Invocation from "../../McpInvocationContext.ts";
import * as Access from "../../McpToolAccess.ts";
import { AgentWorkflowToolkit } from "./tools.ts";

const publicFailure = Effect.mapError(
  (error: { readonly message: string }) =>
    new OrchestratorMcpFailure({ code: "invalid_request", message: error.message }),
);

const requireOrchestration = Invocation.McpInvocationContext.pipe(
  Effect.flatMap((scope) =>
    scope.capabilities.has("orchestration")
      ? Effect.void
      : Effect.fail(
          new OrchestratorMcpFailure({
            code: "capability_denied",
            message: "This credential cannot access agent orchestration.",
          }),
        ),
  ),
);

const handlers = {
  omid_agent_roles: Access.reads((input) =>
    Effect.gen(function* () {
      yield* requireOrchestration;
      return yield* (yield* Runtime.AgentWorkflowRuntimeService).roles(input).pipe(publicFailure);
    }),
  ),
  omid_team_read: Access.reads((input) =>
    Effect.gen(function* () {
      yield* requireOrchestration;
      return yield* (yield* Runtime.AgentWorkflowRuntimeService)
        .read(input, yield* Invocation.McpInvocationContext)
        .pipe(publicFailure);
    }),
  ),
  omid_team_content: Access.reads((input) =>
    Effect.gen(function* () {
      yield* requireOrchestration;
      return yield* (yield* Runtime.AgentWorkflowRuntimeService)
        .content(input, yield* Invocation.McpInvocationContext)
        .pipe(publicFailure);
    }),
  ),
  omid_assignment_start: Access.actsAsCaller((input) =>
    Effect.gen(function* () {
      yield* requireOrchestration;
      return yield* (yield* Runtime.AgentWorkflowRuntimeService)
        .startAssignment(input, yield* Invocation.McpInvocationContext)
        .pipe(publicFailure);
    }),
  ),
  omid_assignment_snapshot: Access.actsAsCaller((input) =>
    Effect.gen(function* () {
      yield* requireOrchestration;
      return yield* (yield* Runtime.AgentWorkflowRuntimeService)
        .snapshot(input, yield* Invocation.McpInvocationContext)
        .pipe(publicFailure);
    }),
  ),
  omid_assignment_checks: Access.reads((input) =>
    Effect.gen(function* () {
      yield* requireOrchestration;
      return yield* (yield* Runtime.AgentWorkflowRuntimeService)
        .checks(input, yield* Invocation.McpInvocationContext)
        .pipe(publicFailure);
    }),
  ),
  omid_assignment_result: Access.actsAsCaller((input) =>
    Effect.gen(function* () {
      yield* requireOrchestration;
      return yield* (yield* Runtime.AgentWorkflowRuntimeService)
        .result(input, yield* Invocation.McpInvocationContext)
        .pipe(publicFailure);
    }),
  ),
  omid_team_message: Access.actsAsCaller((input) =>
    Effect.gen(function* () {
      yield* requireOrchestration;
      const view = yield* (yield* Runtime.AgentWorkflowRuntimeService)
        .message(input, yield* Invocation.McpInvocationContext)
        .pipe(publicFailure);
      if (!view.communication)
        return yield* new OrchestratorMcpFailure({
          code: "orchestration_error",
          message: "Message delivery returned no communication receipt.",
        });
      return { communication: view.communication };
    }),
  ),
  omid_team_ack: Access.actsAsCaller((input) =>
    Effect.gen(function* () {
      yield* requireOrchestration;
      return yield* (yield* Runtime.AgentWorkflowRuntimeService)
        .ack(input, yield* Invocation.McpInvocationContext)
        .pipe(publicFailure);
    }),
  ),
  omid_team_control: Access.actsAsCaller((input) =>
    Effect.gen(function* () {
      yield* requireOrchestration;
      return yield* (yield* Runtime.AgentWorkflowRuntimeService)
        .control(input, yield* Invocation.McpInvocationContext)
        .pipe(publicFailure);
    }),
  ),
} satisfies Access.Handlers<typeof AgentWorkflowToolkit.tools>;

export const layer = Access.toLayer(AgentWorkflowToolkit, handlers);
