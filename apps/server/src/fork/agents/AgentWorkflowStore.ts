import { ProjectId, AgentWorkflowError, AgentWorkflowProject } from "@t3tools/contracts";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as ServerConfig from "../../config.ts";
import { defaultAgentRoles } from "./WorkflowRules.ts";

const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(AgentWorkflowProject));
const encode = Schema.encodeEffect(Schema.fromJsonString(AgentWorkflowProject));
const MAX_STORE_BYTES = 32 * 1024 * 1024;

export class AgentWorkflowStore extends Context.Service<
  AgentWorkflowStore,
  {
    readonly read: (
      projectId: ProjectId,
    ) => Effect.Effect<AgentWorkflowProject, AgentWorkflowError>;
    readonly listProjects: () => Effect.Effect<ReadonlyArray<ProjectId>, AgentWorkflowError>;
    readonly update: <A>(
      projectId: ProjectId,
      change: (
        current: AgentWorkflowProject,
      ) => Effect.Effect<
        { readonly state: AgentWorkflowProject; readonly result: A },
        AgentWorkflowError
      >,
    ) => Effect.Effect<A, AgentWorkflowError>;
  }
>()("t3/fork/agents/AgentWorkflowStore") {}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const locks = yield* KeyedLock.make<ProjectId>();
  const directory = path.join(config.stateDir, "extensions", "agents");
  const filename = (projectId: ProjectId) =>
    path.join(directory, `project-${encodeURIComponent(projectId)}.json`);

  const listProjects = Effect.fn("AgentWorkflowStore.listProjects")(function* () {
    const files = yield* fs.readDirectory(directory).pipe(
      Effect.catchTags({
        PlatformError: (cause) =>
          cause.reason._tag === "NotFound"
            ? Effect.succeed([] as string[])
            : Effect.fail(new AgentWorkflowError({ reason: "storage", cause })),
      }),
    );
    return yield* Effect.try({
      try: () =>
        files.flatMap((file) => {
          const match = /^project-(.+)\.json$/.exec(file);
          return match ? [ProjectId.make(decodeURIComponent(match[1]!))] : [];
        }),
      catch: () => new AgentWorkflowError({ reason: "invalid" }),
    });
  });

  const read = Effect.fn("AgentWorkflowStore.read")(function* (projectId: ProjectId) {
    const contents = yield* fs.readFileString(filename(projectId)).pipe(
      Effect.catchTags({
        PlatformError: (cause) =>
          cause.reason._tag === "NotFound"
            ? Effect.succeed(null)
            : Effect.fail(new AgentWorkflowError({ reason: "storage", cause })),
      }),
    );
    if (contents === null)
      return {
        version: 1 as const,
        revision: 0,
        roleRevision: 0,
        enabled: false,
        roles: defaultAgentRoles(),
        workflows: [],
      };
    if (contents.length > MAX_STORE_BYTES)
      return yield* new AgentWorkflowError({ reason: "limit" });
    return yield* decode(contents).pipe(
      Effect.mapError((cause) => new AgentWorkflowError({ reason: "invalid", cause })),
    );
  });

  const update: AgentWorkflowStore["Service"]["update"] = Effect.fn("AgentWorkflowStore.update")(
    function* (projectId, change) {
      return yield* locks.withLock(
        projectId,
        Effect.gen(function* () {
          const current = yield* read(projectId);
          const changed = yield* change(current);
          if (changed.state === current) return changed.result;
          const next = { ...changed.state, revision: current.revision + 1 };
          const json = yield* encode(next).pipe(
            Effect.mapError((cause) => new AgentWorkflowError({ reason: "invalid", cause })),
          );
          if (json.length > MAX_STORE_BYTES)
            return yield* new AgentWorkflowError({ reason: "limit" });
          const file = filename(projectId);
          yield* Effect.gen(function* () {
            yield* fs.makeDirectory(directory, { recursive: true });
            yield* fs.writeFileString(`${file}.tmp`, json, { mode: 0o600 });
            yield* fs.rename(`${file}.tmp`, file);
          }).pipe(Effect.mapError((cause) => new AgentWorkflowError({ reason: "storage", cause })));
          return changed.result;
        }).pipe(Effect.uninterruptible),
      );
    },
  );
  return AgentWorkflowStore.of({ read, update, listProjects });
});

export const layer = Layer.effect(AgentWorkflowStore, make);
