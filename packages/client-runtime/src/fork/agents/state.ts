import { WS_METHODS, type EnvironmentId, type ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import * as EnvironmentRegistry from "../../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "../../state/runtime.ts";

export function createAgentWorkflowState<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, E>,
) {
  const list = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: WS_METHODS.agentWorkflowList,
    tag: WS_METHODS.agentWorkflowList,
    staleTimeMs: 0,
    refreshIntervalMs: 5_000,
  });
  const version = Atom.family(
    (target: {
      readonly environmentId: EnvironmentId;
      readonly projectId: ProjectId;
      readonly workflowId: string;
    }) =>
      Atom.make((get) => {
        const result = get(
          list({ environmentId: target.environmentId, input: { projectId: target.projectId } }),
        );
        const workflow = Option.getOrNull(AsyncResult.value(result))?.workflows.find(
          (entry) => entry.id === target.workflowId,
        );
        return workflow
          ? JSON.stringify([
              workflow.revision,
              workflow.humanInputPending ?? false,
              [...(workflow.humanInputThreadIds ?? [])].sort(),
            ])
          : null;
      }),
  );
  const read = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: WS_METHODS.agentWorkflowRead,
    tag: WS_METHODS.agentWorkflowRead,
    staleTimeMs: 0,
    refreshTrigger: (target) => version({ environmentId: target.environmentId, ...target.input }),
  });
  const roles = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: WS_METHODS.agentRolesRead,
    tag: WS_METHODS.agentRolesRead,
    staleTimeMs: 0,
  });
  const immutableContent = Atom.make(null);
  const content = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: WS_METHODS.agentWorkflowContent,
    tag: WS_METHODS.agentWorkflowContent,
    staleTimeMs: 60_000,
    refreshTrigger: (target) =>
      target.input.kind === "assignment"
        ? version({ environmentId: target.environmentId, ...target.input })
        : immutableContent,
  });
  const preview = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: WS_METHODS.agentRolePreview,
    tag: WS_METHODS.agentRolePreview,
    staleTimeMs: 0,
    refreshTrigger: (target) =>
      roles({ environmentId: target.environmentId, input: { projectId: target.input.projectId } }),
  });
  const skills = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: WS_METHODS.agentSkillsRead,
    tag: WS_METHODS.agentSkillsRead,
    staleTimeMs: 60_000,
  });
  const refresh = (
    target: {
      readonly environmentId: EnvironmentId;
      readonly input: { readonly projectId: ProjectId; readonly workflowId?: string };
    },
    registry: AtomRegistry.AtomRegistry,
  ) =>
    Effect.sync(() => {
      registry.refresh(
        list({ environmentId: target.environmentId, input: { projectId: target.input.projectId } }),
      );
      if (target.input.workflowId)
        registry.refresh(
          read({
            environmentId: target.environmentId,
            input: { projectId: target.input.projectId, workflowId: target.input.workflowId },
          }),
        );
    });
  const start = createEnvironmentRpcCommand(runtime, {
    label: WS_METHODS.agentWorkflowStart,
    tag: WS_METHODS.agentWorkflowStart,
    onSuccess: refresh,
  });
  const control = createEnvironmentRpcCommand(runtime, {
    label: WS_METHODS.agentWorkflowControl,
    tag: WS_METHODS.agentWorkflowControl,
    onSuccess: refresh,
  });
  const assignmentControl = createEnvironmentRpcCommand(runtime, {
    label: WS_METHODS.agentAssignmentControl,
    tag: WS_METHODS.agentAssignmentControl,
    onSuccess: refresh,
  });
  const message = createEnvironmentRpcCommand(runtime, {
    label: WS_METHODS.agentTeamMessage,
    tag: WS_METHODS.agentTeamMessage,
    onSuccess: refresh,
  });
  const saveRole = createEnvironmentRpcCommand(runtime, {
    label: WS_METHODS.agentRoleSave,
    tag: WS_METHODS.agentRoleSave,
    onSuccess: (target, registry) =>
      Effect.sync(() => {
        registry.refresh(
          roles({
            environmentId: target.environmentId,
            input: { projectId: target.input.projectId },
          }),
        );
      }),
  });
  const settings = createEnvironmentRpcCommand(runtime, {
    label: WS_METHODS.agentWorkflowSettings,
    tag: WS_METHODS.agentWorkflowSettings,
    onSuccess: (target, registry) =>
      Effect.sync(() => {
        registry.refresh(
          roles({
            environmentId: target.environmentId,
            input: { projectId: target.input.projectId },
          }),
        );
        registry.refresh(
          list({
            environmentId: target.environmentId,
            input: { projectId: target.input.projectId },
          }),
        );
      }),
  });
  return {
    list,
    read,
    roles,
    content,
    preview,
    skills,
    start,
    control,
    assignmentControl,
    message,
    saveRole,
    settings,
  };
}
