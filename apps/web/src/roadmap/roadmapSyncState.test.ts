import { expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import {
  EnvironmentRegistry,
  EnvironmentSupervisor,
  AVAILABLE_CONNECTION_STATE,
} from "@t3tools/client-runtime/connection";
import type { RpcSession } from "@t3tools/client-runtime/rpc";
import {
  EnvironmentId,
  ProjectId,
  WS_METHODS,
  type RoadmapView,
  type RoadmapSyncStatus,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as Stream from "effect/Stream";
import { AtomRegistry } from "effect/reactivity";

const harness = vi.hoisted(() => ({
  environment: null as EnvironmentRegistry.EnvironmentRegistry["Service"] | null,
}));
vi.mock("../connection/runtime", async () => {
  const { Atom } = await import("effect/reactivity");
  const Layer = await import("effect/Layer");
  const Effect = await import("effect/Effect");
  const { EnvironmentRegistry } = await import("@t3tools/client-runtime/connection");
  return {
    connectionAtomRuntime: Atom.runtime(
      Layer.effect(
        EnvironmentRegistry.EnvironmentRegistry,
        Effect.sync(() => harness.environment!),
      ),
    ),
  };
});
vi.mock("@t3tools/client-runtime/state/session", async () => {
  const { Atom, AsyncResult } = await import("effect/reactivity");
  return {
    createEnvironmentSessionAtoms: () => ({
      sessionStateAtom: Atom.family(() =>
        Atom.make(
          AsyncResult.success({
            authenticated: true,
            scopes: ["orchestration:operate"],
            permissions: ["orchestration:operate"],
          }),
        ),
      ),
    }),
  };
});

import { roadmapRead } from "./roadmapState";
import { roadmapSyncRead, roadmapSyncRun } from "./roadmapSyncState";

it.effect("updates the mounted board and connection summary immediately after a sync command", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const environmentId = EnvironmentId.make("sync-test");
      const projectId = ProjectId.make("project");
      let board: RoadmapView = { board: { version: 1, revision: 0, cards: [] }, linkedThreads: [] };
      let status: RoadmapSyncStatus = {
        revision: 1,
        binding: {
          contextPath: "/fixture/context.json",
          backend: "fixture.invalid",
          projectId: "external",
          instanceId: "instance",
        },
        connection: "ready",
        lastSyncedAt: null,
        lastRunId: null,
        message: null,
        capabilities: {
          conditionalWrites: false,
          create: false,
          update: false,
          archive: false,
          rank: false,
        },
        rows: [],
        counts: { pulled: 0, pushed: 0, unchanged: 0, conflicts: 0, unsupported: 0, failed: 0 },
      };
      const supervisorState = yield* SubscriptionRef.make({
        ...AVAILABLE_CONNECTION_STATE,
        phase: "connected" as const,
        generation: 1,
      });
      const session = yield* SubscriptionRef.make(
        Option.some({
          client: {
            [WS_METHODS.roadmapRead]: () => Effect.sync(() => board),
            [WS_METHODS.roadmapSyncRead]: () => Effect.sync(() => status),
            [WS_METHODS.roadmapSyncRun]: () =>
              Effect.sync(() => {
                board = {
                  ...board,
                  board: {
                    ...board.board,
                    revision: 1,
                    cards: [
                      {
                        id: "imported",
                        title: "Imported idea",
                        summary: "",
                        type: "feature",
                        effort: "M",
                        lane: "backlog",
                        archived: false,
                        completed: false,
                        threadId: null,
                      },
                    ],
                  },
                };
                status = { ...status, revision: 2, counts: { ...status.counts, pulled: 1 } };
                return status;
              }),
          },
        } as unknown as RpcSession),
      );
      const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
        target: { environmentId },
        state: supervisorState,
        session,
      } as EnvironmentSupervisor.EnvironmentSupervisor["Service"]);
      const environment: Pick<
        EnvironmentRegistry.EnvironmentRegistry["Service"],
        "run" | "followStream" | "stateChanges"
      > = {
        run: (_id, effect) =>
          Effect.provideService(effect, EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
        followStream: (_id, stream) =>
          Stream.provideService(stream, EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
        stateChanges: () => SubscriptionRef.changes(supervisorState),
      };
      harness.environment =
        environment as unknown as EnvironmentRegistry.EnvironmentRegistry["Service"];
      const registry = AtomRegistry.make();
      yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()));
      const target = { environmentId, input: { projectId } };
      const boardAtom = roadmapRead(target);
      const statusAtom = roadmapSyncRead(target);
      registry.mount(boardAtom);
      registry.mount(statusAtom);
      expect(
        (yield* AtomRegistry.getResult(registry, boardAtom, { suspendOnWaiting: true })).board
          .cards,
      ).toHaveLength(0);
      expect(
        (yield* AtomRegistry.getResult(registry, statusAtom, { suspendOnWaiting: true })).counts
          .pulled,
      ).toBe(0);
      expect(
        (yield* Effect.promise(() =>
          roadmapSyncRun.run(registry, {
            environmentId,
            input: { projectId, expectedRevision: 1 },
          }),
        ))._tag,
      ).toBe("Success");
      expect(
        (yield* AtomRegistry.getResult(registry, boardAtom, { suspendOnWaiting: true })).board
          .cards[0]?.title,
      ).toBe("Imported idea");
      expect(
        (yield* AtomRegistry.getResult(registry, statusAtom, { suspendOnWaiting: true })).counts
          .pulled,
      ).toBe(1);
    }),
  ),
);
