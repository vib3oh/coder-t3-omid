import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { scopedProjectKey } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { CommunicationMessage } from "@t3tools/client-runtime/fork/agents/communication";
import {
  WORKFLOW_LIMIT_FIELDS,
  parseWorkflowLimits,
  workflowLimitDraft,
} from "@t3tools/client-runtime/fork/agents/limits";
import {
  DEFAULT_AGENT_WORKFLOW_LIMITS,
  type AgentRolePreset,
  type AgentWorkflow,
  type AgentWorkflowLimits,
  type AgentWorkflowStartInput,
  type EnvironmentId,
  type ModelSelection,
  type RuntimeMode,
  type RoadmapView,
  AgentRolePreviewResult,
} from "@t3tools/contracts";
import { Link, useSearch } from "@tanstack/react-router";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { AsyncResult, Atom } from "effect/reactivity";
import * as Option from "effect/Option";
import { UsersIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { SidebarInset, SidebarTrigger } from "../../components/ui/sidebar";
import { WorkspacePageHeader } from "../../components/WorkspacePageHeader";
import { useProjects, useThreadShells } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { randomUUID } from "../../lib/utils";
import { isElectron } from "../../env";
import {
  resolveProjectDefaultProviderModelSelection,
  providerInstanceEntriesFor,
  isProviderInstancePickerReady,
} from "../../providerInstances";
import { AgentCommunication, WorkflowContent } from "./AgentCommunication";
import { agentWorkflows } from "./agentWorkflowState";
import { roadmapRead } from "../../roadmap/roadmapState";

const SELECT = "rounded-md border border-input bg-background px-2 py-2 text-sm";
const EMPTY_PREVIEW = Atom.make<
  AsyncResult.AsyncResult<typeof AgentRolePreviewResult.Type, unknown>
>(AsyncResult.initial());
const EMPTY_BOARD = Atom.make<AsyncResult.AsyncResult<RoadmapView, unknown>>(AsyncResult.initial());
const STATE_LABELS = {
  draft: "Preparing",
  running: "Working",
  waiting_user: "Needs your answer",
  paused: "Paused",
  completed: "Reviewed result",
  failed: "Stopped with a problem",
  cancelled: "Cancelled",
} as const;

export function AgentWorkflowsPage() {
  const { environments } = useEnvironments();
  const search = useSearch({ from: "/_chat/agent-workflows" });
  const projects = useProjects().filter((project) => !project.archivedAt);
  const [chosenProject, setChosenProject] = useState<string | null>(null);
  const initial = projects.find(
    (project) =>
      (!search.environmentId || project.environmentId === search.environmentId) &&
      (!search.projectId || project.id === search.projectId),
  );
  const project =
    chosenProject !== null
      ? projects.find(
          (entry) =>
            scopedProjectKey({ environmentId: entry.environmentId, projectId: entry.id }) ===
            chosenProject,
        )
      : search.environmentId || search.projectId
        ? initial
        : projects[0];
  return (
    <SidebarInset role="main" className="h-dvh min-h-0 overflow-hidden">
      <WorkspacePageHeader electron={isElectron}>
        <SidebarTrigger />
        <UsersIcon className="size-4 text-muted-foreground" />
        <h1 className="text-sm font-medium">Agent workflows</h1>
      </WorkspacePageHeader>
      <div className="scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto max-w-6xl space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold">A clear handoff at every stage</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Plan, build and independently review work in your project’s environment.
              </p>
            </div>
            <select
              className={`${SELECT} w-full min-w-0 max-w-full sm:w-auto`}
              aria-label="Workflow project"
              value={
                project
                  ? scopedProjectKey({
                      environmentId: project.environmentId,
                      projectId: project.id,
                    })
                  : ""
              }
              onChange={(event) => setChosenProject(event.target.value)}
            >
              {projects.map((entry) => (
                <option
                  key={`${entry.environmentId}:${entry.id}`}
                  value={scopedProjectKey({
                    environmentId: entry.environmentId,
                    projectId: entry.id,
                  })}
                >
                  {entry.title} ·{" "}
                  {environments.find(
                    (environment) => environment.environmentId === entry.environmentId,
                  )?.label ?? "Unavailable environment"}{" "}
                  · {entry.workspaceRoot}
                </option>
              ))}
            </select>
          </div>
          {project ? (
            <ProjectWorkflows
              key={`${project.environmentId}:${project.id}`}
              project={project}
              initialWorkflow={initial === project ? search.workflowId : undefined}
              sourceThreadId={initial === project ? search.sourceThreadId : undefined}
              cardId={initial === project ? search.cardId : undefined}
              rolesInitiallyOpen={search.roles === true}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              {search.environmentId || search.projectId
                ? "The selected project is unavailable. Reconnect its environment or choose another project."
                : "Add or connect a project to use agent workflows."}
            </p>
          )}
        </div>
      </div>
    </SidebarInset>
  );
}

function errorText(result: Parameters<typeof squashAtomCommandFailure>[0]) {
  const cause = squashAtomCommandFailure(result);
  return cause instanceof Error
    ? cause.message
    : "The operation could not finish. Reload to check its current state.";
}

function ProjectWorkflows({
  project,
  initialWorkflow,
  sourceThreadId,
  cardId,
  rolesInitiallyOpen,
}: {
  project: EnvironmentProject;
  initialWorkflow?: string | undefined;
  sourceThreadId?: string | undefined;
  cardId?: string | undefined;
  rolesInitiallyOpen: boolean;
}) {
  const target = { environmentId: project.environmentId, input: { projectId: project.id } };
  const listResult = useAtomValue(agentWorkflows.list(target));
  const rolesResult = useAtomValue(agentWorkflows.roles(target));
  const list = Option.getOrNull(AsyncResult.value(listResult));
  const roles = Option.getOrNull(AsyncResult.value(rolesResult));
  const canStart = useAtomValue(agentWorkflows.start.permissionAtom(project.environmentId));
  const canConfigure = useAtomValue(agentWorkflows.settings.permissionAtom(project.environmentId));
  const setSettings = useAtomCommand(agentWorkflows.settings, { reportFailure: false });
  const reload = useAtomQueryRunner(agentWorkflows.list, { refresh: true });
  const reloadRoles = useAtomQueryRunner(agentWorkflows.roles, { refresh: true });
  const [selected, setSelected] = useState(initialWorkflow ?? "");
  const [messageSearch, setMessageSearch] = useState("");
  const [launching, setLaunching] = useState(
    Boolean(!initialWorkflow && (sourceThreadId || cardId)),
  );
  const [rolesOpen, setRolesOpen] = useState(rolesInitiallyOpen);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selectedId = selected || list?.workflows[0]?.id;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={!canStart || !roles?.enabled} onClick={() => setLaunching(!launching)}>
          <PlusIcon />
          Start workflow
        </Button>
        <Button variant="outline" onClick={() => setRolesOpen(!rolesOpen)}>
          Project roles
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void Promise.all([reload(target), reloadRoles(target)])}
        >
          <RefreshCwIcon />
          Refresh
        </Button>
        {roles && canConfigure ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError(null);
              void setSettings({
                ...target,
                input: {
                  projectId: project.id,
                  expectedRevision: roles.revision,
                  enabled: !roles.enabled,
                },
              }).then((result) => {
                setBusy(false);
                if (result._tag === "Failure") setError(errorText(result));
              });
            }}
          >
            {roles.enabled ? "Disable new starts" : "Enable workflows"}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {!canStart ? (
        <p className="text-sm text-muted-foreground">
          This connection can inspect workflows. Starting or changing work requires operate
          permission in this environment.
        </p>
      ) : null}
      {AsyncResult.isFailure(listResult) ? (
        <p role="alert" className="text-sm text-muted-foreground">
          Could not load workflows. Check this environment’s connection, version and read
          permission.
        </p>
      ) : null}
      {AsyncResult.isFailure(rolesResult) ? (
        <p role="alert" className="text-sm text-destructive">
          Could not load project roles. Check this environment’s connection and read permission,
          then refresh.
        </p>
      ) : null}
      {!list && !AsyncResult.isFailure(listResult) ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading workflows…
        </p>
      ) : null}
      {roles && !roles.enabled ? (
        <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
          New workflows are disabled for this project. Existing history and lifecycle controls
          remain available.
          {canConfigure
            ? " Enable workflows when you are ready to start."
            : " An operator can enable new workflows."}
        </p>
      ) : null}
      {rolesOpen && roles ? (
        <RoleSettings project={project} roles={roles.roles} revision={roles.revision} />
      ) : null}
      {launching && roles?.enabled ? (
        <WorkflowLaunch
          project={project}
          roles={roles.roles}
          sourceThreadId={sourceThreadId}
          cardId={cardId}
          canStart={canStart}
          onStarted={(workflow) => {
            setSelected(workflow.id);
            setLaunching(false);
          }}
        />
      ) : null}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <nav aria-label="Project agent workflows" className="min-w-0 space-y-2">
          {list?.workflows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No workflows yet. Creating a role does not start an agent.
            </p>
          ) : null}
          {list?.workflows.map((workflow) => (
            <button
              key={workflow.id}
              type="button"
              aria-current={workflow.id === selectedId ? "page" : undefined}
              onClick={() => setSelected(workflow.id)}
              className={`w-full rounded-lg border p-3 text-left focus-visible:outline-2 focus-visible:outline-ring ${workflow.id === selectedId ? "border-primary bg-accent" : "border-border"}`}
            >
              <span className="block text-sm font-medium">
                {workflow.title || "Agent workflow"}
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {workflow.humanInputPending ? "Needs your input" : STATE_LABELS[workflow.status]} ·{" "}
                {workflow.acceptedCount}/{workflow.assignmentCount} accepted
              </span>
              {workflow.currentStage ? (
                <span className="mt-1 block text-xs">{workflow.currentStage}</span>
              ) : null}
              {workflow.latestSummary ? (
                <span className="mt-1 block truncate text-xs text-muted-foreground">
                  {workflow.latestSummary}
                </span>
              ) : null}
              {workflow.pendingQuestions > 0 ? (
                <span className="mt-1 block text-xs">
                  {workflow.pendingQuestions} pending questions
                </span>
              ) : null}
            </button>
          ))}
        </nav>
        {selectedId ? (
          <div className="min-w-0 space-y-4">
            <label className="block space-y-1 text-sm">
              <span>Search workflow communications</span>
              <Input
                aria-label="Search all workflow messages"
                placeholder="Search all messages"
                maxLength={200}
                value={messageSearch}
                onChange={(event) => setMessageSearch(event.target.value)}
              />
            </label>
            <WorkflowDetail
              key={selectedId}
              environmentId={project.environmentId}
              projectId={project.id}
              workflowId={selectedId}
              search={messageSearch}
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Choose a workflow to follow its assignments and evidence.
          </p>
        )}
      </div>
    </>
  );
}

function WorkflowLaunch({
  project,
  roles,
  sourceThreadId,
  cardId,
  canStart,
  onStarted,
}: {
  project: EnvironmentProject;
  roles: ReadonlyArray<AgentRolePreset>;
  sourceThreadId?: string | undefined;
  cardId?: string | undefined;
  canStart: boolean;
  onStarted: (workflow: AgentWorkflow) => void;
}) {
  const config = useAtomValue(serverEnvironment.configValueAtom(project.environmentId));
  const source = useThreadShells().find(
    (thread) => thread.environmentId === project.environmentId && thread.id === sourceThreadId,
  );
  const settings = config
    ? resolveProjectSettings(config.settings, project.id, project).settings
    : null;
  const defaultModel =
    source?.modelSelection ??
    (config
      ? (settings?.defaultModelSelection ??
        resolveProjectDefaultProviderModelSelection(config.providers, config.settings, project.id))
      : null);
  const [chosenModel, setChosenModel] = useState<ModelSelection | null>(null);
  const model = chosenModel ?? defaultModel;
  const boardResult = useAtomValue(
    cardId
      ? roadmapRead({ environmentId: project.environmentId, input: { projectId: project.id } })
      : EMPTY_BOARD,
  );
  const boardView = Option.getOrNull(AsyncResult.value(boardResult));
  const card = boardView?.board.cards.find((entry) => entry.id === cardId);
  const [title, setTitle] = useState<string | null>(source?.title ?? null);
  const [objective, setObjective] = useState<string | null>(null);
  const titleValue = title ?? card?.title ?? source?.title ?? "";
  const objectiveValue = objective ?? card?.summary ?? "";
  const [baseRef, setBaseRef] = useState("HEAD");
  const [requiredChecksText, setRequiredChecksText] = useState("");
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>(
    source?.runtimeMode ?? settings?.defaultRuntimeMode ?? "approval-required",
  );
  const [limits, setLimits] = useState<AgentWorkflowLimits>({ ...DEFAULT_AGENT_WORKFLOW_LIMITS });
  const [roleIds, setRoleIds] = useState({
    planner: roles.find((role) => role.kind === "planner" && role.enabled)?.id ?? "planner",
    builder: roles.find((role) => role.kind === "builder" && role.enabled)?.id ?? "builder",
    reviewer: roles.find((role) => role.kind === "reviewer" && role.enabled)?.id ?? "reviewer",
  });
  const plannerPreview = useAtomValue(
    model
      ? agentWorkflows.preview({
          environmentId: project.environmentId,
          input: { projectId: project.id, roleId: roleIds.planner, modelSelection: model },
        })
      : EMPTY_PREVIEW,
  );
  const builderPreview = useAtomValue(
    model
      ? agentWorkflows.preview({
          environmentId: project.environmentId,
          input: { projectId: project.id, roleId: roleIds.builder, modelSelection: model },
        })
      : EMPTY_PREVIEW,
  );
  const reviewerPreview = useAtomValue(
    model
      ? agentWorkflows.preview({
          environmentId: project.environmentId,
          input: { projectId: project.id, roleId: roleIds.reviewer, modelSelection: model },
        })
      : EMPTY_PREVIEW,
  );
  const previews = [plannerPreview, builderPreview, reviewerPreview].map((preview) =>
    Option.getOrNull(AsyncResult.value(preview)),
  );
  const ready =
    (["planner", "builder", "reviewer"] as const).every((kind) =>
      roles.some((role) => role.id === roleIds[kind] && role.kind === kind && role.enabled),
    ) &&
    previews.every((preview) => preview?.ready === true) &&
    ![plannerPreview, builderPreview, reviewerPreview].some((preview) => preview.waiting);
  const refreshPreview = useAtomQueryRunner(agentWorkflows.preview, { refresh: true });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const start = useAtomCommand(agentWorkflows.start, { reportFailure: false });
  const request = useRef<{ fingerprint: string; id: string } | null>(null);
  const choices = (
    config ? providerInstanceEntriesFor(config.providers, config.settings, project.id) : []
  )
    .filter(isProviderInstancePickerReady)
    .flatMap((provider) =>
      provider.models.map((entry) => ({
        selection: {
          instanceId: provider.instanceId,
          model: entry.slug,
        } satisfies ModelSelection,
        label: `${provider.displayName} · ${entry.name}`,
      })),
    );
  const available =
    model &&
    choices.some(
      (choice) =>
        choice.selection.instanceId === model.instanceId && choice.selection.model === model.model,
    );
  return (
    <form
      className="space-y-4 rounded-xl border border-border bg-card p-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (
          !model ||
          !available ||
          !ready ||
          busy ||
          !canStart ||
          (Boolean(cardId) && !card) ||
          (Boolean(sourceThreadId) && !source)
        )
          return;
        const input = {
          projectId: project.id,
          title: titleValue.trim() || objectiveValue.trim().slice(0, 100),
          objective: objectiveValue.trim(),
          sourceThreadId: source?.id ?? null,
          cardId: cardId ?? null,
          cardRevision: card ? boardView!.board.revision : null,
          criteria: card?.acceptanceCriteria?.map(({ id, text }) => ({ id, text })) ?? [],
          modelSelection: model,
          runtimeMode,
          interactionMode: "default",
          workspaceStrategy: { type: "worktree", baseRef: baseRef.trim() },
          limits,
          roleIds,
          requiredChecks: [
            ...new Set(
              requiredChecksText
                .split("\n")
                .map((command) => command.trim())
                .filter(Boolean),
            ),
          ],
        } satisfies Omit<AgentWorkflowStartInput, "requestId">;
        const fingerprint = JSON.stringify(input);
        if (request.current?.fingerprint !== fingerprint)
          request.current = { fingerprint, id: randomUUID() };
        setBusy(true);
        setError(null);
        void start({
          environmentId: project.environmentId,
          input: { ...input, requestId: request.current.id },
        }).then((result) => {
          setBusy(false);
          if (result._tag === "Failure") setError(errorText(result));
          else onStarted(result.value);
        });
      }}
    >
      <div>
        <h3 className="font-semibold">Start a supervised workflow</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Planner → Builder → independent Reviewer. The finish is a reviewed result; publishing and
          merging follow your project’s authorization.
        </p>
      </div>
      {source ? (
        <p className="text-sm">
          Context from: {source.title}. The original conversation stays intact.
        </p>
      ) : null}
      {sourceThreadId && !source ? (
        <p role="alert" className="text-sm text-destructive">
          The source conversation is unavailable. Reconnect its environment or open the thread
          before starting so its context is preserved.
        </p>
      ) : null}
      {cardId ? (
        <p className="text-sm">
          The server will snapshot the saved roadmap card and its criteria before starting.
        </p>
      ) : null}
      {card ? (
        <div className="space-y-1 rounded-lg border border-border p-3 text-sm">
          <p>Saved card revision {boardView!.board.revision}. Criteria are snapshotted at start.</p>
          {card.specPath ? (
            <p className="break-words text-muted-foreground">Full spec: {card.specPath}</p>
          ) : null}
          {card.acceptanceCriteria?.map((criterion) => (
            <p key={criterion.id}>• {criterion.text}</p>
          ))}
        </div>
      ) : null}
      {cardId && !card ? (
        <p role="status" className="text-sm text-muted-foreground">
          {AsyncResult.isFailure(boardResult)
            ? "Could not read the saved roadmap card. Check its environment and permission."
            : "Loading the saved card before launch…"}
        </p>
      ) : null}
      <label className="block space-y-1 text-sm">
        <span>Title</span>
        <Input
          value={titleValue}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={2_000}
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span>Objective and acceptance criteria</span>
        <Textarea
          value={objectiveValue}
          onChange={(event) => setObjective(event.target.value)}
          maxLength={40_000}
          required
          placeholder="What should be different when this work is complete?"
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span>Workflow model</span>
        <select
          className={`${SELECT} w-full`}
          aria-label="Workflow provider and model"
          value={model ? `${model.instanceId}:${model.model}` : ""}
          onChange={(event) =>
            setChosenModel(
              choices.find(
                (choice) =>
                  `${choice.selection.instanceId}:${choice.selection.model}` === event.target.value,
              )?.selection ?? null,
            )
          }
        >
          {!available ? (
            <option value={model ? `${model.instanceId}:${model.model}` : ""}>
              {model
                ? "Configured model unavailable. Choose an available model."
                : "Choose a provider and model"}
            </option>
          ) : null}
          {choices.map((choice) => (
            <option
              key={`${choice.selection.instanceId}:${choice.selection.model}`}
              value={`${choice.selection.instanceId}:${choice.selection.model}`}
            >
              {choice.label}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        {(["planner", "builder", "reviewer"] as const).map((kind) => (
          <label className="flex flex-col gap-1 text-sm" key={kind}>
            <span>{kind.charAt(0).toUpperCase() + kind.slice(1)} role</span>
            <select
              className={SELECT}
              value={roleIds[kind]}
              onChange={(event) => setRoleIds({ ...roleIds, [kind]: event.target.value })}
            >
              {!roles.some((role) => role.kind === kind && role.enabled) ? (
                <option value={roleIds[kind]}>No enabled {kind} role</option>
              ) : null}
              {roles
                .filter((role) => role.kind === kind && role.enabled)
                .map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name} · v{role.version}
                  </option>
                ))}
            </select>
          </label>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span>Worktree base</span>
          <Input value={baseRef} onChange={(event) => setBaseRef(event.target.value)} required />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>Execution mode</span>
          <select
            className={SELECT}
            value={runtimeMode}
            onChange={(event) => setRuntimeMode(event.target.value as RuntimeMode)}
          >
            {["approval-required", "auto-accept-edits", "auto", "full-access"].map((mode) => (
              <option key={mode}>{mode}</option>
            ))}
          </select>
        </label>
      </div>
      <details className="space-y-3 text-sm">
        <summary className="cursor-pointer py-2">Role briefs, skills and limits</summary>
        <p className="text-muted-foreground">
          Roles keep project/provider guidance. Required skills and provider restrictions are
          resolved by the environment before launch. A role prompt alone is not an enforced
          read-only sandbox.
        </p>
        <label className="block space-y-1">
          <span>Required checks (one command per line)</span>
          <Textarea
            value={requiredChecksText}
            maxLength={40_000}
            onChange={(event) => setRequiredChecksText(event.target.value)}
          />
        </label>
        {!requiredChecksText.trim() ? (
          <p className="text-xs text-muted-foreground">
            No project checks declared; reviewer must assess testing sufficiency.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            These required commands are frozen for the workflow. A result cannot remove them by
            changing its own checklist.
          </p>
        )}
        {previews.map((preview) =>
          preview ? (
            <div
              key={preview.snapshot.role.id}
              className="space-y-1 rounded-lg border border-border p-3"
            >
              <p className="font-medium">
                {preview.snapshot.role.name} · v{preview.snapshot.role.version} ·{" "}
                {preview.ready ? "Ready" : "Unavailable"}
              </p>
              <p>{preview.snapshot.role.mission}</p>
              <p className="text-xs text-muted-foreground">
                {config?.providers.find(
                  (provider) => provider.instanceId === preview.snapshot.modelSelection.instanceId,
                )?.displayName ?? preview.snapshot.modelSelection.instanceId}{" "}
                · {preview.snapshot.modelSelection.model}
              </p>
              {preview.issues.map((issue) => (
                <p key={issue} className="text-sm text-destructive">
                  {issue}
                </p>
              ))}
              <ul className="space-y-1 text-xs text-muted-foreground">
                {preview.snapshot.skills.map((skill) => (
                  <li key={skill.id}>
                    {skill.id} · {skill.required ? "Required" : "Optional"} ·{" "}
                    {skill.state.replaceAll("_", " ")} · {skill.source}
                    {skill.reason ? ` · ${skill.reason}` : ""}
                  </li>
                ))}
              </ul>
              <details>
                <summary className="cursor-pointer py-1">Resolved role instructions</summary>
                <p className="whitespace-pre-wrap">{preview.snapshot.role.instructions}</p>
              </details>
            </div>
          ) : null,
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          {(["maxConcurrent", "maxAttempts", "maxReviewRounds"] as const).map((key) => (
            <label key={key} className="space-y-1">
              <span>
                {key === "maxConcurrent"
                  ? "Concurrent assignments"
                  : key === "maxAttempts"
                    ? "Assignment attempts"
                    : "Correction rounds"}
              </span>
              <Input
                type="number"
                min={key === "maxReviewRounds" ? 0 : 1}
                max={key === "maxConcurrent" ? 8 : key === "maxAttempts" ? 100 : 10}
                value={limits[key]}
                onChange={(event) => setLimits({ ...limits, [key]: Number(event.target.value) })}
              />
            </label>
          ))}
          <label className="space-y-1">
            <span>Message limit</span>
            <Input
              type="number"
              min={1}
              max={2_000}
              value={limits.maxMessages}
              onChange={(event) =>
                setLimits({ ...limits, maxMessages: Number(event.target.value) })
              }
            />
          </label>
          <label className="space-y-1">
            <span>Question timeout (minutes)</span>
            <Input
              type="number"
              min={1}
              max={10_080}
              value={limits.questionTimeoutMs / 60_000}
              onChange={(event) =>
                setLimits({ ...limits, questionTimeoutMs: Number(event.target.value) * 60_000 })
              }
            />
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          Known attempt/concurrency limits are enforced. Subscription usage and cost coverage may be
          incomplete.
        </p>
      </details>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error} You can retry the same launch safely.
        </p>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!model || busy}
        onClick={() => {
          if (model)
            void Promise.all(
              Object.values(roleIds).map((roleId) =>
                refreshPreview({
                  environmentId: project.environmentId,
                  input: { projectId: project.id, roleId, modelSelection: model },
                }),
              ),
            );
        }}
      >
        Recheck role readiness
      </Button>
      {!ready ? (
        <p role="status" className="text-sm text-muted-foreground">
          All three roles must resolve their required skills and provider capabilities before
          starting. Expand role briefs for details.
        </p>
      ) : null}
      {(
        [
          { name: "Planner", result: plannerPreview },
          { name: "Builder", result: builderPreview },
          { name: "Reviewer", result: reviewerPreview },
        ] as const
      ).map(({ name, result }) =>
        AsyncResult.isFailure(result) ? (
          <p key={name} role="alert" className="text-sm text-destructive">
            {name}: {errorText(result)} Recheck readiness after fixing the provider or role
            configuration.
          </p>
        ) : null,
      )}
      <Button
        type="submit"
        disabled={
          busy ||
          !canStart ||
          !available ||
          !ready ||
          !objectiveValue.trim() ||
          !baseRef.trim() ||
          (Boolean(sourceThreadId) && !source) ||
          (Boolean(cardId) && !card)
        }
      >
        {busy ? "Starting…" : "Start workflow"}
      </Button>
    </form>
  );
}

function RoleSettings({
  project,
  roles,
  revision,
}: {
  project: EnvironmentProject;
  roles: ReadonlyArray<AgentRolePreset>;
  revision: number;
}) {
  const [editing, setEditing] = useState<AgentRolePreset | null>(null);
  const [editingRevision, setEditingRevision] = useState(revision);
  const [skillDrafts, setSkillDrafts] = useState({ requiredSkills: "", optionalSkills: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canSave = useAtomValue(agentWorkflows.saveRole.permissionAtom(project.environmentId));
  const save = useAtomCommand(agentWorkflows.saveRole, { reportFailure: false });
  const beginEditing = (role: AgentRolePreset) => {
    setError(null);
    setEditingRevision(revision);
    setSkillDrafts({
      requiredSkills: role.requiredSkills.join("\n"),
      optionalSkills: role.optionalSkills.join("\n"),
    });
    setEditing(role);
  };
  const config = useAtomValue(serverEnvironment.configValueAtom(project.environmentId));
  const skillResult = useAtomValue(
    agentWorkflows.skills({
      environmentId: project.environmentId,
      input: { projectId: project.id },
    }),
  );
  const catalog = Option.getOrNull(AsyncResult.value(skillResult));
  const readinessModel = config
    ? resolveProjectDefaultProviderModelSelection(config.providers, config.settings, project.id)
    : null;
  const modelChoices = (
    config ? providerInstanceEntriesFor(config.providers, config.settings, project.id) : []
  )
    .filter(isProviderInstancePickerReady)
    .flatMap((provider) =>
      provider.models.map((model) => ({
        selection: { instanceId: provider.instanceId, model: model.slug } satisfies ModelSelection,
        label: `${provider.displayName} · ${model.name}`,
      })),
    );
  return (
    <section
      className="space-y-4 rounded-xl border border-border p-5"
      aria-label="Project role settings"
    >
      <div>
        <h3 className="font-semibold">Project roles</h3>
        <p className="text-sm text-muted-foreground">
          Saving a role uses no model turn. Active assignments retain their original version.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {roles.map((role) => (
          <div key={role.id} className="space-y-2 rounded-lg border border-border p-3">
            <p className="text-sm font-medium">
              {role.name} · v{role.version}
              {!role.enabled ? " · Disabled" : ""}
            </p>
            <p className="text-sm text-muted-foreground">{role.mission}</p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!canSave}
                onClick={() => beginEditing(role)}
              >
                Edit
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={!canSave}
                onClick={() =>
                  beginEditing({ ...role, id: randomUUID(), name: `${role.name} copy`, version: 0 })
                }
              >
                Clone
              </Button>
            </div>
          </div>
        ))}
      </div>
      {editing ? (
        <form
          className="space-y-3 border-t border-border pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            setError(null);
            void save({
              environmentId: project.environmentId,
              input: {
                projectId: project.id,
                expectedRevision: editingRevision,
                role: {
                  ...editing,
                  requiredSkills: [
                    ...new Set(
                      skillDrafts.requiredSkills
                        .split("\n")
                        .map((id) => id.trim())
                        .filter(Boolean),
                    ),
                  ],
                  optionalSkills: [
                    ...new Set(
                      skillDrafts.optionalSkills
                        .split("\n")
                        .map((id) => id.trim())
                        .filter(Boolean),
                    ),
                  ],
                },
              },
            }).then((result) => {
              setBusy(false);
              if (result._tag === "Failure") setError(errorText(result));
              else setEditing(null);
            });
          }}
        >
          {editingRevision !== revision ? (
            <p role="alert" className="text-sm text-muted-foreground">
              Project roles changed while you were editing. Your draft is kept; close this editor
              and reopen the latest role before replacing it.
            </p>
          ) : null}
          <label className="block space-y-1 text-sm">
            <span>Role name</span>
            <Input
              value={editing.name}
              required
              maxLength={100}
              onChange={(event) => setEditing({ ...editing, name: event.target.value })}
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span>Mission</span>
            <Textarea
              value={editing.mission}
              maxLength={2_000}
              onChange={(event) => setEditing({ ...editing, mission: event.target.value })}
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span>Working instructions</span>
            <Textarea
              value={editing.instructions}
              maxLength={40_000}
              onChange={(event) => setEditing({ ...editing, instructions: event.target.value })}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            {(["requiredSkills", "optionalSkills"] as const).map((key) => (
              <label key={key} className="block space-y-1 text-sm">
                <span>
                  {key === "requiredSkills" ? "Required skills" : "Optional skills"} (one per line)
                </span>
                <Textarea
                  value={skillDrafts[key]}
                  maxLength={20_000}
                  onChange={(event) =>
                    setSkillDrafts({ ...skillDrafts, [key]: event.target.value })
                  }
                />
              </label>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={editing.enabled}
              onChange={(event) => setEditing({ ...editing, enabled: event.target.checked })}
            />
            Enabled for future assignments
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1 text-sm">
              <span>Expected output</span>
              <span className="py-2">{editing.outputKind} · fixed by role kind</span>
            </div>
            <label className="flex flex-col gap-1 text-sm">
              <span>Preferred provider and model</span>
              <select
                className={SELECT}
                value={
                  editing.modelSelection
                    ? `${editing.modelSelection.instanceId}:${editing.modelSelection.model}`
                    : ""
                }
                onChange={(event) =>
                  setEditing({
                    ...editing,
                    modelSelection:
                      modelChoices.find(
                        (choice) =>
                          `${choice.selection.instanceId}:${choice.selection.model}` ===
                          event.target.value,
                      )?.selection ?? null,
                  })
                }
              >
                <option value="">Use the workflow model</option>
                {editing.modelSelection &&
                !modelChoices.some(
                  (choice) =>
                    choice.selection.instanceId === editing.modelSelection?.instanceId &&
                    choice.selection.model === editing.modelSelection?.model,
                ) ? (
                  <option
                    value={`${editing.modelSelection.instanceId}:${editing.modelSelection.model}`}
                  >
                    Configured model currently unavailable
                  </option>
                ) : null}
                {modelChoices.map((choice) => (
                  <option
                    key={`${choice.selection.instanceId}:${choice.selection.model}`}
                    value={`${choice.selection.instanceId}:${choice.selection.model}`}
                  >
                    {choice.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer py-2">
              Skill package provenance and prerequisites
            </summary>
            {[
              ...new Set(
                [
                  ...skillDrafts.requiredSkills.split("\n"),
                  ...skillDrafts.optionalSkills.split("\n"),
                ]
                  .map((id) => id.trim())
                  .filter(Boolean),
              ),
            ].map((id) => {
              const skill = catalog?.skills.find(
                (entry) => entry.id === id || entry.aliases.includes(id),
              );
              return (
                <div key={id} className="space-y-1 border-t border-border py-2">
                  <p className="font-medium">
                    {skill?.name ?? id} · {skill?.tier ?? "Native or external"}
                  </p>
                  {skill ? (
                    <>
                      <p>{skill.description}</p>
                      <p>
                        Modes: {skill.modes.join(", ")}. Requires:{" "}
                        {skill.requiredCapabilities.join(", ") || "No additional tools"}.{" "}
                        {skill.userInvocationOnly
                          ? "User invocation only."
                          : "Agent invocation supported within scope."}
                      </p>
                      <p>
                        Version {skill.version} · {skill.contentHash}
                      </p>
                      {skill.deferredReason ? <p>{skill.deferredReason}</p> : null}
                      <p>{skill.provenance.join("; ")}</p>
                    </>
                  ) : (
                    <p>
                      The destination provider must resolve this skill. Missing required skills
                      block launch.
                    </p>
                  )}
                </div>
              );
            })}
          </details>
          {readinessModel && roles.some((role) => role.id === editing.id) ? (
            <SavedRoleReadiness
              project={project}
              roleId={editing.id}
              modelSelection={readinessModel}
            />
          ) : null}
          <p className="text-xs text-muted-foreground">
            Permissions continue to follow the project and provider. Naming a skill does not grant
            its capabilities.
          </p>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button
              type="submit"
              disabled={!canSave || busy || !editing.name.trim() || editingRevision !== revision}
            >
              Save role
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setEditing(null)}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

function SavedRoleReadiness({
  project,
  roleId,
  modelSelection,
}: {
  project: EnvironmentProject;
  roleId: string;
  modelSelection: ModelSelection;
}) {
  const result = useAtomValue(
    agentWorkflows.preview({
      environmentId: project.environmentId,
      input: { projectId: project.id, roleId, modelSelection },
    }),
  );
  const preview = Option.getOrNull(AsyncResult.value(result));
  return (
    <div className="space-y-2 rounded-lg border border-border p-3 text-xs">
      <p className="font-medium">
        Saved role readiness{preview ? ` · ${preview.ready ? "Ready" : "Unavailable"}` : ""}
      </p>
      <p className="text-muted-foreground">
        Uses the saved version and current project model. Save your draft to check its changed
        skills or preferences.
      </p>
      {AsyncResult.isFailure(result) ? (
        <p role="alert">{errorText(result)}</p>
      ) : !preview ? (
        <p role="status">Resolving skills and provider capabilities…</p>
      ) : null}
      {preview?.issues.map((issue) => (
        <p key={issue} className="text-destructive">
          {issue}
        </p>
      ))}
      {preview?.snapshot.skills.map((skill) => (
        <p key={skill.id}>
          {skill.id} · {skill.required ? "Required" : "Optional"} ·{" "}
          {skill.state.replaceAll("_", " ")} · {skill.source}
          {skill.reason ? ` · ${skill.reason}` : ""}
        </p>
      ))}
    </div>
  );
}

function WorkflowDetail({
  environmentId,
  projectId,
  workflowId,
  search,
}: {
  environmentId: EnvironmentId;
  projectId: EnvironmentProject["id"];
  workflowId: string;
  search: string;
}) {
  const [messagePage, setMessagePage] = useState<{ search: string; offset: number | undefined }>({
    search,
    offset: undefined,
  });
  const messageOffset = messagePage.search === search ? messagePage.offset : undefined;
  const setMessageOffset = (offset: number | undefined) => setMessagePage({ search, offset });
  const [artifactOffset, setArtifactOffset] = useState<number | undefined>();
  const result = useAtomValue(
    agentWorkflows.read({
      environmentId,
      input: {
        projectId,
        workflowId,
        messageOffset,
        artifactOffset,
        limit: 50,
        search: search.trim() || undefined,
      },
    }),
  );
  const workflow = Option.getOrNull(AsyncResult.value(result));
  const canControl = useAtomValue(agentWorkflows.control.permissionAtom(environmentId));
  const canControlAssignment = useAtomValue(
    agentWorkflows.assignmentControl.permissionAtom(environmentId),
  );
  const canReply = useAtomValue(agentWorkflows.message.permissionAtom(environmentId));
  const control = useAtomCommand(agentWorkflows.control, { reportFailure: false });
  const assignmentControl = useAtomCommand(agentWorkflows.assignmentControl, {
    reportFailure: false,
  });
  const send = useAtomCommand(agentWorkflows.message, { reportFailure: false });
  const revisionRequest = useRef<{ key: string; cancelId: string; messageId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!workflow)
    return (
      <p
        role={AsyncResult.isFailure(result) ? "alert" : "status"}
        className="text-sm text-muted-foreground"
      >
        {AsyncResult.isFailure(result)
          ? "Could not load this workflow. Check your connection and read permission."
          : "Loading workflow…"}
      </p>
    );
  const runControl = (
    action: "pause" | "resume" | "cancel" | "retry",
    limits?: AgentWorkflowLimits,
  ) => {
    setBusy(true);
    setError(null);
    void control({
      environmentId,
      input: {
        projectId,
        workflowId,
        requestId: randomUUID(),
        action,
        ...(limits ? { limits } : {}),
      },
    }).then((response) => {
      setBusy(false);
      if (response._tag === "Failure") setError(errorText(response));
    });
  };
  const runAssignmentControl = (assignmentId: string, action: "cancel" | "retry") => {
    setBusy(true);
    setError(null);
    void assignmentControl({
      environmentId,
      input: { projectId, workflowId, assignmentId, requestId: randomUUID(), action },
    }).then((response) => {
      setBusy(false);
      if (response._tag === "Failure") setError(errorText(response));
    });
  };
  const revise = async (assignmentId: string, text: string) => {
    const key = JSON.stringify({
      assignmentId,
      generation: workflow.generation,
      text: text.trim(),
    });
    if (revisionRequest.current?.key !== key)
      revisionRequest.current = { key, cancelId: randomUUID(), messageId: randomUUID() };
    const ids = revisionRequest.current;
    setBusy(true);
    setError(null);
    const cancelled = await assignmentControl({
      environmentId,
      input: { projectId, workflowId, assignmentId, requestId: ids.cancelId, action: "cancel" },
    });
    if (cancelled._tag === "Failure") {
      setBusy(false);
      setError(errorText(cancelled));
      return false;
    }
    const response = await send({
      environmentId,
      input: {
        projectId,
        workflowId,
        assignmentId,
        requestId: ids.messageId,
        generation: cancelled.value.generation,
        toThreadId: workflow.managerThreadId,
        kind: "handoff",
        summary: `Revision requested: ${text.trim().replace(/\s+/g, " ").slice(0, 160)}`,
        text: `The user cancelled assignment ${assignmentId} and requests a fresh revised assignment.\n\n${text.trim()}\n\nPreserve accepted criterion identities and evidence. Resolve material scope choices through the existing human-input flow before new work.`,
        artifactIds: [],
        replyTo: null,
        blocking: false,
      },
    });
    setBusy(false);
    if (response._tag === "Failure") {
      setError(
        `The assignment was cancelled, but the revision request was not delivered. ${errorText(response)} Retry the request or open the planner conversation.`,
      );
      return false;
    }
    return true;
  };
  const reply = async (question: CommunicationMessage, text: string) => {
    setBusy(true);
    setError(null);
    const response = await send({
      environmentId,
      input: {
        projectId,
        workflowId,
        requestId: randomUUID(),
        generation: workflow.generation,
        toThreadId:
          question.senderId === "user" || question.senderId === "system"
            ? workflow.managerThreadId
            : ([...workflow.messages, ...workflow.pendingQuestions].find(
                (entry) => entry.id === question.id,
              )?.senderThreadId ?? workflow.managerThreadId),
        assignmentId: question.assignmentId,
        kind: "answer",
        summary: `Answer: ${text.trim().slice(0, 160)}`,
        text: text.trim(),
        artifactIds: [],
        replyTo: question.id,
        blocking: false,
      },
    });
    setBusy(false);
    if (response._tag === "Failure") {
      setError(errorText(response));
      return false;
    }
    return true;
  };
  return (
    <section className="min-w-0 space-y-6" aria-label="Workflow details">
      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">{workflow.title}</h3>
            <p className="mt-1 text-sm" role="status">
              {STATE_LABELS[workflow.status]}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {workflow.status === "paused" || workflow.status === "waiting_user" ? (
              <Button
                variant="outline"
                size="sm"
                disabled={!canControl || busy}
                onClick={() => runControl("resume")}
              >
                Resume
              </Button>
            ) : workflow.status === "running" ? (
              <Button
                variant="outline"
                size="sm"
                disabled={!canControl || busy}
                onClick={() => runControl("pause")}
              >
                Pause new starts
              </Button>
            ) : null}
            {workflow.status === "failed" ? (
              <Button
                variant="outline"
                size="sm"
                disabled={!canControl || busy}
                onClick={() => runControl("retry")}
              >
                Retry
              </Button>
            ) : null}
            {!["completed", "cancelled"].includes(workflow.status) ? (
              <Button
                variant="outline"
                size="sm"
                disabled={!canControl || busy}
                onClick={() => runControl("cancel")}
              >
                Cancel workflow
              </Button>
            ) : null}
          </div>
        </div>
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">{workflow.objective}</p>
        {workflow.humanInputPending ? (
          <div className="space-y-2 rounded-lg border border-border p-3">
            <p role="status" className="text-sm font-medium">
              Needs your input
            </p>
            <p className="text-xs text-muted-foreground">
              A conversation has a pending native question or approval. Open it to answer using its
              existing controls.
            </p>
            {(workflow.humanInputThreadIds?.length
              ? workflow.humanInputThreadIds
              : [workflow.managerThreadId]
            ).map((threadId) => (
              <Link
                key={threadId}
                to="/$environmentId/$threadId"
                params={{ environmentId, threadId }}
                className="block text-sm text-primary underline"
              >
                Open{" "}
                {threadId === workflow.managerThreadId
                  ? (workflow.managerRole?.role.name ?? "Planner")
                  : (workflow.assignments.find((assignment) =>
                      assignment.attempts.some((attempt) => attempt.childThreadId === threadId),
                    )?.role.role.name ?? "Agent")}{" "}
                conversation
              </Link>
            ))}
          </div>
        ) : null}
        {workflow.specSnapshot ? (
          <FrozenSpec environmentId={environmentId} workflow={workflow} />
        ) : null}
        <Link
          to="/$environmentId/$threadId"
          params={{ environmentId, threadId: workflow.managerThreadId }}
          className="text-sm text-primary underline"
        >
          Open planner conversation
        </Link>
        {workflow.status === "paused" ? (
          <p className="text-xs text-muted-foreground">
            New assignments are paused. Running tasks may still be active; open their conversations
            to interrupt them.
          </p>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <section className="space-y-3">
        <h4 className="font-medium">Assignments</h4>
        {workflow.assignments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            The planner is preparing the first assignment.
          </p>
        ) : null}
        {workflow.assignments.map((assignment) => (
          <details key={assignment.id} className="rounded-lg border border-border p-3">
            <summary className="cursor-pointer text-sm">
              <span className="font-medium">{assignment.role.role.name}</span> ·{" "}
              {assignment.state.replaceAll("_", " ")} · {assignment.attempts.length} attempts
            </summary>
            <div className="mt-3 space-y-3">
              <p className="text-sm">{assignment.objective}</p>
              <p className="text-xs text-muted-foreground">
                {assignment.writeResponsibility
                  ? "Owns workflow write responsibility"
                  : "Does not own workflow write responsibility"}
                . A stopped provider turn does not mean this assignment is accepted.
              </p>
              {assignment.criteria.map((criterion) => (
                <p key={criterion.id} className="text-sm">
                  • {criterion.text}
                </p>
              ))}
              {assignment.requiredChecks.length > 0 ? (
                <div className="space-y-1 text-xs text-muted-foreground">
                  <p className="font-medium">Required checks</p>
                  {assignment.requiredChecks.map((command) => (
                    <p key={command}>{command}</p>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No project checks declared; reviewer must assess testing sufficiency.
                </p>
              )}
              {assignment.dependencies.length > 0 ? (
                <p className="text-xs text-muted-foreground">
                  Depends on:{" "}
                  {assignment.dependencies
                    .map(
                      (id) =>
                        workflow.assignments.find((entry) => entry.id === id)?.role.role.name ??
                        "Earlier assignment",
                    )
                    .join(", ")}
                  .
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {["failed", "cancelled", "needs_changes"].includes(assignment.state) ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={
                      !canControlAssignment ||
                      busy ||
                      ["cancelled", "completed"].includes(workflow.status)
                    }
                    onClick={() => runAssignmentControl(assignment.id, "retry")}
                  >
                    Retry assignment
                  </Button>
                ) : !["accepted", "cancelled"].includes(assignment.state) ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={
                      !canControlAssignment ||
                      busy ||
                      ["cancelled", "completed"].includes(workflow.status)
                    }
                    onClick={() => runAssignmentControl(assignment.id, "cancel")}
                  >
                    Cancel assignment
                  </Button>
                ) : null}
              </div>
              {assignment.checkpoint ? (
                <p className="break-all text-xs text-muted-foreground">
                  Pinned checkpoint: {assignment.checkpoint.commitSha}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {assignment.attempts
                  .filter((attempt) => attempt.childThreadId !== null)
                  .map((attempt) => (
                    <Link
                      key={attempt.id}
                      to="/$environmentId/$threadId"
                      params={{ environmentId, threadId: attempt.childThreadId! }}
                      className="text-sm text-primary underline"
                    >
                      Attempt {attempt.ordinal + 1}
                    </Link>
                  ))}
              </div>
              <AssignmentSnapshot
                environmentId={environmentId}
                workflow={workflow}
                assignment={assignment}
              />
              {assignment.state !== "accepted" &&
              !["completed", "cancelled"].includes(workflow.status) ? (
                <AssignmentRevisionForm
                  disabled={!canControlAssignment || !canReply || busy}
                  onRequest={(text) => revise(assignment.id, text)}
                />
              ) : null}
            </div>
          </details>
        ))}
      </section>
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="font-medium">Communication</h4>
        </div>
        <AgentCommunication
          environmentId={environmentId}
          workflow={{
            ...workflow,
            messages: [
              ...workflow.pendingQuestions.filter(
                (question) => !workflow.messages.some((message) => message.id === question.id),
              ),
              ...workflow.messages,
            ],
          }}
          canReply={canReply}
          pending={busy}
          onReply={reply}
        />
        <div className="flex gap-2">
          {workflow.messageNextOffset !== null ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMessageOffset(workflow.messageNextOffset ?? undefined)}
            >
              Older exchanges
            </Button>
          ) : null}
          {messageOffset !== undefined ? (
            <Button variant="ghost" size="sm" onClick={() => setMessageOffset(undefined)}>
              Newest exchanges
            </Button>
          ) : null}
        </div>
      </section>
      <section className="space-y-3">
        <h4 className="font-medium">Evidence and results</h4>
        {workflow.artifacts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No result artifacts have been submitted yet.
          </p>
        ) : null}
        {workflow.artifacts.map((artifact) => (
          <ArtifactRow
            key={artifact.id}
            environmentId={environmentId}
            workflow={workflow}
            artifact={artifact}
          />
        ))}
        {workflow.artifactNextOffset !== null ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setArtifactOffset(workflow.artifactNextOffset ?? undefined)}
          >
            Older artifacts
          </Button>
        ) : null}
        {artifactOffset !== undefined ? (
          <Button variant="ghost" size="sm" onClick={() => setArtifactOffset(undefined)}>
            Newest artifacts
          </Button>
        ) : null}
      </section>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer py-2">Limits and execution facts</summary>
        <p>
          {workflow.limits.maxConcurrent} concurrent assignments · {workflow.limits.maxAttempts}{" "}
          attempts · {workflow.limits.maxReviewRounds} correction rounds. Cost coverage is unknown
          when providers do not report it.
        </p>
        <p>
          Base: {workflow.baseRef ?? "Preparing"}. Workspace:{" "}
          {workflow.workspacePath ?? "Preparing"}. Generation {workflow.generation}.
        </p>
        <p>
          Workflow completion does not imply a merged PR, board completion or permission to publish.
        </p>
        {!["draft", "completed", "cancelled"].includes(workflow.status) ? (
          <WorkflowLimitsEditor
            workflow={workflow}
            disabled={!canControl || busy}
            onApply={runControl}
          />
        ) : null}
      </details>
    </section>
  );
}

function WorkflowLimitsEditor({
  workflow,
  disabled,
  onApply,
}: {
  workflow: AgentWorkflow;
  disabled: boolean;
  onApply: (action: "pause" | "resume" | "retry", limits: AgentWorkflowLimits) => void;
}) {
  const [draft, setDraft] = useState(() => workflowLimitDraft(workflow.limits));
  const limits = parseWorkflowLimits(draft);
  const action =
    workflow.status === "failed"
      ? "retry"
      : workflow.status === "paused" || workflow.status === "waiting_user"
        ? "resume"
        : "pause";
  return (
    <form
      className="mt-3 space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (limits && !disabled) onApply(action, limits);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {WORKFLOW_LIMIT_FIELDS.map(({ key, label, min, max }) => (
          <label key={key} className="block space-y-1">
            <span>{label}</span>
            <Input
              type="number"
              min={min}
              max={max}
              step={key === "questionTimeoutSeconds" ? "any" : 1}
              value={draft[key]}
              disabled={disabled}
              onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
            />
          </label>
        ))}
      </div>
      <p>
        Limits govern future assignment dispatch. Existing work may continue; manager coordination
        and incomplete provider usage are not a dollar ceiling.
      </p>
      {!limits ? <p role="status">Enter all values within their allowed ranges.</p> : null}
      <Button type="submit" variant="outline" size="sm" disabled={disabled || !limits}>
        {action === "pause"
          ? "Apply limits and pause new starts"
          : action === "resume"
            ? "Apply limits and resume"
            : "Retry with these limits"}
      </Button>
    </form>
  );
}

function FrozenSpec({
  environmentId,
  workflow,
}: {
  environmentId: EnvironmentId;
  workflow: AgentWorkflow;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <details
      onToggle={(event) => setExpanded(event.currentTarget.open)}
      className="rounded-lg border border-border p-3"
    >
      <summary className="cursor-pointer text-sm">Frozen source spec</summary>
      {expanded ? (
        <div className="mt-3 space-y-2">
          <p className="break-words text-xs text-muted-foreground">
            {workflow.specSnapshot?.source} · SHA-256 {workflow.specSnapshot?.contentHash}
          </p>
          <WorkflowContent
            environmentId={environmentId}
            workflow={workflow}
            kind="spec"
            id={workflow.id}
          />
        </div>
      ) : null}
    </details>
  );
}

function AssignmentRevisionForm({
  disabled,
  onRequest,
}: {
  disabled: boolean;
  onRequest: (text: string) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const [submitted, setSubmitted] = useState(false);
  return (
    <details className="text-sm">
      <summary className="cursor-pointer py-2">Request a revised assignment</summary>
      <form
        className="mt-2 space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (disabled || !text.trim()) return;
          void onRequest(text).then((sent) => {
            if (sent) {
              setText("");
              setSubmitted(true);
            }
          });
        }}
      >
        <p className="text-xs text-muted-foreground">
          Cancels the current assignment and asks the planner for a fresh assignment. Accepted
          criteria remain intact; material scope choices still require your input.
        </p>
        <label className="block space-y-1">
          <span>Requested change</span>
          <Textarea
            value={text}
            maxLength={38_000}
            disabled={disabled}
            onChange={(event) => {
              setText(event.target.value);
              setSubmitted(false);
            }}
          />
        </label>
        <Button type="submit" variant="outline" size="sm" disabled={disabled || !text.trim()}>
          Cancel and request revision
        </Button>
        {submitted ? (
          <p role="status" className="text-xs text-muted-foreground">
            Revision request sent to the planner.
          </p>
        ) : null}
      </form>
    </details>
  );
}

function ArtifactRow({
  environmentId,
  workflow,
  artifact,
}: {
  environmentId: EnvironmentId;
  workflow: AgentWorkflow;
  artifact: AgentWorkflow["artifacts"][number];
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <details
      className="rounded-lg border border-border p-3"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary className="cursor-pointer text-sm">
        <span className="font-medium">{artifact.kind}</span> · {artifact.summary} ·{" "}
        {artifact.validation}
      </summary>
      {expanded ? (
        <ArtifactDetails
          environmentId={environmentId}
          workflow={workflow}
          artifactId={artifact.id}
        />
      ) : null}
    </details>
  );
}

function ArtifactDetails({
  environmentId,
  workflow,
  artifactId,
}: {
  environmentId: EnvironmentId;
  workflow: AgentWorkflow;
  artifactId: string;
}) {
  const result = useAtomValue(
    agentWorkflows.content({
      environmentId,
      input: {
        projectId: workflow.projectId,
        workflowId: workflow.id,
        kind: "artifact",
        id: artifactId,
      },
    }),
  );
  const content = Option.getOrNull(AsyncResult.value(result));
  const artifact = content?.artifact;
  return (
    <div className="mt-3 space-y-3">
      <p
        role={AsyncResult.isFailure(result) ? "alert" : undefined}
        className="whitespace-pre-wrap break-words text-sm"
      >
        {content?.text ??
          (AsyncResult.isFailure(result)
            ? "Could not load the original evidence. Check your connection and permission."
            : "Loading evidence…")}
      </p>
      {artifact ? (
        <>
          <p className="text-xs text-muted-foreground">
            Head: {artifact.headRef ?? "Not recorded"}. Reviewed:{" "}
            {artifact.reviewedHead ?? "Not a review"}.
          </p>
          {artifact.checks.map((check) => (
            <div
              key={`${check.command}:${check.revision}:${check.evidence}`}
              className="rounded border border-border p-2 text-xs"
            >
              <p className="font-medium">
                {check.status.toUpperCase()}: {check.command}
              </p>
              <p>
                Revision: {check.revision}
                {check.required ? " · Required" : ""}
              </p>
              <p className="whitespace-pre-wrap">{check.evidence}</p>
            </div>
          ))}
          {artifact.findings.map((finding) => (
            <p
              key={`${finding.severity}:${finding.location}:${finding.reason}`}
              className="text-sm"
            >
              {finding.severity}: {finding.location}. {finding.reason}
            </p>
          ))}
          {artifact.limitations.map((limitation) => (
            <p key={limitation} className="text-sm text-muted-foreground">
              Limitation: {limitation}
            </p>
          ))}
          {artifact.criteria.map((criterion) => (
            <div key={criterion.id} className="space-y-1 text-sm">
              <p>
                {workflow.criteria.find((entry) => entry.id === criterion.id)?.text ?? criterion.id}
                : {criterion.passed ? "Passed" : "Not passed"}
              </p>
              {criterion.evidence.map((reference) => (
                <p key={reference} className="break-words text-xs text-muted-foreground">
                  {reference}
                </p>
              ))}
            </div>
          ))}
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer py-2">
              Original artifact and verification references
            </summary>
            <pre className="overflow-auto whitespace-pre-wrap break-all">
              {JSON.stringify(artifact, null, 2)}
            </pre>
          </details>
        </>
      ) : null}
    </div>
  );
}

function AssignmentSnapshot({
  environmentId,
  workflow,
  assignment,
}: {
  environmentId: EnvironmentId;
  workflow: AgentWorkflow;
  assignment: AgentWorkflow["assignments"][number];
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <details onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary className="cursor-pointer text-xs">Role snapshot and instructions</summary>
      {expanded ? (
        <>
          <WorkflowContent
            environmentId={environmentId}
            workflow={workflow}
            kind="assignment"
            id={assignment.id}
          />
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            {assignment.role.skills.map((skill) => (
              <li key={skill.id}>
                {skill.id} · {skill.state.replaceAll("_", " ")} · {skill.source}
                {skill.reason ? ` · ${skill.reason}` : ""}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </details>
  );
}
