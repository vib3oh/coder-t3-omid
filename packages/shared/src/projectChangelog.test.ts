import { describe, expect, it } from "vite-plus/test";
import { ThreadId, type ChangelogEntry } from "@t3tools/contracts";
import {
  changelogDayOffset,
  changelogSince,
  filterChangelog,
  groupChangelog,
  changelogMarkdown,
  changelogHtml,
} from "./projectChangelog.ts";

const entry = (
  id: string,
  at: string,
  type: ChangelogEntry["type"] = "feature",
): ChangelogEntry => ({
  id,
  threadId: ThreadId.make(id),
  archived: false,
  title: `Change ${id}`,
  summary: "A summary",
  type,
  pullNumber: Number(id),
  url: `https://github.com/example/app/pull/${id}`,
  at,
});
describe("project changelog", () => {
  it("uses calendar days across DST and excludes the next day's boundary", () => {
    const now = new Date(2026, 10, 2, 12).getTime();
    const since = changelogSince("7d", now);
    expect(new Date(since).getDate()).toBe(27);
    expect(new Date(since).getHours()).toBe(0);
    const until = changelogDayOffset(now, -1);
    const entries = [
      entry("1", new Date(since).toISOString()),
      entry("2", new Date(until).toISOString()),
      entry("3", new Date(since - 1).toISOString()),
    ];
    expect(
      filterChangelog(entries, { since, until, type: null, query: "" }).map((e) => e.id),
    ).toEqual(["1"]);
  });
  it("combines type and search while keeping grouping and exported order consistent", () => {
    const entries = [
      entry("1", "2026-11-01T12:00:00Z"),
      entry("2", "2026-11-02T12:00:00Z", "bug"),
      entry("3", "2026-11-02T13:00:00Z", "bug"),
    ];
    const filtered = filterChangelog(entries, {
      since: 0,
      until: Infinity,
      type: "bug",
      query: " #2 ",
    });
    expect(filtered.map((e) => e.id)).toEqual(["2"]);
    expect(
      groupChangelog(entries)
        .flatMap((day) => day.entries)
        .map((e) => e.id),
    ).toEqual(["3", "2", "1"]);
    const markdown = changelogMarkdown(filtered, "App");
    expect(markdown).toContain("Change 2 (#2)");
    expect(markdown).not.toContain("Change 1");
    const html = changelogHtml([entry("4", "2026-11-02T01:00:00Z")], "App", "America/New_York");
    expect(html).toContain("November 1, 2026");
    expect(html).not.toContain("November 2, 2026");
  });
});
