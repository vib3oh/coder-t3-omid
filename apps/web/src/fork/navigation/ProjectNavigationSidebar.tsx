import { useAtomValue } from "@effect/atom-react";
import {
  scopeProjectRef,
  scopeThreadRef,
  scopedProjectKey,
  scopedThreadKey,
} from "@t3tools/client-runtime/environment";
import { createProjectNavigationState } from "@t3tools/client-runtime/fork/navigation/state";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  AuthOrchestrationOperateScope,
  type NavigationThread,
  type NavigationWorktree,
  type ProjectNavigationReadResult,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { useLocation, useNavigate, useSearch } from "@tanstack/react-router";
import { AsyncResult, Atom } from "effect/reactivity";
import * as Option from "effect/Option";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  GitBranchIcon,
  HouseIcon,
  KanbanIcon,
  ListChecksIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  PinIcon,
  PlusIcon,
  SearchIcon,
  UsersIcon,
} from "lucide-react";
import { useState } from "react";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import { connectionAtomRuntime } from "../../connection/runtime";
import { useSidebarProjectGroups } from "../../hooks/useSidebarProjectGroups";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useThreadActions } from "../../hooks/useThreadActions";
import { useThreadRouteRef, useThreadRouteTarget } from "../../hooks/useThreadRouteTarget";
import { useComposerDraftStore } from "../../composerDraftStore";
import { useConnectedEnvironmentIds } from "../../state/environments";
import { useQuietThreadShell, useQuietThreadShells } from "../../state/entities";
import { useEnvironmentScope } from "../../state/session";
import { openCommandPalette } from "../../commandPaletteBus";
import { ProjectFavicon } from "../../components/ProjectFavicon";
import { SidebarChromeHeader, SidebarChromeFooter } from "../../components/sidebar/SidebarChrome";
import ThreadSidebar, { useSidebarProviderEntries } from "../../components/Sidebar";
import type { SidebarRouteReveal } from "../../components/sidebar/routeReveal";
import { useActiveRowReveal } from "../../components/sidebar/routeReveal";
import {
  hasUnseenCompletion,
  resolveSidebarThreadStatus,
  useSnoozeWakeClock,
} from "../../components/Sidebar.logic";
import { Button } from "../../components/ui/button";
import { Menu, MenuTrigger, MenuPopup, MenuItem } from "../../components/ui/menu";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from "../../components/ui/select";
import { useSidebar, useSidebarVisibility } from "../../components/ui/sidebar";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../../components/ui/tooltip";
import { requestCustomSnooze } from "../../components/CustomSnoozeDialog";
import { makeWorkspaceFileDropHandlers } from "../../components/chat/workspaceFileDrop";
import { useSidebarPendingFileDropStore } from "../../sidebarPendingFileDropStore";
import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import {
  changelogDestination,
  isScopedUtilityDestination,
  roadmapDestination,
  resolveNavigationRouteProject,
  resolveProjectGroupMember,
  workflowDestination,
  WORKTREE_SECTIONS,
  WORKTREE_STAGE_LABELS,
} from "./navigation.logic";
import {
  useProjectNavigationPreferences,
  useDocumentVisible,
  useNavigationQueryWhileVisible,
} from "./navigationState";

const navigation = createProjectNavigationState(connectionAtomRuntime);
const EMPTY_NAVIGATION = Atom.make<AsyncResult.AsyncResult<ProjectNavigationReadResult, unknown>>(
  AsyncResult.initial(),
);

export function ProjectNavigationSidebar({ routeReveal }: { routeReveal: SidebarRouteReveal }) {
  const groups = useSidebarProjectGroups();
  const threads = useQuietThreadShells();
  const routeRef = useThreadRouteRef();
  const routeThread = useQuietThreadShell(routeRef);
  const routeTarget = useThreadRouteTarget();
  const routeDraft = useComposerDraftStore((store) =>
    routeTarget?.kind === "draft" ? store.getDraftSession(routeTarget.draftId) : null,
  );
  const search = useSearch({ strict: false });
  const location = useLocation();
  const navigate = useNavigate();
  const [preferences, setPreferences] = useProjectNavigationPreferences();
  const [globalThreads, setGlobalThreads] = useState(false);
  const routeProject = resolveNavigationRouteProject({
    thread: routeThread ? scopeProjectRef(routeThread.environmentId, routeThread.projectId) : null,
    draft: routeDraft ? scopeProjectRef(routeDraft.environmentId, routeDraft.projectId) : null,
    search,
  });
  const selectedKey = routeProject ?? preferences.selectedProject;
  const selectedGroup =
    groups.find((group) =>
      group.memberProjects.some(
        (member) =>
          scopedProjectKey({ environmentId: member.environmentId, projectId: member.id }) ===
          selectedKey,
      ),
    ) ?? (selectedKey ? undefined : groups[0]);
  const selectedProject =
    selectedGroup?.memberProjects.find(
      (member) =>
        scopedProjectKey({ environmentId: member.environmentId, projectId: member.id }) ===
        selectedKey,
    ) ?? selectedGroup?.memberProjects[0];
  const connected = useConnectedEnvironmentIds();
  const projectOptions =
    selectedGroup?.memberProjects.map((project) => ({
      value: scopedProjectKey({ environmentId: project.environmentId, projectId: project.id }),
      label: `${project.title} · ${project.environmentLabel ?? project.environmentId}${connected.includes(project.environmentId) ? "" : " · Offline"}`,
    })) ?? [];
  const snoozeClock = useSnoozeWakeClock(threads);
  const snoozeNow = new Date(snoozeClock).toISOString();
  const sidebarVisible = useSidebarVisibility();
  const documentVisible = useDocumentVisible();
  const aggregateResult = useNavigationQueryWhileVisible(
    !globalThreads && selectedProject
      ? navigation.read({
          environmentId: selectedProject.environmentId,
          input: {
            projectId: selectedProject.id,
            ...(routeRef?.environmentId === selectedProject.environmentId
              ? { revealThreadId: routeRef.threadId }
              : {}),
          },
        })
      : EMPTY_NAVIGATION,
    sidebarVisible &&
      documentVisible &&
      !globalThreads &&
      Boolean(selectedProject && connected.includes(selectedProject.environmentId)),
  );
  const aggregate = Option.getOrNull(AsyncResult.value(aggregateResult));

  const selectProject = (project: EnvironmentProject) => {
    const key = scopedProjectKey({ environmentId: project.environmentId, projectId: project.id });
    const lastThreads = { ...preferences.lastThreads };
    if (routeThread)
      lastThreads[
        scopedProjectKey({
          environmentId: routeThread.environmentId,
          projectId: routeThread.projectId,
        })
      ] = routeThread.id;
    const lastDestinations = { ...preferences.lastDestinations };
    const lastMembers = { ...preferences.lastMembers };
    if (selectedProject) {
      const currentKey = scopedProjectKey({
        environmentId: selectedProject.environmentId,
        projectId: selectedProject.id,
      });
      if (selectedGroup) lastMembers[selectedGroup.projectKey] = currentKey;
      if (routeThread) delete lastDestinations[currentKey];
      else if (
        isScopedUtilityDestination(location.href, selectedProject.environmentId, selectedProject.id)
      )
        lastDestinations[currentKey] = location.href;
    }
    const nextGroup = groups.find((group) =>
      group.memberProjects.some(
        (member) => member.environmentId === project.environmentId && member.id === project.id,
      ),
    );
    if (nextGroup) lastMembers[nextGroup.projectKey] = key;
    setPreferences({
      ...preferences,
      selectedProject: key,
      lastMembers,
      lastThreads,
      lastDestinations,
    });
    setGlobalThreads(false);
    const lastThread = threads.find(
      (thread) =>
        thread.id === lastThreads[key] &&
        thread.projectId === project.id &&
        thread.environmentId === project.environmentId,
    );
    const destination = lastDestinations[key];
    if (destination && isScopedUtilityDestination(destination, project.environmentId, project.id))
      void navigate({ href: destination });
    else if (lastThread)
      void navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId: project.environmentId, threadId: lastThread.id },
      });
    else void navigate(roadmapDestination(project.environmentId, project.id));
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-project-navigation="">
      <SidebarChromeHeader isElectron={isElectron} />
      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Projects"
          className="scrollbar-gutter-both flex w-14 shrink-0 flex-col items-center gap-2 overflow-y-auto border-r border-sidebar-border px-1 py-3"
        >
          <RailButton
            label="All threads and projectless work"
            active={globalThreads}
            onClick={() => setGlobalThreads(true)}
          >
            <MessageSquareIcon className="size-5" />
          </RailButton>
          <RailButton label="Search projects and threads" onClick={() => openCommandPalette()}>
            <SearchIcon className="size-5" />
          </RailButton>
          <div className="my-1 w-7 border-t border-sidebar-border" />
          {groups.map((group) => {
            const member = resolveProjectGroupMember({
              projects: group.memberProjects,
              selectedProject: selectedKey,
              rememberedProject: preferences.lastMembers?.[group.projectKey],
              connectedEnvironmentIds: connected,
            });
            if (!member) return null;
            const groupThreads = threads.filter((thread) =>
              group.memberProjects.some(
                (project) =>
                  thread.projectId === project.id && thread.environmentId === project.environmentId,
              ),
            );
            const isSelectedGroup = selectedGroup?.projectKey === group.projectKey;
            const hasLoadedAttention = groupThreads.some(
              (thread) =>
                (thread.hasPendingApprovals ||
                  thread.hasPendingUserInput ||
                  thread.hasActionableProposedPlan ||
                  thread.pendingSubagentRequest ||
                  (thread.pendingGuestMessageCount ?? 0) > 0) &&
                !effectiveSnoozed(thread, { now: snoozeNow }),
            );
            const needsYou =
              isSelectedGroup && aggregate ? aggregate.attentionCount : hasLoadedAttention ? 1 : 0;
            const partial =
              !isSelectedGroup || !aggregate?.complete || group.memberProjects.length > 1;
            const unread = groupThreads.some(hasUnseenCompletion);
            return (
              <RailButton
                key={group.projectKey}
                label={`${group.displayName}${group.pinned ? ", pinned" : ""}${partial ? `, ${needsYou ? `at least ${needsYou} worktrees need you; ` : ""}additional metadata not loaded` : needsYou ? `, ${needsYou} worktrees need you` : ""}`}
                active={!globalThreads && selectedGroup?.projectKey === group.projectKey}
                onClick={() => selectProject(member)}
              >
                <ProjectFavicon project={group} className="size-8" />
                {needsYou > 0 ? (
                  <span className="absolute -right-0.5 -top-0.5 rounded-full bg-primary px-1 text-3xs text-primary-foreground">
                    {needsYou}
                    {partial ? "+" : ""}
                  </span>
                ) : partial ? (
                  <span
                    className="absolute right-1 top-1 text-3xs text-muted-foreground"
                    aria-label="Attention details not loaded"
                  >
                    ?
                  </span>
                ) : null}
                {unread ? (
                  <span
                    className="absolute bottom-1 right-1 size-2 rounded-full bg-primary"
                    aria-label="Unread work"
                  />
                ) : null}
              </RailButton>
            );
          })}
          <RailButton
            label="Add project"
            onClick={() => openCommandPalette({ open: "add-project" })}
          >
            <PlusIcon className="size-5" />
          </RailButton>
        </nav>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {globalThreads ? (
            <ThreadSidebar routeReveal={routeReveal} hideChrome />
          ) : selectedProject && selectedGroup ? (
            <>
              <header className="space-y-3 px-3 pb-3 pt-2">
                <h2 className="truncate text-base font-semibold">{selectedGroup.displayName}</h2>
                <Select
                  items={projectOptions}
                  value={scopedProjectKey({
                    environmentId: selectedProject.environmentId,
                    projectId: selectedProject.id,
                  })}
                  onValueChange={(key) => {
                    const member = selectedGroup.memberProjects.find(
                      (project) =>
                        scopedProjectKey({
                          environmentId: project.environmentId,
                          projectId: project.id,
                        }) === key,
                    );
                    if (member) selectProject(member);
                  }}
                >
                  <SelectTrigger size="compact" aria-label="Project environment">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    {projectOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
                <ProjectActions project={selectedProject} />
              </header>
              <ProjectWorktrees
                key={scopedProjectKey({
                  environmentId: selectedProject.environmentId,
                  projectId: selectedProject.id,
                })}
                project={selectedProject}
                routeReveal={routeReveal}
                aggregateResult={aggregateResult}
              />
            </>
          ) : (
            <p className="p-3 text-sm text-muted-foreground">
              {selectedKey
                ? "This project is unavailable. Choose another project."
                : "Add a project to organize its worktrees."}
            </p>
          )}
        </div>
      </div>
      <SidebarChromeFooter />
      <span className="sr-only" aria-live="polite">
        {location.pathname === "/roadmap" ? "Roadmap" : ""}
      </span>
    </div>
  );
}

function RailButton({
  label,
  active = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            aria-pressed={active}
            onClick={onClick}
            className={cn(
              "relative flex size-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              active && "bg-accent text-foreground ring-1 ring-border",
            )}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup side="right">{label}</TooltipPopup>
    </Tooltip>
  );
}

function ProjectActions({ project }: { project: EnvironmentProject }) {
  const navigate = useNavigate();
  const newThread = useNewThreadHandler();
  const canOperate = useEnvironmentScope(project.environmentId, AuthOrchestrationOperateScope);
  const { isMobile, setOpenMobile } = useSidebar();
  const close = () => {
    if (isMobile) setOpenMobile(false);
  };
  return (
    <div className="flex flex-wrap gap-1">
      <Button
        variant="outline"
        size="xs"
        onClick={() => {
          close();
          void navigate(roadmapDestination(project.environmentId, project.id));
        }}
      >
        <KanbanIcon />
        Roadmap
      </Button>
      <Button
        variant="outline"
        size="xs"
        disabled={!canOperate}
        onClick={() => {
          close();
          void newThread(scopeProjectRef(project.environmentId, project.id), {
            envMode: "worktree",
          });
        }}
      >
        <PlusIcon />
        New feature
      </Button>
      <Menu>
        <MenuTrigger
          render={<Button variant="ghost" size="icon-xs" aria-label="Project actions" />}
        >
          <MoreHorizontalIcon />
        </MenuTrigger>
        <MenuPopup>
          <MenuItem
            onClick={() => {
              close();
              void navigate(workflowDestination(project.environmentId, project.id));
            }}
          >
            <UsersIcon />
            Agent workflows
          </MenuItem>
          <MenuItem
            onClick={() => {
              close();
              void navigate(changelogDestination(project.environmentId, project.id));
            }}
          >
            <ListChecksIcon />
            Changelog
          </MenuItem>
        </MenuPopup>
      </Menu>
    </div>
  );
}

function ProjectWorktrees({
  project,
  routeReveal,
  aggregateResult,
}: {
  project: EnvironmentProject;
  routeReveal: SidebarRouteReveal;
  aggregateResult: AsyncResult.AsyncResult<ProjectNavigationReadResult, unknown>;
}) {
  const activeRef = useThreadRouteRef();
  const [cursor, setCursor] = useState<string | undefined>();
  const [previous, setPrevious] = useState<readonly (string | undefined)[]>([]);
  const pageResult = useAtomValue(
    cursor
      ? navigation.page({
          environmentId: project.environmentId,
          input: {
            projectId: project.id,
            cursor,
            ...(activeRef?.environmentId === project.environmentId
              ? { revealThreadId: activeRef.threadId }
              : {}),
          },
        })
      : EMPTY_NAVIGATION,
  );
  const result = cursor ? pageResult : aggregateResult;
  const data = Option.getOrNull(AsyncResult.value(result));
  const connected = useConnectedEnvironmentIds().includes(project.environmentId);
  const [preferences] = useProjectNavigationPreferences();
  const aggregate = Option.getOrNull(AsyncResult.value(aggregateResult));
  const [pageRevision, setPageRevision] = useState(aggregate?.revision);
  if (pageRevision !== aggregate?.revision) {
    setPageRevision(aggregate?.revision);
    if (cursor) {
      setCursor(undefined);
      setPrevious([]);
    }
  }
  const main = aggregate?.worktrees.find((row) => row.isMain);
  const rows = [...(main ? [main] : []), ...(data?.worktrees ?? []).filter((row) => !row.isMain)];
  const pinnedKey = (row: NavigationWorktree) =>
    `${scopedProjectKey({ environmentId: project.environmentId, projectId: project.id })}:${row.key}`;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4" aria-label="Project worktrees">
      {!connected ? (
        <p role="status" className="p-2 text-xs text-muted-foreground">
          Offline. Showing available work; reconnect to make changes.
        </p>
      ) : null}
      {AsyncResult.isFailure(result) ? (
        <p role="alert" className="p-2 text-xs text-muted-foreground">
          Worktree details are unavailable. This server may need an update. Your threads remain
          available in All threads.
          {cursor ? (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                setCursor(undefined);
                setPrevious([]);
              }}
            >
              Reload list
            </Button>
          ) : null}
        </p>
      ) : null}
      {!data && !AsyncResult.isFailure(result) ? (
        <p role="status" className="p-2 text-sm text-muted-foreground">
          Loading worktrees…
        </p>
      ) : null}
      {data && !data.complete ? (
        <p role="status" className="p-2 text-xs text-muted-foreground">
          Some work details are unavailable. Counts may be incomplete.
        </p>
      ) : null}
      {[
        ...rows.filter((row) => row.isMain).map((row) => ({ kind: "row" as const, row })),
        ...WORKTREE_SECTIONS.flatMap(([stage, label]) => {
          const section = rows.filter(
            (row) =>
              !row.isMain &&
              (stage === "pinned"
                ? preferences.pinned[pinnedKey(row)]
                : !preferences.pinned[pinnedKey(row)] && row.stage === stage),
          );
          return section.length
            ? [
                { kind: "heading" as const, stage, label },
                ...section.map((row) => ({ kind: "row" as const, row })),
              ]
            : [];
        }),
      ].map((entry) =>
        entry.kind === "heading" ? (
          <h3
            key={`section:${entry.stage}`}
            className="mt-4 px-2 pb-1 text-3xs font-semibold uppercase tracking-widest text-muted-foreground"
          >
            {entry.label}
          </h3>
        ) : (
          <WorktreeRow
            key={`worktree:${entry.row.key}`}
            project={project}
            row={entry.row}
            revision={data?.revision ?? ""}
            routeReveal={routeReveal}
          />
        ),
      )}
      {data && rows.length === 0 ? (
        <p className="p-2 text-sm text-muted-foreground">No worktrees on this page.</p>
      ) : null}
      {data ? (
        <div className="mt-3 flex gap-2">
          {previous.length > 0 ? (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                setCursor(previous.at(-1));
                setPrevious(previous.slice(0, -1));
              }}
            >
              Previous
            </Button>
          ) : null}
          {data.nextCursor ? (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                setPrevious([...previous, cursor]);
                setCursor(data.nextCursor ?? undefined);
              }}
            >
              More worktrees
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function WorktreeRow({
  project,
  row,
  revision,
  routeReveal,
}: {
  project: EnvironmentProject;
  row: NavigationWorktree;
  revision: string;
  routeReveal: SidebarRouteReveal;
}) {
  const [preferences, setPreferences] = useProjectNavigationPreferences();
  const activeRef = useThreadRouteRef();
  const active = row.threads.some(
    (thread) =>
      thread.id === activeRef?.threadId && project.environmentId === activeRef.environmentId,
  );
  const preferenceKey = `${scopedProjectKey({ environmentId: project.environmentId, projectId: project.id })}:${row.key}`;
  const expanded = active || (preferences.expanded[preferenceKey] ?? row.isMain);
  const pinned = preferences.pinned[preferenceKey] ?? false;
  const navigate = useNavigate();
  const newThread = useNewThreadHandler();
  const canOperate = useEnvironmentScope(project.environmentId, AuthOrchestrationOperateScope);
  const connected = useConnectedEnvironmentIds().includes(project.environmentId);
  const [threadOffset, setThreadOffset] = useState(0);
  const [pageRoute, setPageRoute] = useState(activeRef?.threadId ?? null);
  if (pageRoute !== (activeRef?.threadId ?? null)) {
    setPageRoute(activeRef?.threadId ?? null);
    if (threadOffset !== 0) setThreadOffset(0);
  }
  const title = row.cards.length === 1 ? row.cards[0]!.title : row.label;
  const status =
    row.completion === "merged"
      ? "Merged"
      : row.completion === "completed"
        ? "Completed"
        : WORKTREE_STAGE_LABELS[row.stage];
  return (
    <div className={cn("rounded-lg bg-accent/35", active && "bg-accent/70")}>
      <div className="flex items-center gap-1 px-1 py-1">
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={`${row.isMain ? "Main checkout" : title}, ${status}${row.attentionCount ? `, ${row.attentionCount} need you` : ""}`}
          onClick={() =>
            setPreferences({
              ...preferences,
              expanded: { ...preferences.expanded, [preferenceKey]: !expanded },
            })
          }
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          {expanded ? (
            <ChevronDownIcon className="size-3 shrink-0" />
          ) : (
            <ChevronRightIcon className="size-3 shrink-0" />
          )}
          {row.isMain ? (
            <HouseIcon className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <GitBranchIcon className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">
              {row.isMain ? "Main checkout" : title}
            </span>
            <span className="block truncate text-3xs text-muted-foreground">
              {row.availability === "missing"
                ? "Worktree missing"
                : row.availability === "preparing"
                  ? "Preparing worktree"
                  : `${row.branch ?? row.label}${row.isMain ? "" : ` · ${status}`}${row.cards.length > 1 ? ` · ${row.cards.length} cards` : ""}`}
            </span>
          </span>
          {row.attentionCount ? (
            <span className="rounded-full bg-primary px-1.5 text-3xs text-primary-foreground">
              {row.attentionCount}
            </span>
          ) : null}
        </button>
        {!row.isMain ? (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={pinned ? "Unpin worktree" : "Pin worktree"}
            onClick={() =>
              setPreferences({
                ...preferences,
                pinned: { ...preferences.pinned, [preferenceKey]: !pinned },
              })
            }
          >
            <PinIcon className={pinned ? "fill-current" : undefined} />
          </Button>
        ) : null}
      </div>
      {expanded ? (
        <div className="space-y-1 px-2 pb-2">
          {row.cards.map((card) => (
            <button
              key={card.id}
              type="button"
              onClick={() =>
                void navigate(roadmapDestination(project.environmentId, project.id, card.id))
              }
              className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <KanbanIcon className="size-3 shrink-0" />
              <span className="truncate">{card.title}</span>
              <span className="ml-auto shrink-0 text-3xs">
                {card.stage === "ready"
                  ? "Your review"
                  : card.stage === "reviewing"
                    ? "Agent review"
                    : card.stage}
              </span>
            </button>
          ))}
          {row.workflows.map((workflow) => (
            <button
              key={workflow.id}
              type="button"
              onClick={() =>
                void navigate(workflowDestination(project.environmentId, project.id, workflow.id))
              }
              className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <UsersIcon className="size-3 shrink-0" />
              <span className="truncate">{workflow.title}</span>
              <span className="ml-auto shrink-0 text-3xs">
                {workflow.currentStage ?? workflow.status}
              </span>
            </button>
          ))}
          {threadOffset ? (
            <ThreadPage
              key={revision}
              project={project}
              worktreeKey={row.key}
              offset={threadOffset}
              routeReveal={routeReveal}
              onOffsetChange={setThreadOffset}
            />
          ) : (
            <>
              {row.threads.map((thread) => (
                <ThreadRow
                  key={thread.id}
                  project={project}
                  thread={thread}
                  routeReveal={routeReveal}
                />
              ))}
              {row.threadNextOffset !== null ? (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => setThreadOffset(row.threadNextOffset!)}
                >
                  More threads ({row.threadCount})
                </Button>
              ) : null}
            </>
          )}
          {(row.cardNextOffset !== undefined && row.cardNextOffset !== null) ||
          (row.workflowNextOffset !== undefined && row.workflowNextOffset !== null) ? (
            <p className="px-2 text-xs text-muted-foreground">
              More linked work is available in Roadmap and Agent workflows.
            </p>
          ) : null}
          {row.threads.length === 0 ? (
            <p className="px-2 py-1 text-xs text-muted-foreground">Idle · No threads</p>
          ) : null}
          {row.availability === "missing" ? (
            <p className="px-2 py-1 text-xs text-muted-foreground">
              The checkout is missing. Open a thread to inspect or recover it.
            </p>
          ) : null}
          <Button
            variant="ghost"
            size="xs"
            disabled={
              !canOperate ||
              !connected ||
              row.availability === "missing" ||
              row.availability === "preparing"
            }
            onClick={() =>
              void newThread(scopeProjectRef(project.environmentId, project.id), {
                worktreePath: row.isMain ? null : row.path,
                branch: row.branch,
                envMode: "local",
              })
            }
          >
            <PlusIcon />
            New thread here
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ThreadPage({
  project,
  worktreeKey,
  offset,
  routeReveal,
  onOffsetChange,
}: {
  project: EnvironmentProject;
  worktreeKey: string;
  offset: number;
  routeReveal: SidebarRouteReveal;
  onOffsetChange: (offset: number) => void;
}) {
  const result = useAtomValue(
    navigation.page({
      environmentId: project.environmentId,
      input: { projectId: project.id, worktreeKey, threadOffset: offset },
    }),
  );
  const row = Option.getOrNull(AsyncResult.value(result))?.worktrees[0];
  return (
    <>
      <Button variant="ghost" size="xs" onClick={() => onOffsetChange(Math.max(0, offset - 50))}>
        Previous threads
      </Button>
      {row?.threads.map((thread) => (
        <ThreadRow key={thread.id} project={project} thread={thread} routeReveal={routeReveal} />
      ))}
      {row?.threadNextOffset !== null && row?.threadNextOffset !== undefined ? (
        <Button variant="ghost" size="xs" onClick={() => onOffsetChange(row.threadNextOffset!)}>
          More threads
        </Button>
      ) : null}
      {AsyncResult.isFailure(result) ? (
        <p role="alert" className="text-xs text-muted-foreground">
          Couldn't load more threads.
        </p>
      ) : null}
    </>
  );
}

function ThreadRow({
  project,
  thread,
  routeReveal,
}: {
  project: EnvironmentProject;
  thread: NavigationThread;
  routeReveal: SidebarRouteReveal;
}) {
  const ref = scopeThreadRef(project.environmentId, thread.id);
  const native = useQuietThreadShell(ref);
  const provider = useSidebarProviderEntries()
    .get(project.environmentId)
    ?.get(thread.providerInstanceId);
  const activeRef = useThreadRouteRef();
  const active =
    activeRef?.threadId === thread.id && activeRef.environmentId === project.environmentId;
  const nativeStatus = native ? resolveSidebarThreadStatus(native) : null;
  const status =
    nativeStatus === "approval" || nativeStatus === "input" || nativeStatus === "request"
      ? "Needs you"
      : thread.hasPendingApprovals || thread.hasPendingUserInput
        ? "Needs you"
        : nativeStatus === "failed"
          ? "Failed"
          : nativeStatus === "working"
            ? "Working"
            : nativeStatus === "waiting"
              ? "Waiting"
              : (thread.status ?? "Idle");
  const rowClock = useSnoozeWakeClock([thread]);
  const snoozed = effectiveSnoozed(native ?? thread, { now: new Date(rowClock).toISOString() });
  const unseen = hasUnseenCompletion(
    native ?? {
      latestRun: { completedAt: thread.latestRunCompletedAt },
      lastVisitedAt: thread.lastVisitedAt,
    },
  );
  const actions = useThreadActions();
  const canOperate = useEnvironmentScope(project.environmentId, AuthOrchestrationOperateScope);
  const connected = useConnectedEnvironmentIds().includes(project.environmentId);
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const [dragActive, setDragActive] = useState(false);
  const reveal = useActiveRowReveal(routeReveal, activeRef ? scopedThreadKey(activeRef) : null);
  const [preferences, setPreferences] = useProjectNavigationPreferences();
  const [error, setError] = useState<string | null>(null);
  const openThread = () => {
    const projectKey = scopedProjectKey({
      environmentId: project.environmentId,
      projectId: project.id,
    });
    setPreferences({
      ...preferences,
      selectedProject: projectKey,
      lastThreads: { ...preferences.lastThreads, [projectKey]: thread.id },
    });
    if (isMobile) setOpenMobile(false);
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId: project.environmentId, threadId: thread.id },
    });
  };
  const drop = makeWorkspaceFileDropHandlers({
    setDragActive,
    addFiles: (files) => {
      useSidebarPendingFileDropStore.getState().queuePendingFileDrop({ threadRef: ref, files });
      openThread();
    },
    addFolders: () => setError("Attach folders from the thread composer."),
  });
  const run = async (operation: (ref: ScopedThreadRef) => Promise<unknown>) => {
    const result = await operation(ref);
    if (result && typeof result === "object" && "_tag" in result && result._tag === "Failure")
      setError("The thread action failed. Open the thread and try again.");
  };
  return (
    <div className={cn("rounded-md", dragActive && "ring-2 ring-ring")} {...drop}>
      <div className="flex min-w-0 items-center">
        <button
          type="button"
          ref={
            active
              ? (node) => {
                  if (node) reveal(node, scopedThreadKey(ref));
                }
              : undefined
          }
          onClick={openThread}
          aria-current={active ? "page" : undefined}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            active && "bg-accent text-accent-foreground",
          )}
        >
          <MessageSquareIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block truncate">{thread.title}</span>
            <span
              className={cn(
                "block truncate text-3xs text-muted-foreground",
                status === "Needs you" && "text-primary",
              )}
            >
              {thread.archivedAt
                ? "Archived"
                : snoozed
                  ? "Snoozed"
                  : thread.settledAt
                    ? "Settled"
                    : status}
              {provider ? ` · ${provider.displayName ?? provider.driverKind}` : ""}
            </span>
          </span>
          {unseen ? (
            <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-label="Unread" />
          ) : null}
        </button>
        <Menu>
          <MenuTrigger
            render={
              <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${thread.title}`} />
            }
          >
            <MoreHorizontalIcon />
          </MenuTrigger>
          <MenuPopup>
            <MenuItem
              disabled={!native || !canOperate || !connected}
              onClick={() => void run(thread.pinnedAt ? actions.unpinThread : actions.pinThread)}
            >
              {thread.pinnedAt ? "Unpin thread" : "Pin thread"}
            </MenuItem>
            <MenuItem
              disabled={!native || !canOperate || !connected}
              onClick={() =>
                void run(thread.settledAt ? actions.unsettleThread : actions.settleThread)
              }
            >
              {thread.settledAt ? "Un-settle thread" : "Settle thread"}
            </MenuItem>
            <MenuItem
              disabled={!native || !canOperate || !connected || status === "Needs you"}
              onClick={() => {
                if (snoozed) void run(actions.unsnoozeThread);
                else
                  void requestCustomSnooze().then((preset) => {
                    if (preset) void actions.snoozeThread(ref, preset.snoozedUntil);
                  });
              }}
            >
              {snoozed ? "Wake thread" : "Snooze thread"}
            </MenuItem>
            <MenuItem
              disabled={!native || !canOperate || !connected}
              onClick={() =>
                void run(thread.archivedAt ? actions.unarchiveThread : actions.archiveThread)
              }
            >
              {thread.archivedAt ? "Restore thread" : "Archive thread"}
            </MenuItem>
            <MenuItem disabled={!native} onClick={() => void actions.markThreadUnread(ref)}>
              Mark unread
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
      {error ? (
        <p role="alert" className="px-2 py-1 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
