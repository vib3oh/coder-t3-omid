import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  ProjectId,
  RoadmapSyncError,
  RoadmapSyncDetail,
  type RoadmapCard,
  type RoadmapSyncCapabilities,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as ServerConfig from "../../config.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as RoadmapService from "../RoadmapService.ts";
import * as HyperCoderRoadmap from "./HyperCoderRoadmap.ts";
import * as RoadmapSyncService from "./RoadmapSyncService.ts";
import { snapshot } from "./reconcile.ts";

const projectId = ProjectId.make("sync-fixture");
const encodeDetail = Schema.encodeEffect(RoadmapSyncDetail);
const binding = {
  contextPath: "/fixture/context.json",
  backend: "fixture.invalid",
  projectId: "hc-project",
  instanceId: "hc-instance",
};
const card: RoadmapCard = {
  id: "local",
  title: "Plan",
  summary: "Original",
  type: "feature",
  effort: "M",
  lane: "backlog",
  archived: false,
  completed: false,
  threadId: null,
};
const capabilities: RoadmapSyncCapabilities = {
  conditionalWrites: true,
  create: true,
  update: true,
  archive: true,
  rank: true,
};

function fake() {
  let revision = 1;
  let cards: HyperCoderRoadmap.RemoteCard[] = [];
  let available = true;
  let failAfterWrite = false;
  let writes = 0;
  let conditional = true;
  const receipts = new Map<string, HyperCoderRoadmap.RemoteWriteReceipt>();
  let beforeApply: Effect.Effect<void> = Effect.void;
  const service = HyperCoderRoadmap.HyperCoderRoadmap.of({
    read: (input) =>
      Effect.sync(() => {
        expect(input.workspaceRoot).toBe("/fixture/repository");
        return {
          revision: conditional ? String(revision) : null,
          capabilities: conditional ? capabilities : { ...capabilities, conditionalWrites: false },
          cards: [...cards],
        };
      }).pipe(
        Effect.filterOrFail(
          () => available,
          () => new RoadmapSyncError({ reason: "unavailable" }),
        ),
      ),
    apply: (input) =>
      Effect.gen(function* () {
        const prior = receipts.get(input.operation.idempotencyKey);
        if (prior) return prior;
        yield* beforeApply;
        beforeApply = Effect.void;
        if (input.expectedRevision !== String(revision))
          return yield* new RoadmapSyncError({ reason: "conflict" });
        writes++;
        const operation = input.operation;
        const id = operation.externalId ?? `remote-${writes}`;
        const next = {
          id,
          fields: operation.fields,
          rank: operation.rank,
          column: null,
          issues: [],
        };
        cards = [...cards.filter((card) => card.id !== id), next];
        revision++;
        const receipt = {
          externalId: id,
          revision: String(revision),
          fields: operation.fields,
          rank: operation.rank,
        };
        receipts.set(operation.idempotencyKey, receipt);
        if (failAfterWrite) {
          failAfterWrite = false;
          return yield* new RoadmapSyncError({ reason: "unavailable" });
        }
        return receipt;
      }),
  });
  return {
    service,
    setCards: (value: HyperCoderRoadmap.RemoteCard[]) => {
      cards = value;
      revision++;
    },
    getCards: () => cards,
    writes: () => writes,
    unavailable: (value: boolean) => {
      available = !value;
    },
    loseNextReceipt: () => {
      failAfterWrite = true;
    },
    readOnly: () => {
      conditional = false;
    },
    beforeApply: (effect: Effect.Effect<void>) => {
      beforeApply = effect;
    },
  };
}
const testLayer = (port: HyperCoderRoadmap.HyperCoderRoadmap["Service"]) =>
  RoadmapSyncService.layer.pipe(
    Layer.provideMerge(RoadmapService.layer),
    Layer.provideMerge(Layer.succeed(HyperCoderRoadmap.HyperCoderRoadmap, port)),
    Layer.provideMerge(
      Layer.mock(ProjectStore.ProjectStoreV2)({
        get: () =>
          Effect.succeedSome({
            projectId,
            title: "Fixture",
            workspaceRoot: "/fixture/repository",
            defaultModelSelection: null,
            defaultThreadEnvMode: null,
            autoPull: false,
            faviconPath: null,
            projectIcon: null,
            scripts: [],
            pinnedAt: null,
            archivedAt: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            deletedAt: null,
          }),
      }),
    ),
    Layer.provideMerge(Layer.mock(ProjectionStore.ProjectionStoreV2)({})),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-roadmap-sync-" })),
    Layer.provideMerge(NodeServices.layer),
  );
const remoteCard = (
  id = "external",
  overrides: Partial<HyperCoderRoadmap.RemoteCard> = {},
): HyperCoderRoadmap.RemoteCard => ({
  id,
  ...snapshot(card, 0),
  column: null,
  issues: [],
  ...overrides,
});

describe("RoadmapSyncService", () => {
  it.effect(
    "imports stable ids, merges independent fields and criteria, resolves conflicts and disconnects retained cards",
    () => {
      const port = fake();
      port.setCards([
        remoteCard("external", {
          fields: {
            ...snapshot(card, 0).fields,
            acceptanceCriteria: [{ id: "criterion", text: "Original text", checked: false }],
          },
        }),
      ]);
      return Effect.gen(function* () {
        const sync = yield* RoadmapSyncService.RoadmapSyncService;
        const roadmap = yield* RoadmapService.RoadmapService;
        expect((yield* sync.read({ projectId })).connection).toBe("disconnected");
        yield* sync.connect({ projectId, expectedRevision: 0, binding });
        const imported = yield* sync.run({ projectId, expectedRevision: 1 });
        expect(imported.counts.pulled).toBe(1);
        let board = yield* roadmap.read({ projectId });
        const id = board.cards[0]!.id;
        expect(board.cards[0]?.sync?.externalId).toBe("external");
        yield* roadmap.save({
          projectId,
          expectedRevision: board.revision,
          cards: board.cards.map((card) => ({
            ...card,
            summary: "Local summary",
            acceptanceCriteria: [{ id: "criterion", text: "Original text", checked: true }],
          })),
        });
        const external = port.getCards()[0]!;
        port.setCards([
          {
            ...external,
            fields: {
              ...external.fields,
              title: "Remote title",
              acceptanceCriteria: [{ id: "criterion", text: "Remote text", checked: false }],
            },
          },
        ]);
        const merged = yield* sync.run({ projectId, expectedRevision: imported.revision });
        expect(merged.counts.pushed).toBe(1);
        board = yield* roadmap.read({ projectId });
        expect(board.cards[0]).toMatchObject({
          id,
          title: "Remote title",
          summary: "Local summary",
          acceptanceCriteria: [{ id: "criterion", text: "Remote text", checked: true }],
          sync: { readOnly: false },
        });
        yield* roadmap.save({
          projectId,
          expectedRevision: board.revision,
          cards: board.cards.map((card) => ({
            ...card,
            title: "Local collision",
            summary: "Independent local edit",
          })),
        });
        port.setCards(
          port.getCards().map((card) => ({
            ...card,
            fields: { ...card.fields, title: "Remote collision", effort: "L" },
          })),
        );
        const conflict = yield* sync.run({ projectId, expectedRevision: merged.revision });
        expect(conflict.rows[0]).toMatchObject({
          status: "conflict",
          conflictingFields: ["title"],
        });
        expect((yield* sync.detail({ projectId, cardId: id })).baseline?.title).toBe(
          "Remote title",
        );
        expect((yield* roadmap.read({ projectId })).cards[0]?.title).toBe("Local collision");
        const resolved = yield* sync.resolve({
          projectId,
          expectedRevision: conflict.revision,
          cardId: id,
          choice: "remote",
        });
        expect((yield* roadmap.read({ projectId })).cards[0]).toMatchObject({
          title: "Remote collision",
          summary: "Independent local edit",
          effort: "L",
          sync: { readOnly: false },
        });
        const fresh = yield* RoadmapSyncService.RoadmapSyncService.pipe(
          Effect.provide(Layer.fresh(RoadmapSyncService.layer)),
        );
        expect((yield* fresh.read({ projectId })).revision).toBe(resolved.revision);
        expect(
          (yield* fresh.run({ projectId, expectedRevision: resolved.revision })).counts.unchanged,
        ).toBe(1);
        const latest = yield* sync.read({ projectId });
        yield* sync.disconnect({ projectId, expectedRevision: latest.revision });
        expect((yield* roadmap.read({ projectId })).cards[0]).toMatchObject({
          id,
          title: "Remote collision",
        });
        expect((yield* roadmap.read({ projectId })).cards[0]?.sync).toBeUndefined();
      }).pipe(Effect.provide(testLayer(port.service)));
    },
  );

  it.effect(
    "keeps local drafts and last good data when conditional writes or the connection are unavailable",
    () => {
      const port = fake();
      port.readOnly();
      port.setCards([remoteCard("external", { column: "building" })]);
      return Effect.gen(function* () {
        const sync = yield* RoadmapSyncService.RoadmapSyncService;
        const roadmap = yield* RoadmapService.RoadmapService;
        yield* roadmap.save({ projectId, expectedRevision: 0, cards: [card] });
        yield* sync.connect({ projectId, expectedRevision: 0, binding });
        const status = yield* sync.run({ projectId, expectedRevision: 1 });
        expect(status.counts.unsupported).toBe(2);
        const board = yield* roadmap.read({ projectId });
        expect(board.cards.find((card) => card.id === "local")).toMatchObject({
          title: "Plan",
          sync: { readOnly: true },
        });
        expect(
          board.cards.find((card) => card.sync?.externalId === "external")?.sync?.remoteColumn,
        ).toBe("building");
        port.unavailable(true);
        const failed = yield* sync.run({ projectId, expectedRevision: status.revision });
        expect(failed.connection).toBe("unavailable");
        expect(yield* roadmap.read({ projectId })).toEqual(board);
        expect(port.writes()).toBe(0);
        expect(
          yield* sync.run({ projectId, expectedRevision: status.revision }).pipe(Effect.flip),
        ).toMatchObject({ reason: "conflict" });
        port.unavailable(false);
        port.setCards([remoteCard()]);
        const planning = yield* sync.run({ projectId, expectedRevision: failed.revision });
        const planningBoard = yield* roadmap.read({ projectId });
        const importedId = planningBoard.cards.find(
          (card) => card.sync?.externalId === "external",
        )!.id;
        yield* roadmap.save({
          projectId,
          expectedRevision: planningBoard.revision,
          cards: planningBoard.cards.map((card) =>
            card.id === importedId ? { ...card, summary: "Outgoing draft" } : card,
          ),
        });
        const unsupported = yield* sync.run({ projectId, expectedRevision: planning.revision });
        expect(unsupported.rows.find((row) => row.cardId === importedId)?.status).toBe(
          "unsupported",
        );
        const adopted = yield* sync.resolve({
          projectId,
          expectedRevision: unsupported.revision,
          cardId: importedId,
          choice: "remote",
        });
        expect(adopted.rows.find((row) => row.cardId === importedId)?.status).toBe("pulled");
        expect(
          (yield* roadmap.read({ projectId })).cards.find((card) => card.id === importedId),
        ).toMatchObject({ summary: "Original", sync: { readOnly: false } });
        expect(port.writes()).toBe(0);
      }).pipe(Effect.provide(testLayer(port.service)));
    },
  );

  it.effect(
    "retains uncertain create receipts across restarts without resending and recovers an uncertain update from a fresh read",
    () => {
      const port = fake();
      return Effect.gen(function* () {
        const sync = yield* RoadmapSyncService.RoadmapSyncService;
        const roadmap = yield* RoadmapService.RoadmapService;
        yield* roadmap.save({ projectId, expectedRevision: 0, cards: [card] });
        yield* sync.connect({ projectId, expectedRevision: 0, binding });
        port.loseNextReceipt();
        const uncertain = yield* sync.run({ projectId, expectedRevision: 1 });
        expect(uncertain.rows[0]?.status).toBe("failed");
        expect(port.writes()).toBe(1);
        const fresh = yield* RoadmapSyncService.RoadmapSyncService.pipe(
          Effect.provide(Layer.fresh(RoadmapSyncService.layer)),
        );
        const next = yield* fresh.run({ projectId, expectedRevision: uncertain.revision });
        expect(next.rows.find((row) => row.cardId === "local")?.status).toBe("failed");
        expect(port.writes()).toBe(1);
        expect(port.getCards()).toHaveLength(1);
        yield* sync.disconnect({ projectId, expectedRevision: next.revision });
        yield* roadmap.applySync({
          projectId,
          expectedRevision: (yield* roadmap.read({ projectId })).revision,
          cards: [],
        });
        const connected = yield* sync.connect({
          projectId,
          expectedRevision: next.revision + 1,
          binding,
        });
        const imported = yield* sync.run({ projectId, expectedRevision: connected.revision });
        const board = yield* roadmap.read({ projectId });
        yield* roadmap.save({
          projectId,
          expectedRevision: board.revision,
          cards: board.cards.map((card) => ({ ...card, summary: "Retry update" })),
        });
        port.loseNextReceipt();
        const failedUpdate = yield* sync.run({ projectId, expectedRevision: imported.revision });
        expect(failedUpdate.rows[0]?.status).toBe("failed");
        const confirmed = yield* fresh.run({ projectId, expectedRevision: failedUpdate.revision });
        expect(confirmed.rows[0]?.status).toBe("unchanged");
        expect(port.writes()).toBe(2);
        expect((yield* roadmap.read({ projectId })).cards[0]?.sync?.readOnly).toBe(false);
      }).pipe(Effect.provide(testLayer(port.service)));
    },
  );

  it.effect(
    "keeps remote receipts when native CAS loses to a draft and reports missing remote cards without deleting",
    () => {
      const port = fake();
      return Effect.gen(function* () {
        const sync = yield* RoadmapSyncService.RoadmapSyncService;
        const roadmap = yield* RoadmapService.RoadmapService;
        yield* roadmap.save({ projectId, expectedRevision: 0, cards: [card] });
        yield* sync.connect({ projectId, expectedRevision: 0, binding });
        port.beforeApply(
          roadmap
            .save({
              projectId,
              expectedRevision: 1,
              cards: [{ ...card, summary: "Concurrent draft" }],
            })
            .pipe(Effect.asVoid, Effect.orDie),
        );
        const stale = yield* sync.run({ projectId, expectedRevision: 1 });
        expect(stale.connection).toBe("blocked");
        expect((yield* roadmap.read({ projectId })).cards[0]?.summary).toBe("Concurrent draft");
        const recovered = yield* sync.run({ projectId, expectedRevision: stale.revision });
        expect(recovered.counts.pushed).toBe(1);
        expect(port.getCards()).toHaveLength(1);
        expect(port.getCards()[0]?.fields.summary).toBe("Concurrent draft");
        port.setCards([...port.getCards(), remoteCard("second", { rank: 1 })]);
        const expanded = yield* sync.run({ projectId, expectedRevision: recovered.revision });
        port.readOnly();
        port.setCards([remoteCard("second")]);
        const missing = yield* sync.run({ projectId, expectedRevision: expanded.revision });
        expect(missing.counts.conflicts).toBe(1);
        expect((yield* roadmap.read({ projectId })).cards).toHaveLength(2);
        const repeated = yield* sync.run({ projectId, expectedRevision: missing.revision });
        expect(repeated.counts.unchanged).toBe(1);
        expect(repeated.counts.conflicts).toBe(1);
        expect(repeated.counts.unsupported).toBe(0);
        const missingDetail = yield* sync.detail({ projectId, cardId: "local" });
        expect(missingDetail.localRank).toBeNull();
        yield* encodeDetail(missingDetail);
      }).pipe(Effect.provide(testLayer(port.service)));
    },
  );

  it.effect("keeps source insertions ordered beside retained read-only cards", () => {
    const port = fake();
    port.readOnly();
    port.setCards([remoteCard("locked", { column: "done" }), remoteCard("second", { rank: 1 })]);
    return Effect.gen(function* () {
      const sync = yield* RoadmapSyncService.RoadmapSyncService;
      const roadmap = yield* RoadmapService.RoadmapService;
      yield* sync.connect({ projectId, expectedRevision: 0, binding });
      let status = yield* sync.run({ projectId, expectedRevision: 1 });
      for (const ids of [
        ["inserted", "locked", "second"],
        ["newest", "inserted", "locked", "second"],
        ["newest", "inserted", "second", "locked"],
      ]) {
        port.setCards(
          ids.map((id, rank) => remoteCard(id, { rank, column: id === "locked" ? "done" : null })),
        );
        status = yield* sync.run({ projectId, expectedRevision: status.revision });
        status = yield* sync.run({ projectId, expectedRevision: status.revision });
        expect(
          (yield* roadmap.read({ projectId })).cards.map((card) => card.sync?.externalId),
        ).toEqual(ids);
        for (const id of ids.filter((id) => id !== "locked"))
          expect(status.rows.find((row) => row.externalId === id)?.status).toBe("unchanged");
      }
      expect(port.writes()).toBe(0);
    }).pipe(Effect.provide(testLayer(port.service)));
  });

  it.effect(
    "reinserts a resolved card at its source position without an outgoing rank write",
    () => {
      const port = fake();
      port.readOnly();
      port.setCards([remoteCard("first"), remoteCard("second", { rank: 1 })]);
      return Effect.gen(function* () {
        const sync = yield* RoadmapSyncService.RoadmapSyncService;
        const roadmap = yield* RoadmapService.RoadmapService;
        yield* sync.connect({ projectId, expectedRevision: 0, binding });
        let status = yield* sync.run({ projectId, expectedRevision: 1 });
        const board = yield* roadmap.read({ projectId });
        yield* roadmap.save({
          projectId,
          expectedRevision: board.revision,
          cards: [...board.cards].reverse(),
        });
        status = yield* sync.run({ projectId, expectedRevision: status.revision });
        status = yield* sync.resolve({
          projectId,
          expectedRevision: status.revision,
          cardId: board.cards[0]!.id,
          choice: "remote",
        });
        status = yield* sync.run({ projectId, expectedRevision: status.revision });
        expect(
          (yield* roadmap.read({ projectId })).cards.map((card) => card.sync?.externalId),
        ).toEqual(["first", "second"]);
        expect(status.counts.unchanged).toBe(2);
        expect(port.writes()).toBe(0);
      }).pipe(Effect.provide(testLayer(port.service)));
    },
  );

  it.effect("retains an order conflict without turning incoming cards into outgoing edits", () => {
    const port = fake();
    port.readOnly();
    port.setCards([remoteCard("a"), remoteCard("b", { rank: 1 }), remoteCard("c", { rank: 2 })]);
    return Effect.gen(function* () {
      const sync = yield* RoadmapSyncService.RoadmapSyncService;
      const roadmap = yield* RoadmapService.RoadmapService;
      yield* sync.connect({ projectId, expectedRevision: 0, binding });
      let status = yield* sync.run({ projectId, expectedRevision: 1 });
      const board = yield* roadmap.read({ projectId });
      yield* roadmap.save({
        projectId,
        expectedRevision: board.revision,
        cards: [board.cards[1]!, board.cards[0]!, board.cards[2]!],
      });
      port.setCards(["x", "a", "b", "c"].map((id, rank) => remoteCard(id, { rank })));
      status = yield* sync.run({ projectId, expectedRevision: status.revision });
      status = yield* sync.run({ projectId, expectedRevision: status.revision });
      for (const id of ["x", "a", "c"])
        expect(status.rows.find((row) => row.externalId === id)?.status).toBe("unchanged");
      expect(status.rows.find((row) => row.externalId === "b")?.status).toBe("conflict");
      status = yield* sync.resolve({
        projectId,
        expectedRevision: status.revision,
        cardId: board.cards[1]!.id,
        choice: "remote",
      });
      status = yield* sync.run({ projectId, expectedRevision: status.revision });
      expect(
        (yield* roadmap.read({ projectId })).cards.map((card) => card.sync?.externalId),
      ).toEqual(["x", "a", "b", "c"]);
      expect(status.counts.unchanged).toBe(4);
      expect(port.writes()).toBe(0);
    }).pipe(Effect.provide(testLayer(port.service)));
  });

  it.effect("preserves corrupt private state and does not overwrite it", () => {
    const port = fake();
    return Effect.gen(function* () {
      const sync = yield* RoadmapSyncService.RoadmapSyncService;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const config = yield* ServerConfig.ServerConfig;
      yield* sync.connect({ projectId, expectedRevision: 0, binding });
      const file = path.join(
        config.stateDir,
        "extensions",
        "roadmap-sync",
        "project-sync-fixture.json",
      );
      yield* fs.writeFileString(file, "{broken");
      expect(yield* sync.read({ projectId }).pipe(Effect.flip)).toMatchObject({
        reason: "invalid",
      });
      expect(
        yield* sync.connect({ projectId, expectedRevision: 1, binding }).pipe(Effect.flip),
      ).toMatchObject({ reason: "invalid" });
      expect(yield* fs.readFileString(file)).toBe("{broken");
    }).pipe(Effect.provide(testLayer(port.service)));
  });

  it.effect(
    "recovers stable incoming ids when the final private-state replacement fails after the native commit",
    () => {
      const port = fake();
      port.readOnly();
      port.setCards([remoteCard("a"), remoteCard("b", { rank: 1 }), remoteCard("c", { rank: 2 })]);
      return Effect.gen(function* () {
        const sync = yield* RoadmapSyncService.RoadmapSyncService;
        const roadmap = yield* RoadmapService.RoadmapService;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const config = yield* ServerConfig.ServerConfig;
        yield* sync.connect({ projectId, expectedRevision: 0, binding });
        const imported = yield* sync.run({ projectId, expectedRevision: 1 });
        const original = yield* roadmap.read({ projectId });
        yield* roadmap.save({
          projectId,
          expectedRevision: original.revision,
          cards: [original.cards[1]!, original.cards[0]!, original.cards[2]!],
        });
        port.setCards(
          ["x", "a", "b", "c"].map((id, rank) =>
            remoteCard(id, {
              rank,
              ...(id === "a"
                ? { fields: { ...snapshot(card, 0).fields, summary: "Source update" } }
                : {}),
            }),
          ),
        );
        let replacements = 0;
        const faulting = yield* RoadmapSyncService.RoadmapSyncService.pipe(
          Effect.provide(Layer.fresh(RoadmapSyncService.layer)),
          Effect.provideService(FileSystem.FileSystem, {
            ...fs,
            rename: (from, to) => {
              replacements++;
              return replacements === 3
                ? fs.rename(path.join(config.stateDir, "missing-file"), to)
                : fs.rename(from, to);
            },
          }),
        );
        expect(
          yield* faulting.run({ projectId, expectedRevision: imported.revision }).pipe(Effect.flip),
        ).toMatchObject({ reason: "storage" });
        const first = yield* roadmap.read({ projectId });
        expect(first.cards).toHaveLength(4);
        expect(first).not.toHaveProperty("syncCommitId");
        const receipt = yield* roadmap.readSyncCommit({ projectId });
        expect(receipt).not.toBeNull();
        yield* roadmap.save({
          projectId,
          expectedRevision: first.revision,
          cards: first.cards.map((card) =>
            card.sync?.externalId === "a" ? { ...card, summary: "New local draft" } : card,
          ),
        });
        expect(yield* roadmap.readSyncCommit({ projectId })).toBe(receipt);
        const current = yield* sync.read({ projectId });
        const recovered = yield* sync.run({ projectId, expectedRevision: current.revision });
        for (const id of ["x", "c"])
          expect(recovered.rows.find((row) => row.externalId === id)?.status).toBe("unchanged");
        expect(recovered.rows.find((row) => row.externalId === "b")?.status).toBe("conflict");
        expect(recovered.rows.find((row) => row.externalId === "a")?.status).toBe("unsupported");
        expect(
          (yield* roadmap.read({ projectId })).cards.find((card) => card.sync?.externalId === "a")
            ?.summary,
        ).toBe("New local draft");
        expect((yield* roadmap.read({ projectId })).cards.map((card) => card.id)).toEqual(
          first.cards.map((card) => card.id),
        );
        expect(port.writes()).toBe(0);
      }).pipe(Effect.provide(testLayer(port.service)));
    },
  );
});
