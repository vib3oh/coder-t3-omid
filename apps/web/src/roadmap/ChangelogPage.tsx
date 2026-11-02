import { useAtomValue } from "@effect/atom-react";
import {
  scopedProjectKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  AuthOrchestrationOperateScope,
  type ChangelogEntry,
  type ChangelogType,
} from "@t3tools/contracts";
import {
  CHANGELOG_TYPES,
  CHANGELOG_LABELS,
  changelogDay,
  changelogDayOffset,
  changelogSince,
  filterChangelog,
  groupChangelog,
  changelogMarkdown,
  type ChangelogRange,
} from "@t3tools/shared/projectChangelog";
import { Link, useSearch, useNavigate } from "@tanstack/react-router";
import { AsyncResult } from "effect/reactivity";
import * as Option from "effect/Option";
import {
  CopyIcon,
  ListChecksIcon,
  RefreshCwIcon,
  Share2Icon,
  SparklesIcon,
  SquareArrowOutUpRightIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../components/ui/tooltip";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Menu, MenuTrigger, MenuPopup, MenuItem } from "../components/ui/menu";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "../components/ui/dialog";
import { SidebarInset, SidebarTrigger } from "../components/ui/sidebar";
import { WorkspacePageHeader } from "../components/WorkspacePageHeader";
import { isElectron } from "../env";
import { useProjects } from "../state/entities";
import { useEnvironmentHttpBaseUrl } from "../state/environments";
import { useAtomCommand } from "../state/use-atom-command";
import { useAtomQueryRunner } from "../state/use-atom-query-runner";
import { useNowMinute } from "../hooks/useNowMinute";
import { useThreadActions } from "../hooks/useThreadActions";
import { useEnvironmentScope } from "../state/session";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { writeTextToClipboard } from "../hooks/useCopyToClipboard";
import { changelogRead, changelogShare } from "./changelogState";

const COLORS = {
  feature: "bg-yellow-400",
  bug: "bg-pink-500",
  chore: "bg-slate-400",
  spike: "bg-amber-300",
  untyped: "bg-zinc-500",
};
const RANGES = { today: "Today", "7d": "7 days", "30d": "30 days" } as const;
const SELECT =
  "min-w-0 max-w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm";

export function ChangelogPage() {
  const projects = useProjects();
  const { project: selected } = useSearch({ from: "/_chat/changelog" });
  const navigate = useNavigate();
  const setSelected = (project: string) => void navigate({ to: "/changelog", search: { project } });
  const keyFor = (project: EnvironmentProject) =>
    scopedProjectKey({ environmentId: project.environmentId, projectId: project.id });
  const project = projects.find((p) => keyFor(p) === selected) ?? projects[0];
  return (
    <SidebarInset role="main" className="h-dvh min-h-0 overflow-hidden">
      <WorkspacePageHeader electron={isElectron}>
        <div className="hidden md:flex">
          <SidebarTrigger />
        </div>
        <ListChecksIcon className="size-4 text-muted-foreground" />
        <h1 className="text-sm font-medium">Changelog</h1>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Open changelog in a new window"
          render={<a href={window.location.href} target="_blank" rel="noreferrer" />}
        >
          <SquareArrowOutUpRightIcon />
        </Button>
      </WorkspacePageHeader>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="border-b border-border px-4 py-3 md:px-6">
          <select
            aria-label="Changelog project"
            className={SELECT}
            value={project ? keyFor(project) : ""}
            onChange={(event) => setSelected(event.target.value)}
          >
            {projects.map((p) => (
              <option key={keyFor(p)} value={keyFor(p)}>
                {p.title} · {p.workspaceRoot}
              </option>
            ))}
          </select>
        </div>
        {project ? (
          <ProjectChangelog key={keyFor(project)} project={project} />
        ) : (
          <p className="p-6 text-muted-foreground">Open a project to see what shipped.</p>
        )}
      </div>
    </SidebarInset>
  );
}

function scrollChartToEnd(element: HTMLDivElement | null) {
  if (element) element.scrollLeft = element.scrollWidth;
}

function ProjectChangelog({ project }: { project: EnvironmentProject }) {
  const now = Date.parse(useNowMinute());
  const since = new Date(changelogDayOffset(now, 30)).toISOString();
  const until = new Date(changelogDayOffset(now, -1)).toISOString();
  const target = {
    environmentId: project.environmentId,
    input: { projectId: project.id, since, until },
  };
  const result = useAtomValue(changelogRead(target));
  const view = Option.getOrNull(AsyncResult.value(result));
  const reload = useAtomQueryRunner(changelogRead, { refresh: true });
  const canShare = useAtomValue(changelogShare.permissionAtom(project.environmentId));
  const share = useAtomCommand(changelogShare);
  const baseUrl = useEnvironmentHttpBaseUrl(project.environmentId);
  const newThread = useNewThreadHandler();
  const { unarchiveThread } = useThreadActions();
  const canUnarchive = useEnvironmentScope(project.environmentId, AuthOrchestrationOperateScope);

  const log = useRef<HTMLDivElement>(null);
  const [jump, setJump] = useState<{ day: number } | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Scrolling synchronizes the chart selection with the committed DOM.
  useEffect(() => {
    if (jump)
      log.current?.querySelector(`#changelog-day-${jump.day}`)?.scrollIntoView({ block: "start" });
  }, [jump]);
  const [range, setRange] = useState<ChangelogRange>("7d");
  const [type, setType] = useState<ChangelogType | null>(null);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [summaries, setSummaries] = useState(false);
  const [shareOverride, setShareOverride] = useState<{ shareId: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  if (!view)
    return (
      <div role="status" className="p-6 text-sm text-muted-foreground">
        {AsyncResult.isFailure(result)
          ? "Couldn't load the changelog. Check that this environment supports it."
          : "Loading what shipped…"}
        <div className="mt-3">
          <Button variant="outline" size="sm" onClick={() => void reload(target)}>
            Retry
          </Button>
        </div>
      </div>
    );
  const filter = { since: changelogSince(range, now), until: Date.parse(until), type, query };
  const inRange = filterChangelog(view.entries, { ...filter, type: null, query: "" });
  const visible = filterChangelog(inRange, filter);
  const days = groupChangelog(visible);
  const chartGroups = new Map(
    groupChangelog(view.entries).map((group) => [group.day, group.entries]),
  );
  const peak = Math.max(1, ...[...chartGroups.values()].map((entries) => entries.length));
  const shareId = (shareOverride ?? view).shareId;
  const shareUrl =
    shareId && baseUrl ? new URL(`/api/changelog/shared/${shareId}`, baseUrl).href : null;
  const copy = async (text: string) => {
    try {
      await writeTextToClipboard(text, "changelog");
      setNotice("Copied to clipboard.");
    } catch {
      setNotice("Couldn't copy. Check clipboard access and try again.");
    }
  };
  const publish = async (enabled: boolean) => {
    setBusy(true);
    const outcome = await share({
      environmentId: project.environmentId,
      input: {
        projectId: project.id,
        title: project.title,
        since: new Date(filter.since).toISOString(),
        until,
        type,
        query,
        summaries,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        enabled,
      },
    });
    setBusy(false);
    if (outcome._tag === "Success") {
      setShareOverride(outcome.value);
      setNotice(
        enabled ? "Published the selected entries. Copy the link below." : "Public link revoked.",
      );
    }
  };
  const ask = async (purpose: string) => {
    const prompt = `${purpose} for ${project.title}. Use only these shipped entries from ${new Date(filter.since).toLocaleDateString()} through today${type ? `, filtered to ${type}` : ""}. Cite each PR. Do not invent impact or motivation.\n\n${changelogMarkdown(visible, project.title)}`;
    const draft = await newThread(scopeProjectRef(project.environmentId, project.id), { prompt });
    if (!draft) setNotice("Couldn't open an agent draft for this project.");
  };
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 md:px-6">
        <div className="min-w-40 flex-1">
          <Input
            type="search"
            aria-label="Search what shipped"
            placeholder="Search what shipped…"
            maxLength={200}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setQuery("");
            }}
          />
        </div>
        <Button variant="outline" size="sm" disabled={!canShare} onClick={() => setShareOpen(true)}>
          <Share2Icon />
          Share
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Refresh changelog"
          onClick={() => void reload(target)}
        >
          <RefreshCwIcon />
        </Button>
      </div>
      {AsyncResult.isFailure(result) ? (
        <p role="status" className="px-6 py-2 text-sm text-warning">
          Showing the last loaded changelog. Reconnecting…
        </p>
      ) : null}
      <div className="space-y-4 border-b border-border bg-muted/20 px-4 py-5 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">
              <span className="font-mono text-primary">{inRange.length}</span> shipped{" "}
              {range === "today" ? "today" : `in the last ${RANGES[range]}`}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Merged PRs linked to this project's threads. Types follow PR title prefixes.
            </p>
            {view.undatedCount > 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {view.undatedCount} merged PRs have no merge date and aren't listed.
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={visible.length === 0}
              onClick={() => void copy(changelogMarkdown(visible, project.title))}
            >
              <CopyIcon />
              Copy changelog
            </Button>
            <Menu>
              <MenuTrigger
                render={<Button size="sm" variant="outline" disabled={visible.length === 0} />}
              >
                <SparklesIcon />
                Ask an agent
              </MenuTrigger>
              <MenuPopup align="end">
                <MenuItem onClick={() => void ask("Write release notes")}>
                  Write release notes
                </MenuItem>
                <MenuItem onClick={() => void ask("Write a short standup note")}>
                  Write a standup note
                </MenuItem>
                <MenuItem
                  onClick={() => void ask("Choose what to announce to users and explain why")}
                >
                  What should I announce?
                </MenuItem>
              </MenuPopup>
            </Menu>
          </div>
        </div>
        <div ref={scrollChartToEnd} className="overflow-x-auto">
          <div
            role="group"
            aria-label="Shipped PRs per day, last 31 days"
            className="flex h-32 min-w-max items-end gap-1"
          >
            {Array.from({ length: 31 }, (_, i) => changelogDayOffset(now, 30 - i)).map((day) => {
              const entries = chartGroups.get(day) ?? [];
              const label = `${new Date(day).toLocaleDateString(undefined, { month: "short", day: "numeric" })}: ${entries.length} shipped`;
              return (
                <Tooltip key={day}>
                  <TooltipTrigger
                    render={<button type="button" />}
                    aria-label={label}
                    disabled={entries.length === 0 || day < changelogSince("30d", now)}
                    className="flex h-full w-5 flex-col justify-end rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
                    style={{ opacity: day < filter.since ? 0.3 : 1 }}
                    onClick={() => {
                      if (day < filter.since) setRange("30d");
                      setQuery("");
                      setType(null);
                      setExpanded(null);
                      setJump({ day });
                    }}
                  >
                    <span
                      className="flex min-h-px w-full flex-col-reverse gap-px"
                      style={{
                        height: `${Math.max(1, entries.length * Math.min(8, 96 / peak))}px`,
                      }}
                    >
                      {CHANGELOG_TYPES.flatMap((type) =>
                        entries.filter((e) => e.type === type),
                      ).map((entry) => (
                        <span
                          key={entry.id}
                          className={`min-h-px flex-1 rounded-xs ${COLORS[entry.type]}`}
                        />
                      ))}
                    </span>
                    <span className="mt-2 h-4 whitespace-nowrap font-mono text-3xs text-muted-foreground">
                      {new Date(day).getDay() === 1
                        ? new Date(day).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                          })
                        : ""}
                    </span>
                  </TooltipTrigger>
                  <TooltipPopup>{label}</TooltipPopup>
                </Tooltip>
              );
            })}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div role="group" aria-label="Range" className="flex gap-1">
            {(Object.keys(RANGES) as ChangelogRange[]).map((value) => (
              <Button
                key={value}
                size="sm"
                variant={range === value ? "secondary" : "ghost"}
                aria-pressed={range === value}
                onClick={() => {
                  setRange(value);
                  setType(null);
                }}
              >
                {RANGES[value]}
              </Button>
            ))}
          </div>
          <div role="group" aria-label="Type" className="flex flex-wrap gap-1">
            <Button
              size="sm"
              variant={type === null ? "secondary" : "ghost"}
              aria-pressed={type === null}
              onClick={() => setType(null)}
            >
              All {inRange.length}
            </Button>
            {CHANGELOG_TYPES.map((value) => {
              const count = inRange.filter((entry) => entry.type === value).length;
              return count ? (
                <Button
                  key={value}
                  size="sm"
                  variant={type === value ? "secondary" : "ghost"}
                  aria-pressed={type === value}
                  onClick={() => setType(value)}
                >
                  <span className={`h-1.5 w-3 rounded-sm ${COLORS[value]}`} />
                  {CHANGELOG_LABELS[value]} {count}
                </Button>
              ) : null;
            })}
          </div>
        </div>
      </div>
      {notice ? (
        <p role="status" className="px-6 py-2 text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}
      <div ref={log} className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 md:px-6">
        {days.length === 0 ? (
          <div className="space-y-3 py-14 text-center text-sm text-muted-foreground">
            <p>
              {inRange.length
                ? "No shipped work matches these filters."
                : "Nothing shipped in this range."}
            </p>
            <div className="flex justify-center gap-2">
              {query ? (
                <Button variant="outline" size="sm" onClick={() => setQuery("")}>
                  Clear search
                </Button>
              ) : null}
              {type ? (
                <Button variant="outline" size="sm" onClick={() => setType(null)}>
                  Show all types
                </Button>
              ) : null}
              {range !== "30d" ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setRange("30d");
                    setType(null);
                  }}
                >
                  Show 30 days
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          days.map(({ day, entries }) => (
            <section
              id={`changelog-day-${day}`}
              key={day}
              aria-label={new Date(day).toLocaleDateString()}
              className="grid scroll-mt-4 gap-2 pt-5 sm:grid-cols-[72px_minmax(0,1fr)] sm:gap-5"
            >
              <div className="flex items-baseline gap-2 text-muted-foreground sm:sticky sm:top-4 sm:flex-col sm:gap-0 sm:self-start">
                <span className="text-xs">
                  {day === changelogDay(now)
                    ? "Today"
                    : day === changelogDayOffset(now, 1)
                      ? "Yesterday"
                      : new Date(day).toLocaleDateString(undefined, { weekday: "long" })}
                </span>
                <span className="font-mono text-3xl text-foreground">
                  {new Date(day).getDate()}
                </span>
                <span className="text-xs">
                  {new Date(day).toLocaleDateString(undefined, { month: "short" })}
                </span>
              </div>
              <div className="min-w-0">
                {entries.map((entry) => (
                  <ChangelogRow
                    key={entry.id}
                    entry={entry}
                    open={expanded === entry.id}
                    toggle={() => setExpanded(expanded === entry.id ? null : entry.id)}
                    environmentId={project.environmentId}
                    canUnarchive={canUnarchive && !busy}
                    onUnarchive={async () => {
                      setBusy(true);
                      const outcome = await unarchiveThread(
                        scopeThreadRef(project.environmentId, entry.threadId),
                        { navigate: true },
                      );
                      setBusy(false);
                      if (outcome._tag === "Failure")
                        setNotice("Couldn't unarchive this thread. Try again.");
                    }}
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Share changelog</DialogTitle>
            <DialogDescription>
              Publish a snapshot of the current range, type, and search. Anyone with the link can
              read the published entries. Update it here when you're ready.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="space-y-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={summaries}
                  onChange={(e) => setSummaries(e.target.checked)}
                />
                Include summaries
              </label>
              {shareUrl ? (
                <div className="space-y-2">
                  <Input aria-label="Public changelog link" readOnly value={shareUrl} />
                  <Button size="sm" variant="outline" onClick={() => void copy(shareUrl)}>
                    Copy link
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void copy(
                        `<iframe src="${shareUrl}" width="100%" height="720" style="border:0" title="Changelog"></iframe>`,
                      )
                    }
                  >
                    Copy embed
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    This server must be reachable by your readers. Local addresses work only on your
                    network.
                  </p>
                </div>
              ) : null}
            </div>
          </DialogPanel>
          <DialogFooter>
            {shareId ? (
              <Button
                variant="outline"
                disabled={busy || !canShare}
                onClick={() => void publish(false)}
              >
                Revoke link
              </Button>
            ) : null}
            <Button
              disabled={busy || !canShare || visible.length === 0}
              onClick={() => void publish(true)}
            >
              {busy ? "Saving…" : shareId ? "Update public snapshot" : "Publish selected entries"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}

function ChangelogRow({
  entry,
  open,
  toggle,
  environmentId,
  canUnarchive,
  onUnarchive,
}: {
  entry: ChangelogEntry;
  open: boolean;
  toggle: () => void;
  environmentId: EnvironmentProject["environmentId"];
  canUnarchive: boolean;
  onUnarchive: () => Promise<void>;
}) {
  return (
    <article className="border-b border-border/40 py-3">
      <button
        aria-expanded={open}
        className="grid w-full grid-cols-[14px_minmax(0,1fr)_auto] items-start gap-3 rounded-md text-left focus-visible:outline-2 focus-visible:outline-ring"
        onClick={toggle}
      >
        <span className={`mt-2 h-1.5 w-3 rounded-sm ${COLORS[entry.type]}`} />
        <span className="min-w-0">
          <span className="block text-sm leading-relaxed">{entry.title}</span>
          {entry.summary ? (
            <span
              className={`mt-0.5 block text-xs leading-relaxed text-muted-foreground ${open ? "whitespace-pre-wrap" : "truncate"}`}
            >
              {entry.summary}
            </span>
          ) : null}
        </span>
        <span className="text-right text-xs leading-relaxed text-muted-foreground">
          <span className="block">{CHANGELOG_LABELS[entry.type]}</span>
          <span className="font-mono">#{entry.pullNumber}</span>
        </span>
      </button>
      {open ? (
        <div className="ml-7 mt-3 flex flex-wrap items-center gap-4 text-xs">
          {entry.archived ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={!canUnarchive}
              onClick={() => void onUnarchive()}
            >
              Unarchive and open thread
            </Button>
          ) : (
            <Link
              className="text-primary hover:underline"
              to="/$environmentId/$threadId"
              params={{ environmentId, threadId: entry.threadId }}
            >
              Open thread
            </Link>
          )}
          {/^https?:\/\//i.test(entry.url) ? (
            <a
              className="text-primary hover:underline"
              href={entry.url}
              target="_blank"
              rel="noreferrer"
            >
              Open PR #{entry.pullNumber}
            </a>
          ) : null}
          <time className="text-muted-foreground" dateTime={entry.at}>
            {new Date(entry.at).toLocaleString()}
          </time>
        </div>
      ) : null}
    </article>
  );
}
