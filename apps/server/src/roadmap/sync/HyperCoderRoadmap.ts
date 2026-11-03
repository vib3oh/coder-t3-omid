import {
  RoadmapSyncBinding,
  RoadmapSyncError,
  type RoadmapSyncCapabilities,
  type RoadmapSyncFields,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ProcessRunner from "../../processRunner.ts";

export interface RemoteCard {
  readonly id: string;
  readonly fields: RoadmapSyncFields;
  // Zero-based board position; provider order tokens are normalized at this boundary.
  readonly rank: number;
  readonly column: string | null;
  readonly issues: readonly string[];
}

export interface RemoteBoard {
  readonly revision: string | null;
  readonly capabilities: RoadmapSyncCapabilities;
  readonly cards: readonly RemoteCard[];
}

export interface RemoteWriteOperation {
  readonly idempotencyKey: string;
  readonly kind: "create" | "update";
  readonly externalId: string | null;
  readonly fields: RoadmapSyncFields;
  readonly rank: number;
}

export interface RemoteWriteReceipt {
  readonly externalId: string;
  readonly revision: string;
  readonly fields: RoadmapSyncFields;
  readonly rank: number;
}

export class HyperCoderRoadmap extends Context.Service<
  HyperCoderRoadmap,
  {
    readonly read: (input: {
      readonly binding: RoadmapSyncBinding;
      readonly workspaceRoot: string;
    }) => Effect.Effect<RemoteBoard, RoadmapSyncError>;
    readonly apply: (input: {
      readonly binding: RoadmapSyncBinding;
      readonly workspaceRoot: string;
      readonly expectedRevision: string;
      readonly operation: RemoteWriteOperation;
    }) => Effect.Effect<RemoteWriteReceipt, RoadmapSyncError>;
  }
>()("t3/roadmap/sync/HyperCoderRoadmap") {}

const nativeExecutable = "/Applications/HyperCoder.app/Contents/MacOS/HyperCoder";
const nativeScript = "/Applications/HyperCoder.app/Contents/Resources/hc-roadmap.mjs";
const contextLimit = 64 * 1024;
const outputLimit = 8 * 1024 * 1024;
const nativeCapabilities: RoadmapSyncCapabilities = {
  conditionalWrites: false,
  create: false,
  update: false,
  archive: false,
  rank: false,
};
const ContextIdentity = Schema.Struct({
  convexUrl: Schema.String,
  projectId: Schema.String,
  instanceId: Schema.String,
  directory: Schema.String,
});
const Diagnostics = Schema.Struct({
  source: Schema.String,
  backend: Schema.String,
  projectId: Schema.String,
  instanceId: Schema.String,
});
const decodeBinding = Schema.decodeEffect(RoadmapSyncBinding);
const decodeContext = Schema.decodeUnknownEffect(Schema.fromJsonString(ContextIdentity));
const decodeDiagnostics = Schema.decodeUnknownEffect(Schema.fromJsonString(Diagnostics));
const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const parseJson = (text: string) =>
  decodeJson(text).pipe(Effect.mapError(() => new RoadmapSyncError({ reason: "invalid" })));

function repositoryOrigin(value: string): string | null {
  const raw = value.trim();
  const scp = /^(?:[^@\s]+@)?([^/:\s]+):([^\s]+)$/.exec(raw);
  if (scp && !raw.includes("://")) {
    return `${scp[1]!.toLowerCase()}/${scp[2]!.replace(/\.git\/?$/, "").replace(/\/$/, "")}`;
  }
  try {
    const url = new URL(raw);
    if (!["https:", "http:", "ssh:", "git:"].includes(url.protocol) || url.search || url.hash) {
      return null;
    }
    return `${url.host.toLowerCase()}${url.pathname.replace(/\.git\/?$/, "").replace(/\/$/, "")}`;
  } catch {
    return null;
  }
}

function boardCard(value: unknown, index: number): RemoteCard | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || !row.id.trim() || row.id.length > 2_000) return null;
  const issues: string[] = [];
  const text = (key: string, max: number, fallback: string) => {
    const value = row[key];
    if (typeof value !== "string" || (key === "title" && !value.trim())) {
      if (key !== "summary" || value != null) issues.push(`HyperCoder ${key} is unsupported.`);
      return fallback;
    }
    if (value.length > max) issues.push(`HyperCoder ${key} exceeds the supported length.`);
    return (key === "title" ? value.trim() : value).slice(0, max);
  };
  const title = text("title", 200, "Unsupported HyperCoder card");
  const summary = text("summary", 20_000, "");
  const type = row.type;
  const effort = row.effort;
  const lane = row.lane;
  const column =
    typeof row.column === "string" && row.column.trim() ? row.column.trim().slice(0, 128) : null;
  if (type !== "feature" && type !== "bug" && type !== "chore" && type !== "spike") {
    issues.push("HyperCoder card type is unsupported.");
  }
  if (effort !== "XS" && effort !== "S" && effort !== "M" && effort !== "L" && effort !== "XL") {
    issues.push("HyperCoder effort is unsupported.");
  }
  if (lane !== "backlog" && lane !== "upNext")
    issues.push("HyperCoder planning lane is unsupported.");
  if (column !== "backlog" && column !== "upNext") {
    issues.push(
      "HyperCoder reports a derived or unsupported column; planning edits are read-only.",
    );
  }
  if (typeof row.column === "string" && row.column.length > 128) {
    issues.push("HyperCoder column exceeds the supported length.");
  }
  let specPath: string | null = null;
  if (row.specPath != null) {
    const reference = typeof row.specPath === "string" ? row.specPath.trim() : "";
    let supported =
      Boolean(reference) && reference.length <= 2_000 && !/[\u0000-\u001f]/.test(reference);
    if (/^[a-z][a-z\d+.-]*:/i.test(reference)) {
      try {
        const url = new URL(reference);
        supported &&=
          ["https:", "http:"].includes(url.protocol) &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash;
      } catch {
        supported = false;
      }
    } else {
      supported &&=
        !reference.startsWith("/") &&
        !reference.includes("\\") &&
        !reference.split("/").includes("..");
    }
    if (supported) specPath = reference;
    else issues.push("HyperCoder spec reference is unsupported.");
  }
  if (
    ["tier", "diligence", "owner", "acceptanceCriteria"].some((key) => row[key] != null) ||
    (row.attachments != null && row.attachments !== 0)
  ) {
    issues.push("HyperCoder has additional metadata that is preserved only in HyperCoder.");
  }
  const rank =
    typeof row.order === "number" &&
    Number.isFinite(row.order) &&
    Math.abs(row.order) <= Number.MAX_SAFE_INTEGER
      ? row.order
      : index;
  if (rank !== row.order) issues.push("HyperCoder rank is unsupported.");
  return {
    id: row.id,
    fields: {
      title,
      summary,
      type: type === "bug" || type === "chore" || type === "spike" ? type : "feature",
      effort: effort === "XS" || effort === "S" || effort === "L" || effort === "XL" ? effort : "M",
      lane: lane === "upNext" ? "upNext" : "backlog",
      specPath,
      acceptanceCriteria: [],
      completed: false,
      archived: false,
    },
    rank,
    column,
    issues,
  };
}

const makeNative = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const runner = yield* ProcessRunner.ProcessRunner;
  const platform = yield* HostProcess.Platform;
  const environment = yield* HostProcess.Environment;
  // The CLI must not select an inherited pane, backend, token, or injected Node module.
  const isolatedEnv: NodeJS.ProcessEnv = Object.fromEntries(
    Object.keys(environment)
      .filter((key) =>
        /^(?:HC_|HYPERCODER_|CONVEX_|VITE_CONVEX_|GIT_|NODE_|ELECTRON_|DEBUG)/.test(key),
      )
      .map((key) => [key, undefined]),
  );
  const command = Effect.fn("HyperCoderRoadmap.command")(function* (
    executable: string,
    args: readonly string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
    maxOutputBytes: number,
  ) {
    const result = yield* runner
      .run({ command: executable, args, cwd, env, maxOutputBytes, timeout: "30 seconds" })
      .pipe(Effect.mapError(() => new RoadmapSyncError({ reason: "unavailable" })));
    if (result.code !== 0 || result.timedOut)
      return yield* new RoadmapSyncError({ reason: "unavailable" });
    if (
      result.stdoutTruncated ||
      result.stderrTruncated ||
      result.stdoutInvalidUtf8 ||
      result.stderrInvalidUtf8 ||
      result.stdout.length > maxOutputBytes
    ) {
      return yield* new RoadmapSyncError({ reason: "invalid" });
    }
    return result.stdout;
  });
  const realPath = Effect.fn("HyperCoderRoadmap.realPath")(function* (value: string) {
    return yield* fileSystem
      .realPath(value)
      .pipe(Effect.mapError(() => new RoadmapSyncError({ reason: "unavailable" })));
  });
  const git = Effect.fn("HyperCoderRoadmap.git")(function* (cwd: string, args: readonly string[]) {
    return (yield* command(
      "/usr/bin/git",
      ["--no-optional-locks", "-C", cwd, ...args],
      cwd,
      isolatedEnv,
      contextLimit,
    )).trim();
  });
  const read: HyperCoderRoadmap["Service"]["read"] = Effect.fn("HyperCoderRoadmap.read")(
    function* ({ binding, workspaceRoot }) {
      if (platform !== "darwin") return yield* new RoadmapSyncError({ reason: "unavailable" });
      yield* decodeBinding(binding).pipe(
        Effect.mapError(() => new RoadmapSyncError({ reason: "invalid" })),
      );
      if (
        !path.isAbsolute(binding.contextPath) ||
        !path.isAbsolute(workspaceRoot) ||
        /\0/.test(binding.contextPath + workspaceRoot)
      ) {
        return yield* new RoadmapSyncError({ reason: "invalid" });
      }
      const contextPath = yield* realPath(binding.contextPath);
      const stat = yield* fileSystem
        .stat(contextPath)
        .pipe(Effect.mapError(() => new RoadmapSyncError({ reason: "unavailable" })));
      if (stat.type !== "File" || Number(stat.size) > contextLimit)
        return yield* new RoadmapSyncError({ reason: "invalid" });
      const raw = yield* fileSystem
        .readFileString(contextPath)
        .pipe(Effect.mapError(() => new RoadmapSyncError({ reason: "unavailable" })));
      if (raw.length > contextLimit) return yield* new RoadmapSyncError({ reason: "invalid" });
      const identity = yield* decodeContext(raw).pipe(
        Effect.mapError(() => new RoadmapSyncError({ reason: "invalid" })),
      );
      const backend = yield* Effect.try({
        try: () => {
          const url = new URL(identity.convexUrl);
          if (
            url.protocol !== "https:" ||
            url.username ||
            url.password ||
            url.search ||
            url.hash ||
            url.pathname !== "/" ||
            url.port
          )
            throw new Error();
          return url.hostname;
        },
        catch: () => new RoadmapSyncError({ reason: "invalid" }),
      });
      if (
        backend !== binding.backend ||
        identity.projectId !== binding.projectId ||
        identity.instanceId !== binding.instanceId
      ) {
        return yield* new RoadmapSyncError({ reason: "mismatch" });
      }
      if (!path.isAbsolute(identity.directory) || /\0/.test(identity.directory))
        return yield* new RoadmapSyncError({ reason: "invalid" });
      const root = yield* realPath(workspaceRoot);
      const contextRoot = yield* realPath(identity.directory);
      const localGit = yield* git(root, [
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir",
      ]);
      const remoteGit = yield* git(contextRoot, [
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir",
      ]);
      if ((yield* realPath(localGit)) !== (yield* realPath(remoteGit))) {
        const localOrigin = repositoryOrigin(
          yield* git(root, ["config", "--get", "remote.origin.url"]),
        );
        const remoteOrigin = repositoryOrigin(
          yield* git(contextRoot, ["config", "--get", "remote.origin.url"]),
        );
        if (!localOrigin || localOrigin !== remoteOrigin)
          return yield* new RoadmapSyncError({ reason: "mismatch" });
      }
      const env = { ...isolatedEnv, ELECTRON_RUN_AS_NODE: "1", HC_AGENT_CONTEXT: contextPath };
      const diagnosticOutput = yield* command(
        nativeExecutable,
        [nativeScript, "context"],
        contextRoot,
        env,
        contextLimit,
      );
      const diagnostics = yield* decodeDiagnostics(diagnosticOutput).pipe(
        Effect.mapError(() => new RoadmapSyncError({ reason: "invalid" })),
      );
      if (
        diagnostics.source !== contextPath ||
        diagnostics.backend !== binding.backend ||
        diagnostics.projectId !== binding.projectId ||
        diagnostics.instanceId !== binding.instanceId
      ) {
        return yield* new RoadmapSyncError({ reason: "mismatch" });
      }
      const rows = yield* command(
        nativeExecutable,
        [nativeScript, "list", "--json"],
        contextRoot,
        env,
        outputLimit,
      ).pipe(Effect.flatMap(parseJson));
      if (!Array.isArray(rows) || rows.length > 10_000)
        return yield* new RoadmapSyncError({ reason: "invalid" });
      const cards: RemoteCard[] = [];
      const ids = new Set<string>();
      for (const [index, row] of rows.entries()) {
        const card = boardCard(row, index);
        if (!card || ids.has(card.id)) return yield* new RoadmapSyncError({ reason: "invalid" });
        ids.add(card.id);
        cards.push(card);
      }
      return {
        revision: null,
        capabilities: nativeCapabilities,
        cards: cards
          .sort((left, right) => left.rank - right.rank)
          .map((card, rank) => ({ ...card, rank })),
      };
    },
  );
  // Observed native commands have no atomic expected-revision guard.
  const apply: HyperCoderRoadmap["Service"]["apply"] = Effect.fn("HyperCoderRoadmap.apply")(() =>
    Effect.fail(new RoadmapSyncError({ reason: "unsupported" })),
  );
  return HyperCoderRoadmap.of({ read, apply });
});

export const layer = Layer.effect(HyperCoderRoadmap, makeNative);
