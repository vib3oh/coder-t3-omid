import { assert, describe, it } from "@effect/vitest";
import { RoadmapSyncError, type RoadmapSyncBinding } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as ByteSize from "effect/ByteSize";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as ProcessRunner from "../../processRunner.ts";
import * as HyperCoderRoadmap from "./HyperCoderRoadmap.ts";

const binding: RoadmapSyncBinding = {
  contextPath: "/selected/context.json",
  backend: "example.convex.cloud",
  projectId: "remote-project",
  instanceId: "selected-instance",
};
const identity = {
  convexUrl: "https://example.convex.cloud",
  projectId: binding.projectId,
  instanceId: binding.instanceId,
  directory: "/hc-project",
};
const diagnostics = {
  source: binding.contextPath,
  backend: binding.backend,
  projectId: binding.projectId,
  instanceId: binding.instanceId,
};
const row = {
  id: "stable-remote-id",
  slug: "plan-a",
  title: "Plan A",
  summary: "The brief",
  column: "upNext",
  lane: "upNext",
  order: 1.5,
  type: "feature",
  effort: "M",
  specPath: "docs/plan-a.md",
};
const secret = "credential-bytes-must-not-escape";
const output = (stdout: string): ProcessRunner.ProcessRunOutput => ({
  stdout,
  stderr: "",
  code: ChildProcessSpawner.ExitCode(0),
  timedOut: false,
  stdoutTruncated: false,
  stderrTruncated: false,
  stdoutInvalidUtf8: false,
  stderrInvalidUtf8: false,
});
const fileInfo: FileSystem.File.Info = {
  type: "File",
  mtime: Option.none(),
  atime: Option.none(),
  birthtime: Option.none(),
  dev: 0n,
  ino: Option.none(),
  mode: 0o600,
  nlink: Option.none(),
  uid: Option.none(),
  gid: Option.none(),
  rdev: Option.none(),
  size: ByteSize.bytes(1_000),
  blksize: Option.none(),
  blocks: Option.none(),
};

function fixture(
  options: {
    readonly context?: string;
    readonly diagnosticOutput?: string;
    readonly boardOutput?: string;
    readonly nativeOutput?: Partial<ProcessRunner.ProcessRunOutput>;
    readonly spawnFailure?: boolean;
    readonly origins?: readonly [string, string];
    readonly size?: number;
  } = {},
) {
  const calls: ProcessRunner.ProcessRunInput[] = [];
  const reads: string[] = [];
  const fileSystem = FileSystem.makeNoop({
    realPath: (value) => Effect.succeed(value),
    stat: () => Effect.succeed({ ...fileInfo, size: ByteSize.bytes(options.size ?? 1_000) }),
    readFileString: (value) => {
      reads.push(value);
      return Effect.succeed(options.context ?? JSON.stringify({ ...identity, token: secret }));
    },
  });
  const runner = ProcessRunner.ProcessRunner.of({
    run: (input) => {
      calls.push(input);
      if (input.command === "/usr/bin/git") {
        const project = input.cwd === "/t3-project" ? 0 : 1;
        const stdout = input.args.includes("rev-parse")
          ? options.origins
            ? `/git-${project}`
            : "/shared/git"
          : (options.origins?.[project] ?? "https://github.com/example/repo.git");
        return Effect.succeed(output(stdout));
      }
      if (options.spawnFailure) {
        return Effect.fail(
          new ProcessRunner.ProcessSpawnError({
            command: input.command,
            argumentCount: input.args.length,
            cause: new Error(secret),
          }),
        );
      }
      const stdout = input.args.includes("context")
        ? (options.diagnosticOutput ?? JSON.stringify(diagnostics))
        : (options.boardOutput ?? JSON.stringify([row]));
      return Effect.succeed({ ...output(stdout), ...options.nativeOutput });
    },
  });
  const layer = HyperCoderRoadmap.layer.pipe(
    Layer.provide(Layer.succeed(ProcessRunner.ProcessRunner, runner)),
    Layer.provide(Layer.succeed(FileSystem.FileSystem, fileSystem)),
    Layer.provide(Path.layer),
    Layer.provide(Layer.succeed(HostProcess.Platform, "darwin")),
    Layer.provide(
      Layer.succeed(HostProcess.Environment, {
        HC_AGENT_CONTEXT_DIR: "/unselected",
        HC_AGENT_INSTANCE_ID: "wrong-instance",
        HC_CONVEX_TOKEN: secret,
        HC_CONVEX_URL: "https://unselected.convex.cloud",
        HYPERCODER_CONTROL_URL: "http://unselected",
        NODE_OPTIONS: "--require=/untrusted/module",
        CONVEX_URL: "https://unselected.convex.cloud",
        GIT_DIR: "/unselected/git",
        GIT_WORK_TREE: "/unselected/worktree",
      }),
    ),
  );
  return { calls, reads, layer };
}

const read = (selectedBinding = binding) =>
  Effect.flatMap(HyperCoderRoadmap.HyperCoderRoadmap, (adapter) =>
    adapter.read({ binding: selectedBinding, workspaceRoot: "/t3-project" }),
  );

describe("HyperCoderRoadmap native adapter", () => {
  it.effect(
    "reads only the selected context and normalizes native order without claiming write support",
    () =>
      Effect.gen(function* () {
        const test = fixture();
        const board = yield* read().pipe(Effect.provide(test.layer));
        assert.deepEqual(board, {
          revision: null,
          capabilities: {
            conditionalWrites: false,
            create: false,
            update: false,
            archive: false,
            rank: false,
          },
          cards: [
            {
              id: row.id,
              fields: {
                title: row.title,
                summary: row.summary,
                type: "feature",
                effort: "M",
                lane: "upNext",
                specPath: row.specPath,
                acceptanceCriteria: [],
                archived: false,
                completed: false,
              },
              rank: 0,
              column: "upNext",
              issues: [],
            },
          ],
        });
        assert.deepEqual(test.reads, [binding.contextPath]);
        for (const call of test.calls) {
          assert.equal(Object.hasOwn(call.env ?? {}, "GIT_DIR"), true);
          assert.equal(Object.hasOwn(call.env ?? {}, "GIT_WORK_TREE"), true);
          assert.equal(call.env?.GIT_DIR, undefined);
          assert.equal(call.env?.GIT_WORK_TREE, undefined);
        }
        const nativeCalls = test.calls.filter((call) => call.command !== "/usr/bin/git");
        assert.equal(nativeCalls.length, 2);
        for (const call of nativeCalls) {
          assert.equal(call.command, "/Applications/HyperCoder.app/Contents/MacOS/HyperCoder");
          assert.equal(
            call.args[0],
            "/Applications/HyperCoder.app/Contents/Resources/hc-roadmap.mjs",
          );
          assert.equal(call.env?.HC_AGENT_CONTEXT, binding.contextPath);
          assert.equal(call.env?.HC_CONVEX_TOKEN, undefined);
          assert.equal(call.env?.HC_AGENT_CONTEXT_DIR, undefined);
          assert.equal(call.env?.HC_AGENT_INSTANCE_ID, undefined);
          assert.equal(call.env?.NODE_OPTIONS, undefined);
          assert.equal(call.env?.HYPERCODER_CONTROL_URL, undefined);
          assert.equal(call.env?.CONVEX_URL, undefined);
          assert.equal(JSON.stringify(call).includes(secret), false);
        }
        assert.equal(JSON.stringify(board).includes(secret), false);
        const ordered = yield* read().pipe(
          Effect.provide(
            fixture({
              boardOutput: JSON.stringify([
                { ...row, id: "later", order: 20.5 },
                { ...row, id: "earlier", order: -10.25 },
              ]),
            }).layer,
          ),
        );
        assert.deepEqual(
          ordered.cards.map(({ id, rank }) => ({ id, rank })),
          [
            { id: "earlier", rank: 0 },
            { id: "later", rank: 1 },
          ],
        );
      }),
  );

  it.effect("rejects context identity and diagnostic mismatches before accessing a board", () =>
    Effect.gen(function* () {
      const cases = [
        { context: JSON.stringify({ ...identity, projectId: "other-project", token: secret }) },
        { context: JSON.stringify({ ...identity, instanceId: "other-instance", token: secret }) },
        {
          context: JSON.stringify({
            ...identity,
            convexUrl: "https://other.convex.cloud",
            token: secret,
          }),
        },
        { diagnosticOutput: JSON.stringify({ ...diagnostics, source: "/another/context.json" }) },
        { diagnosticOutput: JSON.stringify({ ...diagnostics, backend: "other.convex.cloud" }) },
        { diagnosticOutput: JSON.stringify({ ...diagnostics, projectId: "other-project" }) },
        { diagnosticOutput: JSON.stringify({ ...diagnostics, instanceId: "other-instance" }) },
      ];
      for (const entry of cases) {
        const test = fixture(entry);
        const error = yield* read().pipe(Effect.flip, Effect.provide(test.layer));
        assert.equal(error.reason, "mismatch");
        assert.equal(
          test.calls.some((call) => call.args.includes("list")),
          false,
        );
        assert.equal(JSON.stringify(error).includes(secret), false);
      }
      const invalidPath = fixture();
      const error = yield* read({ ...binding, contextPath: "relative/context.json" }).pipe(
        Effect.flip,
        Effect.provide(invalidPath.layer),
      );
      assert.equal(error.reason, "invalid");
      assert.deepEqual(invalidPath.reads, []);
      assert.deepEqual(invalidPath.calls, []);
    }),
  );

  it.effect(
    "matches linked worktrees or corresponding repository origins and rejects another repository",
    () =>
      Effect.gen(function* () {
        const matching = fixture({
          origins: ["git@github.com:example/repo.git", "https://github.com/example/repo"],
        });
        const board = yield* read().pipe(Effect.provide(matching.layer));
        assert.equal(board.cards.length, 1);
        for (const origins of [
          ["https://github.com/example/repo.git", "https://github.com/other/repo.git"],
          ["", ""],
        ] as const) {
          const test = fixture({ origins });
          const error = yield* read().pipe(Effect.flip, Effect.provide(test.layer));
          assert.equal(error.reason, "mismatch");
          assert.equal(
            test.calls.every((call) => call.command === "/usr/bin/git"),
            true,
          );
        }
      }),
  );

  it.effect(
    "keeps unsupported and oversized cards visible with bounded fields and original source columns",
    () =>
      Effect.gen(function* () {
        const columns = ["building", "reviewing", "ready", "parked", "done", "future-column"];
        const test = fixture({
          boardOutput: JSON.stringify(
            columns.map((column) => ({
              ...row,
              id: column,
              column,
              title: "T".repeat(500),
              summary: "B".repeat(25_000),
              specPath: `https://example.com/spec?token=${secret}`,
              type: { toString: 1 },
              effort: { toString: 1 },
              lane: "unknown",
              order: "unknown",
              attachments: 2,
              token: secret,
            })),
          ),
        });
        const board = yield* read().pipe(Effect.provide(test.layer));
        assert.deepEqual(
          board.cards.map((card) => card.column),
          columns,
        );
        for (const [index, card] of board.cards.entries()) {
          assert.equal(card.id, columns[index]);
          assert.equal(card.fields.title.length, 200);
          assert.equal(card.fields.summary.length, 20_000);
          assert.equal(card.fields.specPath, null);
          assert.equal(card.fields.completed, false);
          assert.equal(card.rank, index);
          assert.isAbove(card.issues.length, 0);
        }
        assert.equal(JSON.stringify(board).includes(secret), false);
      }),
  );

  it.effect(
    "fails closed on malformed output and never exposes provider diagnostics or credentials",
    () =>
      Effect.gen(function* () {
        for (const options of [
          { context: `{broken:${secret}` },
          { context: JSON.stringify({ ...identity, directory: "relative" }) },
          {
            context: JSON.stringify({
              ...identity,
              convexUrl: `https://user:${secret}@example.convex.cloud`,
            }),
          },
          { size: 70_000 },
          { diagnosticOutput: secret },
          { diagnosticOutput: JSON.stringify({ ...diagnostics, instanceId: null }) },
          { boardOutput: secret },
          { boardOutput: JSON.stringify({ token: secret }) },
          { boardOutput: JSON.stringify([{ title: secret }]) },
          { boardOutput: JSON.stringify([row, row]) },
          { nativeOutput: { stdoutTruncated: true, stderr: secret } },
          { nativeOutput: { stdoutInvalidUtf8: true, stderr: secret } },
          { nativeOutput: { code: ChildProcessSpawner.ExitCode(1), stderr: secret } },
          { spawnFailure: true },
        ]) {
          const test = fixture(options);
          const error = yield* read().pipe(Effect.flip, Effect.provide(test.layer));
          assert.instanceOf(error, RoadmapSyncError);
          assert.equal(JSON.stringify(error).includes(secret), false);
          assert.equal(error.message.includes(secret), false);
          assert.isAtMost(test.calls.filter((call) => call.args.includes("list")).length, 1);
        }
      }),
  );

  it.effect(
    "refuses outgoing mutations without invoking HyperCoder even with an expected revision",
    () =>
      Effect.gen(function* () {
        const test = fixture();
        for (const kind of ["create", "update"] as const) {
          const error = yield* Effect.flatMap(HyperCoderRoadmap.HyperCoderRoadmap, (adapter) =>
            adapter.apply({
              binding,
              workspaceRoot: "/t3-project",
              expectedRevision: "caller-claimed-revision",
              operation: {
                idempotencyKey: "operation-1",
                kind,
                externalId: kind === "create" ? null : row.id,
                fields: {
                  title: row.title,
                  summary: row.summary,
                  type: "feature",
                  effort: "M",
                  lane: "upNext",
                  specPath: row.specPath,
                  acceptanceCriteria: [],
                  completed: false,
                  archived: false,
                },
                rank: 1,
              },
            }),
          ).pipe(Effect.flip, Effect.provide(test.layer));
          assert.equal(error.reason, "unsupported");
        }
        assert.deepEqual(test.calls, []);
        assert.deepEqual(test.reads, []);
      }),
  );
});
