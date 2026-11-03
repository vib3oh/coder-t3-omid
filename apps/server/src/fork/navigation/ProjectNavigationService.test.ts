import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  AgentWorkflowError,
  ProjectId,
  RoadmapError,
  ThreadId,
  ProviderInstanceId,
  type RoadmapBoard,
  ProjectNavigationReadResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as RoadmapService from "../../roadmap/RoadmapService.ts";
import * as GitVcsDriver from "../../vcs/GitVcsDriver.ts";
import * as AgentWorkflowStore from "../agents/AgentWorkflowStore.ts";
import { defaultAgentRoles } from "../agents/WorkflowRules.ts";
import { v2PullRequestThread } from "../../orchestration-v2/testkit/pullRequestFixtures.ts";
import * as Navigation from "./ProjectNavigationService.ts";

const projectId = ProjectId.make("project");
const at = "2026-11-03T10:00:00Z";
const encodeNavigation = Schema.encodeEffect(Schema.fromJsonString(ProjectNavigationReadResult));

describe("ProjectNavigationService", () => {
  it.effect(
    "paginates metadata, reveals older work and rejects stale or cross-project cursors",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "navigation-test-" });
        const threads = Array.from({ length: 500 }, (_, i) =>
          v2PullRequestThread({
            id: ThreadId.make(`thread-${i}`),
            projectId,
            title: `Thread ${i}`,
            modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: `branch-${i}`,
            worktreePath: `${root}/worktree-${Math.floor(i / 10)}`,
            pullRequests: [],
            latestUserMessageAt: null,
            createdAt: at,
            updatedAt: at,
            archivedAt: i === 499 ? at : null,
            settledOverride: i === 498 ? "settled" : null,
            settledAt: i === 498 ? at : null,
          }),
        );
        let board: RoadmapBoard = { version: 1, revision: 0, cards: [] };
        let launchDuringRead = false;
        let ownerReads = 0;
        let snapshotReads = 0;
        const service = yield* Navigation.ProjectNavigationService.pipe(
          Effect.provide(
            Navigation.layer.pipe(
              Layer.provide(
                Layer.mock(ProjectStore.ProjectStoreV2)({
                  getShell: (id) =>
                    Effect.succeed(
                      id === projectId
                        ? Option.some({
                            id: projectId,
                            title: "Project",
                            workspaceRoot: root,
                            defaultModelSelection: null,
                            scripts: [],
                            createdAt: at,
                            updatedAt: at,
                          })
                        : Option.none(),
                    ),
                }),
              ),
              Layer.provide(
                Layer.mock(ProjectionStore.ProjectionStoreV2)({
                  getShellSnapshot: () =>
                    Effect.sync(() => {
                      const beforeLaunch = launchDuringRead && snapshotReads++ === 0;
                      return {
                        schemaVersion: 1,
                        snapshotSequence: 0,
                        threads: beforeLaunch ? [] : threads.slice(0, -1),
                        archivedThreads: beforeLaunch ? [] : [threads[499]!],
                      };
                    }),
                }),
              ),
              Layer.provide(
                Layer.mock(RoadmapService.RoadmapService)({
                  read: () =>
                    Effect.sync(() =>
                      launchDuringRead
                        ? { ...board, revision: board.revision + Number(++ownerReads > 1) }
                        : board,
                    ),
                }),
              ),
              Layer.provide(
                Layer.mock(AgentWorkflowStore.AgentWorkflowStore)({
                  read: () =>
                    Effect.succeed({
                      version: 1,
                      revision: 0,
                      enabled: true,
                      roles: defaultAgentRoles(),
                      workflows: [],
                    }),
                }),
              ),
              Layer.provide(Layer.mock(GitVcsDriver.GitVcsDriver)({})),
            ),
          ),
        );
        const first = yield* service.read({ projectId, limit: 2 });
        expect(first.totalWorktrees).toBe(51);
        expect(first.worktrees.map((row) => row.isMain)).toEqual([true, false]);
        expect(first.nextCursor).not.toBeNull();
        const populated = yield* service.read({ projectId });
        const encoded = yield* encodeNavigation(populated);
        expect(encoded.length).toBeLessThan(128 * 1024);
        expect(populated.worktrees.every((row) => row.threads.length <= 3)).toBe(true);
        const next = yield* service.read({ projectId, limit: 2, cursor: first.nextCursor! });
        expect(next.worktrees[0]?.key).not.toBe(first.worktrees[1]?.key);
        const revealed = yield* service.read({
          projectId,
          limit: 2,
          revealThreadId: threads[499]!.id,
        });
        expect(revealed.worktrees[1]?.threads[0]?.id).toBe(threads[499]!.id);
        expect(revealed.worktrees[1]?.availability).toBe("missing");
        expect(
          (yield* service
            .read({ projectId: ProjectId.make("other"), cursor: first.nextCursor! })
            .pipe(Effect.flip)).reason,
        ).toBe("not_found");
        board = { ...board, revision: 1 };
        expect(
          (yield* service.read({ projectId, cursor: first.nextCursor! }).pipe(Effect.flip)).reason,
        ).toBe("stale_cursor");
        expect(
          (yield* service.read({ projectId, cursor: "not-json" }).pipe(Effect.flip)).reason,
        ).toBe("stale_cursor");
        launchDuringRead = true;
        const raced = yield* service.read({ projectId });
        expect(raced.complete).toBe(true);
        expect(raced.totalWorktrees).toBe(51);
        expect(
          raced.worktrees.some((row) => row.threads.some((thread) => thread.id === threads[0]!.id)),
        ).toBe(true);
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "reports failed enrichment as partial while preserving native work and exact counts across thread pages",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "navigation-partial-" });
        const threads = Array.from({ length: 55 }, (_, i) => ({
          ...v2PullRequestThread({
            id: ThreadId.make(`thread-${i}`),
            projectId,
            title: `Thread ${i}`,
            modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            pullRequests: [],
            latestUserMessageAt: null,
            createdAt: at,
            updatedAt: at,
            archivedAt: null,
            settledOverride: null,
            settledAt: null,
          }),
          hasActionableProposedPlan: i === 54,
        }));
        const service = yield* Navigation.ProjectNavigationService.pipe(
          Effect.provide(
            Navigation.layer.pipe(
              Layer.provide(
                Layer.mock(ProjectStore.ProjectStoreV2)({
                  getShell: () =>
                    Effect.succeedSome({
                      id: projectId,
                      title: "Project",
                      workspaceRoot: root,
                      defaultModelSelection: null,
                      scripts: [],
                      createdAt: at,
                      updatedAt: at,
                    }),
                }),
              ),
              Layer.provide(
                Layer.mock(ProjectionStore.ProjectionStoreV2)({
                  getShellSnapshot: () =>
                    Effect.succeed({
                      schemaVersion: 1,
                      snapshotSequence: 0,
                      threads,
                      archivedThreads: [],
                    }),
                }),
              ),
              Layer.provide(
                Layer.mock(RoadmapService.RoadmapService)({
                  read: () => Effect.fail(new RoadmapError({ reason: "storage" })),
                }),
              ),
              Layer.provide(
                Layer.mock(AgentWorkflowStore.AgentWorkflowStore)({
                  read: () => Effect.fail(new AgentWorkflowError({ reason: "storage" })),
                }),
              ),
              Layer.provide(Layer.mock(GitVcsDriver.GitVcsDriver)({})),
            ),
          ),
        );
        const result = yield* service.read({ projectId });
        expect(result.complete).toBe(false);
        expect(result.sources).toMatchObject({
          threads: "available",
          roadmap: "unavailable",
          workflows: "unavailable",
        });
        expect(result.attentionCount).toBe(1);
        expect(result.worktrees[0]).toMatchObject({
          threadCount: 55,
          threadNextOffset: 3,
          attentionCount: 1,
        });
        const expanded = yield* service.read({ projectId, worktreeKey: "main" });
        expect(expanded.worktrees[0]?.threads).toHaveLength(50);
        expect(expanded.worktrees[0]?.threadNextOffset).toBe(50);
        const last = yield* service.read({ projectId, worktreeKey: "main", threadOffset: 50 });
        expect(last.worktrees[0]?.threads).toHaveLength(5);
        expect(last.worktrees[0]?.threadNextOffset).toBeNull();
      }).pipe(Effect.provide(NodeServices.layer)),
  );
});
