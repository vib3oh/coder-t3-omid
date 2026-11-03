import {
  RoadmapBoard,
  RoadmapError,
  type RoadmapSaveInput,
  type ProjectId,
  type RoadmapView,
} from "@t3tools/contracts";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import * as NodeUtil from "node:util";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as ServerConfig from "../config.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";

const decodeBoard = Schema.decodeUnknownEffect(RoadmapBoard);
const StoredBoard = Schema.Struct({
  ...RoadmapBoard.fields,
  syncCommitId: Schema.optional(Schema.String.check(Schema.isMaxLength(128))),
});
const decodeBoardJson = Schema.decodeUnknownEffect(Schema.fromJsonString(StoredBoard));
const encodeBoardJson = Schema.encodeEffect(Schema.fromJsonString(StoredBoard));

type SyncSaveInput = RoadmapSaveInput & { readonly commitId?: string };

export class RoadmapService extends Context.Service<
  RoadmapService,
  {
    readonly read: (input: {
      readonly projectId: ProjectId;
    }) => Effect.Effect<RoadmapBoard, RoadmapError>;
    readonly save: (input: RoadmapSaveInput) => Effect.Effect<RoadmapBoard, RoadmapError>;
    readonly applySync: (input: SyncSaveInput) => Effect.Effect<RoadmapBoard, RoadmapError>;
    readonly readSyncCommit: (input: {
      readonly projectId: ProjectId;
    }) => Effect.Effect<string | null, RoadmapError>;
    readonly readView: (input: {
      readonly projectId: ProjectId;
    }) => Effect.Effect<RoadmapView, RoadmapError>;
  }
>()("t3/roadmap/RoadmapService") {}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const lock = yield* KeyedLock.make<ProjectId>();
  const directory = path.join(config.stateDir, "extensions", "roadmap");
  const filename = (projectId: ProjectId) =>
    path.join(directory, `project-${encodeURIComponent(projectId)}.json`);

  const readStored = Effect.fn("RoadmapService.readStored")(function* ({
    projectId,
  }: {
    readonly projectId: ProjectId;
  }) {
    const file = filename(projectId);
    const contents = yield* fs.readFileString(file).pipe(
      Effect.catchTags({
        PlatformError: (error) =>
          error.reason._tag === "NotFound"
            ? Effect.succeed(null)
            : Effect.fail(new RoadmapError({ reason: "storage" })),
      }),
    );
    if (contents === null)
      return { version: 1 as const, revision: 0, cards: [], syncCommitId: undefined };
    return yield* decodeBoardJson(contents).pipe(
      Effect.mapError(() => new RoadmapError({ reason: "invalid" })),
    );
  });

  const read = Effect.fn("RoadmapService.read")((input: { readonly projectId: ProjectId }) =>
    Effect.map(readStored(input), ({ version, revision, cards }) => ({ version, revision, cards })),
  );
  const readSyncCommit = Effect.fn("RoadmapService.readSyncCommit")(
    (input: { readonly projectId: ProjectId }) =>
      Effect.map(readStored(input), (board) => board.syncCommitId ?? null),
  );
  const write = Effect.fn("RoadmapService.write")((input: SyncSaveInput, trusted: boolean) =>
    lock.withLock(
      input.projectId,
      Effect.gen(function* () {
        const current = yield* readStored(input);
        if (current.revision !== input.expectedRevision)
          return yield* new RoadmapError({ reason: "conflict" });
        if (!trusted) {
          const existing = new Map(current.cards.map((card) => [card.id, card]));
          const surviving = new Set(input.cards.map((card) => card.id));
          if (current.cards.some((card) => card.sync && !surviving.has(card.id)))
            return yield* new RoadmapError({ reason: "invalid" });
          let segment = 0;
          const segments = new Map(
            current.cards.map((card) => {
              if (!card.sync?.readOnly) return [card.id, segment] as const;
              segment += 2;
              return [card.id, segment - 1] as const;
            }),
          );
          let lastSegment = 0;
          for (const card of input.cards) {
            const previous = existing.get(card.id);
            if (!NodeUtil.isDeepStrictEqual(card.sync, previous?.sync))
              return yield* new RoadmapError({ reason: "invalid" });
            if (previous?.sync?.readOnly && !NodeUtil.isDeepStrictEqual(card, previous))
              return yield* new RoadmapError({ reason: "invalid" });
            const nextSegment = segments.get(card.id);
            if (nextSegment !== undefined) {
              if (nextSegment < lastSegment) return yield* new RoadmapError({ reason: "invalid" });
              lastSegment = nextSegment;
            }
          }
        }
        if (
          new Set(input.cards.map((card) => card.id)).size !== input.cards.length ||
          input.cards.some((card) => {
            const criteria = card.acceptanceCriteria ?? [];
            return new Set(criteria.map((row) => row.id)).size !== criteria.length;
          })
        ) {
          return yield* new RoadmapError({ reason: "invalid" });
        }
        const next = yield* decodeBoard({
          version: 1,
          revision: current.revision + 1,
          cards: input.cards,
        }).pipe(Effect.mapError(() => new RoadmapError({ reason: "invalid" })));
        const file = filename(input.projectId);
        yield* Effect.gen(function* () {
          yield* fs.makeDirectory(directory, { recursive: true });
          yield* fs.writeFileString(
            `${file}.tmp`,
            yield* encodeBoardJson({
              ...next,
              syncCommitId: trusted ? input.commitId : current.syncCommitId,
            }),
            { mode: 0o600 },
          );
          yield* fs.rename(`${file}.tmp`, file);
        }).pipe(Effect.mapError(() => new RoadmapError({ reason: "storage" })));
        return next;
      }).pipe(Effect.uninterruptible),
    ),
  );
  const save = Effect.fn("RoadmapService.save")((input: RoadmapSaveInput) => write(input, false));
  const applySync = Effect.fn("RoadmapService.applySync")((input: SyncSaveInput) =>
    write(input, true),
  );
  const readView = Effect.fn("RoadmapService.readView")(function* (input: {
    readonly projectId: ProjectId;
  }) {
    const board = yield* read(input);
    const threadIds = [
      ...new Set(board.cards.flatMap((card) => (card.threadId ? [card.threadId] : []))),
    ];
    if (threadIds.length === 0) return { board, linkedThreads: [] };
    const snapshots = yield* Effect.all(
      [
        projections.getShellSnapshot({ projectId: input.projectId, threadIds, location: "active" }),
        projections.getShellSnapshot({
          projectId: input.projectId,
          threadIds,
          location: "archive",
        }),
      ],
      { concurrency: 2 },
    ).pipe(Effect.mapError(() => new RoadmapError({ reason: "storage" })));
    return {
      board,
      linkedThreads: snapshots.flatMap((snapshot) =>
        [...snapshot.threads, ...snapshot.archivedThreads].map((thread) => ({
          id: thread.id,
          title: thread.title,
          modelSelection: thread.modelSelection,
          runtimeMode: thread.runtimeMode,
          interactionMode: thread.interactionMode,
          archivedAt: thread.archivedAt ? DateTime.formatIso(thread.archivedAt) : null,
          pullRequests: thread.pullRequests ?? [],
        })),
      ),
    };
  });
  return RoadmapService.of({ read, save, applySync, readSyncCommit, readView });
});

export const layer = Layer.effect(RoadmapService, make);
