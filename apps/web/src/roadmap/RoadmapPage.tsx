import { useAtomValue } from "@effect/atom-react";
import { scopedProjectKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { type RoadmapBoard, type RoadmapCard, type RoadmapLinkedThread } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { AsyncResult } from "effect/reactivity";
import * as Option from "effect/Option";
import { ArrowDownIcon, ArrowUpIcon, KanbanIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { SidebarInset, SidebarTrigger } from "../components/ui/sidebar";
import { WorkspacePageHeader } from "../components/WorkspacePageHeader";
import { isElectron } from "../env";
import { randomUUID } from "../lib/utils";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useProjects, useThreadShells } from "../state/entities";
import { useAtomCommand } from "../state/use-atom-command";
import { useAtomQueryRunner } from "../state/use-atom-query-runner";
import {
  mergeRoadmapEdit,
  moveRoadmapCard,
  roadmapColumn,
  roadmapDropAction,
  ROADMAP_COLUMNS,
  type RoadmapColumn,
} from "./roadmap.logic";
import { threadEnvironment } from "../state/threads";
import { CardDrawer } from "./CardDrawer";
import { RoadmapDrag, RoadmapDragCard, RoadmapDropZone } from "./RoadmapDrag";
import { useRoadmapWork } from "./useRoadmapWork";
import { roadmapRead, roadmapSave } from "./roadmapState";

const SELECT = "rounded-md border border-input bg-background px-2 py-1.5 text-sm";

export function RoadmapPage() {
  const projects = useProjects().filter((p) => !p.archivedAt);
  const [selected, setSelected] = useState("");
  const project =
    projects.find(
      (p) => scopedProjectKey({ environmentId: p.environmentId, projectId: p.id }) === selected,
    ) ?? projects[0];
  return (
    <SidebarInset role="main" className="h-dvh min-h-0 overflow-hidden">
      <WorkspacePageHeader electron={isElectron}>
        <SidebarTrigger />
        <KanbanIcon className="size-4 text-muted-foreground" />
        <h1 className="text-sm font-medium">Roadmap</h1>
      </WorkspacePageHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-5 p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">From idea to shipped</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Plan the next change. Follow the work as it happens.
            </p>
          </div>
          <select
            aria-label="Roadmap project"
            className={SELECT}
            value={
              project
                ? scopedProjectKey({ environmentId: project.environmentId, projectId: project.id })
                : ""
            }
            onChange={(e) => setSelected(e.target.value)}
          >
            {projects.map((p) => {
              const key = scopedProjectKey({ environmentId: p.environmentId, projectId: p.id });
              return (
                <option key={key} value={key}>
                  {p.title} · {p.workspaceRoot}
                </option>
              );
            })}
          </select>
        </div>
        {project ? (
          <ProjectBoard key={`${project.environmentId}:${project.id}`} project={project} />
        ) : (
          <p className="text-muted-foreground">
            Add a project to start its roadmap. A GitHub repository is optional.
          </p>
        )}
      </div>
    </SidebarInset>
  );
}

function ProjectBoard({ project }: { project: EnvironmentProject }) {
  const target = { environmentId: project.environmentId, input: { projectId: project.id } };
  const result = useAtomValue(roadmapRead(target));
  const canSave = useAtomValue(roadmapSave.permissionAtom(project.environmentId));
  const saveCommand = useAtomCommand(roadmapSave, { reportFailure: false });
  const archiveThread = useAtomCommand(threadEnvironment.archive, { reportFailure: false });
  const reload = useAtomQueryRunner(roadmapRead, { refresh: true });
  const threads = useThreadShells().filter(
    (t) => t.environmentId === project.environmentId && t.projectId === project.id,
  );
  const [saved, setSaved] = useState<RoadmapBoard | null>(null);
  const [saving, setSaving] = useState(false);
  const savePending = useRef(false);
  const transitionPending = useRef(false);
  const [transitioning, setTransitioning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<{ card: RoadmapCard; board: RoadmapBoard } | null>(null);
  const view = Option.getOrNull(AsyncResult.value(result));
  const fetched = view?.board ?? null;
  const board = saved && (!fetched || saved.revision > fetched.revision) ? saved : fetched;
  const work = useRoadmapWork(project, save);
  const busy = saving || work.working || transitioning;
  const threadsById = new Map(
    [...threads, ...(view?.linkedThreads ?? [])].map((thread) => [thread.id, thread]),
  );
  const threadFor = (card: RoadmapCard) =>
    card.threadId ? threadsById.get(card.threadId) : undefined;

  async function save(cards: ReadonlyArray<RoadmapCard>, revision?: number) {
    const expectedRevision = revision ?? board?.revision;
    if (expectedRevision === undefined || savePending.current || !canSave) return null;
    savePending.current = true;
    setSaving(true);
    const outcome = await saveCommand({
      environmentId: project.environmentId,
      input: { projectId: project.id, expectedRevision, cards },
    });
    savePending.current = false;
    setSaving(false);
    if (outcome._tag === "Failure") {
      setError(commandError(outcome));
      return null;
    }
    setSaved(outcome.value);
    setError(null);
    return outcome.value;
  }

  async function drop(id: string, column: RoadmapColumn, beforeId?: string) {
    if (!board || busy || !canSave || showArchived || transitionPending.current) return;
    const card = board.cards.find((row) => row.id === id);
    if (!card || card.archived) return;
    const thread = threadFor(card);
    const current = roadmapColumn(card, thread);
    if (current === column) {
      await save(moveRoadmapCard(board.cards, id, card.lane, beforeId));
      return;
    }
    const action = roadmapDropAction(card, column, thread);
    if (action.type === "blocked") {
      setError(action.message);
      return;
    }
    transitionPending.current = true;
    setTransitioning(true);
    setError(null);
    setNotice(null);
    if (action.type === "work") {
      const next = card.completed
        ? await save(
            board.cards.map((row) => (row.id === id ? { ...row, completed: false } : row)),
            board.revision,
          )
        : board;
      if (next) {
        const failure = await work.run({ ...card, completed: false }, next, action.mode, thread);
        if (failure) setError(failure);
        else
          setNotice(
            action.mode === "review"
              ? "Agent review started. The card follows the pull request as the review progresses."
              : "Work started in the linked thread.",
          );
      }
    } else if (action.type === "park" || (action.type === "plan" && action.archiveThread)) {
      if (thread) {
        const archived = await archiveThread({
          environmentId: project.environmentId,
          input: { threadId: thread.id },
        });
        if (archived._tag === "Failure") setError(commandError(archived));
        else if (action.type === "plan")
          await save(
            moveRoadmapCard(
              board.cards.map((row) => (row.id === id ? { ...row, completed: false } : row)),
              id,
              action.lane,
              beforeId,
            ),
          );
        else if (card.completed)
          await save(
            board.cards.map((row) => (row.id === id ? { ...row, completed: false } : row)),
          );
      }
    } else if (action.type === "plan") {
      await save(
        moveRoadmapCard(
          board.cards.map((row) => (row.id === id ? { ...row, completed: false } : row)),
          id,
          action.lane,
          beforeId,
        ),
      );
    } else if (action.type === "complete") {
      await save(board.cards.map((row) => (row.id === id ? { ...row, completed: true } : row)));
    }
    transitionPending.current = false;
    setTransitioning(false);
    void reload(target);
  }

  if (!board)
    return (
      <div role="status" className="text-sm text-muted-foreground">
        {AsyncResult.isFailure(result)
          ? "Could not load this roadmap. Check the connection and that this environment runs the roadmap fork."
          : "Loading roadmap…"}
        <div className="mt-3">
          <Button variant="outline" size="sm" onClick={() => void reload(target)}>
            Retry
          </Button>
        </div>
      </div>
    );
  const cards = board.cards.filter(
    (card) =>
      card.archived === showArchived &&
      `${card.title} ${card.summary}`.toLowerCase().includes(query.toLowerCase()),
  );
  const disabled = busy || !canSave || showArchived;
  const patch = (card: RoadmapCard) =>
    save(board.cards.map((row) => (row.id === card.id ? card : row)));

  function renderCards(column: RoadmapColumn, rows: ReadonlyArray<RoadmapCard>) {
    return rows.map((card, index) => (
      <RoadmapDragCard
        key={card.id}
        card={card}
        column={column}
        disabled={disabled}
        onOpen={() => {
          setError(null);
          setEditing({ card, board: board! });
        }}
      >
        <button
          className="w-full text-left text-sm font-medium leading-snug hover:underline"
          onClick={() => {
            setError(null);
            setEditing({ card, board: board! });
          }}
        >
          {card.title}
        </button>
        {card.summary ? (
          <p className="line-clamp-3 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
            {card.summary}
          </p>
        ) : null}
        {card.acceptanceCriteria?.length ? (
          <p className="text-xs text-muted-foreground">
            {card.acceptanceCriteria.filter((row) => row.checked).length}/
            {card.acceptanceCriteria.length} criteria complete
          </p>
        ) : null}
        <CardThread card={card} thread={threadFor(card)} project={project} />
        <div className="flex flex-wrap items-center gap-1">
          {(column === "backlog" || column === "upNext") && !showArchived ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => void drop(card.id, column === "backlog" ? "upNext" : "backlog")}
              >
                {column === "backlog" ? "Prioritize" : "Backlog"}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Move ${card.title} up`}
                disabled={disabled || index === 0}
                onClick={() => void drop(card.id, column, rows[index - 1]?.id)}
              >
                <ArrowUpIcon className="size-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Move ${card.title} down`}
                disabled={disabled || index === rows.length - 1}
                onClick={() =>
                  void save(moveRoadmapCard(board!.cards, card.id, card.lane, rows[index + 2]?.id))
                }
              >
                <ArrowDownIcon className="size-3" />
              </Button>
            </>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || !canSave}
            onClick={() => void patch({ ...card, archived: !card.archived })}
          >
            {card.archived ? "Restore" : "Archive"}
          </Button>
        </div>
      </RoadmapDragCard>
    ));
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-64">
          <Input
            type="search"
            aria-label="Search roadmap"
            placeholder="Search cards…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowArchived(!showArchived)}>
          {showArchived ? "Show board" : "Archived"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={async () => {
            const read = await reload(target);
            if (read._tag === "Success") {
              setSaved(null);
              setError(null);
            }
          }}
        >
          <RefreshCwIcon className="size-3.5" />
          Reload
        </Button>
        <div className="ml-auto">
          <Button
            size="sm"
            disabled={busy || !canSave}
            onClick={() => {
              setError(null);
              setEditing({
                board,
                card: {
                  id: randomUUID(),
                  title: "",
                  summary: "",
                  type: "feature",
                  effort: "M",
                  lane: "backlog",
                  threadId: null,
                  completed: false,
                  archived: false,
                },
              });
            }}
          >
            <PlusIcon className="size-4" />
            Add idea
          </Button>
        </div>
      </div>
      {!canSave ? (
        <p className="text-sm text-muted-foreground">
          Read only. Roadmap edits require permission to operate this environment.
        </p>
      ) : null}
      {error && !editing ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}
      <RoadmapDrag cards={cards} onMove={(id, column, before) => void drop(id, column, before)}>
        <div
          className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-3"
          aria-label={showArchived ? "Archived roadmap" : "Project roadmap"}
          aria-busy={busy}
        >
          {ROADMAP_COLUMNS.map(([column, title, subtitle]) => {
            const rows = cards.filter((card) => {
              const state = roadmapColumn(card, threadFor(card));
              return column === "inReview"
                ? state === "ready" || state === "reviewing"
                : state === column;
            });
            return (
              <RoadmapDropZone
                key={column}
                id={`lane:${column}`}
                column={column === "inReview" ? "reviewing" : column}
                label={title}
                disabled={disabled}
              >
                <div className="border-b border-border/50 p-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium">{title}</h3>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {rows.length}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
                </div>
                <div className="min-h-32 flex-1 space-y-3 overflow-y-auto p-2">
                  {rows.length === 0 ? (
                    <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                      {column === "building"
                        ? "Drop a card to start building"
                        : column === "inReview"
                          ? "Drop built work to start an agent review"
                          : "Drop a card here"}
                    </p>
                  ) : null}
                  {column === "inReview"
                    ? (["ready", "reviewing"] as const).map((state) => {
                        const group = rows.filter(
                          (card) => roadmapColumn(card, threadFor(card)) === state,
                        );
                        if (!group.length) return null;
                        const label = state === "ready" ? "Your review" : "Agent review";
                        return (
                          <RoadmapDropZone
                            key={state}
                            id={`group:${state}`}
                            column={state}
                            label={label}
                            disabled={disabled}
                            group
                          >
                            <h4 className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              {label} · {group.length}
                            </h4>
                            {renderCards(state, group)}
                          </RoadmapDropZone>
                        );
                      })
                    : renderCards(column, rows)}
                </div>
              </RoadmapDropZone>
            );
          })}
        </div>
      </RoadmapDrag>
      {editing ? (
        <CardDrawer
          key={editing.card.id}
          project={project}
          card={editing.card}
          latest={editing.board.cards.find((row) => row.id === editing.card.id)}
          error={error}
          threads={[...threadsById.values()]}
          disabled={busy || !canSave}
          busy={busy}
          onClose={() => setEditing(null)}
          onReload={async () => {
            const read = await reload(target);
            if (read._tag === "Success") {
              setSaved(read.value.board);
              setEditing((current) => (current ? { ...current, board: read.value.board } : null));
              setError(null);
            }
          }}
          onSave={async (draft, mode) => {
            if (mode) {
              const action = roadmapDropAction(
                draft,
                mode === "build" ? "building" : "reviewing",
                threadFor(draft),
              );
              if (action.type === "blocked") {
                setError(action.message);
                return;
              }
            }
            const update = mode ? { ...draft, completed: false } : draft;
            const exists = editing.board.cards.some((row) => row.id === draft.id);
            const next = await save(
              exists
                ? editing.board.cards.map((row) =>
                    row.id === draft.id ? mergeRoadmapEdit(editing.card, update, row) : row,
                  )
                : [...editing.board.cards, update],
              editing.board.revision,
            );
            if (!next) return;
            if (mode) {
              const card = next.cards.find((row) => row.id === draft.id)!;
              const failure = await work.run(card, next, mode, threadFor(card));
              if (failure) {
                setError(failure);
                setEditing({ card, board: next });
                return;
              }
            }
            setEditing(null);
          }}
        />
      ) : null}
    </>
  );
}

function commandError(result: Parameters<typeof squashAtomCommandFailure>[0]) {
  const cause = squashAtomCommandFailure(result);
  return cause instanceof Error
    ? cause.message
    : "The roadmap action failed. Reload and try again.";
}

function CardThread({
  card,
  thread,
  project,
}: {
  card: RoadmapCard;
  thread: RoadmapLinkedThread | undefined;
  project: EnvironmentProject;
}) {
  const navigate = useNavigate();
  const newThread = useNewThreadHandler();
  if (thread)
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          void navigate({
            to: "/$environmentId/$threadId",
            params: { environmentId: project.environmentId, threadId: thread.id },
          })
        }
      >
        Open thread
      </Button>
    );
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() =>
        void newThread(
          { environmentId: project.environmentId, projectId: project.id },
          {
            prompt: `Work on this roadmap item: ${card.title}\n\n${card.summary}\n\nRoadmap card: ${card.id}. Plan or implement this change in the current project.`,
          },
        )
      }
    >
      Plan in thread
    </Button>
  );
}
