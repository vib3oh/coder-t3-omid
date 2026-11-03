import {
  ProjectId,
  RoadmapSyncBinding,
  RoadmapSyncCapabilities,
  RoadmapSyncError,
  RoadmapSyncFields,
  RoadmapSyncStatus,
  type RoadmapCardSync,
  type RoadmapSyncConnectInput,
  type RoadmapSyncDetail,
  type RoadmapSyncDetailInput,
  type RoadmapSyncDisconnectInput,
  type RoadmapSyncReadInput,
  type RoadmapSyncResolveInput,
  type RoadmapSyncRow,
  type RoadmapSyncRunInput,
} from "@t3tools/contracts";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as ServerConfig from "../../config.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as RoadmapService from "../RoadmapService.ts";
import * as HyperCoderRoadmap from "./HyperCoderRoadmap.ts";
import { reconcile, same, snapshot } from "./reconcile.ts";

const Text = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2_000));
const SnapshotSchema = Schema.Struct({
  fields: RoadmapSyncFields,
  rank: Schema.Number.check(Schema.isFinite()),
});
const Journal = Schema.Struct({
  idempotencyKey: Text,
  kind: Schema.Literals(["create", "update"]),
  externalId: Schema.NullOr(Text),
  desired: SnapshotSchema,
  phase: Schema.Literals(["pending", "uncertain", "confirmed"]),
  receipt: Schema.NullOr(
    Schema.Struct({ externalId: Text, revision: Text, ...SnapshotSchema.fields }),
  ),
});
const Entry = Schema.Struct({
  cardId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  externalId: Schema.NullOr(Text),
  baseline: Schema.NullOr(SnapshotSchema),
  // Retained order conflicts can leave the boards with different ordinals.
  localRankBaseline: Schema.optional(Schema.Number.check(Schema.isFinite())),
  remote: Schema.NullOr(SnapshotSchema),
  journal: Schema.NullOr(Journal),
  pendingImport: Schema.optional(Schema.Boolean),
});
type Entry = typeof Entry.Type;
const LocalCommitUpdate = Schema.Struct({
  cardId: Entry.fields.cardId,
  localRankBaseline: SnapshotSchema.fields.rank,
  baseline: Schema.NullOr(SnapshotSchema),
  accepted: Schema.Boolean,
});
const State = Schema.Struct({
  version: Schema.Literal(1),
  disconnecting: Schema.optional(Schema.Boolean),
  pendingLocalCommit: Schema.optional(
    Schema.Struct({
      id: Text,
      updates: Schema.Array(LocalCommitUpdate).check(Schema.isMaxLength(10_000)),
    }),
  ),
  status: RoadmapSyncStatus,
  entries: Schema.Array(Entry).check(Schema.isMaxLength(10_000)),
});
type State = typeof State.Type;
const decodeState = Schema.decodeUnknownEffect(Schema.fromJsonString(State));
const encodeState = Schema.encodeEffect(Schema.fromJsonString(State));
const decodeFields = Schema.decodeUnknownEffect(RoadmapSyncFields);
const decodeBinding = Schema.decodeEffect(RoadmapSyncBinding);
const noCapabilities: RoadmapSyncCapabilities = {
  conditionalWrites: false,
  create: false,
  update: false,
  archive: false,
  rank: false,
};
const counts = (rows: ReadonlyArray<RoadmapSyncRow>): RoadmapSyncStatus["counts"] => ({
  pulled: rows.filter((row) => row.status === "pulled").length,
  pushed: rows.filter((row) => row.status === "pushed").length,
  unchanged: rows.filter((row) => row.status === "unchanged").length,
  conflicts: rows.filter((row) => row.status === "conflict").length,
  unsupported: rows.filter((row) => row.status === "unsupported").length,
  failed: rows.filter((row) => row.status === "failed").length,
});
const initial = (): State => ({
  version: 1,
  status: {
    revision: 0,
    binding: null,
    connection: "disconnected",
    lastSyncedAt: null,
    lastRunId: null,
    message: null,
    capabilities: noCapabilities,
    rows: [],
    counts: counts([]),
  },
  entries: [],
});
const metadata = (row: RoadmapSyncRow, column: string | null): RoadmapCardSync => ({
  source: "hypercoder",
  externalId: row.externalId,
  status:
    row.status === "pulled" || row.status === "pushed" || row.status === "unchanged"
      ? "synced"
      : row.status,
  readOnly: ["conflict", "unsupported", "failed", "pending"].includes(row.status),
  reason: row.reason,
  remoteColumn: column,
});
const derived = (column: string | null): boolean =>
  column !== null && !["backlog", "upNext", "up-next", "up_next"].includes(column);

export class RoadmapSyncService extends Context.Service<
  RoadmapSyncService,
  {
    readonly read: (
      input: typeof RoadmapSyncReadInput.Type,
    ) => Effect.Effect<RoadmapSyncStatus, RoadmapSyncError>;
    readonly connect: (
      input: typeof RoadmapSyncConnectInput.Type,
    ) => Effect.Effect<RoadmapSyncStatus, RoadmapSyncError>;
    readonly run: (
      input: typeof RoadmapSyncRunInput.Type,
    ) => Effect.Effect<RoadmapSyncStatus, RoadmapSyncError>;
    readonly detail: (
      input: typeof RoadmapSyncDetailInput.Type,
    ) => Effect.Effect<RoadmapSyncDetail, RoadmapSyncError>;
    readonly resolve: (
      input: typeof RoadmapSyncResolveInput.Type,
    ) => Effect.Effect<RoadmapSyncStatus, RoadmapSyncError>;
    readonly disconnect: (
      input: typeof RoadmapSyncDisconnectInput.Type,
    ) => Effect.Effect<RoadmapSyncStatus, RoadmapSyncError>;
  }
>()("t3/roadmap/sync/RoadmapSyncService") {}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const crypto = yield* Crypto.Crypto;
  const uuid = crypto
    .randomUUIDv4()
    .pipe(Effect.mapError(() => new RoadmapSyncError({ reason: "storage" })));
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const roadmap = yield* RoadmapService.RoadmapService;
  const remote = yield* HyperCoderRoadmap.HyperCoderRoadmap;
  const lock = yield* KeyedLock.make<ProjectId>();
  const directory = path.join(config.stateDir, "extensions", "roadmap-sync");
  const filename = (projectId: ProjectId) =>
    path.join(directory, `project-${encodeURIComponent(projectId)}.json`);
  const load = Effect.fn("RoadmapSyncService.load")(function* (projectId: ProjectId) {
    const file = filename(projectId);
    const info = yield* fs.stat(file).pipe(
      Effect.catchTags({
        PlatformError: (error) =>
          error.reason._tag === "NotFound"
            ? Effect.succeed(null)
            : Effect.fail(new RoadmapSyncError({ reason: "storage" })),
      }),
    );
    if (info === null) return initial();
    if (Number(info.size) > 32 * 1024 * 1024)
      return yield* new RoadmapSyncError({ reason: "invalid" });
    const value = yield* fs
      .readFileString(file)
      .pipe(Effect.mapError(() => new RoadmapSyncError({ reason: "storage" })));
    const state = yield* decodeState(value).pipe(
      Effect.mapError(() => new RoadmapSyncError({ reason: "invalid" })),
    );
    if (
      new Set(state.entries.map((entry) => entry.cardId)).size !== state.entries.length ||
      new Set(state.entries.flatMap((entry) => (entry.externalId ? [entry.externalId] : [])))
        .size !== state.entries.filter((entry) => entry.externalId).length
    )
      return yield* new RoadmapSyncError({ reason: "invalid" });
    return state;
  });
  const persist = Effect.fn("RoadmapSyncService.persist")(function* (
    projectId: ProjectId,
    state: State,
  ) {
    const contents = yield* encodeState(state).pipe(
      Effect.mapError(() => new RoadmapSyncError({ reason: "invalid" })),
    );
    if (Buffer.byteLength(contents) > 32 * 1024 * 1024)
      return yield* new RoadmapSyncError({ reason: "invalid" });
    yield* Effect.gen(function* () {
      yield* fs.makeDirectory(directory, { recursive: true, mode: 0o700 });
      const file = filename(projectId);
      yield* fs.writeFileString(`${file}.tmp`, contents, { mode: 0o600 });
      yield* fs.rename(`${file}.tmp`, file);
    }).pipe(Effect.mapError(() => new RoadmapSyncError({ reason: "storage" })));
  });
  const workspace = Effect.fn("RoadmapSyncService.workspace")(function* (projectId: ProjectId) {
    const project = yield* projects
      .get(projectId)
      .pipe(Effect.mapError(() => new RoadmapSyncError({ reason: "storage" })));
    if (Option.isNone(project) || project.value.deletedAt !== null)
      return yield* new RoadmapSyncError({ reason: "invalid" });
    return project.value.workspaceRoot;
  });
  const requireRevision = Effect.fn("RoadmapSyncService.requireRevision")(function* (
    state: State,
    expected: number,
  ) {
    if (state.status.revision !== expected)
      return yield* new RoadmapSyncError({ reason: "conflict" });
  });
  const read = Effect.fn("RoadmapSyncService.read")((input: typeof RoadmapSyncReadInput.Type) =>
    lock.withLock(
      input.projectId,
      Effect.map(load(input.projectId), (state) => state.status),
    ),
  );
  const connect = Effect.fn("RoadmapSyncService.connect")(
    (input: typeof RoadmapSyncConnectInput.Type) =>
      lock.withLock(
        input.projectId,
        Effect.gen(function* () {
          const state = yield* load(input.projectId);
          yield* requireRevision(state, input.expectedRevision);
          if (state.disconnecting) return yield* new RoadmapSyncError({ reason: "conflict" });
          if (state.status.binding && !same(state.status.binding, input.binding))
            return yield* new RoadmapSyncError({ reason: "conflict" });
          const binding = yield* decodeBinding(input.binding).pipe(
            Effect.mapError(() => new RoadmapSyncError({ reason: "invalid" })),
          );
          const board = yield* remote.read({
            binding,
            workspaceRoot: yield* workspace(input.projectId),
          });
          const next: State = {
            ...state,
            status: {
              ...state.status,
              revision: state.status.revision + 1,
              binding,
              connection: "ready",
              capabilities: board.capabilities,
              message: null,
            },
          };
          yield* persist(input.projectId, next);
          return next.status;
        }).pipe(Effect.uninterruptible),
      ),
  );

  const applyCommitUpdates = (
    entries: ReadonlyArray<Entry>,
    changes: ReadonlyArray<typeof LocalCommitUpdate.Type>,
  ) => {
    const updates = new Map(changes.map((update) => [update.cardId, update]));
    return entries.map((entry) => {
      const update = updates.get(entry.cardId);
      return update
        ? {
            ...entry,
            localRankBaseline: update.localRankBaseline,
            baseline: update.baseline,
            journal: update.accepted ? null : entry.journal,
            pendingImport: update.accepted ? false : entry.pendingImport,
          }
        : entry;
    });
  };

  const synchronize = Effect.fn("RoadmapSyncService.synchronize")(function* (
    input: typeof RoadmapSyncRunInput.Type,
    resolution?: { readonly cardId: string; readonly choice: "local" | "remote" },
  ) {
    let state = yield* load(input.projectId);
    yield* requireRevision(state, input.expectedRevision);
    if (state.disconnecting) return yield* new RoadmapSyncError({ reason: "conflict" });
    const binding = state.status.binding;
    if (!binding) return yield* new RoadmapSyncError({ reason: "invalid" });
    if (state.pendingLocalCommit) {
      const receipt = yield* roadmap
        .readSyncCommit(input)
        .pipe(Effect.mapError(() => new RoadmapSyncError({ reason: "storage" })));
      state = {
        ...state,
        entries:
          receipt === state.pendingLocalCommit.id
            ? applyCommitUpdates(state.entries, state.pendingLocalCommit.updates)
            : state.entries,
        pendingLocalCommit: undefined,
      };
      yield* persist(input.projectId, state);
    }
    const workspaceRoot = yield* workspace(input.projectId);
    const result = yield* remote.read({ binding, workspaceRoot }).pipe(Effect.result);
    if (result._tag === "Failure") {
      state = {
        ...state,
        status: {
          ...state.status,
          revision: state.status.revision + 1,
          connection: result.failure.reason === "unavailable" ? "unavailable" : "blocked",
          message: result.failure.message,
        },
      };
      yield* persist(input.projectId, state);
      return state.status;
    }
    const remoteBoard = result.success;
    if (
      remoteBoard.cards.length > 10_000 ||
      new Set(remoteBoard.cards.map((card) => card.id)).size !== remoteBoard.cards.length
    )
      return yield* new RoadmapSyncError({ reason: "invalid" });
    const local = yield* roadmap
      .read(input)
      .pipe(Effect.mapError(() => new RoadmapSyncError({ reason: "storage" })));
    const entries = new Map(state.entries.map((entry) => [entry.cardId, entry]));
    const remoteById = new Map(remoteBoard.cards.map((card) => [card.id, card]));
    const localIds = new Set(local.cards.map((card) => card.id));
    const linkedOrder = local.cards.filter((card) => {
      const externalId = entries.get(card.id)?.externalId;
      return externalId !== null && externalId !== undefined && remoteById.has(externalId);
    });
    const linkedRanks = new Map(linkedOrder.map((card, rank) => [card.id, rank]));
    const cards = new Map(local.cards.map((card, rank) => [card.id, { card, rank }]));
    for (const entry of entries.values()) {
      const external = entry.externalId ? remoteById.get(entry.externalId) : undefined;
      if (entry.pendingImport && !cards.has(entry.cardId) && external) {
        cards.set(entry.cardId, {
          card: { id: entry.cardId, ...external.fields, threadId: null },
          rank: external.rank,
        });
      }
    }
    const rows: RoadmapSyncRow[] = resolution
      ? state.status.rows.filter((row) => row.cardId !== resolution.cardId)
      : [];
    const bound = new Set(
      state.entries.flatMap((entry) => (entry.externalId ? [entry.externalId] : [])),
    );
    const runId = yield* uuid;
    const adoptedRanks = new Map<string, number>();
    const acceptedIds = new Set<string>();
    let revision = remoteBoard.revision;
    let writes = 0;
    state = {
      ...state,
      status: {
        ...state.status,
        revision: state.status.revision + 1,
        lastRunId: runId,
        connection: "ready",
        capabilities: remoteBoard.capabilities,
        message: null,
      },
    };
    const checkpoint = Effect.fn("RoadmapSyncService.checkpoint")(function* () {
      state = { ...state, entries: [...entries.values()] };
      yield* persist(input.projectId, state);
    });
    yield* checkpoint();
    for (const external of remoteBoard.cards) {
      if (resolution) continue;
      if (bound.has(external.id)) continue;
      let cardId = `hc-${yield* uuid}`;
      while (cards.has(cardId)) cardId = `hc-${yield* uuid}`;
      if (cards.size >= 10_000) return yield* new RoadmapSyncError({ reason: "invalid" });
      cards.set(cardId, {
        card: { id: cardId, ...external.fields, threadId: null },
        rank: external.rank,
      });
      entries.set(cardId, {
        cardId,
        externalId: external.id,
        baseline: { fields: external.fields, rank: external.rank },
        remote: null,
        journal: null,
        pendingImport: true,
      });
    }
    for (const [cardId, record] of cards) {
      if (resolution && cardId !== resolution.cardId) continue;
      const original = localIds.has(cardId);
      let entry: Entry = entries.get(cardId) ?? {
        cardId,
        externalId: null,
        baseline: null,
        remote: null,
        journal: null,
      };
      let external = entry.externalId ? remoteById.get(entry.externalId) : undefined;
      const nativeRank = linkedRanks.get(cardId) ?? record.rank;
      const comparisonRank =
        entry.baseline && entry.localRankBaseline !== undefined && nativeRank !== external?.rank
          ? entry.baseline.rank + nativeRank - entry.localRankBaseline
          : nativeRank;
      const current = snapshot(record.card, comparisonRank);
      let desired = current;
      let status: RoadmapSyncRow["status"] = original ? "unchanged" : "pulled";
      let reason: string | null = null;
      let conflictingFields: string[] = [];
      if (entry.journal) {
        const journal = entry.journal;
        if (journal.receipt) {
          entry = {
            ...entry,
            externalId: journal.receipt.externalId,
            baseline: entry.baseline ?? journal.desired,
          };
          external = remoteById.get(journal.receipt.externalId);
        } else if (
          !external ||
          !same({ fields: external.fields, rank: external.rank }, journal.desired)
        ) {
          if (
            journal.kind === "create" ||
            !external ||
            !entry.baseline ||
            !same({ fields: external.fields, rank: external.rank }, entry.baseline)
          ) {
            status = "failed";
            reason =
              "A previous write has an uncertain outcome. Review Hypercoder before disconnecting or choosing a version.";
          }
        }
      }
      if (status !== "failed") {
        if (entry.externalId && !external) {
          status = "conflict";
          reason = "The linked Hypercoder card is missing. No deletion was propagated.";
        } else if (external?.issues.length || derived(external?.column ?? null)) {
          status = "unsupported";
          reason = external?.issues.length
            ? "Hypercoder has unsupported card data. Review the original card before editing."
            : "This column is derived from Hypercoder work. T3 does not control that execution.";
          if (!original && external) desired = { fields: external.fields, rank: external.rank };
        } else if (external) {
          const their = { fields: external.fields, rank: external.rank };
          if (resolution?.cardId === cardId) {
            const previous = state.status.rows.find((row) => row.cardId === cardId);
            if (entry.remote && !same(entry.remote, their)) {
              status = "conflict";
              reason =
                "Hypercoder changed since this comparison. Run Sync again before choosing a version.";
            } else {
              desired =
                previous?.status === "unsupported" && resolution.choice === "remote"
                  ? their
                  : entry.baseline
                    ? reconcile(entry.baseline, current, their, resolution.choice).merged
                    : resolution.choice === "remote"
                      ? their
                      : current;
              status = same(current, desired) ? "unchanged" : "pulled";
            }
          } else if (entry.baseline) {
            const comparison = reconcile(entry.baseline, current, their);
            conflictingFields = comparison.conflicts;
            if (conflictingFields.length) {
              status = "conflict";
              reason = "Both boards changed the same fields. Choose which version to keep.";
            } else {
              desired = comparison.merged;
              status = comparison.pull ? "pulled" : status;
            }
          } else if (!same(current, their)) {
            status = "conflict";
            reason = "The link has no confirmed baseline. Choose which version to keep.";
          }
        }
      }
      const valid = yield* decodeFields(desired.fields).pipe(Effect.result);
      if (
        valid._tag === "Failure" ||
        new Set(desired.fields.acceptanceCriteria.map((row) => row.id)).size !==
          desired.fields.acceptanceCriteria.length
      ) {
        status = "unsupported";
        reason = "The merged card exceeds supported limits. Review each version separately.";
      }
      const needsPush =
        !external || !same(desired, { fields: external.fields, rank: external.rank });
      if (!["failed", "conflict", "unsupported"].includes(status) && needsPush) {
        const capabilities = remoteBoard.capabilities;
        const archiveChanged = external && desired.fields.archived !== external.fields.archived;
        const rankChanged = external && desired.rank !== external.rank;
        if (
          !capabilities.conditionalWrites ||
          revision === null ||
          (!external && !capabilities.create) ||
          (external && !capabilities.update) ||
          (archiveChanged && !capabilities.archive) ||
          (rankChanged && !capabilities.rank)
        ) {
          status = "unsupported";
          reason =
            "This Hypercoder connection cannot conditionally write these changes. The local draft is retained.";
        } else if (record.card.threadId) {
          status = "unsupported";
          reason =
            "This card is linked to T3 work. Execution ownership cannot be written to Hypercoder.";
        } else if (writes >= 100) {
          status = "pending";
          reason = "This sync reached its write limit. Run Sync again to continue.";
        } else {
          writes++;
          const kind = external ? ("update" as const) : ("create" as const);
          const externalId = external?.id ?? null;
          const prior = entry.journal;
          const journal = {
            idempotencyKey:
              prior &&
              !prior.receipt &&
              prior.kind === kind &&
              prior.externalId === externalId &&
              same(prior.desired, desired)
                ? prior.idempotencyKey
                : yield* uuid,
            kind,
            externalId,
            desired,
            phase: "pending" as const,
            receipt: null,
          };
          entry = { ...entry, journal };
          entries.set(cardId, entry);
          yield* checkpoint();
          const applied = yield* remote
            .apply({
              binding,
              workspaceRoot,
              expectedRevision: revision,
              operation: {
                idempotencyKey: journal.idempotencyKey,
                kind: journal.kind,
                externalId: journal.externalId,
                fields: desired.fields,
                rank: desired.rank,
              },
            })
            .pipe(Effect.result);
          if (applied._tag === "Failure") {
            const rejected = ["conflict", "unsupported", "invalid", "mismatch"].includes(
              applied.failure.reason,
            );
            status = applied.failure.reason === "conflict" ? "conflict" : "failed";
            reason =
              applied.failure.reason === "conflict"
                ? "Hypercoder changed during this sync. Run Sync again to compare the new version."
                : "Hypercoder did not confirm the write. Sync will inspect it before another attempt.";
            entry = { ...entry, journal: rejected ? null : { ...journal, phase: "uncertain" } };
            revision = null;
          } else {
            const receipt = applied.success;
            revision = receipt.revision;
            desired = { fields: receipt.fields, rank: receipt.rank };
            entry = {
              ...entry,
              externalId: receipt.externalId,
              journal: { ...journal, phase: "confirmed", receipt },
            };
            status = "pushed";
          }
          entries.set(cardId, entry);
          yield* checkpoint();
        }
      }
      const row: RoadmapSyncRow = {
        cardId,
        externalId: entry.externalId,
        title: current.fields.title,
        status,
        reason,
        conflictingFields,
      };
      rows.push(row);
      const accepted = ["pulled", "pushed", "unchanged"].includes(status);
      if (accepted) acceptedIds.add(cardId);
      const adoptedRank =
        !accepted && external && entry.baseline && current.rank === entry.baseline.rank
          ? external.rank
          : undefined;
      if (adoptedRank !== undefined) adoptedRanks.set(cardId, adoptedRank);
      cards.set(cardId, {
        card: {
          ...record.card,
          ...(accepted ? desired.fields : {}),
          sync: metadata(row, external?.column ?? null),
        },
        rank: accepted ? desired.rank : (adoptedRank ?? record.rank),
      });
      entries.set(cardId, {
        ...entry,
        remote: entry.journal?.receipt
          ? { fields: entry.journal.receipt.fields, rank: entry.journal.receipt.rank }
          : external
            ? { fields: external.fields, rank: external.rank }
            : null,
      });
    }
    for (const entry of entries.values()) {
      if (resolution && entry.cardId !== resolution.cardId) continue;
      if (cards.has(entry.cardId)) continue;
      rows.push({
        cardId: entry.cardId,
        externalId: entry.externalId,
        title: entry.baseline?.fields.title ?? "Missing local card",
        status: "conflict",
        reason: "The local card is missing. No deletion was propagated.",
        conflictingFields: [],
      });
    }
    let ordered = [...cards.values()].sort((a, b) => a.rank - b.rank).map((record) => record.card);
    const resolved = resolution ? cards.get(resolution.cardId) : undefined;
    const resolvedRow = resolution
      ? rows.find((row) => row.cardId === resolution.cardId)
      : undefined;
    if (resolved && resolvedRow && ["pulled", "pushed", "unchanged"].includes(resolvedRow.status)) {
      const retained = ordered.filter((card) => card.id !== resolved.card.id);
      const positions = retained.flatMap((card, index) => {
        const externalId = entries.get(card.id)?.externalId;
        return externalId && remoteById.has(externalId) ? [index] : [];
      });
      const position =
        positions[resolved.rank] ??
        (positions.length
          ? positions[positions.length - 1]! + 1
          : Math.min(resolved.rank, retained.length));
      retained.splice(position, 0, resolved.card);
      ordered = retained;
    }
    const plannedRanks = new Map(
      ordered
        .filter((card) => {
          const entry = entries.get(card.id);
          return entry?.externalId && (remoteById.has(entry.externalId) || entry.journal?.receipt);
        })
        .map((card, rank) => [card.id, rank]),
    );
    const commitUpdates: Array<typeof LocalCommitUpdate.Type> = [];
    for (const [cardId, entry] of entries) {
      const rank = plannedRanks.get(cardId);
      if (rank === undefined) continue;
      const previousRank = linkedRanks.get(cardId);
      const previousBaseline = entry.localRankBaseline ?? entry.baseline?.rank;
      const source =
        entry.journal?.receipt ?? (entry.externalId ? remoteById.get(entry.externalId) : undefined);
      const agreed = rank === source?.rank;
      const localRankBaseline =
        agreed ||
        acceptedIds.has(cardId) ||
        adoptedRanks.has(cardId) ||
        previousRank === undefined ||
        previousBaseline === undefined
          ? rank
          : rank - (previousRank - previousBaseline);
      const record = cards.get(cardId)!;
      const accepted = acceptedIds.has(cardId);
      const adoptedRank = adoptedRanks.get(cardId);
      const baselineRank = adoptedRank ?? (agreed ? rank : undefined);
      commitUpdates.push({
        cardId,
        localRankBaseline,
        baseline: accepted
          ? snapshot(record.card, record.rank)
          : entry.baseline && baselineRank !== undefined
            ? { ...entry.baseline, rank: baselineRank }
            : entry.baseline,
        accepted,
      });
    }
    state = {
      ...state,
      pendingLocalCommit: { id: runId, updates: commitUpdates },
      status: { ...state.status, rows, counts: counts(rows) },
    };
    yield* checkpoint();
    const committed = yield* roadmap
      .applySync({
        projectId: input.projectId,
        expectedRevision: local.revision,
        cards: ordered,
        commitId: runId,
      })
      .pipe(Effect.result);
    if (committed._tag === "Failure") {
      state = {
        ...state,
        pendingLocalCommit: undefined,
        status: {
          ...state.status,
          connection: "blocked",
          message:
            "The T3 board changed during sync. Its edits were retained; run Sync again to reconcile confirmed receipts.",
          rows,
          counts: counts(rows),
        },
      };
      yield* checkpoint();
      return state.status;
    }
    for (const entry of applyCommitUpdates([...entries.values()], commitUpdates))
      entries.set(entry.cardId, entry);
    state = { ...state, pendingLocalCommit: undefined };
    state = {
      ...state,
      status: {
        ...state.status,
        lastSyncedAt: DateTime.formatIso(yield* DateTime.now),
        rows,
        counts: counts(rows),
        message: rows.some((row) => row.status === "failed")
          ? "Some writes were not confirmed. Review the affected cards before retrying."
          : null,
      },
    };
    yield* checkpoint();
    return state.status;
  });
  const run = Effect.fn("RoadmapSyncService.run")((input: typeof RoadmapSyncRunInput.Type) =>
    lock.withLock(input.projectId, synchronize(input).pipe(Effect.uninterruptible)),
  );
  const resolve = Effect.fn("RoadmapSyncService.resolve")(
    (input: typeof RoadmapSyncResolveInput.Type) =>
      lock.withLock(
        input.projectId,
        Effect.gen(function* () {
          const state = yield* load(input.projectId);
          yield* requireRevision(state, input.expectedRevision);
          if (!state.entries.some((entry) => entry.cardId === input.cardId))
            return yield* new RoadmapSyncError({ reason: "invalid" });
          return yield* synchronize(input, { cardId: input.cardId, choice: input.choice });
        }).pipe(Effect.uninterruptible),
      ),
  );
  const detail = Effect.fn("RoadmapSyncService.detail")(
    (input: typeof RoadmapSyncDetailInput.Type) =>
      lock.withLock(
        input.projectId,
        Effect.gen(function* () {
          const state = yield* load(input.projectId);
          const board = yield* roadmap
            .read(input)
            .pipe(Effect.mapError(() => new RoadmapSyncError({ reason: "storage" })));
          const rank = board.cards.findIndex((card) => card.id === input.cardId);
          const card = board.cards[rank];
          const entry = state.entries.find((entry) => entry.cardId === input.cardId);
          const linkedIds = new Set(
            state.entries
              .filter((entry) => entry.externalId && entry.remote)
              .map((entry) => entry.cardId),
          );
          const localRank = entry?.externalId
            ? board.cards
                .filter((card) => linkedIds.has(card.id))
                .findIndex((card) => card.id === input.cardId)
            : rank;
          if (!entry && !card) return yield* new RoadmapSyncError({ reason: "invalid" });
          return {
            cardId: input.cardId,
            local: card ? snapshot(card, rank).fields : null,
            remote: entry?.remote?.fields ?? null,
            baseline: entry?.baseline?.fields ?? null,
            localRank: card && localRank >= 0 ? localRank : null,
            remoteRank: entry?.remote?.rank ?? null,
            baselineRank: entry?.baseline?.rank ?? null,
            conflictingFields:
              state.status.rows.find((row) => row.cardId === input.cardId)?.conflictingFields ?? [],
          };
        }),
      ),
  );
  const disconnect = Effect.fn("RoadmapSyncService.disconnect")(
    (input: typeof RoadmapSyncDisconnectInput.Type) =>
      lock.withLock(
        input.projectId,
        Effect.gen(function* () {
          const state = yield* load(input.projectId);
          yield* requireRevision(state, input.expectedRevision);
          const board = yield* roadmap
            .read(input)
            .pipe(Effect.mapError(() => new RoadmapSyncError({ reason: "storage" })));
          yield* persist(input.projectId, {
            ...state,
            disconnecting: true,
            status: {
              ...state.status,
              revision: state.status.revision + 1,
              connection: "blocked",
              message: "Disconnect is incomplete. Retry Disconnect to release retained cards.",
            },
          });
          yield* roadmap
            .applySync({
              projectId: input.projectId,
              expectedRevision: board.revision,
              cards: board.cards.map(({ sync: _sync, ...card }) => card),
            })
            .pipe(Effect.mapError(() => new RoadmapSyncError({ reason: "conflict" })));
          const disconnected = initial();
          const next = {
            ...disconnected,
            status: { ...disconnected.status, revision: state.status.revision + 1 },
          };
          yield* persist(input.projectId, next);
          return next.status;
        }).pipe(Effect.uninterruptible),
      ),
  );
  return RoadmapSyncService.of({ read, connect, run, detail, resolve, disconnect });
});

export const layer = Layer.effect(RoadmapSyncService, make);
