import type { ChangelogEntry, ChangelogType } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

const localTimeZone = DateTime.zoneMakeLocal();

export const CHANGELOG_TYPES = ["feature", "bug", "chore", "spike", "untyped"] as const;
export const CHANGELOG_LABELS = {
  feature: "Feature",
  bug: "Bug",
  chore: "Chore",
  spike: "Spike",
  untyped: "Untyped",
};
export type ChangelogRange = "today" | "7d" | "30d";

export function changelogDay(at: string | number) {
  return DateTime.toEpochMillis(
    DateTime.startOf(DateTime.makeZonedUnsafe(at, { timeZone: localTimeZone }), "day"),
  );
}
export function changelogDayOffset(now: number, offset: number) {
  return DateTime.toEpochMillis(
    DateTime.subtract(DateTime.makeZonedUnsafe(changelogDay(now), { timeZone: localTimeZone }), {
      days: offset,
    }),
  );
}
export function changelogSince(range: ChangelogRange, now: number) {
  return changelogDayOffset(now, range === "today" ? 0 : range === "7d" ? 6 : 29);
}
export function filterChangelog(
  entries: readonly ChangelogEntry[],
  filter: {
    since: number;
    until: number;
    type: ChangelogType | null;
    query: string;
  },
) {
  const query = filter.query.trim().toLowerCase();
  return entries.filter((entry) => {
    const at = Date.parse(entry.at);
    return (
      at >= filter.since &&
      at < filter.until &&
      (!filter.type || entry.type === filter.type) &&
      `${entry.title} ${entry.summary} #${entry.pullNumber}`.toLowerCase().includes(query)
    );
  });
}
export function groupChangelog(entries: readonly ChangelogEntry[]) {
  const days = new Map<number, ChangelogEntry[]>();
  for (const entry of entries) {
    const day = changelogDay(entry.at);
    const group = days.get(day) ?? [];
    group.push(entry);
    days.set(day, group);
  }
  return [...days]
    .sort(([a], [b]) => b - a)
    .map(([day, group]) => ({
      day,
      entries: [...group].sort(
        (a, b) => Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id),
      ),
    }));
}
export function changelogMarkdown(entries: readonly ChangelogEntry[], title: string) {
  return [
    `# ${title.replace(/[\r\n]/g, " ")}: Changelog`,
    ...groupChangelog(entries).flatMap(({ day, entries }) => [
      "",
      `## ${new Intl.DateTimeFormat(undefined, { year: "numeric", month: "long", day: "numeric" }).format(day)}`,
      "",
      ...entries.map(
        (entry) =>
          `- **${CHANGELOG_LABELS[entry.type]}:** ${entry.title.replace(/[\r\n]/g, " ")} (#${entry.pullNumber})${entry.summary ? `: ${entry.summary.replace(/\s+/g, " ")}` : ""}`,
      ),
    ]),
  ].join("\n");
}
export function changelogHtml(entries: readonly ChangelogEntry[], title: string, timeZone: string) {
  const dayFormat = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const days = new Map<string, ChangelogEntry[]>();
  for (const entry of [...entries].sort(
    (a, b) => Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id),
  )) {
    const day = dayFormat.format(Date.parse(entry.at));
    const group = days.get(day) ?? [];
    group.push(entry);
    days.set(day, group);
  }
  const escape = (value: string) =>
    value.replace(
      /[&<>"']/g,
      (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
    );
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}: Changelog</title><style>body{font:16px/1.6 system-ui;max-width:760px;margin:48px auto;padding:0 24px;background:#15161a;color:#e7e7ec}h1{font-size:28px}h2{font-size:18px;color:#aaa}article{padding:16px 0;border-bottom:1px solid #303038}p{color:#aaa;margin:6px 0}a{color:#d6b85e}small{color:#aaa}</style><h1>${escape(title)}: Changelog</h1>${[
    ...days.values(),
  ]
    .map(
      (entries) =>
        `<section><h2>${escape(new Intl.DateTimeFormat(undefined, { timeZone, year: "numeric", month: "long", day: "numeric" }).format(Date.parse(entries[0]!.at)))}</h2>${entries.map((entry) => `<article><small>${CHANGELOG_LABELS[entry.type]}</small><div>${escape(entry.title)} <a href="${/^https?:\/\//i.test(entry.url) ? escape(entry.url) : "#"}" rel="noreferrer">#${entry.pullNumber}</a></div>${entry.summary ? `<p>${escape(entry.summary)}</p>` : ""}</article>`).join("")}</section>`,
    )
    .join("")}</html>`;
}
