import { lazy, Suspense, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { ThreadId, type RoadmapCard, type RoadmapLinkedThread } from "@t3tools/contracts";
import { FileTextIcon, ExternalLinkIcon, PlusIcon, XIcon } from "lucide-react";
import {
  Sheet,
  SheetPopup,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "../components/ui/sheet";
import { Checkbox } from "../components/ui/checkbox";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { randomUUID } from "../lib/utils";
import { roadmapColumn, roadmapSpecTarget } from "./roadmap.logic";
const RoadmapSpec = lazy(() => import("./RoadmapSpec"));
const SELECT = "rounded-md border border-input bg-background px-2 py-1.5 text-sm";
const STAGE_LABELS = {
  backlog: "Backlog",
  upNext: "Up Next",
  building: "Building",
  ready: "In Review · Your review",
  reviewing: "In Review · Agent review",
  parked: "Parked",
  done: "Done",
};

export function CardDrawer({
  card,
  project,
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
  project: EnvironmentProject;
  latest: RoadmapCard | undefined;
  error: string | null;
  onReload: () => Promise<void>;
  threads: ReadonlyArray<RoadmapLinkedThread>;
  disabled: boolean;
  busy: boolean;
  onClose: () => void;
  onSave: (card: RoadmapCard, mode?: "build" | "review") => Promise<void>;
}) {
  const [draft, setDraft] = useState(card);
  const navigate = useNavigate();
  const [specOpen, setSpecOpen] = useState(false);
  const criteria = draft.acceptanceCriteria ?? [];
  const spec = roadmapSpecTarget(draft.specPath ?? "");
  const stage = roadmapColumn(
    draft,
    threads.find((thread) => thread.id === draft.threadId),
  );
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <SheetPopup side="right" className="w-full max-w-xl">
        <SheetHeader>
          <p className="text-xs font-medium uppercase tracking-wide text-primary">
            {STAGE_LABELS[stage]}
          </p>
          <SheetTitle>{draft.title || "Capture an idea"}</SheetTitle>
          <SheetDescription>Acceptance criteria, full spec, and work details.</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-6">
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
              {latest.specPath ? <p>Full spec: {latest.specPath}</p> : null}
              {latest.acceptanceCriteria?.map((row) => (
                <p key={row.id}>
                  {row.checked ? "Complete" : "Incomplete"}: {row.text}
                </p>
              ))}
            </details>
          ) : null}
          {specOpen && spec.kind === "file" ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => setSpecOpen(false)}>
                Back to card
              </Button>
              <Suspense fallback={<p>Loading spec…</p>}>
                <RoadmapSpec project={project} path={spec.path} />
              </Suspense>
            </>
          ) : (
            <>
              {spec.kind !== "invalid" ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Full spec</p>
                    <p className="truncate text-xs text-muted-foreground">{draft.specPath}</p>
                  </div>
                  {spec.kind === "url" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      render={<a href={spec.url} target="_blank" rel="noreferrer" />}
                    >
                      Open full spec
                      <ExternalLinkIcon className="size-3.5" />
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => setSpecOpen(true)}>
                      Open full spec
                      <FileTextIcon className="size-3.5" />
                    </Button>
                  )}
                </div>
              ) : null}
              <form
                id="roadmap-card-editor"
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  const mode = (event.nativeEvent as SubmitEvent).submitter?.getAttribute(
                    "data-work",
                  );
                  void onSave(
                    {
                      ...draft,
                      title: draft.title.trim(),
                      specPath: draft.specPath?.trim() || null,
                      acceptanceCriteria: criteria.map((row) => ({
                        ...row,
                        text: row.text.trim(),
                      })),
                    },
                    mode === "build" || mode === "review" ? mode : undefined,
                  );
                }}
              >
                <fieldset disabled={disabled} className="space-y-4">
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
                  <label className="block space-y-1 text-sm">
                    <span>Full spec path or URL</span>
                    <Input
                      value={draft.specPath ?? ""}
                      maxLength={2000}
                      placeholder="docs/roadmap/feature.md or https://…"
                      aria-invalid={Boolean(draft.specPath) && spec.kind === "invalid"}
                      onChange={(e) => setDraft({ ...draft, specPath: e.target.value })}
                    />
                  </label>
                  {draft.specPath && spec.kind === "invalid" ? (
                    <p role="alert" className="text-xs text-destructive">
                      Use a project-relative path or an HTTP/HTTPS link.
                    </p>
                  ) : null}
                  <section aria-label="Acceptance criteria" className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Acceptance
                      </h3>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {criteria.filter((row) => row.checked).length} of {criteria.length}
                      </span>
                    </div>
                    {criteria.map((row, index) => (
                      <div key={row.id} className="flex items-start gap-3">
                        <div className="pt-2">
                          <Checkbox
                            aria-label={`Complete criterion ${index + 1}`}
                            checked={row.checked}
                            onCheckedChange={(checked) =>
                              setDraft({
                                ...draft,
                                acceptanceCriteria: criteria.map((item) =>
                                  item.id === row.id ? { ...item, checked } : item,
                                ),
                              })
                            }
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <Textarea
                            size="sm"
                            required
                            maxLength={2000}
                            aria-label={`Acceptance criterion ${index + 1}`}
                            value={row.text}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                acceptanceCriteria: criteria.map((item) =>
                                  item.id === row.id ? { ...item, text: e.target.value } : item,
                                ),
                              })
                            }
                          />
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Remove criterion ${index + 1}`}
                          onClick={() =>
                            setDraft({
                              ...draft,
                              acceptanceCriteria: criteria.filter((item) => item.id !== row.id),
                            })
                          }
                        >
                          <XIcon className="size-3.5" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={criteria.length >= 200}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          acceptanceCriteria: [
                            ...criteria,
                            { id: randomUUID(), text: "", checked: false },
                          ],
                        })
                      }
                    >
                      <PlusIcon className="size-3.5" />
                      Add criterion
                    </Button>
                  </section>
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
                </fieldset>
              </form>
            </>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t px-6 py-4">
          <Button
            type="button"
            variant="outline"
            disabled={disabled || busy || draft !== card || Boolean(card.threadId)}
            onClick={() =>
              void navigate({
                to: "/agent-workflows",
                search: {
                  environmentId: project.environmentId,
                  projectId: project.id,
                  cardId: card.id,
                  ...(card.threadId ? { sourceThreadId: card.threadId } : {}),
                },
              })
            }
          >
            Start workflow
          </Button>
          {card.threadId ? (
            <div className="w-full space-y-2 text-xs text-muted-foreground">
              <p>
                Open the stopped linked thread to start a workflow. The card keeps its existing
                owner.
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  void navigate({
                    to: "/$environmentId/$threadId",
                    params: { environmentId: project.environmentId, threadId: card.threadId! },
                  })
                }
              >
                Open linked thread
              </Button>
            </div>
          ) : null}
          {draft !== card ? (
            <p className="w-full text-xs text-muted-foreground">
              Save card edits before starting a workflow.
            </p>
          ) : null}
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="roadmap-card-editor"
            disabled={
              disabled ||
              !draft.title.trim() ||
              specOpen ||
              (Boolean(draft.specPath) && spec.kind === "invalid")
            }
          >
            Save card
          </Button>
          <Button
            type="submit"
            form="roadmap-card-editor"
            data-work="build"
            disabled={
              disabled ||
              !draft.title.trim() ||
              specOpen ||
              (Boolean(draft.specPath) && spec.kind === "invalid")
            }
          >
            Start building
          </Button>
          {draft.threadId ? (
            <Button
              type="submit"
              form="roadmap-card-editor"
              data-work="review"
              variant="outline"
              disabled={
                disabled ||
                !draft.title.trim() ||
                specOpen ||
                (Boolean(draft.specPath) && spec.kind === "invalid")
              }
            >
              Start agent review
            </Button>
          ) : null}
        </div>
      </SheetPopup>
    </Sheet>
  );
}
