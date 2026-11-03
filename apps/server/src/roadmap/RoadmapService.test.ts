import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  ProjectId,
  ThreadId,
  EventId,
  ProviderInstanceId,
  type RoadmapCard,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as ServerConfig from "../config.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { v2PullRequestThread } from "../orchestration-v2/testkit/pullRequestFixtures.ts";
import * as RoadmapService from "./RoadmapService.ts";

const card: RoadmapCard = {
  id: "first",
  title: "A project board",
  summary: "Persist planning across clients",
  type: "feature",
  effort: "M",
  lane: "backlog",
  threadId: null,
  completed: false,
  archived: false,
};

const layer = RoadmapService.layer.pipe(
  Layer.provideMerge(Layer.mock(ProjectionStore.ProjectionStoreV2)({})),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-roadmap-test-" })),
  Layer.provideMerge(NodeServices.layer),
);

describe("RoadmapService", () => {
  it.effect(
    "owns sync metadata and blocks edits or moves of locked cards while allowing unrelated insertions",
    () =>
      Effect.gen(function* () {
        const service = yield* RoadmapService.RoadmapService;
        const projectId = ProjectId.make("sync-ownership");
        const sync = {
          source: "hypercoder" as const,
          externalId: "remote",
          status: "conflict" as const,
          readOnly: true,
          reason: "Choose a version",
          remoteColumn: null,
        };
        expect(
          yield* service
            .save({ projectId, expectedRevision: 0, cards: [{ ...card, sync }] })
            .pipe(Effect.flip),
        ).toMatchObject({ reason: "invalid" });
        const locked = { ...card, sync };
        yield* service.applySync({
          projectId,
          expectedRevision: 0,
          cards: [locked, { ...card, id: "other" }],
        });
        for (const cards of [
          [
            { ...locked, title: "Changed" },
            { ...card, id: "other" },
          ],
          [
            { ...locked, sync: { ...sync, readOnly: false } },
            { ...card, id: "other" },
          ],
          [{ ...card, id: "other" }, locked],
          [{ ...card, id: "other" }],
        ]) {
          expect(
            yield* service.save({ projectId, expectedRevision: 1, cards }).pipe(Effect.flip),
          ).toMatchObject({ reason: "invalid" });
        }
        const inserted = yield* service.save({
          projectId,
          expectedRevision: 1,
          cards: [{ ...card, id: "new" }, locked, { ...card, id: "other", title: "Writable" }],
        });
        expect(inserted.cards[1]?.sync).toEqual(sync);
        expect(
          yield* service.applySync({ projectId, expectedRevision: 1, cards: [] }).pipe(Effect.flip),
        ).toMatchObject({ reason: "conflict" });
        yield* service.applySync({
          projectId,
          expectedRevision: 2,
          cards: [{ ...card, title: "Unlocked" }],
        });
        expect(
          (yield* service.save({
            projectId,
            expectedRevision: 3,
            cards: [{ ...card, title: "Editable" }],
          })).cards[0]?.title,
        ).toBe("Editable");
      }).pipe(Effect.provide(layer)),
  );
  it.effect("preserves the board after a failed replacement and releases the save lock", () =>
    Effect.gen(function* () {
      const service = yield* RoadmapService.RoadmapService;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const config = yield* ServerConfig.ServerConfig;
      const projectId = ProjectId.make("write-failure");
      const original = yield* service.save({ projectId, expectedRevision: 0, cards: [card] });
      let failRename = true;
      const faulting = yield* RoadmapService.RoadmapService.pipe(
        Effect.provide(Layer.fresh(RoadmapService.layer)),
        Effect.provideService(FileSystem.FileSystem, {
          ...fs,
          rename: (from: string, to: string) =>
            failRename
              ? fs.rename(path.join(config.stateDir, "missing-file"), to)
              : fs.rename(from, to),
        }),
      );
      expect(
        yield* faulting.save({ projectId, expectedRevision: 1, cards: [] }).pipe(Effect.flip),
      ).toMatchObject({ reason: "storage" });
      expect(yield* service.read({ projectId })).toEqual(original);
      failRename = false;
      expect((yield* faulting.save({ projectId, expectedRevision: 1, cards: [] })).revision).toBe(
        2,
      );
    }).pipe(Effect.provide(layer)),
  );
  it.effect("reads linked archived and old settled threads without leaking other projects", () =>
    Effect.gen(function* () {
      const service = yield* RoadmapService.RoadmapService;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const projectId = ProjectId.make("roadmap-views");
      const at = "2025-01-01T00:00:00.000Z";
      for (const id of ["archived", "old", "foreign", "unlinked"]) {
        const threadId = ThreadId.make(id);
        const thread = v2PullRequestThread({
          id: threadId,
          projectId: id === "foreign" ? ProjectId.make("another") : projectId,
          title: id,
          modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: "feature/roadmap",
          worktreePath: null,
          pullRequests: [],
          latestUserMessageAt: null,
          createdAt: at,
          updatedAt: at,
          archivedAt: id === "archived" ? at : null,
          settledOverride: id === "old" ? "settled" : null,
          settledAt: id === "old" ? at : null,
        });
        yield* projections.apply({
          id: EventId.make(`created-${id}`),
          type: "thread.created",
          threadId,
          occurredAt: DateTime.makeUnsafe(at),
          payload: { ...thread, lastVisitedAt: null },
        });
      }
      yield* service.save({
        projectId,
        expectedRevision: 0,
        cards: ["archived", "old", "foreign"].map((id) => ({
          ...card,
          id,
          threadId: ThreadId.make(id),
        })),
      });
      const view = yield* service.readView({ projectId });
      expect(view.linkedThreads.map((thread) => thread.id).sort()).toEqual(["archived", "old"]);
      expect(view.linkedThreads.find((thread) => thread.id === "archived")?.archivedAt).toBe(at);
    }).pipe(
      Effect.provide(
        RoadmapService.layer.pipe(
          Layer.provideMerge(
            ProjectionStore.layer.pipe(Layer.provideMerge(SqlitePersistence.layerMemory)),
          ),
          Layer.provideMerge(
            ServerConfig.layerTest(process.cwd(), { prefix: "t3-roadmap-views-" }),
          ),
          Layer.provideMerge(NodeServices.layer),
        ),
      ),
    ),
  );
  it.effect("persists cards across service instances and isolates projects", () =>
    Effect.gen(function* () {
      const service = yield* RoadmapService.RoadmapService;
      const projectId = ProjectId.make("one");
      expect(yield* service.read({ projectId })).toEqual({ version: 1, revision: 0, cards: [] });
      yield* service.save({ projectId, expectedRevision: 0, cards: [card] });
      const detailed = yield* service.save({
        projectId,
        expectedRevision: 1,
        cards: [
          {
            ...card,
            specPath: "docs/roadmap/board.md",
            acceptanceCriteria: [
              { id: "criterion", text: "The board survives a restart", checked: true },
            ],
          },
        ],
      });
      expect(detailed.cards[0]).toMatchObject({
        specPath: "docs/roadmap/board.md",
        acceptanceCriteria: [
          { id: "criterion", text: "The board survives a restart", checked: true },
        ],
      });
      const fresh = yield* RoadmapService.RoadmapService.pipe(
        Effect.provide(Layer.fresh(RoadmapService.layer)),
      );
      expect(yield* fresh.read({ projectId })).toEqual(detailed);
      expect((yield* service.read({ projectId: ProjectId.make("two") })).cards).toEqual([]);
      const revised = yield* service.save({
        projectId,
        expectedRevision: 2,
        cards: [{ ...card, archived: true }],
      });
      expect(revised.cards[0]?.archived).toBe(true);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("rejects stale simultaneous saves without losing the winner", () =>
    Effect.gen(function* () {
      const service = yield* RoadmapService.RoadmapService;
      const projectId = ProjectId.make("concurrent");
      const outcomes = yield* Effect.all(
        [
          service.save({ projectId, expectedRevision: 0, cards: [card] }).pipe(Effect.result),
          service
            .save({ projectId, expectedRevision: 0, cards: [{ ...card, id: "second" }] })
            .pipe(Effect.result),
        ],
        { concurrency: "unbounded" },
      );
      expect(outcomes.filter((r) => r._tag === "Success")).toHaveLength(1);
      expect(outcomes.filter((r) => r._tag === "Failure")).toMatchObject([
        { failure: { reason: "conflict" } },
      ]);
      expect((yield* service.read({ projectId })).revision).toBe(1);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("rejects duplicate cards and preserves corrupt files for recovery", () =>
    Effect.gen(function* () {
      const service = yield* RoadmapService.RoadmapService;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const config = yield* ServerConfig.ServerConfig;
      const projectId = ProjectId.make("corrupt");
      expect(
        yield* service
          .save({ projectId, expectedRevision: 0, cards: [card, card] })
          .pipe(Effect.flip),
      ).toMatchObject({ reason: "invalid" });
      const criterion = { id: "criterion", text: "Works", checked: false };
      expect(
        yield* service
          .save({
            projectId,
            expectedRevision: 0,
            cards: [{ ...card, acceptanceCriteria: [criterion, criterion] }],
          })
          .pipe(Effect.flip),
      ).toMatchObject({ reason: "invalid" });
      yield* service.save({ projectId, expectedRevision: 0, cards: [card] });
      const file = path.join(config.stateDir, "extensions", "roadmap", "project-corrupt.json");
      yield* fs.writeFileString(file, "{broken");
      expect(yield* service.read({ projectId }).pipe(Effect.flip)).toMatchObject({
        reason: "invalid",
      });
      expect(
        yield* service.save({ projectId, expectedRevision: 1, cards: [] }).pipe(Effect.flip),
      ).toMatchObject({ reason: "invalid" });
      expect(yield* fs.readFileString(file)).toBe("{broken");
    }).pipe(Effect.provide(layer)),
  );
});
