import { T, Var, msg, useGT, useMessages } from "gt-react";
import { m as resolveMessage, type MessageResolver } from "../i18n/messages";
import { useAtomValue } from "@effect/atom-react";
import {
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type {
  RoadmapSyncBinding,
  RoadmapSyncDetail,
  RoadmapSyncFields,
  RoadmapSyncRow,
  RoadmapSyncStatus,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { RefreshCwIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { useAtomCommand } from "../state/use-atom-command";
import { useAtomQueryRunner } from "../state/use-atom-query-runner";
import {
  roadmapSyncConnect,
  roadmapSyncDetail,
  roadmapSyncDisconnect,
  roadmapSyncRead,
  roadmapSyncResolve,
  roadmapSyncRun,
} from "./roadmapSyncState";
import { roadmapSyncDiagnostics } from "./roadmap.logic";

export function RoadmapSyncControl({
  project,
  disabled,
  onBusyChange,
}: {
  project: EnvironmentProject;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const gt = useGT();
  const messages = useMessages();
  const target = { environmentId: project.environmentId, input: { projectId: project.id } };
  const result = useAtomValue(roadmapSyncRead(target));
  const status = Option.getOrNull(AsyncResult.value(result));
  const refresh = useAtomQueryRunner(roadmapSyncRead, { refresh: true, reportFailure: false });
  const [opened, setOpened] = useState<RoadmapSyncStatus | null>(null);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || !status}
        onClick={() => setOpened(status)}
      >
        <T>Sync with Hypercoder</T>
      </Button>
      <span className="text-xs text-muted-foreground" role="status">
        {status
          ? syncSummary(status, messages)
          : AsyncResult.isFailure(result)
            ? gt("Hypercoder sync status unavailable.")
            : gt("Loading sync status…")}
      </span>
      {AsyncResult.isFailure(result) ? (
        <Button variant="ghost" size="sm" disabled={disabled} onClick={() => void refresh(target)}>
          <T>Retry sync status</T>
        </Button>
      ) : null}
      {opened ? (
        <SyncDialog
          project={project}
          initialStatus={opened}
          disabled={disabled}
          onBusyChange={onBusyChange}
          onClose={() => setOpened(null)}
        />
      ) : null}
    </>
  );
}

function syncSummary(status: RoadmapSyncStatus, resolve: MessageResolver) {
  if (!status.binding) return resolve(msg("Not connected"));
  if (status.connection !== "ready")
    return (
      status.message ?? resolve(msg("Connection {connection}", { connection: status.connection }))
    );
  const mode = status.capabilities.conditionalWrites
    ? resolve(msg("Connected"))
    : resolve(msg("Read-only connection"));
  const issues = status.counts.conflicts + status.counts.unsupported + status.counts.failed;
  return issues > 0
    ? resolve(
        msg(
          "{mode} · {count, plural, one {{count} card needs attention} other {{count} cards need attention}}",
          { mode, count: issues },
        ),
      )
    : mode;
}

function syncError(result: Parameters<typeof squashAtomCommandFailure>[0]) {
  const error = squashAtomCommandFailure(result);
  return error instanceof Error
    ? error.message
    : resolveMessage(msg("The sync action failed. Refresh and try again."));
}

function SyncDialog({
  project,
  initialStatus,
  disabled,
  onBusyChange,
  onClose,
}: {
  project: EnvironmentProject;
  initialStatus: RoadmapSyncStatus;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onClose: () => void;
}) {
  const gt = useGT();
  const messages = useMessages();
  const [status, setStatus] = useState(initialStatus);
  const [binding, setBinding] = useState<RoadmapSyncBinding>(
    initialStatus.binding ?? { contextPath: "", backend: "", projectId: "", instanceId: "" },
  );
  const [error, setError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState("");
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [detailCard, setDetailCard] = useState<string | null>(null);
  const [rowsOpen, setRowsOpen] = useState(false);
  const [rowLimit, setRowLimit] = useState(100);
  const canConnect = useAtomValue(roadmapSyncConnect.permissionAtom(project.environmentId));
  const canDisconnect = useAtomValue(roadmapSyncDisconnect.permissionAtom(project.environmentId));
  const canRun = useAtomValue(roadmapSyncRun.permissionAtom(project.environmentId));
  const canResolve = useAtomValue(roadmapSyncResolve.permissionAtom(project.environmentId));
  const connect = useAtomCommand(roadmapSyncConnect, { reportFailure: false });
  const run = useAtomCommand(roadmapSyncRun, { reportFailure: false });
  const resolve = useAtomCommand(roadmapSyncResolve, { reportFailure: false });
  const disconnect = useAtomCommand(roadmapSyncDisconnect, { reportFailure: false });
  const refresh = useAtomQueryRunner(roadmapSyncRead, { refresh: true, reportFailure: false });
  const target = { environmentId: project.environmentId, input: { projectId: project.id } };
  const input = { projectId: project.id, expectedRevision: status.revision };
  const unavailable = disabled || busy || needsRefresh;

  async function execute(action: () => Promise<AtomCommandResult<RoadmapSyncStatus, unknown>>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    onBusyChange(true);
    const outcome = await action();
    pending.current = false;
    setBusy(false);
    onBusyChange(false);
    if (outcome._tag === "Failure") {
      setError(syncError(outcome));
      setNeedsRefresh(true);
      return;
    }
    setStatus(outcome.value);
    setDetailCard(null);
    setNeedsRefresh(false);
    setError(null);
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogPopup showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>
            <T>Sync with Hypercoder</T>
          </DialogTitle>
          <DialogDescription>
            <T>
              Manually compare this project’s roadmap with a Hypercoder instance on its environment.
              Sync does not start agents or publish work.
            </T>
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <p className="text-sm font-medium" role="status">
            {syncSummary(status, messages)}
          </p>
          {status.message ? (
            <p className="text-sm text-muted-foreground">{status.message}</p>
          ) : null}
          {!status.capabilities.conditionalWrites ? (
            <p className="text-sm text-muted-foreground">
              <T>
                Sync can import changes when Hypercoder is available. Sending changes to Hypercoder
                is unavailable because safe conditional writes have not been verified. Outgoing
                changes remain read-only with a reason.
              </T>
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void execute(() => refresh(target))}
          >
            <RefreshCwIcon className="size-3.5" />
            <T>Refresh sync status and keep inputs</T>
          </Button>
          {!status.binding ? (
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (unavailable || !canConnect) return;
                void execute(() =>
                  connect({
                    environmentId: project.environmentId,
                    input: {
                      ...input,
                      binding: {
                        contextPath: binding.contextPath.trim(),
                        backend: binding.backend.trim(),
                        projectId: binding.projectId.trim(),
                        instanceId: binding.instanceId.trim(),
                      },
                    },
                  }),
                );
              }}
            >
              <p className="text-sm text-muted-foreground">
                <T>Run </T>
                <code>hc roadmap context</code>
                <T>
                  {" "}
                  in this project’s Hypercoder terminal on the machine hosting T3. Copy its context
                  diagnostics below. Keep Hypercoder running and signed in there. Both directories
                  must belong to the same Git repository.
                </T>
              </p>
              <fieldset disabled={unavailable || !canConnect} className="space-y-3">
                <label className="block space-y-1 text-sm">
                  <span>
                    <T>Context diagnostics JSON</T>
                  </span>
                  <Textarea
                    maxLength={20_000}
                    value={diagnostics}
                    placeholder={gt("Paste hc roadmap context output; diagnostics only")}
                    onChange={(event) => setDiagnostics(event.target.value)}
                  />
                </label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!diagnostics.trim()}
                  onClick={() => {
                    const parsed = roadmapSyncDiagnostics(diagnostics);
                    setDiagnostics("");
                    if (parsed.type === "valid") {
                      setBinding(parsed.binding);
                      setError(null);
                    } else
                      setError(
                        parsed.type === "credentials"
                          ? gt(
                              "Paste context diagnostics only. Credentials and tokens are not accepted.",
                            )
                          : gt(
                              "Include source, backend, projectId and instanceId from hc roadmap context.",
                            ),
                      );
                  }}
                >
                  <T>Use diagnostics</T>
                </Button>
                <details className="space-y-3">
                  <summary className="text-sm">
                    <T>Review or enter connection fields</T>
                  </summary>
                  {(
                    [
                      ["contextPath", "Context path", 2000],
                      ["backend", "Backend", 253],
                      ["projectId", "Hypercoder project ID", 2000],
                      ["instanceId", "Hypercoder instance ID", 2000],
                    ] as const
                  ).map(([key, label, maxLength]) => (
                    <label key={key} className="block space-y-1 text-sm">
                      <span>{label}</span>
                      <Input
                        required
                        maxLength={maxLength}
                        value={binding[key]}
                        onChange={(event) => setBinding({ ...binding, [key]: event.target.value })}
                      />
                    </label>
                  ))}
                </details>
                <Button
                  type="submit"
                  disabled={Object.values(binding).some((value) => !value.trim())}
                >
                  <T>Connect roadmap</T>
                </Button>
              </fieldset>
              {!canConnect ? (
                <p className="text-xs text-muted-foreground">
                  <T>Connecting requires permission to manage this environment’s access.</T>
                </p>
              ) : null}
            </form>
          ) : (
            <>
              <details className="text-sm text-muted-foreground">
                <summary>
                  <T>Connection diagnostics</T>
                </summary>
                <dl className="mt-2 space-y-1 break-all">
                  <dt>
                    <T>Context path</T>
                  </dt>
                  <dd>{status.binding.contextPath}</dd>
                  <dt>
                    <T>Backend</T>
                  </dt>
                  <dd>{status.binding.backend}</dd>
                  <dt>
                    <T>Hypercoder project</T>
                  </dt>
                  <dd>{status.binding.projectId}</dd>
                  <dt>
                    <T>Hypercoder instance</T>
                  </dt>
                  <dd>{status.binding.instanceId}</dd>
                </dl>
              </details>
              <Button
                disabled={unavailable || !canRun}
                onClick={() =>
                  void execute(() => run({ environmentId: project.environmentId, input }))
                }
              >
                {busy ? gt("Working…") : gt("Sync now")}
              </Button>
              {!canRun ? (
                <p className="text-xs text-muted-foreground">
                  <T>Sync requires permission to operate this environment.</T>
                </p>
              ) : null}
              <p className="text-sm text-muted-foreground">
                <T>
                  <Var>{status.counts.pulled}</Var> imported · <Var>{status.counts.pushed}</Var>{" "}
                  sent · <Var>{status.counts.unchanged}</Var> unchanged ·{" "}
                  <Var>{status.counts.conflicts}</Var> conflicts ·{" "}
                  <Var>{status.counts.unsupported}</Var> unsupported ·{" "}
                  <Var>{status.counts.failed}</Var> failed
                </T>
              </p>
              {status.lastSyncedAt ? (
                <p className="text-xs text-muted-foreground">
                  <T>
                    Last sync: <Var>{status.lastSyncedAt}</Var>
                  </T>
                </p>
              ) : null}
              {status.rows.length ? (
                <details
                  className="space-y-3 text-sm"
                  onToggle={(event) => setRowsOpen(event.currentTarget.open)}
                >
                  <summary>
                    <T>
                      Card results (<Var>{status.rows.length}</Var>)
                    </T>
                  </summary>
                  {rowsOpen ? (
                    <>
                      <ul className="space-y-3">
                        {status.rows.slice(0, rowLimit).map((row) => (
                          <li
                            key={row.cardId}
                            className="min-w-0 space-y-2 border-t border-border pt-3"
                          >
                            <p className="break-words font-medium">
                              {row.title}{" "}
                              <span className="font-normal text-muted-foreground">
                                · {row.status}
                              </span>
                            </p>
                            {row.reason ? (
                              <p className="text-xs text-muted-foreground">{row.reason}</p>
                            ) : null}
                            {row.conflictingFields.length ? (
                              <p className="text-xs text-muted-foreground">
                                <T>
                                  Conflicting fields: <Var>{row.conflictingFields.join(", ")}</Var>
                                </T>
                              </p>
                            ) : null}
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={busy}
                              aria-label={gt("{value} differences for {title}", {
                                value: detailCard === row.cardId ? "Hide" : "Review",
                                title: row.title,
                              })}
                              onClick={() =>
                                setDetailCard(detailCard === row.cardId ? null : row.cardId)
                              }
                            >
                              {detailCard === row.cardId
                                ? gt("Hide differences")
                                : gt("Review differences")}
                            </Button>
                            {detailCard === row.cardId ? (
                              <SyncDifferences
                                key={`${status.revision}:${row.cardId}`}
                                project={project}
                                row={row}
                                disabled={unavailable || !canResolve}
                                canWrite={status.capabilities.conditionalWrites}
                                onResolve={(choice) =>
                                  void execute(() =>
                                    resolve({
                                      environmentId: project.environmentId,
                                      input: { ...input, cardId: row.cardId, choice },
                                    }),
                                  )
                                }
                              />
                            ) : null}
                          </li>
                        ))}
                      </ul>
                      {status.rows.length > rowLimit ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setRowLimit(rowLimit + 100)}
                        >
                          <T>Show next 100 results</T>
                        </Button>
                      ) : null}
                    </>
                  ) : null}
                </details>
              ) : null}
              <details className="space-y-3 text-sm">
                <summary>
                  <T>Disconnect roadmap</T>
                </summary>
                <p className="text-muted-foreground">
                  <T>
                    Retained cards stay in T3 and become editable local cards. Disconnecting removes
                    their Hypercoder ownership and sync history. Hypercoder cards are kept there.
                  </T>
                </p>
                <Button
                  variant="outline"
                  disabled={unavailable || !canDisconnect}
                  onClick={() =>
                    void execute(() => disconnect({ environmentId: project.environmentId, input }))
                  }
                >
                  <T>Disconnect and keep cards</T>
                </Button>
                {!canDisconnect ? (
                  <p className="text-xs text-muted-foreground">
                    <T>Disconnecting requires permission to manage this environment’s access.</T>
                  </p>
                ) : null}
              </details>
            </>
          )}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            <T>Close</T>
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

const FIELDS = [
  ["title", "Title"],
  ["summary", "Summary"],
  ["type", "Type"],
  ["effort", "Effort"],
  ["lane", "Planning lane"],
  ["archived", "Archived"],
  ["completed", "Completed"],
  ["specPath", "Full spec"],
  ["acceptanceCriteria", "Acceptance criteria"],
] as const;

function fieldValue(
  fields: RoadmapSyncFields | null,
  key: keyof RoadmapSyncFields,
  resolve: MessageResolver,
) {
  if (!fields) return resolve(msg("Card absent"));
  const value = fields[key];
  if (value === null) return resolve(msg("None"));
  if (typeof value === "boolean") return value ? resolve(msg("Yes")) : resolve(msg("No"));
  if (typeof value === "string") return value || resolve(msg("Empty"));
  return (
    value.map((row) => `${row.checked ? "[x]" : "[ ]"} ${row.text}`).join("\n") ||
    resolve(msg("None"))
  );
}

function SyncDifferences({
  project,
  row,
  disabled,
  canWrite,
  onResolve,
}: {
  project: EnvironmentProject;
  row: RoadmapSyncRow;
  disabled: boolean;
  canWrite: boolean;
  onResolve: (choice: "local" | "remote") => void;
}) {
  const gt = useGT();
  const target = {
    environmentId: project.environmentId,
    input: { projectId: project.id, cardId: row.cardId },
  };
  const result = useAtomValue(roadmapSyncDetail(target));
  const detail = Option.getOrNull(AsyncResult.value(result));
  const refresh = useAtomQueryRunner(roadmapSyncDetail, { refresh: true, reportFailure: false });
  if (!detail || !AsyncResult.isSuccess(result) || result.waiting)
    return (
      <div className="space-y-2 text-xs text-muted-foreground">
        <p role="status">
          {AsyncResult.isFailure(result)
            ? gt("Could not load field differences.")
            : gt("Loading field differences…")}
        </p>
        {AsyncResult.isFailure(result) ? (
          <Button variant="outline" size="sm" onClick={() => void refresh(target)}>
            <T>Retry differences</T>
          </Button>
        ) : null}
      </div>
    );
  const conflict = row.status === "conflict";
  const outgoingDifference =
    row.status === "unsupported" &&
    detail.remote &&
    (JSON.stringify(detail.local) !== JSON.stringify(detail.remote) ||
      detail.localRank !== detail.remoteRank);
  return (
    <div className="space-y-3">
      <FieldDifferences detail={detail} />
      {conflict || outgoingDifference ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {conflict
              ? gt(
                  "Choose one version for this card’s conflicting fields. Independent changes are preserved.",
                )
              : gt(
                  "Using Hypercoder replaces this card’s retained T3 differences with its Hypercoder version. Unsupported source data may still require attention.",
                )}
          </p>
          <div className="flex flex-wrap gap-2">
            {conflict ? (
              <Button
                variant="outline"
                size="sm"
                disabled={disabled || !canWrite || !detail.local}
                onClick={() => onResolve("local")}
              >
                <T>Keep T3 changes</T>
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              disabled={disabled || !detail.remote}
              onClick={() => onResolve("remote")}
            >
              <T>Use Hypercoder changes</T>
            </Button>
          </div>
          {conflict && !canWrite ? (
            <p className="text-xs text-muted-foreground">
              <T>
                Keeping T3 changes requires safe outgoing writes, which this connection does not
                support.
              </T>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function FieldDifferences({ detail }: { detail: RoadmapSyncDetail }) {
  const gt = useGT();
  const messages = useMessages();
  const fields = FIELDS.filter(
    ([key]) =>
      detail.conflictingFields.includes(key) ||
      JSON.stringify(detail.local?.[key]) !== JSON.stringify(detail.remote?.[key]),
  );
  const rankDiffers =
    detail.conflictingFields.includes("rank") || detail.localRank !== detail.remoteRank;
  return fields.length || rankDiffers ? (
    <div className="space-y-3">
      {rankDiffers ? (
        <section className="space-y-2 rounded-md border border-border p-3 text-xs">
          <h4 className="font-medium">
            <T>Order</T>
          </h4>
          <p>T3: {detail.localRank ?? gt("Unknown")}</p>
          <p>
            <T>Last confirmed: </T>
            {detail.baselineRank ?? gt("Unknown")}
          </p>
          <p>
            <T>Hypercoder: </T>
            {detail.remoteRank ?? gt("Unknown")}
          </p>
        </section>
      ) : null}
      {fields.map(([key, label]) => (
        <section key={key} className="space-y-2 rounded-md border border-border p-3 text-xs">
          <h4 className="font-medium">{label}</h4>
          {(
            [
              ["local", "T3"],
              ["baseline", "Last confirmed"],
              ["remote", "Hypercoder"],
            ] as const
          ).map(([source, name]) => (
            <div key={source}>
              <p className="font-medium text-muted-foreground">{name}</p>
              <p className="whitespace-pre-wrap break-words">
                {fieldValue(detail[source], key, messages)}
              </p>
            </div>
          ))}
        </section>
      ))}
    </div>
  ) : (
    <p className="text-xs text-muted-foreground">
      <T>No supported content fields differ.</T>
    </p>
  );
}
