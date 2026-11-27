import { T, Var, msg, useGT, useMessages } from "gt-react-native";
import { m as resolveMessage } from "../../i18n/messages";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  communicationStatus,
  workflowCommunications,
  type CommunicationMessage,
} from "@t3tools/client-runtime/fork/agents/communication";
import type {
  AgentWorkflow,
  AgentWorkflowLimits,
  EnvironmentId,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import {
  WORKFLOW_LIMIT_FIELDS,
  parseWorkflowLimits,
  workflowLimitDraft,
} from "@t3tools/client-runtime/fork/agents/limits";
import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { AsyncResult } from "effect/reactivity";
import * as Option from "effect/Option";
import { useRef, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { useProjects } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { uuidv4 } from "../../lib/uuid";
import { agentWorkflows } from "./agentWorkflowState";

export type AgentWorkflowsRouteParams = {
  environmentId?: EnvironmentId;
  projectId?: ProjectId;
  sourceThreadId?: ThreadId;
  workflowId?: string;
};

const STATUS = {
  draft: "Preparing",
  running: "Working",
  waiting_user: "Needs your answer",
  paused: "Paused",
  completed: "Reviewed result",
  failed: "Stopped with a problem",
  cancelled: "Cancelled",
} as const;

export function AgentWorkflowsScreen({ route }: StaticScreenProps<AgentWorkflowsRouteParams>) {
  const gt = useGT();
  const params = route.params ?? {};
  const { environments } = useEnvironments();
  const projects = useProjects().filter((project) => !project.archivedAt);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const key = (project: EnvironmentProject) => `${project.environmentId}:${project.id}`;
  const initial = projects.find(
    (entry) =>
      (!params.projectId || entry.id === params.projectId) &&
      (!params.environmentId || entry.environmentId === params.environmentId),
  );
  const project =
    selectedProject !== null
      ? projects.find((entry) => key(entry) === selectedProject)
      : params.projectId || params.environmentId
        ? initial
        : projects[0];
  return (
    <ScreenScrollView
      className="flex-1 bg-screen"
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerClassName="gap-5 p-5 pb-12"
      maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
    >
      <View className="gap-2">
        <Text className="text-2xl font-t3-bold text-foreground">
          <T>Agent workflows</T>
        </Text>
        <Text className="text-sm text-foreground-muted">
          <T>
            Follow assignments, inspect evidence and answer questions in the project’s environment.
          </T>
        </Text>
      </View>
      <View className="gap-2" accessibilityLabel={gt("Workflow projects")}>
        {projects.map((entry) => (
          <Pressable
            key={key(entry)}
            accessibilityRole="button"
            accessibilityState={{ selected: project === entry }}
            onPress={() => setSelectedProject(key(entry))}
            className={`min-h-12 rounded-xl border p-3 ${project === entry ? "border-primary bg-secondary" : "border-border"}`}
          >
            <Text className="font-t3-medium text-foreground">{entry.title}</Text>
            <Text className="text-xs text-foreground-muted">
              {environments.find((environment) => environment.environmentId === entry.environmentId)
                ?.label ?? gt("Unavailable environment")}{" "}
              · {entry.workspaceRoot}
            </Text>
          </Pressable>
        ))}
      </View>
      {project ? (
        <ProjectWorkflows
          key={key(project)}
          project={project}
          {...(initial === project
            ? {
                initialWorkflowId: params.workflowId,
                sourceThreadId: params.sourceThreadId,
              }
            : {})}
        />
      ) : (
        <Text className="text-foreground-muted">
          {params.projectId || params.environmentId
            ? gt(
                "The selected project is unavailable. Reconnect its environment or choose another project.",
              )
            : gt("Connect a project to see its workflows.")}
        </Text>
      )}
    </ScreenScrollView>
  );
}

function failureText(result: Parameters<typeof squashAtomCommandFailure>[0]) {
  const cause = squashAtomCommandFailure(result);
  return cause instanceof Error
    ? cause.message
    : resolveMessage(msg("The operation could not finish. Reload to check its current state."));
}

function ProjectWorkflows({
  project,
  initialWorkflowId,
  sourceThreadId,
}: {
  project: EnvironmentProject;
  initialWorkflowId?: string | undefined;
  sourceThreadId?: ThreadId | undefined;
}) {
  const gt = useGT();
  const listResult = useAtomValue(
    agentWorkflows.list({ environmentId: project.environmentId, input: { projectId: project.id } }),
  );
  const rolesResult = useAtomValue(
    agentWorkflows.roles({
      environmentId: project.environmentId,
      input: { projectId: project.id },
    }),
  );
  const list = Option.getOrNull(AsyncResult.value(listResult));
  const roles = Option.getOrNull(AsyncResult.value(rolesResult));
  const canConfigure = useAtomValue(agentWorkflows.settings.permissionAtom(project.environmentId));
  const configure = useAtomCommand(agentWorkflows.settings, { reportFailure: false });
  const [selection, setSelection] = useState(initialWorkflowId ?? "");
  const [messageSearch, setMessageSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedId =
    selection ||
    list?.workflows.find(
      (workflow) =>
        workflow.managerThreadId === sourceThreadId || workflow.sourceThreadId === sourceThreadId,
    )?.id ||
    list?.workflows[0]?.id;
  return (
    <View className="gap-4">
      {AsyncResult.isFailure(listResult) ? (
        <Text accessibilityRole="alert" className="text-danger">
          <T>
            Could not load workflows. Check this environment’s connection, version and read
            permission.
          </T>
        </Text>
      ) : null}
      {roles && !roles.enabled ? (
        <Text className="text-foreground-muted">
          <T>New workflows are disabled. Existing history and controls remain available.</T>
        </Text>
      ) : null}
      {roles && canConfigure ? (
        <Button
          label={roles.enabled ? gt("Disable new starts") : gt("Enable workflows")}
          disabled={busy}
          onPress={() => {
            setBusy(true);
            setError(null);
            void configure({
              environmentId: project.environmentId,
              input: {
                projectId: project.id,
                expectedRevision: roles.revision,
                enabled: !roles.enabled,
              },
            }).then((result) => {
              setBusy(false);
              if (result._tag === "Failure") setError(failureText(result));
            });
          }}
        />
      ) : null}
      <Text className="text-xs text-foreground-muted">
        <T>
          Start workflows and edit project roles from web or desktop. Mobile supports monitoring,
          evidence, answers and lifecycle controls.
        </T>
      </Text>
      {error ? (
        <Text accessibilityRole="alert" className="text-danger">
          {error}
        </Text>
      ) : null}
      {list?.workflows.map((workflow) => (
        <Pressable
          key={workflow.id}
          accessibilityRole="button"
          accessibilityState={{ selected: selectedId === workflow.id }}
          onPress={() => setSelection(workflow.id)}
          className={`min-h-12 gap-1 rounded-xl border p-4 ${selectedId === workflow.id ? "border-primary" : "border-border"}`}
        >
          <Text className="font-t3-medium text-foreground">{workflow.title}</Text>
          <Text className="text-sm text-foreground-muted">
            {workflow.humanInputPending ? gt("Needs your input") : STATUS[workflow.status]} ·{" "}
            {workflow.acceptedCount}/{workflow.assignmentCount} accepted
          </Text>
          {workflow.currentStage ? (
            <Text className="text-sm text-foreground">{workflow.currentStage}</Text>
          ) : null}
          {workflow.latestSummary ? (
            <Text numberOfLines={1} className="text-xs text-foreground-muted">
              {workflow.latestSummary}
            </Text>
          ) : null}
          {workflow.pendingQuestions > 0 ? (
            <Text className="text-sm text-foreground">
              <T>
                <Var>{workflow.pendingQuestions}</Var> pending questions
              </T>
            </Text>
          ) : null}
        </Pressable>
      ))}
      {list?.workflows.length === 0 ? (
        <Text className="text-foreground-muted">
          <T>No workflows in this project yet.</T>
        </Text>
      ) : null}
      {selectedId ? (
        <View className="gap-4">
          <TextInput
            accessibilityLabel={gt("Search all workflow messages")}
            placeholder={gt("Search all messages")}
            className="min-h-12 rounded-lg border border-border p-3 text-foreground"
            value={messageSearch}
            maxLength={200}
            onChangeText={setMessageSearch}
          />
          <WorkflowDetail
            key={selectedId}
            project={project}
            workflowId={selectedId}
            search={messageSearch}
          />
        </View>
      ) : null}
    </View>
  );
}

function WorkflowDetail({
  project,
  workflowId,
  search,
}: {
  project: EnvironmentProject;
  workflowId: string;
  search: string;
}) {
  const gt = useGT();
  const resolveMessage = useMessages();
  const navigation = useNavigation();
  const [messagePage, setMessagePage] = useState<{ search: string; offset: number | undefined }>({
    search,
    offset: undefined,
  });
  const messageOffset = messagePage.search === search ? messagePage.offset : undefined;
  const setMessageOffset = (offset: number | undefined) => setMessagePage({ search, offset });
  const [artifactOffset, setArtifactOffset] = useState<number | undefined>();
  const result = useAtomValue(
    agentWorkflows.read({
      environmentId: project.environmentId,
      input: {
        projectId: project.id,
        workflowId,
        messageOffset,
        artifactOffset,
        limit: 50,
        search: search.trim() || undefined,
      },
    }),
  );
  const workflow = Option.getOrNull(AsyncResult.value(result));
  const canControl = useAtomValue(agentWorkflows.control.permissionAtom(project.environmentId));
  const canControlAssignment = useAtomValue(
    agentWorkflows.assignmentControl.permissionAtom(project.environmentId),
  );
  const canReply = useAtomValue(agentWorkflows.message.permissionAtom(project.environmentId));
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
      <Text
        accessibilityRole={AsyncResult.isFailure(result) ? "alert" : undefined}
        className="text-foreground-muted"
      >
        {AsyncResult.isFailure(result)
          ? gt("Could not load this workflow. Check your connection and permission.")
          : gt("Loading workflow…")}
      </Text>
    );
  const openThread = (threadId: ThreadId) =>
    navigation.dispatch(
      StackActions.push("Thread", { environmentId: project.environmentId, threadId }),
    );
  const controlWorkflow = (
    action: "pause" | "resume" | "cancel" | "retry",
    limits?: AgentWorkflowLimits,
  ) => {
    setBusy(true);
    setError(null);
    void control({
      environmentId: project.environmentId,
      input: {
        projectId: project.id,
        workflowId,
        action,
        requestId: uuidv4(),
        ...(limits ? { limits } : {}),
      },
    }).then((response) => {
      setBusy(false);
      if (response._tag === "Failure") setError(failureText(response));
    });
  };
  const controlAssignment = (assignmentId: string, action: "cancel" | "retry") => {
    setBusy(true);
    setError(null);
    void assignmentControl({
      environmentId: project.environmentId,
      input: { projectId: project.id, workflowId, assignmentId, action, requestId: uuidv4() },
    }).then((response) => {
      setBusy(false);
      if (response._tag === "Failure") setError(failureText(response));
    });
  };
  const revise = async (assignmentId: string, text: string) => {
    const key = JSON.stringify({
      assignmentId,
      generation: workflow.generation,
      text: text.trim(),
    });
    if (revisionRequest.current?.key !== key)
      revisionRequest.current = { key, cancelId: uuidv4(), messageId: uuidv4() };
    const ids = revisionRequest.current;
    setBusy(true);
    setError(null);
    const cancelled = await assignmentControl({
      environmentId: project.environmentId,
      input: {
        projectId: project.id,
        workflowId,
        assignmentId,
        requestId: ids.cancelId,
        action: "cancel",
      },
    });
    if (cancelled._tag === "Failure") {
      setBusy(false);
      setError(failureText(cancelled));
      return false;
    }
    const response = await send({
      environmentId: project.environmentId,
      input: {
        projectId: project.id,
        workflowId,
        assignmentId,
        requestId: ids.messageId,
        generation: cancelled.value.generation,
        toThreadId: workflow.managerThreadId,
        kind: "handoff",
        summary: gt("Revision requested: {slice}", {
          slice: text.trim().replace(/\s+/g, " ").slice(0, 160),
        }),
        text: gt(
          "The user cancelled assignment {assignmentId} and requests a fresh revised assignment.\n\n{trim}\n\nPreserve accepted criterion identities and evidence. Resolve material scope choices through the existing human-input flow before new work.",
          { assignmentId, trim: text.trim() },
        ),
        artifactIds: [],
        replyTo: null,
        blocking: false,
      },
    });
    setBusy(false);
    if (response._tag === "Failure") {
      setError(
        gt(
          "The assignment was cancelled, but the revision request was not delivered. {failureText} Retry the request or open the planner conversation.",
          { failureText: failureText(response) },
        ),
      );
      return false;
    }
    return true;
  };
  const reply = async (question: CommunicationMessage, text: string) => {
    const original = [...workflow.messages, ...workflow.pendingQuestions].find(
      (entry) => entry.id === question.id,
    );
    setBusy(true);
    setError(null);
    const response = await send({
      environmentId: project.environmentId,
      input: {
        projectId: project.id,
        workflowId,
        requestId: uuidv4(),
        generation: workflow.generation,
        toThreadId: original?.senderThreadId ?? workflow.managerThreadId,
        assignmentId: question.assignmentId,
        kind: "answer",
        summary: gt("Answer: {slice}", { slice: text.trim().slice(0, 160) }),
        text: text.trim(),
        artifactIds: [],
        replyTo: question.id,
        blocking: false,
      },
    });
    setBusy(false);
    if (response._tag === "Failure") {
      setError(failureText(response));
      return false;
    }
    return true;
  };
  const messages = [
    ...workflow.pendingQuestions.filter(
      (question) => !workflow.messages.some((message) => message.id === question.id),
    ),
    ...workflow.messages,
  ];
  const presentation = workflowCommunications({ ...workflow, messages });
  return (
    <View className="gap-5 border-t border-border pt-5">
      <View className="gap-2">
        <Text className="text-xl font-t3-bold text-foreground">{workflow.title}</Text>
        <Text
          accessibilityRole="text"
          accessibilityLiveRegion="polite"
          className="font-t3-medium text-foreground"
        >
          {STATUS[workflow.status]}
        </Text>
        <Text selectable className="text-sm text-foreground-muted">
          {workflow.objective}
        </Text>
        {workflow.humanInputPending ? (
          <View className="gap-2 rounded-xl border border-border p-3">
            <Text accessibilityLiveRegion="polite" className="font-t3-medium text-foreground">
              <T>Needs your input</T>
            </Text>
            <Text className="text-xs text-foreground-muted">
              <T>
                A conversation has a pending native question or approval. Open it to answer using
                its existing controls.
              </T>
            </Text>
            {(workflow.humanInputThreadIds?.length
              ? workflow.humanInputThreadIds
              : [workflow.managerThreadId]
            ).map((threadId) => (
              <Button
                key={threadId}
                label={gt("Open {value} conversation", {
                  value:
                    threadId === workflow.managerThreadId
                      ? (workflow.managerRole?.role.name ?? "Planner")
                      : (workflow.assignments.find((assignment) =>
                          assignment.attempts.some((attempt) => attempt.childThreadId === threadId),
                        )?.role.role.name ?? "Agent"),
                })}
                onPress={() => openThread(threadId)}
              />
            ))}
          </View>
        ) : null}
        {workflow.specSnapshot ? (
          <NativeDisclosure title={gt("Frozen source spec")}>
            <Text selectable className="text-xs text-foreground-muted">
              <T>
                <Var>{workflow.specSnapshot.source}</Var> · SHA-256{" "}
                <Var>{workflow.specSnapshot.contentHash}</Var>
              </T>
            </Text>
            <NativeContent project={project} workflowId={workflowId} kind="spec" id={workflow.id} />
          </NativeDisclosure>
        ) : null}
        <Button
          label={gt("Open planner conversation")}
          onPress={() => openThread(workflow.managerThreadId)}
        />
      </View>
      <View className="flex-row flex-wrap gap-2">
        {workflow.status === "paused" || workflow.status === "waiting_user" ? (
          <Button
            label={gt("Resume")}
            disabled={!canControl || busy}
            onPress={() => controlWorkflow("resume")}
          />
        ) : workflow.status === "running" ? (
          <Button
            label={gt("Pause new starts")}
            disabled={!canControl || busy}
            onPress={() => controlWorkflow("pause")}
          />
        ) : null}
        {workflow.status === "failed" ? (
          <Button
            label={gt("Retry")}
            disabled={!canControl || busy}
            onPress={() => controlWorkflow("retry")}
          />
        ) : null}
        {!["completed", "cancelled"].includes(workflow.status) ? (
          <Button
            label={gt("Cancel workflow")}
            tone="danger"
            disabled={!canControl || busy}
            onPress={() => controlWorkflow("cancel")}
          />
        ) : null}
      </View>
      {workflow.status === "paused" ? (
        <Text className="text-xs text-foreground-muted">
          <T>
            New assignments are paused. Running work may continue; open its conversation to
            interrupt it.
          </T>
        </Text>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" className="text-danger">
          {error}
        </Text>
      ) : null}
      <Text className="text-lg font-t3-medium text-foreground">
        <T>Assignments</T>
      </Text>
      {workflow.assignments.map((assignment) => (
        <NativeDisclosure
          key={assignment.id}
          title={`${assignment.role.role.name} · ${assignment.state.replaceAll("_", " ")}`}
        >
          <Text selectable className="text-sm text-foreground">
            {assignment.objective}
          </Text>
          <Text className="text-xs text-foreground-muted">
            {assignment.writeResponsibility
              ? gt("Owns workflow write responsibility")
              : gt("Does not own write responsibility")}
            <T>. A stopped provider turn does not mean accepted work.</T>
          </Text>
          {assignment.criteria.map((criterion) => (
            <Text key={criterion.id} className="text-sm text-foreground">
              • {criterion.text}
            </Text>
          ))}
          {assignment.requiredChecks.length > 0 ? (
            <View className="gap-1">
              <Text className="text-xs font-t3-medium text-foreground">
                <T>Required checks</T>
              </Text>
              {assignment.requiredChecks.map((command) => (
                <Text key={command} className="text-xs text-foreground-muted">
                  {command}
                </Text>
              ))}
            </View>
          ) : (
            <Text className="text-xs text-foreground-muted">
              <T>No project checks declared; reviewer must assess testing sufficiency.</T>
            </Text>
          )}
          {assignment.dependencies.length > 0 ? (
            <Text className="text-xs text-foreground-muted">
              <T>
                Depends on:{" "}
                <Var>
                  {assignment.dependencies
                    .map(
                      (id) =>
                        workflow.assignments.find((entry) => entry.id === id)?.role.role.name ??
                        "Earlier assignment",
                    )
                    .join(", ")}
                </Var>
                .
              </T>
            </Text>
          ) : null}
          {["failed", "cancelled", "needs_changes"].includes(assignment.state) ? (
            <Button
              label={gt("Retry assignment")}
              disabled={
                !canControlAssignment ||
                busy ||
                ["cancelled", "completed"].includes(workflow.status)
              }
              onPress={() => controlAssignment(assignment.id, "retry")}
            />
          ) : !["accepted", "cancelled"].includes(assignment.state) ? (
            <Button
              label={gt("Cancel assignment")}
              disabled={
                !canControlAssignment ||
                busy ||
                ["cancelled", "completed"].includes(workflow.status)
              }
              onPress={() => controlAssignment(assignment.id, "cancel")}
            />
          ) : null}
          {assignment.checkpoint ? (
            <Text selectable className="text-xs text-foreground-muted">
              <T>
                Pinned checkpoint: <Var>{assignment.checkpoint.commitSha}</Var>
              </T>
            </Text>
          ) : null}
          {assignment.attempts.map((attempt) =>
            attempt.childThreadId ? (
              <Button
                key={attempt.id}
                label={gt("Open attempt {value}", { value: attempt.ordinal + 1 })}
                onPress={() => openThread(attempt.childThreadId!)}
              />
            ) : null,
          )}
          <NativeDisclosure title={gt("Role snapshot and skill availability")}>
            <NativeContent
              project={project}
              workflowId={workflowId}
              kind="assignment"
              id={assignment.id}
            />
            {assignment.role.skills.map((skill) => (
              <Text key={skill.id} className="text-xs text-foreground-muted">
                {skill.id} · {skill.state.replaceAll("_", " ")}
                {skill.reason ? ` · ${skill.reason}` : ""}
              </Text>
            ))}
          </NativeDisclosure>
          {assignment.state !== "accepted" &&
          !["completed", "cancelled"].includes(workflow.status) ? (
            <NativeDisclosure title={gt("Request a revised assignment")}>
              <NativeRevisionForm
                disabled={!canControlAssignment || !canReply || busy}
                onRequest={(text) => revise(assignment.id, text)}
              />
            </NativeDisclosure>
          ) : null}
        </NativeDisclosure>
      ))}
      {workflow.assignments.length === 0 ? (
        <Text className="text-sm text-foreground-muted">
          <T>The planner is preparing the first assignment.</T>
        </Text>
      ) : null}
      <Text className="text-lg font-t3-medium text-foreground">
        <T>Communication</T>
      </Text>
      {presentation.groups.map((group) => (
        <NativeDisclosure
          key={group.id}
          title={group.summary}
          subtitle={`${presentation.names.get(group.latest.senderId) ?? "Agent"} → ${presentation.names.get(group.latest.recipientId) ?? "Agent"} · ${communicationStatus(group.latest, resolveMessage)}${group.messages.length > 1 ? ` · ${group.messages.length} updates` : ""}`}
        >
          <Text className="text-xs text-foreground-muted">
            <T>Summary from sender. Delivery status does not establish task completion.</T>
          </Text>
          {group.latest.delivery === "failed" ? (
            <View className="gap-2">
              <Text className="text-sm text-foreground">
                <T>
                  Delivery stopped. Open the conversation to resolve the failure and request another
                  send.
                </T>
              </Text>
              <Button
                label={
                  messages.find((entry) => entry.id === group.latest.id)?.senderThreadId
                    ? gt("Open sender conversation")
                    : gt("Open planner conversation")
                }
                onPress={() =>
                  openThread(
                    messages.find((entry) => entry.id === group.latest.id)?.senderThreadId ??
                      workflow.managerThreadId,
                  )
                }
              />
            </View>
          ) : null}
          {group.latest.questionState === "expired" ? (
            <Text className="text-sm text-foreground">
              <T>
                This question expired. Resume the workflow or open the planner conversation to
                resolve the blocking decision.
              </T>
            </Text>
          ) : null}
          {group.messages.map((message) => (
            <View key={message.id} className="gap-1">
              <Text className="text-xs text-foreground-muted">
                {new Date(message.createdAt).toLocaleString()}
              </Text>
              <NativeContent
                project={project}
                workflowId={workflowId}
                kind="message"
                id={message.id}
              />
              {messages
                .find((entry) => entry.id === message.id)
                ?.artifactIds.map((id) => (
                  <NativeDisclosure
                    key={id}
                    title={
                      workflow.artifacts.find((artifact) => artifact.id === id)?.summary ??
                      gt("Referenced artifact")
                    }
                  >
                    <NativeArtifactDetails
                      project={project}
                      workflowId={workflowId}
                      artifactId={id}
                      criteria={workflow.criteria}
                    />
                  </NativeDisclosure>
                ))}
            </View>
          ))}
          {group.latest.kind === "question" && group.latest.questionState === "open" ? (
            <AnswerForm question={group.latest} disabled={!canReply || busy} onReply={reply} />
          ) : null}
          <NativeDisclosure title={gt("Diagnostics and delivery facts")}>
            <Text selectable className="text-xs text-foreground-muted">
              {JSON.stringify(
                messages.filter((entry) => group.messages.some((row) => row.id === entry.id)),
                null,
                2,
              )}
            </Text>
          </NativeDisclosure>
        </NativeDisclosure>
      ))}
      {presentation.groups.length === 0 ? (
        <Text className="text-sm text-foreground-muted">
          <T>No matching communications yet.</T>
        </Text>
      ) : null}
      <View className="flex-row flex-wrap gap-2">
        {workflow.messageNextOffset !== null ? (
          <Button
            label={gt("Older exchanges")}
            onPress={() => setMessageOffset(workflow.messageNextOffset ?? undefined)}
          />
        ) : null}
        {messageOffset !== undefined ? (
          <Button
            label={gt("Newest exchanges")}
            tone="text"
            onPress={() => setMessageOffset(undefined)}
          />
        ) : null}
      </View>
      <Text className="text-lg font-t3-medium text-foreground">
        <T>Evidence and results</T>
      </Text>
      {workflow.artifacts.map((artifact) => (
        <NativeDisclosure
          key={artifact.id}
          title={`${artifact.kind} · ${artifact.summary}`}
          subtitle={artifact.validation}
        >
          <NativeArtifactDetails
            project={project}
            workflowId={workflowId}
            artifactId={artifact.id}
            criteria={workflow.criteria}
          />
        </NativeDisclosure>
      ))}
      <View className="flex-row flex-wrap gap-2">
        {workflow.artifactNextOffset !== null ? (
          <Button
            label={gt("Older artifacts")}
            onPress={() => setArtifactOffset(workflow.artifactNextOffset ?? undefined)}
          />
        ) : null}
        {artifactOffset !== undefined ? (
          <Button
            label={gt("Newest artifacts")}
            tone="text"
            onPress={() => setArtifactOffset(undefined)}
          />
        ) : null}
      </View>
      <NativeDisclosure title={gt("Limits and execution facts")}>
        <Text className="text-xs text-foreground-muted">
          <T>
            <Var>{workflow.limits.maxConcurrent}</Var> concurrent assignments ·{" "}
            <Var>{workflow.limits.maxAttempts}</Var> attempts ·{" "}
            <Var>{workflow.limits.maxReviewRounds}</Var> correction rounds. Provider cost coverage
            may be unknown.
          </T>
        </Text>
        <Text selectable className="text-xs text-foreground-muted">
          <T>Base: </T>
          {workflow.baseRef ?? gt("Preparing")}
          <T>. Workspace: </T>
          {workflow.workspacePath ?? gt("Preparing")}.
        </Text>
        <Text className="text-xs text-foreground-muted">
          <T>A reviewed result does not imply a merged PR or board completion.</T>
        </Text>
        {!["draft", "completed", "cancelled"].includes(workflow.status) ? (
          <NativeLimitsEditor
            workflow={workflow}
            disabled={!canControl || busy}
            onApply={controlWorkflow}
          />
        ) : null}
      </NativeDisclosure>
    </View>
  );
}

function NativeLimitsEditor({
  workflow,
  disabled,
  onApply,
}: {
  workflow: AgentWorkflow;
  disabled: boolean;
  onApply: (action: "pause" | "resume" | "retry", limits: AgentWorkflowLimits) => void;
}) {
  const gt = useGT();
  const messages = useMessages();
  const [draft, setDraft] = useState(() => workflowLimitDraft(workflow.limits));
  const limits = parseWorkflowLimits(draft);
  const action =
    workflow.status === "failed"
      ? "retry"
      : workflow.status === "paused" || workflow.status === "waiting_user"
        ? "resume"
        : "pause";
  return (
    <View className="gap-3">
      {WORKFLOW_LIMIT_FIELDS.map(({ key, label, min, max }) => (
        <View key={key} className="gap-1">
          <Text className="text-xs text-foreground">
            {messages(label)} ({min}–{max})
          </Text>
          <TextInput
            accessibilityLabel={messages(label)}
            className="min-h-12 rounded-lg border border-border p-3 text-foreground"
            keyboardType="numeric"
            editable={!disabled}
            value={draft[key]}
            onChangeText={(text) => setDraft({ ...draft, [key]: text })}
          />
        </View>
      ))}
      <Text className="text-xs text-foreground-muted">
        <T>
          Limits govern future assignment dispatch. Existing work may continue; manager coordination
          and incomplete provider usage are not a dollar ceiling.
        </T>
      </Text>
      {!limits ? (
        <Text accessibilityLiveRegion="polite" className="text-xs text-foreground-muted">
          <T>Enter all values within their allowed ranges.</T>
        </Text>
      ) : null}
      <Button
        disabled={disabled || !limits}
        label={
          action === "pause"
            ? gt("Apply limits and pause new starts")
            : action === "resume"
              ? gt("Apply limits and resume")
              : gt("Retry with these limits")
        }
        onPress={() => {
          if (limits && !disabled) onApply(action, limits);
        }}
      />
    </View>
  );
}

function NativeRevisionForm({
  disabled,
  onRequest,
}: {
  disabled: boolean;
  onRequest: (text: string) => Promise<boolean>;
}) {
  const gt = useGT();
  const [text, setText] = useState("");
  const [submitted, setSubmitted] = useState(false);
  return (
    <View className="gap-2">
      <Text className="text-xs text-foreground-muted">
        <T>
          Cancels the current assignment and asks the planner for a fresh assignment. Accepted
          criteria remain intact; material scope choices still require your input.
        </T>
      </Text>
      <TextInput
        accessibilityLabel={gt("Requested assignment change")}
        className="min-h-24 rounded-lg border border-border p-3 text-foreground"
        multiline
        maxLength={38_000}
        editable={!disabled}
        value={text}
        onChangeText={(value) => {
          setText(value);
          setSubmitted(false);
        }}
      />
      <Button
        label={gt("Cancel and request revision")}
        disabled={disabled || !text.trim()}
        onPress={() => {
          if (disabled || !text.trim()) return;
          void onRequest(text).then((sent) => {
            if (sent) {
              setText("");
              setSubmitted(true);
            }
          });
        }}
      />
      {submitted ? (
        <Text accessibilityLiveRegion="polite" className="text-xs text-foreground-muted">
          <T>Revision request sent to the planner.</T>
        </Text>
      ) : null}
    </View>
  );
}

function NativeArtifactDetails({
  project,
  workflowId,
  artifactId,
  criteria,
}: {
  project: EnvironmentProject;
  workflowId: string;
  artifactId: string;
  criteria: ReadonlyArray<{ readonly id: string; readonly text: string }>;
}) {
  const gt = useGT();
  const result = useAtomValue(
    agentWorkflows.content({
      environmentId: project.environmentId,
      input: {
        projectId: project.id,
        workflowId,
        kind: "artifact",
        id: artifactId,
      },
    }),
  );
  const content = Option.getOrNull(AsyncResult.value(result));
  const artifact = content?.artifact;
  return (
    <View className="gap-3">
      <Text
        selectable
        accessibilityRole={AsyncResult.isFailure(result) ? "alert" : undefined}
        className="text-sm text-foreground"
      >
        {content?.text ??
          (AsyncResult.isFailure(result)
            ? gt("Could not load the original evidence. Check your connection and permission.")
            : gt("Loading evidence…"))}
      </Text>
      {artifact ? (
        <>
          <Text selectable className="text-xs text-foreground-muted">
            <T>Head: </T>
            {artifact.headRef ?? gt("Not recorded")}
            <T>. Reviewed: </T>
            {artifact.reviewedHead ?? gt("Not a review")}.
          </Text>
          {artifact.checks.map((check) => (
            <View
              key={`${check.command}:${check.revision}:${check.evidence}`}
              className="gap-1 rounded-lg border border-border p-3"
            >
              <Text className="text-sm font-t3-medium text-foreground">
                {check.status.toUpperCase()}: {check.command}
              </Text>
              <Text selectable className="text-xs text-foreground-muted">
                {check.revision}
                {check.required ? gt(" · Required") : ""}
                {"\n"}
                {check.evidence}
              </Text>
            </View>
          ))}
          {artifact.findings.map((finding) => (
            <Text
              key={`${finding.severity}:${finding.location}:${finding.reason}`}
              className="text-sm text-foreground"
            >
              {finding.severity}: {finding.location}. {finding.reason}
            </Text>
          ))}
          {artifact.limitations.map((limitation) => (
            <Text key={limitation} className="text-sm text-foreground-muted">
              <T>
                Limitation: <Var>{limitation}</Var>
              </T>
            </Text>
          ))}
          {artifact.criteria.map((criterion) => (
            <View key={criterion.id} className="gap-1">
              <Text className="text-sm text-foreground">
                {criteria.find((entry) => entry.id === criterion.id)?.text ?? criterion.id}:{" "}
                {criterion.passed ? gt("Passed") : gt("Not passed")}
              </Text>
              {criterion.evidence.map((reference) => (
                <Text key={reference} selectable className="text-xs text-foreground-muted">
                  {reference}
                </Text>
              ))}
            </View>
          ))}
          <NativeDisclosure title={gt("Original artifact and verification references")}>
            <Text selectable className="text-xs text-foreground-muted">
              {JSON.stringify(artifact, null, 2)}
            </Text>
          </NativeDisclosure>
        </>
      ) : null}
    </View>
  );
}

function NativeDisclosure({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View className="rounded-xl border border-border">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        className="min-h-12 gap-1 p-4"
      >
        <Text numberOfLines={open ? undefined : 1} className="font-t3-medium text-foreground">
          {open ? "▾" : "▸"} {title}
        </Text>
        {subtitle ? <Text className="text-xs text-foreground-muted">{subtitle}</Text> : null}
      </Pressable>
      {open ? <View className="gap-3 border-t border-border p-4">{children}</View> : null}
    </View>
  );
}

function NativeContent({
  project,
  workflowId,
  kind,
  id,
}: {
  project: EnvironmentProject;
  workflowId: string;
  kind: "message" | "artifact" | "assignment" | "spec";
  id: string;
}) {
  const gt = useGT();
  const result = useAtomValue(
    agentWorkflows.content({
      environmentId: project.environmentId,
      input: { projectId: project.id, workflowId, kind, id },
    }),
  );
  const content = Option.getOrNull(AsyncResult.value(result));
  return (
    <Text selectable className="text-sm text-foreground">
      {content?.text ??
        (AsyncResult.isFailure(result)
          ? gt("Could not load the original content.")
          : gt("Loading content…"))}
    </Text>
  );
}

function AnswerForm({
  question,
  disabled,
  onReply,
}: {
  question: CommunicationMessage;
  disabled: boolean;
  onReply: (question: CommunicationMessage, text: string) => Promise<boolean>;
}) {
  const gt = useGT();
  const [answer, setAnswer] = useState("");
  return (
    <View className="gap-2">
      <Text className="text-sm font-t3-medium text-foreground">
        <T>Answer as you</T>
      </Text>
      <TextInput
        accessibilityLabel={gt("Your answer")}
        className="min-h-24 rounded-lg border border-border p-3 text-foreground"
        multiline
        maxLength={40_000}
        value={answer}
        onChangeText={setAnswer}
        editable={!disabled}
      />
      <Text className="text-xs text-foreground-muted">
        <T>Your answer is attributed to you. Peer questions do not require your intervention.</T>
      </Text>
      <Button
        label={gt("Send answer")}
        disabled={disabled || !answer.trim()}
        onPress={() => {
          void onReply(question, answer).then((sent) => {
            if (sent) setAnswer("");
          });
        }}
      />
    </View>
  );
}
