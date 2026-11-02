import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import {
  ChangelogError,
  type ChangelogEntry,
  type ChangelogShareInput,
  ChangelogShareResult,
  ChangelogView,
  ProjectId,
  ThreadId,
  ThreadPullRequestLink,
} from "@t3tools/contracts";
import { changelogHtml, filterChangelog } from "@t3tools/shared/projectChangelog";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as ServerConfig from "../config.ts";

const decodeLink = Schema.decodeUnknownEffect(Schema.fromJsonString(ThreadPullRequestLink));
const encodeShare = Schema.encodeEffect(Schema.fromJsonString(ChangelogShareResult));
const decodeShare = Schema.decodeUnknownEffect(Schema.fromJsonString(ChangelogShareResult));

export class ChangelogService extends Context.Service<
  ChangelogService,
  {
    readonly read: (input: {
      readonly projectId: ProjectId;
      readonly since: string;
      readonly until: string;
    }) => Effect.Effect<typeof ChangelogView.Type, ChangelogError>;
    readonly share: (
      input: ChangelogShareInput,
    ) => Effect.Effect<typeof ChangelogShareResult.Type, ChangelogError>;
    readonly publicPage: (id: string) => Effect.Effect<string | null, ChangelogError>;
  }
>()("t3/roadmap/ChangelogService") {}

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const sql = yield* SqlClient.SqlClient;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const lock = yield* KeyedLock.make<ProjectId>();
  const directory = path.join(config.stateDir, "extensions", "changelog");
  const metadata = (id: ProjectId) =>
    path.join(directory, `project-${encodeURIComponent(id)}.json`);
  const pagePath = (id: string) => path.join(directory, `${id}.html`);
  const readFile = Effect.fn("ChangelogService.readFile")(function* (file: string) {
    return yield* fs.readFileString(file).pipe(
      Effect.catchTags({
        PlatformError: (error) =>
          error.reason._tag === "NotFound" ? Effect.succeed(null) : Effect.fail(error),
      }),
    );
  });
  const writeShareState = Effect.fn("ChangelogService.writeShareState")(function* (
    projectId: ProjectId,
    shareId: string | null,
  ) {
    const file = metadata(projectId);
    yield* fs.writeFileString(`${file}.tmp`, yield* encodeShare({ shareId }), { mode: 0o600 });
    yield* fs.rename(`${file}.tmp`, file);
  });
  const shareState = Effect.fn("ChangelogService.shareState")(function* (projectId: ProjectId) {
    const json = yield* readFile(metadata(projectId));
    return json === null ? { shareId: null } : yield* decodeShare(json);
  });
  const read = Effect.fn("ChangelogService.read")(
    function* ({
      projectId,
      since,
      until,
    }: {
      readonly projectId: ProjectId;
      readonly since: string;
      readonly until: string;
    }) {
      // Read only PR metadata, including archived/settled threads, without loading conversations.
      const rows = yield* sql<{
        thread_id: string;
        archived_at: string | null;
        title: string;
        link: string;
      }>`
      SELECT t.thread_id, t.archived_at, json_extract(t.payload_json, '$.title') AS title, pr.value AS link
      FROM orchestration_v2_projection_threads t, json_each(t.payload_json, '$.pullRequests') pr
      WHERE t.project_id = ${projectId} AND t.deleted_at IS NULL
        AND json_extract(pr.value, '$.source') != 'stack-dismissed'
        AND json_extract(pr.value, '$.snapshot.state') = 'merged'
      ORDER BY json_extract(pr.value, '$.snapshot.syncedAt') DESC, t.thread_id ASC
    `.pipe(NodeSqliteClient.readOnly);
      const seen = new Set<string>();
      const entries: ChangelogEntry[] = [];
      let undatedCount = 0;
      for (const row of rows) {
        const link = yield* decodeLink(row.link);
        const id = `${link.host.toLowerCase()}/${link.repository.toLowerCase()}#${link.number}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const at = link.snapshot?.mergedAt;
        if (!at || !Number.isFinite(Date.parse(at))) {
          undatedCount++;
          continue;
        }
        if (Date.parse(at) < Date.parse(since) || Date.parse(at) >= Date.parse(until)) continue;
        const title = link.snapshot!.title;
        const prefix = /^([a-z]+)(?:\([^)]*\))?!?:/i.exec(title)?.[1]?.toLowerCase();
        const type =
          prefix === "feat"
            ? "feature"
            : prefix === "fix"
              ? "bug"
              : prefix === "spike"
                ? "spike"
                : prefix &&
                    ["chore", "refactor", "docs", "test", "build", "ci", "perf", "style"].includes(
                      prefix,
                    )
                  ? "chore"
                  : "untyped";
        entries.push({
          id,
          threadId: ThreadId.make(row.thread_id),
          archived: row.archived_at !== null,
          title,
          summary: row.title === title ? "" : row.title,
          type,
          pullNumber: link.number,
          url: link.url,
          at: DateTime.formatIso(DateTime.makeUnsafe(at)),
        });
      }
      return {
        entries: entries.toSorted((a, b) => Date.parse(b.at) - Date.parse(a.at)),
        undatedCount,
        ...(yield* shareState(projectId)),
      };
    },
    Effect.mapError((cause) => new ChangelogError({ cause })),
  );

  const share = Effect.fn("ChangelogService.share")((input: ChangelogShareInput) =>
    lock.withLock(
      input.projectId,
      Effect.gen(function* () {
        const previous = yield* shareState(input.projectId);
        yield* fs.makeDirectory(directory, { recursive: true });
        if (!input.enabled) {
          if (previous.shareId) yield* fs.remove(pagePath(previous.shareId), { force: true });
          yield* writeShareState(input.projectId, null);
          return { shareId: null };
        }
        const view = yield* read(input);
        const entries = filterChangelog(view.entries, {
          since: Date.parse(input.since),
          until: Date.parse(input.until),
          type: input.type,
          query: input.query,
        }).map((entry) => (input.summaries ? entry : { ...entry, summary: "" }));
        const shareId = previous.shareId ?? (yield* crypto.randomUUIDv4());
        const file = pagePath(shareId);
        const html = yield* Effect.try(() => changelogHtml(entries, input.title, input.timeZone));
        yield* fs.writeFileString(`${file}.tmp`, html, { mode: 0o600 });
        yield* fs.rename(`${file}.tmp`, file);
        yield* writeShareState(input.projectId, shareId);
        return { shareId };
      }).pipe(
        Effect.uninterruptible,
        Effect.mapError((cause) => new ChangelogError({ cause })),
      ),
    ),
  );
  const publicPage = Effect.fn("ChangelogService.publicPage")(
    function* (id: string) {
      if (!/^[a-f0-9-]{36}$/.test(id)) return null;
      return yield* readFile(pagePath(id));
    },
    Effect.mapError((cause) => new ChangelogError({ cause })),
  );
  return ChangelogService.of({ read, share, publicPage });
});
export const layer = Layer.effect(ChangelogService, make);
