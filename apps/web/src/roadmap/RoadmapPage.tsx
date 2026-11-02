import { useAtomValue } from "@effect/atom-react";
import { scopedProjectKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  type RoadmapBoard,
  type RoadmapCard,
  type RoadmapLinkedThread,
  ThreadId,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { AsyncResult } from "effect/reactivity";
import * as Option from "effect/Option";
import { ArrowDownIcon, ArrowUpIcon, KanbanIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogPopup,
  DialogTitle,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogFooter,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { SidebarInset, SidebarTrigger } from "../components/ui/sidebar";
import { Textarea } from "../components/ui/textarea";
import { WorkspacePageHeader } from "../components/WorkspacePageHeader";
import { isElectron } from "../env";
import { randomUUID } from "../lib/utils";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useProjects, useThreadShells } from "../state/entities";
import { useAtomCommand } from "../state/use-atom-command";
import { useAtomQueryRunner } from "../state/use-atom-query-runner";
import { mergeRoadmapEdit, moveRoadmapCard, roadmapColumn, ROADMAP_COLUMNS } from "./roadmap.logic";
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
  const reload = useAtomQueryRunner(roadmapRead, { refresh: true });
  const threads = useThreadShells().filter(
    (t) => t.environmentId === project.environmentId && t.projectId === project.id,
  );
  const [saved, setSaved] = useState<RoadmapBoard | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<{ card: RoadmapCard; board: RoadmapBoard } | null>(null);
  const view = Option.getOrNull(AsyncResult.value(result));
  const fetched = view?.board ?? null;
  const board = saved && (!fetched || saved.revision > fetched.revision) ? saved : fetched;
  const threadsById = new Map(
    [...threads, ...(view?.linkedThreads ?? [])].map((thread) => [thread.id, thread]),
  );
  const threadFor = (card: RoadmapCard) =>
    card.threadId ? threadsById.get(card.threadId) : undefined;

  async function save(cards: ReadonlyArray<RoadmapCard>, revision?: number) {
    const expectedRevision = revision ?? board?.revision;
    if (expectedRevision === undefined || busy || !canSave) return false;
    setBusy(true);
    const outcome = await saveCommand({
      environmentId: project.environmentId,
      input: { projectId: project.id, expectedRevision, cards },
    });
    setBusy(false);
    if (outcome._tag === "Failure") {
      const cause = squashAtomCommandFailure(outcome);
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save the roadmap. Reload and try again.",
      );
      return false;
    }
    setSaved(outcome.value);
    setError(null);
    return true;
  }

  function move(id: string, lane: RoadmapCard["lane"], beforeId?: string) {
    if (!board) return;
    const card = board.cards.find((c) => c.id === id);
    if (
      !card ||
      card.archived ||
      !["backlog", "upNext"].includes(roadmapColumn(card, threadFor(card)))
    )
      return;
    void save(moveRoadmapCard(board.cards, id, lane, beforeId));
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
  const patch = (card: RoadmapCard) => save(board.cards.map((c) => (c.id === card.id ? card : c)));

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-64">
          <Input
            type="search"
            aria-label="Search roadmap"
            placeholder="Search cards…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
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
            onClick={() =>
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
              })
            }
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
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div
        className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-3"
        aria-label={showArchived ? "Archived roadmap" : "Project roadmap"}
        aria-busy={busy}
      >
        {ROADMAP_COLUMNS.map(([column, title, subtitle]) => {
          const inColumn = cards.filter((card) => roadmapColumn(card, threadFor(card)) === column);
          const planning = column === "backlog" || column === "upNext";
          return (
            <section
              key={column}
              aria-label={title}
              className="flex w-72 shrink-0 flex-col rounded-xl border border-border/60 bg-muted/25"
              onDragOver={(event) => {
                if (planning && !showArchived && canSave) event.preventDefault();
              }}
              onDrop={(event) => {
                if (!planning || showArchived) return;
                event.preventDefault();
                move(event.dataTransfer.getData("text/t3-roadmap-card"), column);
              }}
            >
              <div className="border-b border-border/50 p-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium">{title}</h3>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {inColumn.length}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto p-2">
                {inColumn.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                    {planning ? "Space for your next idea" : "Linked work appears here"}
                  </p>
                ) : null}
                {inColumn.map((card, index) => (
                  <article
                    key={card.id}
                    className="space-y-3 rounded-lg border border-border bg-background p-3 shadow-sm"
                    draggable={planning && !showArchived && canSave && !busy}
                    onDragStart={(event) =>
                      event.dataTransfer.setData("text/t3-roadmap-card", card.id)
                    }
                    onDragOver={(event) => {
                      if (planning && !showArchived && canSave) {
                        event.preventDefault();
                        event.stopPropagation();
                      }
                    }}
                    onDrop={(event) => {
                      if (planning && !showArchived) {
                        event.preventDefault();
                        event.stopPropagation();
                        move(event.dataTransfer.getData("text/t3-roadmap-card"), column, card.id);
                      }
                    }}
                  >
                    <div className="flex items-center justify-between text-2xs text-muted-foreground">
                      <span className="uppercase tracking-wide">{card.type}</span>
                      <span>{card.effort}</span>
                    </div>
                    <button
                      className="w-full text-left text-sm font-medium leading-snug hover:underline"
                      onClick={() => setEditing({ card, board })}
                    >
                      {card.title}
                    </button>
                    {card.summary ? (
                      <p className="line-clamp-3 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                        {card.summary}
                      </p>
                    ) : null}
                    <CardThread card={card} thread={threadFor(card)} project={project} />
                    <div className="flex flex-wrap items-center gap-1">
                      {planning && !showArchived ? (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy || !canSave}
                            onClick={() =>
                              move(card.id, column === "backlog" ? "upNext" : "backlog")
                            }
                          >
                            {column === "backlog" ? "Prioritize" : "Backlog"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Move ${card.title} up`}
                            disabled={busy || !canSave || index === 0}
                            onClick={() => move(card.id, column, inColumn[index - 1]?.id)}
                          >
                            <ArrowUpIcon className="size-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Move ${card.title} down`}
                            disabled={busy || !canSave || index === inColumn.length - 1}
                            onClick={() => {
                              const after = inColumn[index + 2];
                              move(card.id, column, after?.id);
                            }}
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
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      {editing ? (
        <CardEditor
          key={editing.card.id}
          card={editing.card}
          latest={editing.board.cards.find((c) => c.id === editing.card.id)}
          error={error}
          onReload={async () => {
            const read = await reload(target);
            if (read._tag === "Success") {
              setSaved(read.value.board);
              setEditing((current) => (current ? { ...current, board: read.value.board } : null));
              setError(null);
            }
          }}
          threads={[...threadsById.values()]}
          disabled={busy || !canSave}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={async (card) => {
            const exists = editing.board.cards.some((c) => c.id === card.id);
            if (
              await save(
                exists
                  ? editing.board.cards.map((c) =>
                      c.id === card.id ? mergeRoadmapEdit(editing.card, card, c) : c,
                    )
                  : [...editing.board.cards, card],
                editing.board.revision,
              )
            )
              setEditing(null);
          }}
        />
      ) : null}
    </>
  );
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

function CardEditor({
  card,
  latest,
  error,
  onReload,
  threads,
  disabled,
  busy,
  onClose,
  onSave,
}: {
  card: RoadmapCard;
  latest: RoadmapCard | undefined;
  error: string | null;
  onReload: () => Promise<void>;
  threads: ReadonlyArray<RoadmapLinkedThread>;
  disabled: boolean;
  busy: boolean;
  onClose: () => void;
  onSave: (card: RoadmapCard) => Promise<void>;
}) {
  const [draft, setDraft] = useState(card);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{card.title || "Capture an idea"}</DialogTitle>
          <DialogDescription>Link a thread to follow its work and pull requests.</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {error ? (
            <div className="space-y-2">
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
              <Button
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => void onReload()}
              >
                Reload board and keep my draft
              </Button>
            </div>
          ) : null}
          {latest && latest !== card ? (
            <details className="text-sm text-muted-foreground">
              <summary>Latest saved card (review before replacing it)</summary>
              <p className="mt-2 font-medium">{latest.title}</p>
              <p className="whitespace-pre-wrap">{latest.summary}</p>
              <p>
                {latest.type} · {latest.effort} · {latest.lane === "upNext" ? "Up Next" : "Backlog"}
              </p>
              <p>
                {latest.completed ? "Completed" : "Incomplete"} ·{" "}
                {latest.archived ? "Archived" : "On board"}
              </p>
              <p>
                Thread:{" "}
                {threads.find((thread) => thread.id === latest.threadId)?.title ??
                  "No available linked thread"}
              </p>
            </details>
          ) : null}
          <form
            id="roadmap-card-editor"
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void onSave({ ...draft, title: draft.title.trim() });
            }}
          >
            <label className="block space-y-1 text-sm">
              <span>Title</span>
              <Input
                autoFocus
                required
                maxLength={200}
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </label>
            <label className="block space-y-1 text-sm">
              <span>Summary / brief</span>
              <Textarea
                maxLength={20_000}
                value={draft.summary}
                onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
              />
            </label>
            <div className="flex flex-wrap gap-3">
              <label className="flex flex-col gap-1 text-sm">
                Type
                <select
                  className={SELECT}
                  value={draft.type}
                  onChange={(e) =>
                    setDraft({ ...draft, type: e.target.value as RoadmapCard["type"] })
                  }
                >
                  {["feature", "bug", "chore", "spike"].map((type) => (
                    <option key={type}>{type}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Effort
                <select
                  className={SELECT}
                  value={draft.effort}
                  onChange={(e) =>
                    setDraft({ ...draft, effort: e.target.value as RoadmapCard["effort"] })
                  }
                >
                  {["XS", "S", "M", "L", "XL"].map((effort) => (
                    <option key={effort}>{effort}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Planning lane
                <select
                  className={SELECT}
                  value={draft.lane}
                  onChange={(e) =>
                    setDraft({ ...draft, lane: e.target.value as RoadmapCard["lane"] })
                  }
                >
                  <option value="backlog">Backlog</option>
                  <option value="upNext">Up Next</option>
                </select>
              </label>
            </div>
            <label className="flex flex-col gap-1 text-sm">
              Linked thread
              <select
                className={SELECT}
                value={draft.threadId ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    threadId: e.target.value ? ThreadId.make(e.target.value) : null,
                  })
                }
              >
                <option value="">No thread linked</option>
                {draft.threadId && !threads.some((t) => t.id === draft.threadId) ? (
                  <option value={draft.threadId}>Thread unavailable</option>
                ) : null}
                {threads.map((t) => (
                  <option value={t.id} key={t.id}>
                    {t.title}
                    {t.archivedAt ? " (archived)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.completed}
                onChange={(e) => setDraft({ ...draft, completed: e.target.checked })}
              />
              Mark complete manually
            </label>
          </form>
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="roadmap-card-editor"
            disabled={disabled || !draft.title.trim()}
          >
            Save card
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
