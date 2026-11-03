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
        Sync with Hypercoder
      </Button>
      <span className="text-xs text-muted-foreground" role="status">
        {status
          ? syncSummary(status)
          : AsyncResult.isFailure(result)
            ? "Hypercoder sync status unavailable."
            : "Loading sync status…"}
      </span>
      {AsyncResult.isFailure(result) ? (
        <Button variant="ghost" size="sm" disabled={disabled} onClick={() => void refresh(target)}>
          Retry sync status
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

function syncSummary(status: RoadmapSyncStatus) {
  if (!status.binding) return "Not connected";
  if (status.connection !== "ready") return status.message ?? `Connection ${status.connection}`;
  const mode = status.capabilities.conditionalWrites ? "Connected" : "Read-only connection";
  const issues = status.counts.conflicts + status.counts.unsupported + status.counts.failed;
  return `${mode}${issues ? ` · ${issues} cards need attention` : ""}`;
}

function syncError(result: Parameters<typeof squashAtomCommandFailure>[0]) {
  const error = squashAtomCommandFailure(result);
  return error instanceof Error ? error.message : "The sync action failed. Refresh and try again.";
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
          <DialogTitle>Sync with Hypercoder</DialogTitle>
          <DialogDescription>
            Manually compare this project’s roadmap with a Hypercoder instance on its environment.
            Sync does not start agents or publish work.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <p className="text-sm font-medium" role="status">
            {syncSummary(status)}
          </p>
          {status.message ? (
            <p className="text-sm text-muted-foreground">{status.message}</p>
          ) : null}
          {!status.capabilities.conditionalWrites ? (
            <p className="text-sm text-muted-foreground">
              Sync can import changes when Hypercoder is available. Sending changes to Hypercoder is
              unavailable because safe conditional writes have not been verified. Outgoing changes
              remain read-only with a reason.
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
            Refresh sync status and keep inputs
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
                Run <code>hc roadmap context</code> in this project’s Hypercoder terminal on the
                machine hosting T3. Copy its context diagnostics below. Keep Hypercoder running and
                signed in there. Both directories must belong to the same Git repository.
              </p>
              <fieldset disabled={unavailable || !canConnect} className="space-y-3">
                <label className="block space-y-1 text-sm">
                  <span>Context diagnostics JSON</span>
                  <Textarea
                    maxLength={20_000}
                    value={diagnostics}
                    placeholder="Paste hc roadmap context output; diagnostics only"
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
                          ? "Paste context diagnostics only. Credentials and tokens are not accepted."
                          : "Include source, backend, projectId and instanceId from hc roadmap context.",
                      );
                  }}
                >
                  Use diagnostics
                </Button>
                <details className="space-y-3">
                  <summary className="text-sm">Review or enter connection fields</summary>
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
                  Connect roadmap
                </Button>
              </fieldset>
              {!canConnect ? (
                <p className="text-xs text-muted-foreground">
                  Connecting requires permission to manage this environment’s access.
                </p>
              ) : null}
            </form>
          ) : (
            <>
              <details className="text-sm text-muted-foreground">
                <summary>Connection diagnostics</summary>
                <dl className="mt-2 space-y-1 break-all">
                  <dt>Context path</dt>
                  <dd>{status.binding.contextPath}</dd>
                  <dt>Backend</dt>
                  <dd>{status.binding.backend}</dd>
                  <dt>Hypercoder project</dt>
                  <dd>{status.binding.projectId}</dd>
                  <dt>Hypercoder instance</dt>
                  <dd>{status.binding.instanceId}</dd>
                </dl>
              </details>
              <Button
                disabled={unavailable || !canRun}
                onClick={() =>
                  void execute(() => run({ environmentId: project.environmentId, input }))
                }
              >
                {busy ? "Working…" : "Sync now"}
              </Button>
              {!canRun ? (
                <p className="text-xs text-muted-foreground">
                  Sync requires permission to operate this environment.
                </p>
              ) : null}
              <p className="text-sm text-muted-foreground">
                {status.counts.pulled} imported · {status.counts.pushed} sent ·{" "}
                {status.counts.unchanged} unchanged · {status.counts.conflicts} conflicts ·{" "}
                {status.counts.unsupported} unsupported · {status.counts.failed} failed
              </p>
              {status.lastSyncedAt ? (
                <p className="text-xs text-muted-foreground">Last sync: {status.lastSyncedAt}</p>
              ) : null}
              {status.rows.length ? (
                <details
                  className="space-y-3 text-sm"
                  onToggle={(event) => setRowsOpen(event.currentTarget.open)}
                >
                  <summary>Card results ({status.rows.length})</summary>
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
                                Conflicting fields: {row.conflictingFields.join(", ")}
                              </p>
                            ) : null}
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={busy}
                              aria-label={`${detailCard === row.cardId ? "Hide" : "Review"} differences for ${row.title}`}
                              onClick={() =>
                                setDetailCard(detailCard === row.cardId ? null : row.cardId)
                              }
                            >
                              {detailCard === row.cardId
                                ? "Hide differences"
                                : "Review differences"}
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
                          Show next 100 results
                        </Button>
                      ) : null}
                    </>
                  ) : null}
                </details>
              ) : null}
              <details className="space-y-3 text-sm">
                <summary>Disconnect roadmap</summary>
                <p className="text-muted-foreground">
                  Retained cards stay in T3 and become editable local cards. Disconnecting removes
                  their Hypercoder ownership and sync history. Hypercoder cards are kept there.
                </p>
                <Button
                  variant="outline"
                  disabled={unavailable || !canDisconnect}
                  onClick={() =>
                    void execute(() => disconnect({ environmentId: project.environmentId, input }))
                  }
                >
                  Disconnect and keep cards
                </Button>
                {!canDisconnect ? (
                  <p className="text-xs text-muted-foreground">
                    Disconnecting requires permission to manage this environment’s access.
                  </p>
                ) : null}
              </details>
            </>
          )}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Close
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

function fieldValue(fields: RoadmapSyncFields | null, key: keyof RoadmapSyncFields) {
  if (!fields) return "Card absent";
  const value = fields[key];
  if (value === null) return "None";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return value || "Empty";
  return value.map((row) => `${row.checked ? "[x]" : "[ ]"} ${row.text}`).join("\n") || "None";
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
            ? "Could not load field differences."
            : "Loading field differences…"}
        </p>
        {AsyncResult.isFailure(result) ? (
          <Button variant="outline" size="sm" onClick={() => void refresh(target)}>
            Retry differences
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
              ? "Choose one version for this card’s conflicting fields. Independent changes are preserved."
              : "Using Hypercoder replaces this card’s retained T3 differences with its Hypercoder version. Unsupported source data may still require attention."}
          </p>
          <div className="flex flex-wrap gap-2">
            {conflict ? (
              <Button
                variant="outline"
                size="sm"
                disabled={disabled || !canWrite || !detail.local}
                onClick={() => onResolve("local")}
              >
                Keep T3 changes
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              disabled={disabled || !detail.remote}
              onClick={() => onResolve("remote")}
            >
              Use Hypercoder changes
            </Button>
          </div>
          {conflict && !canWrite ? (
            <p className="text-xs text-muted-foreground">
              Keeping T3 changes requires safe outgoing writes, which this connection does not
              support.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function FieldDifferences({ detail }: { detail: RoadmapSyncDetail }) {
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
          <h4 className="font-medium">Order</h4>
          <p>T3: {detail.localRank ?? "Unknown"}</p>
          <p>Last confirmed: {detail.baselineRank ?? "Unknown"}</p>
          <p>Hypercoder: {detail.remoteRank ?? "Unknown"}</p>
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
              <p className="whitespace-pre-wrap break-words">{fieldValue(detail[source], key)}</p>
            </div>
          ))}
        </section>
      ))}
    </div>
  ) : (
    <p className="text-xs text-muted-foreground">No supported content fields differ.</p>
  );
}
