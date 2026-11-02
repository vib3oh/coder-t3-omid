import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  EventId,
  ProjectId,
  ThreadId,
  ProviderInstanceId,
  type OrchestrationV2AppThread,
  type ThreadPullRequestLink,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ServerConfig from "../config.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ChangelogService from "./ChangelogService.ts";

const projectId = ProjectId.make("changelog-project");
const since = "2026-10-01T00:00:00Z";
const until = "2026-11-03T00:00:00Z";
const layer = ChangelogService.layer.pipe(
  Layer.provideMerge(ProjectionStore.layer),
  Layer.provideMerge(Sqlite.layerMemory),
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "changelog-" })),
  Layer.provide(NodeServices.layer),
);
const link = (
  number: number,
  overrides: Partial<ThreadPullRequestLink> = {},
): ThreadPullRequestLink => ({
  host: "github.com",
  repository: "example/app",
  number,
  url: `https://github.com/example/app/pull/${number}`,
  source: "manual",
  linkedAt: since,
  stack: null,
  snapshot: {
    state: "merged",
    title: `feat: change ${number}`,
    headBranch: "feature",
    baseBranch: "main",
    isDraft: false,
    updatedAt: since,
    syncedAt: since,
    mergedAt: "2026-11-02T12:00:00Z",
  },
  ...overrides,
});
const seed = Effect.fn("test.seedChangelog")(function* (
  name: string,
  pullRequests: readonly ThreadPullRequestLink[],
  overrides: Partial<OrchestrationV2AppThread> = {},
) {
  const store = yield* ProjectionStore.ProjectionStoreV2;
  const id = ThreadId.make(name);
  const at = DateTime.makeUnsafe(since);
  yield* store.apply({
    id: EventId.make(name),
    type: "thread.created",
    threadId: id,
    occurredAt: at,
    payload: {
      id,
      projectId,
      title: `Summary ${name}`,
      createdBy: "user",
      creationSource: "web",
      providerInstanceId: ProviderInstanceId.make("codex"),
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      activeProviderThreadId: null,
      lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: id },
      forkedFrom: null,
      createdAt: at,
      updatedAt: at,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      lastVisitedAt: null,
      deletedAt: null,
      pullRequests,
      ...overrides,
    },
  });
});

it.effect(
  "reads archived and settled merges once, scopes projects, and preserves undated omissions",
  () =>
    Effect.gen(function* () {
      const changelog = yield* ChangelogService.ChangelogService;
      const date = DateTime.makeUnsafe(since);
      yield* seed(
        "archived",
        [
          link(1),
          link(2, { source: "stack-dismissed" }),
          link(3, { snapshot: null }),
          link(4, { snapshot: { ...link(4).snapshot!, mergedAt: null } }),
        ],
        { archivedAt: date, settledAt: date },
      );
      yield* seed("duplicate", [link(1)]);
      yield* seed("other", [link(5)], { projectId: ProjectId.make("other") });
      yield* seed("deleted", [link(6)], { deletedAt: date });
      yield* seed("old", [
        link(7, { snapshot: { ...link(7).snapshot!, mergedAt: "2020-01-01T00:00:00Z" } }),
      ]);
      yield* seed("open", [link(8, { snapshot: { ...link(8).snapshot!, state: "open" } })]);
      const result = yield* changelog.read({ projectId, since, until });
      assert.deepEqual(
        result.entries.map((entry) => [entry.pullNumber, entry.type]),
        [[1, "feature"]],
      );
      assert.equal(result.entries[0]?.archived, true);
      assert.equal(result.undatedCount, 1);
      assert.equal(result.shareId, null);
    }).pipe(Effect.provide(layer)),
);

it.effect("publishes filtered escaped snapshots, updates the same link, and revokes it", () =>
  Effect.gen(function* () {
    const service = yield* ChangelogService.ChangelogService;
    yield* seed("private-summary", [
      link(1, { snapshot: { ...link(1).snapshot!, title: "fix: <script>bad</script>" } }),
      link(2),
    ]);
    const input = {
      projectId,
      title: "Example",
      since,
      until,
      type: "bug" as const,
      query: "",
      summaries: false,
      timeZone: "America/New_York",
      enabled: true,
    };
    const shared = yield* service.share(input);
    assert.isNotNull(shared.shareId);
    const html = (yield* service.publicPage(shared.shareId!))!;
    assert.include(html, "&lt;script&gt;");
    assert.notInclude(html, "Summary private-summary");
    assert.notInclude(html, "change 2");
    assert.notInclude(html, "private-summary");
    assert.deepEqual(yield* service.share({ ...input, summaries: true }), shared);
    assert.include((yield* service.publicPage(shared.shareId!))!, "Summary private-summary");
    assert.equal((yield* service.read({ projectId, since, until })).shareId, shared.shareId);
    yield* service.share({ ...input, enabled: false });
    assert.isNull(yield* service.publicPage(shared.shareId!));
    assert.isNull(yield* service.publicPage("../../settings.json"));
    const next = yield* service.share(input);
    assert.notEqual(next.shareId, shared.shareId);
  }).pipe(Effect.provide(layer)),
);
