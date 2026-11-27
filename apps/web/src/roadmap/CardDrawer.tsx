import { T, Var, useGT } from "gt-react";
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
  readOnlyReason,
  syncMetadata,
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
  readOnlyReason: string | null;
  syncMetadata: RoadmapCard["sync"];
  onReload: () => Promise<void>;
  threads: ReadonlyArray<RoadmapLinkedThread>;
  disabled: boolean;
  busy: boolean;
  onClose: () => void;
  onSave: (card: RoadmapCard, mode?: "build" | "review") => Promise<void>;
}) {
  const gt = useGT();
  const [draft, setDraft] = useState(card);
  const navigate = useNavigate();
  const [specOpen, setSpecOpen] = useState(false);
  const locked = disabled || Boolean(readOnlyReason);
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
          <SheetTitle>{draft.title || gt("Capture an idea")}</SheetTitle>
          <SheetDescription>
            <T>Acceptance criteria, full spec, and work details.</T>
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-6">
          {syncMetadata ? (
            <p className="text-sm text-muted-foreground">
              <T>
                Hypercoder · <Var>{syncMetadata.status}</Var>
              </T>
              {syncMetadata.remoteColumn
                ? gt(" · source: {remoteColumn}", { remoteColumn: syncMetadata.remoteColumn })
                : ""}
            </p>
          ) : null}
          {readOnlyReason ? (
            <p role="status" className="text-sm text-muted-foreground">
              <T>
                Read only: <Var>{readOnlyReason}</Var> Your unsaved draft is kept.
              </T>
            </p>
          ) : null}
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
                <T>Reload board and keep my draft</T>
              </Button>
            </div>
          ) : null}
          {latest && latest !== card ? (
            <details className="text-sm text-muted-foreground">
              <summary>
                <T>Latest saved card (review before replacing it)</T>
              </summary>
              <p className="mt-2 font-medium">{latest.title}</p>
              <p className="whitespace-pre-wrap">{latest.summary}</p>
              <p>
                {latest.type} · {latest.effort} ·{" "}
                {latest.lane === "upNext" ? gt("Up Next") : gt("Backlog")}
              </p>
              <p>
                {latest.completed ? gt("Completed") : gt("Incomplete")} ·{" "}
                {latest.archived ? gt("Archived") : gt("On board")}
              </p>
              <p>
                <T>Thread: </T>
                {threads.find((thread) => thread.id === latest.threadId)?.title ??
                  gt("No available linked thread")}
              </p>
              {latest.specPath ? (
                <p>
                  <T>
                    Full spec: <Var>{latest.specPath}</Var>
                  </T>
                </p>
              ) : null}
              {latest.acceptanceCriteria?.map((row) => (
                <p key={row.id}>
                  {row.checked ? gt("Complete") : gt("Incomplete")}: {row.text}
                </p>
              ))}
            </details>
          ) : null}
          {specOpen && spec.kind === "file" ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => setSpecOpen(false)}>
                <T>Back to card</T>
              </Button>
              <Suspense
                fallback={
                  <p>
                    <T>Loading spec…</T>
                  </p>
                }
              >
                <RoadmapSpec project={project} path={spec.path} />
              </Suspense>
            </>
          ) : (
            <>
              {spec.kind !== "invalid" ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      <T>Full spec</T>
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{draft.specPath}</p>
                  </div>
                  {spec.kind === "url" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      render={<a href={spec.url} target="_blank" rel="noreferrer" />}
                    >
                      <T>Open full spec</T>
                      <ExternalLinkIcon className="size-3.5" />
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => setSpecOpen(true)}>
                      <T>Open full spec</T>
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
                  if (locked) return;
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
                <fieldset disabled={locked} className="space-y-4">
                  <label className="block space-y-1 text-sm">
                    <span>
                      <T>Title</T>
                    </span>
                    <Input
                      autoFocus
                      required
                      maxLength={200}
                      value={draft.title}
                      onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                    />
                  </label>
                  <label className="block space-y-1 text-sm">
                    <span>
                      <T>Summary / brief</T>
                    </span>
                    <Textarea
                      maxLength={20_000}
                      value={draft.summary}
                      onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
                    />
                  </label>
                  <label className="block space-y-1 text-sm">
                    <span>
                      <T>Full spec path or URL</T>
                    </span>
                    <Input
                      value={draft.specPath ?? ""}
                      maxLength={2000}
                      placeholder={gt("docs/roadmap/feature.md or https://…")}
                      aria-invalid={Boolean(draft.specPath) && spec.kind === "invalid"}
                      onChange={(e) => setDraft({ ...draft, specPath: e.target.value })}
                    />
                  </label>
                  {draft.specPath && spec.kind === "invalid" ? (
                    <p role="alert" className="text-xs text-destructive">
                      <T>Use a project-relative path or an HTTP/HTTPS link.</T>
                    </p>
                  ) : null}
                  <section aria-label={gt("Acceptance criteria")} className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        <T>Acceptance</T>
                      </h3>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {criteria.filter((row) => row.checked).length} of {criteria.length}
                      </span>
                    </div>
                    {criteria.map((row, index) => (
                      <div key={row.id} className="flex items-start gap-3">
                        <div className="pt-2">
                          <Checkbox
                            aria-label={gt("Complete criterion {value}", { value: index + 1 })}
                            disabled={locked}
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
                            aria-label={gt("Acceptance criterion {value}", { value: index + 1 })}
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
                          aria-label={gt("Remove criterion {value}", { value: index + 1 })}
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
                      <T>Add criterion</T>
                    </Button>
                  </section>
                  <div className="flex flex-wrap gap-3">
                    <label className="flex flex-col gap-1 text-sm">
                      <T>Type</T>
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
                      <T>Effort</T>
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
                      <T>Planning lane</T>
                      <select
                        className={SELECT}
                        value={draft.lane}
                        onChange={(e) =>
                          setDraft({ ...draft, lane: e.target.value as RoadmapCard["lane"] })
                        }
                      >
                        <option value="backlog">
                          <T>Backlog</T>
                        </option>
                        <option value="upNext">
                          <T>Up Next</T>
                        </option>
                      </select>
                    </label>
                  </div>
                  <label className="flex flex-col gap-1 text-sm">
                    <T>Linked thread</T>
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
                      <option value="">
                        <T>No thread linked</T>
                      </option>
                      {draft.threadId && !threads.some((t) => t.id === draft.threadId) ? (
                        <option value={draft.threadId}>
                          <T>Thread unavailable</T>
                        </option>
                      ) : null}
                      {threads.map((t) => (
                        <option value={t.id} key={t.id}>
                          {t.title}
                          {t.archivedAt ? gt(" (archived)") : ""}
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
                    <T>Mark complete manually</T>
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
            disabled={locked || busy || draft !== card || Boolean(card.threadId)}
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
            <T>Start workflow</T>
          </Button>
          {card.threadId ? (
            <div className="w-full space-y-2 text-xs text-muted-foreground">
              <p>
                <T>
                  Open the stopped linked thread to start a workflow. The card keeps its existing
                  owner.
                </T>
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
                <T>Open linked thread</T>
              </Button>
            </div>
          ) : null}
          {draft !== card ? (
            <p className="w-full text-xs text-muted-foreground">
              <T>Save card edits before starting a workflow.</T>
            </p>
          ) : null}
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            <T>Cancel</T>
          </Button>
          <Button
            type="submit"
            form="roadmap-card-editor"
            disabled={
              locked ||
              !draft.title.trim() ||
              specOpen ||
              (Boolean(draft.specPath) && spec.kind === "invalid")
            }
          >
            <T>Save card</T>
          </Button>
          <Button
            type="submit"
            form="roadmap-card-editor"
            data-work="build"
            disabled={
              locked ||
              !draft.title.trim() ||
              specOpen ||
              (Boolean(draft.specPath) && spec.kind === "invalid")
            }
          >
            <T>Start building</T>
          </Button>
          {draft.threadId ? (
            <Button
              type="submit"
              form="roadmap-card-editor"
              data-work="review"
              variant="outline"
              disabled={
                locked ||
                !draft.title.trim() ||
                specOpen ||
                (Boolean(draft.specPath) && spec.kind === "invalid")
              }
            >
              <T>Start agent review</T>
            </Button>
          ) : null}
        </div>
      </SheetPopup>
    </Sheet>
  );
}
