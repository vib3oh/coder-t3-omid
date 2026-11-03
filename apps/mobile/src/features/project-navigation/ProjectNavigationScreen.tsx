import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type NavigationWorktree,
  type NavigationThread,
  type ProjectNavigationReadResult,
  type ProjectId,
} from "@t3tools/contracts";
import { useIsFocused, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { scopedProjectKey } from "../../lib/scopedEntities";
import { uuidv4 } from "../../lib/uuid";
import { useProjects, useQuietThreadShell } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { useEnvironmentScope } from "../../state/session";
import { buildHomeProjectScopes } from "../home/homeThreadList";
import { useAtomValueWhileVisible } from "../home/home-route-visibility";
import { useSelectWorkspaceDetail } from "../workspace/useSelectWorkspaceDetail";
import { projectNavigation } from "./projectNavigationState";
import { resolveProjectNavigationTarget } from "./projectNavigationSelection";
import { resolveThreadListV2Status, threadHasUnseenCompletion } from "../threads/threadListV2";

export type ProjectNavigationRouteParams = {
  environmentId?: EnvironmentId;
  projectId?: ProjectId;
};

const STAGES = {
  ready: "Your review",
  reviewing: "Agent review",
  building: "Building",
  done: "Done",
  parked: "Parked / settled",
} as const;
const CARD_STAGES = { ...STAGES, backlog: "Backlog", upNext: "Up Next" };

export function ProjectNavigationScreen({
  route,
}: StaticScreenProps<ProjectNavigationRouteParams>) {
  const visible = useIsFocused();
  return <ProjectNavigationPanel visible={visible} initialTarget={route.params} />;
}

export function ProjectNavigationPanel({
  visible,
  initialTarget,
}: {
  visible: boolean;
  initialTarget?: ProjectNavigationRouteParams;
}) {
  const projects = useProjects().filter((project) => !project.archivedAt);
  const { environments } = useEnvironments();
  const preferences = useAtomValue(mobilePreferencesAtom);
  const saved = Option.getOrNull(AsyncResult.value(preferences));
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const [selected, setSelected] = useState<string | null | undefined>();
  const target = resolveProjectNavigationTarget({
    projects,
    selected,
    initialTarget,
    remembered: saved?.lastThreadProject,
  });
  const groups = buildHomeProjectScopes({
    projects,
    environmentId: null,
    projectGroupingMode: saved?.projectGroupingMode ?? "repository",
  });
  const environmentLabel = (environmentId: EnvironmentId) =>
    environments.find((environment) => environment.environmentId === environmentId)?.label ??
    "Unavailable environment";
  const projectLabel = (project: EnvironmentProject) =>
    `${project.title} · ${environmentLabel(project.environmentId)}`;
  const pickProject = (project: EnvironmentProject) => {
    setSelected(scopedProjectKey(project.environmentId, project.id));
    savePreferences({
      lastThreadProject: { environmentId: project.environmentId, projectId: project.id },
    });
  };

  return (
    <ScreenScrollView
      className="flex-1 bg-screen"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerClassName="gap-4 p-5 pb-12"
      maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
    >
      <Text accessibilityRole="header" className="text-2xl font-t3-bold text-foreground">
        {target?.title ?? "Project worktrees"}
      </Text>
      {target ? (
        <>
          <Button label="Choose project" tone="text" onPress={() => setSelected(null)} />
          <View className="gap-2" accessibilityLabel="Project environments">
            {groups
              .find((group) =>
                group.projects.some(
                  (project) =>
                    project.id === target.id && project.environmentId === target.environmentId,
                ),
              )
              ?.projects.map((project) => (
                <Pressable
                  key={scopedProjectKey(project.environmentId, project.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: project === target }}
                  onPress={() => pickProject(project)}
                  className={`min-h-12 justify-center rounded-xl border px-4 ${project === target ? "border-primary bg-secondary" : "border-border"}`}
                >
                  <Text className="text-foreground">{projectLabel(project)}</Text>
                </Pressable>
              ))}
          </View>
          <ProjectWorktrees
            key={scopedProjectKey(target.environmentId, target.id)}
            project={target}
            visible={visible}
          />
        </>
      ) : (
        <>
          {initialTarget?.projectId || initialTarget?.environmentId ? (
            <Text accessibilityRole="alert" className="text-foreground-muted">
              The selected project is unavailable. Reconnect its environment or choose another
              project.
            </Text>
          ) : null}
          {groups.map((group) => (
            <View key={group.key} className="gap-2 rounded-xl border border-border p-4">
              <Text className="font-t3-bold text-foreground">{group.title}</Text>
              {group.projects.map((project) => (
                <Button
                  key={scopedProjectKey(project.environmentId, project.id)}
                  label={projectLabel(project)}
                  onPress={() => pickProject(project)}
                />
              ))}
            </View>
          ))}
          {groups.length === 0 ? (
            <Text className="text-foreground-muted">Connect a project to see its worktrees.</Text>
          ) : null}
        </>
      )}
    </ScreenScrollView>
  );
}

function ProjectWorktrees({ project, visible }: { project: EnvironmentProject; visible: boolean }) {
  const { environments } = useEnvironments();
  const connected = environments.some(
    (environment) =>
      environment.environmentId === project.environmentId &&
      environment.connection.phase === "connected",
  );
  const result = useAtomValueWhileVisible(
    projectNavigation.read({
      environmentId: project.environmentId,
      input: { projectId: project.id },
    }),
    visible && connected,
  );
  const view = Option.getOrNull(AsyncResult.value(result));
  const navigation = useNavigation();
  return (
    <View className="gap-4">
      {!connected ? (
        <Text accessibilityRole="alert" className="text-foreground-muted">
          This environment is disconnected. Displayed work may be stale; reconnect to continue.
        </Text>
      ) : AsyncResult.isFailure(result) ? (
        <Text accessibilityRole="alert" className="text-danger">
          Worktree details are unavailable. Check the server version, connection and read
          permission. All threads remain available in the ordinary thread list.
        </Text>
      ) : !view ? (
        <Text className="text-foreground-muted">Loading worktrees…</Text>
      ) : null}
      <Button
        label="Agent workflows"
        disabled={!connected}
        onPress={() =>
          navigation.navigate("AgentWorkflows", {
            environmentId: project.environmentId,
            projectId: project.id,
          })
        }
      />
      <Text className="text-xs text-foreground-muted">
        Roadmap cards and Changelog are available in web and desktop. This native view opens agent
        threads and workflow monitoring; it does not start work when you select a row.
      </Text>
      {view && !view.complete ? (
        <Text accessibilityRole="alert" className="text-foreground-muted">
          Some work details are unavailable. Counts and stages may be incomplete.
        </Text>
      ) : null}
      {view ? (
        <Text className="text-sm text-foreground-muted">
          {view.attentionCount} worktrees need your input · {view.totalWorktrees} worktrees
        </Text>
      ) : null}
      {view?.worktrees
        .filter((worktree) => worktree.isMain)
        .map((worktree) => (
          <WorktreeRow
            key={worktree.key}
            worktree={worktree}
            revision={view.revision}
            project={project}
            visible={visible && connected}
            connected={connected}
          />
        ))}
      {view ? (
        <WorktreePages
          first={view}
          project={project}
          visible={visible && connected}
          connected={connected}
        />
      ) : null}
    </View>
  );
}

function WorktreePages({
  first,
  project,
  visible,
  connected,
}: {
  first: ProjectNavigationReadResult;
  project: EnvironmentProject;
  visible: boolean;
  connected: boolean;
}) {
  const [page, setPage] = useState<{ revision: string; cursor: string } | null>(null);
  const cursor = page?.revision === first.revision ? page.cursor : null;
  const setCursor = (next: string | null) =>
    setPage(next ? { revision: first.revision, cursor: next } : null);
  return cursor ? (
    <WorktreePage
      key={cursor}
      cursor={cursor}
      project={project}
      visible={visible}
      connected={connected}
      onCursor={setCursor}
    />
  ) : (
    <WorktreeFeatureRows
      view={first}
      project={project}
      visible={visible}
      connected={connected}
      onCursor={setCursor}
    />
  );
}

function WorktreePage({
  cursor,
  project,
  visible,
  connected,
  onCursor,
}: {
  cursor: string;
  project: EnvironmentProject;
  visible: boolean;
  connected: boolean;
  onCursor: (cursor: string | null) => void;
}) {
  const result = useAtomValueWhileVisible(
    projectNavigation.page({
      environmentId: project.environmentId,
      input: { projectId: project.id, cursor },
    }),
    visible,
  );
  const view = Option.getOrNull(AsyncResult.value(result));
  return (
    <>
      {view ? (
        <WorktreeFeatureRows
          view={view}
          project={project}
          visible={visible}
          connected={connected}
          onCursor={onCursor}
        />
      ) : (
        <Text accessibilityRole="alert" className="text-foreground-muted">
          {AsyncResult.isFailure(result)
            ? "Work changed or this page is unavailable. Return to the first page."
            : "Loading worktrees…"}
        </Text>
      )}
      <Button label="First worktrees" onPress={() => onCursor(null)} />
    </>
  );
}

function WorktreeFeatureRows({
  view,
  project,
  visible,
  connected,
  onCursor,
}: {
  view: ProjectNavigationReadResult;
  project: EnvironmentProject;
  visible: boolean;
  connected: boolean;
  onCursor: (cursor: string | null) => void;
}) {
  return (
    <>
      {view.worktrees
        .filter((row) => !row.isMain)
        .map((worktree) => (
          <WorktreeRow
            key={worktree.key}
            worktree={worktree}
            revision={view.revision}
            project={project}
            visible={visible}
            connected={connected}
          />
        ))}
      {view.nextCursor ? (
        <Button label="Next worktrees" onPress={() => onCursor(view.nextCursor)} />
      ) : null}
    </>
  );
}

function WorktreeRow({
  worktree,
  revision,
  project,
  visible,
  connected,
}: {
  worktree: NavigationWorktree;
  revision: string;
  project: EnvironmentProject;
  visible: boolean;
  connected: boolean;
}) {
  const [expanded, setExpanded] = useState(worktree.isMain || worktree.attentionCount > 0);
  const [threadOffset, setThreadOffset] = useState<number | null>(null);
  const navigation = useNavigation();
  const selectDetail = useSelectWorkspaceDetail();
  const canOperate = useEnvironmentScope(project.environmentId, AuthOrchestrationOperateScope);
  const stage = worktree.isMain
    ? "Main checkout"
    : worktree.stage === "done" && worktree.completion === "merged"
      ? "Merged"
      : worktree.stage === "done" && worktree.completion === "completed"
        ? "Completed"
        : STAGES[worktree.stage];
  return (
    <View className="gap-3 rounded-xl border border-border p-4">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(!expanded)}
        className="min-h-12 justify-center gap-1"
      >
        <Text className="font-t3-bold text-foreground">{worktree.label}</Text>
        <Text className="text-sm text-foreground-muted">
          {stage} · {worktree.threadCount} threads
          {worktree.attentionCount > 0 ? " · Needs your input" : ""}
        </Text>
        {worktree.availability !== "available" ? (
          <Text className="text-xs text-foreground-muted">
            Worktree {worktree.availability}. Existing conversations remain available.
          </Text>
        ) : null}
      </Pressable>
      {expanded ? (
        <>
          {worktree.cards.map((card) => (
            <Text key={card.id} className="text-sm text-foreground-muted">
              Roadmap: {card.title} · {CARD_STAGES[card.stage]}
            </Text>
          ))}
          {(worktree.cardCount ?? worktree.cards.length) > worktree.cards.length ? (
            <Text className="text-xs text-foreground-muted">
              Showing {worktree.cards.length} of {worktree.cardCount} cards. Open Roadmap in web or
              desktop for the complete board.
            </Text>
          ) : null}
          {worktree.workflows.map((workflow) => (
            <Button
              key={workflow.id}
              label={`${workflow.title} · ${workflow.currentStage ?? workflow.status}`}
              disabled={!connected}
              onPress={() =>
                navigation.navigate("AgentWorkflows", {
                  environmentId: project.environmentId,
                  projectId: project.id,
                  workflowId: workflow.id,
                })
              }
            />
          ))}
          {(worktree.workflowCount ?? worktree.workflows.length) > worktree.workflows.length ? (
            <Button
              label={`All ${worktree.workflowCount} workflows`}
              disabled={!connected}
              onPress={() =>
                navigation.navigate("AgentWorkflows", {
                  environmentId: project.environmentId,
                  projectId: project.id,
                })
              }
            />
          ) : null}
          {threadOffset === null ? (
            <ThreadRows threads={worktree.threads} project={project} connected={connected} />
          ) : (
            <WorktreeThreadPage
              key={`${revision}:${threadOffset}`}
              project={project}
              worktreeKey={worktree.key}
              offset={threadOffset}
              visible={visible}
              onNext={setThreadOffset}
              connected={connected}
            />
          )}
          {threadOffset === null && worktree.threadNextOffset !== null ? (
            <Button
              label="More threads"
              onPress={() => setThreadOffset(worktree.threadNextOffset)}
            />
          ) : null}
          {threadOffset !== null ? (
            <Button label="First threads" tone="text" onPress={() => setThreadOffset(null)} />
          ) : null}
          <Button
            label="New thread here"
            disabled={
              !connected ||
              !canOperate ||
              worktree.availability !== "available" ||
              worktree.path === null
            }
            onPress={() =>
              selectDetail({
                name: "Thread",
                params: {
                  draft: {
                    requestId: uuidv4(),
                    environmentId: String(project.environmentId),
                    projectId: String(project.id),
                    branch: worktree.branch,
                    worktreePath: worktree.isMain ? null : worktree.path,
                  },
                },
              })
            }
          />
        </>
      ) : null}
    </View>
  );
}

function WorktreeThreadPage({
  project,
  worktreeKey,
  offset,
  visible,
  connected,
  onNext,
}: {
  project: EnvironmentProject;
  worktreeKey: string;
  offset: number;
  visible: boolean;
  connected: boolean;
  onNext: (offset: number) => void;
}) {
  const result = useAtomValueWhileVisible(
    projectNavigation.page({
      environmentId: project.environmentId,
      input: { projectId: project.id, worktreeKey, threadOffset: offset },
    }),
    visible,
  );
  const page = Option.getOrNull(AsyncResult.value(result))?.worktrees[0];
  return (
    <View className="gap-2">
      {page ? <ThreadRows threads={page.threads} project={project} connected={connected} /> : null}
      {!page ? (
        <Text className="text-foreground-muted">
          {AsyncResult.isFailure(result) ? "Could not load more threads." : "Loading threads…"}
        </Text>
      ) : null}
      {page?.threadNextOffset !== null && page?.threadNextOffset !== undefined ? (
        <Button label="More threads" onPress={() => onNext(page.threadNextOffset ?? offset)} />
      ) : null}
    </View>
  );
}

function ThreadRows({
  threads,
  project,
  connected,
}: {
  threads: NavigationWorktree["threads"];
  project: EnvironmentProject;
  connected: boolean;
}) {
  return threads.map((thread) => (
    <NavigationThreadRow key={thread.id} thread={thread} project={project} connected={connected} />
  ));
}

function NavigationThreadRow({
  thread,
  project,
  connected,
}: {
  thread: NavigationThread;
  project: EnvironmentProject;
  connected: boolean;
}) {
  const selectDetail = useSelectWorkspaceDetail();
  const shell = useQuietThreadShell(scopeThreadRef(project.environmentId, thread.id));
  const needsYou =
    thread.hasPendingApprovals ||
    thread.hasPendingUserInput ||
    thread.hasActionableProposedPlan ||
    thread.pendingGuestMessageCount > 0;
  const unread =
    shell !== null
      ? resolveThreadListV2Status(shell) === "ready" && threadHasUnseenCompletion(shell)
      : !needsYou &&
        !["preparing", "queued", "starting", "running", "waiting", "idle", "failed"].includes(
          thread.status ?? "",
        ) &&
        threadHasUnseenCompletion({
          latestRun: thread.latestRunCompletedAt
            ? { completedAt: thread.latestRunCompletedAt }
            : null,
          lastVisitedAt: thread.lastVisitedAt,
        });
  return (
    <Pressable
      accessibilityRole="button"
      disabled={!connected}
      accessibilityState={{ disabled: !connected }}
      onPress={() =>
        selectDetail({
          name: "Thread",
          params: { environmentId: String(project.environmentId), threadId: String(thread.id) },
        })
      }
      className="min-h-12 gap-1 rounded-lg bg-secondary p-3"
    >
      <Text className="font-t3-medium text-foreground">
        {unread ? "● " : ""}
        {thread.title}
      </Text>
      <Text className="text-xs text-foreground-muted">
        {thread.status ?? "Idle"}
        {needsYou ? " · Needs your input" : ""}
        {unread ? " · Unread completion" : ""}
        {thread.archivedAt ? " · Archived" : thread.settledAt ? " · Settled" : ""}
      </Text>
    </Pressable>
  );
}
