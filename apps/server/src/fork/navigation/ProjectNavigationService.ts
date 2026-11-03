import {
  ProjectNavigationError,
  ProjectId,
  NonNegativeInt,
  type ProjectNavigationReadInput,
  type ProjectNavigationReadResult,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Schema from "effect/Schema";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Hex from "effect/encoding/Hex";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as RoadmapService from "../../roadmap/RoadmapService.ts";
import * as GitVcsDriver from "../../vcs/GitVcsDriver.ts";
import * as AgentWorkflowStore from "../agents/AgentWorkflowStore.ts";
import { navigationWorktrees } from "./navigationView.ts";

export class ProjectNavigationService extends Context.Service<
  ProjectNavigationService,
  {
    readonly read: (
      input: ProjectNavigationReadInput,
    ) => Effect.Effect<ProjectNavigationReadResult, ProjectNavigationError>;
  }
>()("t3/fork/navigation/ProjectNavigationService") {}

const Cursor = Schema.Struct({
  projectId: ProjectId,
  revision: Schema.String,
  offset: NonNegativeInt,
});
const decodeCursor = Schema.decodeUnknownEffect(Schema.fromJsonString(Cursor));
const encodeCursor = Schema.encodeEffect(Schema.fromJsonString(Cursor));
const encodeRevision = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const roadmap = yield* RoadmapService.RoadmapService;
  const workflows = yield* AgentWorkflowStore.AgentWorkflowStore;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const inventories = new Map<
    ProjectId,
    { readonly expires: number; readonly paths: ReadonlyArray<string>; readonly available: boolean }
  >();

  const inventory = Effect.fn("ProjectNavigationService.inventory")(function* (
    projectId: ProjectId,
    root: string,
    now: number,
  ) {
    const cached = inventories.get(projectId);
    if (cached && cached.expires > now) return cached;
    const hasGit = yield* fs.exists(path.join(root, ".git")).pipe(Effect.orElseSucceed(() => true));
    const paths = hasGit
      ? yield* git.listWorktreePaths(root).pipe(Effect.option)
      : Option.some([] as string[]);
    const next = {
      paths: Option.getOrElse(paths, () => []),
      available: Option.isSome(paths),
      expires: now + 5_000,
    };
    inventories.set(projectId, next);
    return next;
  });

  const read = Effect.fn("ProjectNavigationService.read")(function* (
    input: ProjectNavigationReadInput,
  ) {
    const project = yield* projects
      .getShell(input.projectId)
      .pipe(Effect.mapError(() => new ProjectNavigationError({ reason: "storage" })));
    if (Option.isNone(project)) return yield* new ProjectNavigationError({ reason: "not_found" });
    const root = project.value.workspaceRoot;
    const now = yield* Clock.currentTimeMillis;
    const [initialSnapshot, initialBoard, initialState, listed] = yield* Effect.all(
      [
        projections.getShellSnapshot({ projectId: input.projectId }).pipe(Effect.option),
        roadmap.read(input).pipe(Effect.option),
        workflows.read(input.projectId).pipe(Effect.option),
        inventory(input.projectId, root, now),
      ],
      { concurrency: 4 },
    );
    let snapshot = initialSnapshot;
    let board = initialBoard;
    let state = initialState;
    const readOwners = Effect.all(
      [
        roadmap.read(input).pipe(Effect.option),
        workflows.read(input.projectId).pipe(Effect.option),
      ],
      { concurrency: 2 },
    );
    const sameOwners = (nextBoard: typeof board, nextState: typeof state) =>
      Option.getOrNull(board)?.revision === Option.getOrNull(nextBoard)?.revision &&
      Option.getOrNull(state)?.revision === Option.getOrNull(nextState)?.revision;
    const verified = yield* readOwners;
    let ownersStable = sameOwners(verified[0], verified[1]);
    board = verified[0];
    state = verified[1];
    if (!ownersStable) {
      snapshot = yield* projections
        .getShellSnapshot({ projectId: input.projectId })
        .pipe(Effect.option);
      const retried = yield* readOwners;
      ownersStable = sameOwners(retried[0], retried[1]);
      board = retried[0];
      state = retried[1];
    }
    const threads = Option.isSome(snapshot)
      ? [...snapshot.value.threads, ...snapshot.value.archivedThreads]
      : [];
    const workflowRows = Option.isSome(state) ? state.value.workflows : [];
    const rawPaths = [
      ...new Set([
        root,
        ...listed.paths,
        ...threads.flatMap((thread) => thread.worktreePath ?? []),
        ...workflowRows.flatMap((workflow) => workflow.workspacePath ?? []),
      ]),
    ];
    const resolved = yield* Effect.forEach(
      rawPaths,
      (value) =>
        fs.realPath(value).pipe(
          Effect.map((canonical) => [value, { canonical, exists: true }] as const),
          Effect.catchTags({
            PlatformError: (error) =>
              Effect.succeed([
                value,
                {
                  canonical: path.resolve(value),
                  exists: error.reason._tag === "NotFound" ? false : null,
                },
              ] as const),
          }),
        ),
      { concurrency: 8 },
    );
    const groupedRows = navigationWorktrees({
      projectId: input.projectId,
      workspaceRoot: root,
      threads,
      board: Option.getOrNull(board),
      workflows: workflowRows,
      paths: new Map<string, { readonly canonical: string; readonly exists: boolean | null }>(
        resolved,
      ),
      inventoriedPaths: listed.paths,
      now,
    });
    const revealed = input.revealThreadId
      ? groupedRows.find((row) => row.threads.some((thread) => thread.id === input.revealThreadId))
      : undefined;
    const rows = revealed
      ? [
          ...groupedRows.filter((row) => row.isMain),
          ...(!revealed.isMain ? [revealed] : []),
          ...groupedRows.filter((row) => !row.isMain && row !== revealed),
        ].map((row) =>
          row === revealed
            ? {
                ...row,
                threads: [...row.threads].sort(
                  (a, b) =>
                    Number(b.id === input.revealThreadId) - Number(a.id === input.revealThreadId),
                ),
              }
            : row,
        )
      : groupedRows;
    const sources = {
      threads: Option.isSome(snapshot) ? "available" : "unavailable",
      roadmap: ownersStable && Option.isSome(board) ? "available" : "unavailable",
      workflows: ownersStable && Option.isSome(state) ? "available" : "unavailable",
      git: listed.available ? "available" : "unavailable",
    } as const;
    const revisionText = yield* encodeRevision([
      input.projectId,
      sources,
      Option.getOrNull(board)?.revision,
      Option.getOrNull(state)?.revision,
      rows.map((row) => ({
        ...row,
        threads: row.threads.map(({ updatedAt: _updatedAt, ...thread }) => thread),
      })),
    ]).pipe(Effect.mapError(() => new ProjectNavigationError({ reason: "storage" })));
    const revision = Hex.encode(
      yield* crypto
        .digest("SHA-256", new TextEncoder().encode(revisionText))
        .pipe(Effect.mapError(() => new ProjectNavigationError({ reason: "storage" }))),
    );
    let offset = 0;
    if (input.cursor) {
      const cursor = yield* Effect.fromResult(Base64Url.decodeString(input.cursor)).pipe(
        Effect.flatMap(decodeCursor),
        Effect.mapError(() => new ProjectNavigationError({ reason: "stale_cursor" })),
      );
      if (cursor.revision !== revision || cursor.projectId !== input.projectId)
        return yield* new ProjectNavigationError({ reason: "stale_cursor" });
      offset = cursor.offset;
    }
    const limit = input.limit ?? 50;
    const selected = input.worktreeKey
      ? rows.filter((row) => row.key === input.worktreeKey)
      : rows.slice(offset, offset + limit);
    const nextOffset = offset + limit;
    const nextCursor =
      !input.worktreeKey && nextOffset < rows.length
        ? Base64Url.encode(
            yield* encodeCursor({ projectId: input.projectId, revision, offset: nextOffset }).pipe(
              Effect.mapError(() => new ProjectNavigationError({ reason: "storage" })),
            ),
          )
        : null;
    return {
      projectId: input.projectId,
      revision,
      observedAt: DateTime.formatIso(DateTime.makeUnsafe(now)),
      sources,
      worktrees: selected.map((row) => {
        const start = input.worktreeKey === row.key ? (input.threadOffset ?? 0) : 0;
        const cardStart = input.worktreeKey === row.key ? (input.cardOffset ?? 0) : 0;
        const workflowStart = input.worktreeKey === row.key ? (input.workflowOffset ?? 0) : 0;
        const pageSize = input.worktreeKey ? 50 : 3;
        return {
          ...row,
          cards: row.cards.slice(cardStart, cardStart + pageSize),
          cardCount: row.cards.length,
          cardNextOffset: cardStart + pageSize < row.cards.length ? cardStart + pageSize : null,
          workflows: row.workflows.slice(workflowStart, workflowStart + pageSize),
          workflowCount: row.workflows.length,
          workflowNextOffset:
            workflowStart + pageSize < row.workflows.length ? workflowStart + pageSize : null,
          threads: row.threads.slice(start, start + pageSize),
          threadNextOffset: start + pageSize < row.threadCount ? start + pageSize : null,
        };
      }),
      nextCursor,
      totalWorktrees: rows.length,
      attentionCount: rows.filter((row) => row.attentionCount > 0).length,
      complete: Object.values(sources).every((source) => source === "available"),
    } satisfies ProjectNavigationReadResult;
  });
  return ProjectNavigationService.of({ read });
});

export const layer = Layer.effect(ProjectNavigationService, make);
