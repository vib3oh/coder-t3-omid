import {
  RoadmapBoard,
  RoadmapError,
  type RoadmapSaveInput,
  type ProjectId,
  type RoadmapView,
} from "@t3tools/contracts";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
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
const decodeBoardJson = Schema.decodeUnknownEffect(Schema.fromJsonString(RoadmapBoard));
const encodeBoardJson = Schema.encodeEffect(Schema.fromJsonString(RoadmapBoard));

export class RoadmapService extends Context.Service<
  RoadmapService,
  {
    readonly read: (input: {
      readonly projectId: ProjectId;
    }) => Effect.Effect<RoadmapBoard, RoadmapError>;
    readonly save: (input: RoadmapSaveInput) => Effect.Effect<RoadmapBoard, RoadmapError>;
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

  const read = Effect.fn("RoadmapService.read")(function* ({
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
    if (contents === null) return { version: 1 as const, revision: 0, cards: [] };
    return yield* decodeBoardJson(contents).pipe(
      Effect.mapError(() => new RoadmapError({ reason: "invalid" })),
    );
  });

  const save = Effect.fn("RoadmapService.save")((input: RoadmapSaveInput) =>
    lock.withLock(
      input.projectId,
      Effect.gen(function* () {
        const current = yield* read(input);
        if (current.revision !== input.expectedRevision)
          return yield* new RoadmapError({ reason: "conflict" });
        if (new Set(input.cards.map((card) => card.id)).size !== input.cards.length) {
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
          yield* fs.writeFileString(`${file}.tmp`, yield* encodeBoardJson(next), { mode: 0o600 });
          yield* fs.rename(`${file}.tmp`, file);
        }).pipe(Effect.mapError(() => new RoadmapError({ reason: "storage" })));
        return next;
      }).pipe(Effect.uninterruptible),
    ),
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
          archivedAt: thread.archivedAt ? DateTime.formatIso(thread.archivedAt) : null,
          pullRequests: thread.pullRequests ?? [],
        })),
      ),
    };
  });
  return RoadmapService.of({ read, save, readView });
});

export const layer = Layer.effect(RoadmapService, make);
