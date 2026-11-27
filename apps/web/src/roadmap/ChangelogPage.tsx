import { T, Var, useGT } from "gt-react";
import { resolveExplicitProject } from "../fork/navigation/navigation.logic";
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
  ArrowLeftToLineIcon,
  PinIcon,
  CopyIcon,
  ListChecksIcon,
  RefreshCwIcon,
  Share2Icon,
  BotIcon,
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
  const gt = useGT();
  const projects = useProjects();
  const { project: selected, detached = false } = useSearch({ from: "/_chat/changelog" });
  const navigate = useNavigate();
  const [pinned, setPinned] = useState(false);
  const [windowError, setWindowError] = useState<string | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Restore the native window's always-on-top state after a renderer reload.
  useEffect(() => {
    if (!detached) return;
    let active = true;
    void window.desktopBridge
      ?.getChangelogWindowPinned?.()
      .then((value) => {
        if (active) setPinned(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [detached]);
  const setSelected = (project: string) =>
    void navigate({
      to: "/changelog",
      search: { project, ...(detached ? { detached: true } : {}) },
    });
  const keyFor = (project: EnvironmentProject) =>
    scopedProjectKey({ environmentId: project.environmentId, projectId: project.id });
  const project = resolveExplicitProject(projects, selected);
  const selectedKey = project ? keyFor(project) : undefined;
  const openWindow = async () => {
    setWindowError(null);
    try {
      if (window.desktopBridge?.openChangelogWindow) {
        if (!(await window.desktopBridge.openChangelogWindow(selectedKey))) {
          setWindowError(gt("Couldn't open the changelog window. Try again."));
        }
        return;
      }
      const url = new URL("/changelog", window.location.href);
      url.searchParams.set("detached", "true");
      if (selectedKey) url.searchParams.set("project", selectedKey);
      const popup = window.open(url.href, "t3-changelog", "popup,width=800,height=900");
      if (popup) popup.focus();
      else
        setWindowError(
          gt("Couldn't open the changelog window. Check your pop-up permissions and try again."),
        );
    } catch {
      setWindowError(
        gt("Couldn't open the changelog window. Check your pop-up permissions and try again."),
      );
    }
  };
  const returnToApp = async () => {
    setWindowError(null);
    try {
      if (window.desktopBridge?.returnChangelogToApp) {
        if (!(await window.desktopBridge.returnChangelogToApp(selectedKey))) {
          setWindowError(gt("Couldn't return to the app. Try again or close this window."));
        }
      } else if (window.opener && !window.opener.closed) {
        window.opener.postMessage(
          { type: "t3.changelog.return", project: selectedKey },
          window.location.origin,
        );
        window.opener.focus();
        window.close();
      } else {
        void navigate({ to: "/changelog", search: selectedKey ? { project: selectedKey } : {} });
      }
    } catch {
      setWindowError(gt("Couldn't return to the app. Try again or close this window."));
    }
  };
  const togglePinned = async () => {
    try {
      setPinned(await window.desktopBridge!.setChangelogWindowPinned!(!pinned));
      setWindowError(null);
    } catch {
      setWindowError(gt("Couldn't change always-on-top. Try again."));
    }
  };
  return (
    <SidebarInset role="main" className="h-dvh min-h-0 overflow-hidden">
      <WorkspacePageHeader electron={isElectron && !detached}>
        {!detached && (
          <div className="hidden md:flex">
            <SidebarTrigger />
          </div>
        )}
        <ListChecksIcon className="size-4 text-muted-foreground" />
        <h1 className="text-sm font-medium">
          <T>Changelog</T>
        </h1>
        <div className="ml-auto flex items-center gap-1">
          {detached && window.desktopBridge?.setChangelogWindowPinned && (
            <Button
              variant={pinned ? "secondary" : "ghost"}
              size="icon-sm"
              aria-label={gt("Always keep changelog on top")}
              aria-pressed={pinned}
              onClick={() => void togglePinned()}
            >
              <PinIcon />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={!project && !detached}
            aria-label={detached ? gt("Return changelog to app") : gt("Pop out changelog")}
            onClick={() => void (detached ? returnToApp() : openWindow())}
          >
            {detached ? <ArrowLeftToLineIcon /> : <SquareArrowOutUpRightIcon />}
          </Button>
        </div>
      </WorkspacePageHeader>
      {windowError && (
        <p role="alert" className="px-4 py-2 text-sm text-destructive">
          {windowError}
        </p>
      )}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="border-b border-border px-4 py-3 md:px-6">
          <select
            aria-label={gt("Changelog project")}
            className={SELECT}
            value={project ? keyFor(project) : ""}
            onChange={(event) => setSelected(event.target.value)}
          >
            {!project ? (
              <option value="" disabled>
                <T>Choose a project</T>
              </option>
            ) : null}
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
          <p className="p-6 text-muted-foreground">
            {selected
              ? gt("This project is unavailable. Choose a project to see what shipped.")
              : gt("Open a project to see what shipped.")}
          </p>
        )}
      </div>
    </SidebarInset>
  );
}

function scrollChartToEnd(element: HTMLDivElement | null) {
  if (element) element.scrollLeft = element.scrollWidth;
}

function ProjectChangelog({ project }: { project: EnvironmentProject }) {
  const gt = useGT();
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
          ? gt("Couldn't load the changelog. Check that this environment supports it.")
          : gt("Loading what shipped…")}
        <div className="mt-3">
          <Button variant="outline" size="sm" onClick={() => void reload(target)}>
            <T>Retry</T>
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
      await writeTextToClipboard(text);
      setNotice(gt("Copied to clipboard."));
    } catch {
      setNotice(gt("Couldn't copy. Check clipboard access and try again."));
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
        enabled
          ? gt("Published the selected entries. Copy the link below.")
          : gt("Public link revoked."),
      );
    }
  };
  const ask = async (purpose: string) => {
    const prompt = `${purpose} for ${project.title}. Use only these shipped entries from ${new Date(filter.since).toLocaleDateString()} through today${type ? `, filtered to ${type}` : ""}. Cite each PR. Do not invent impact or motivation.\n\n${changelogMarkdown(visible, project.title)}`;
    const draft = await newThread(scopeProjectRef(project.environmentId, project.id), { prompt });
    if (!draft) setNotice(gt("Couldn't open an agent draft for this project."));
  };
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 md:px-6">
        <div className="min-w-40 flex-1">
          <Input
            type="search"
            aria-label={gt("Search what shipped")}
            placeholder={gt("Search what shipped…")}
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
          <T>Share</T>
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={gt("Refresh changelog")}
          onClick={() => void reload(target)}
        >
          <RefreshCwIcon />
        </Button>
      </div>
      {AsyncResult.isFailure(result) ? (
        <p role="status" className="px-6 py-2 text-sm text-warning">
          <T>Showing the last loaded changelog. Reconnecting…</T>
        </p>
      ) : null}
      <div className="space-y-4 border-b border-border bg-muted/20 px-4 py-5 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">
              <span className="font-mono text-primary">{inRange.length}</span> shipped{" "}
              {range === "today" ? "today" : gt("in the last {value}", { value: RANGES[range] })}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              <T>Merged PRs linked to this project's threads. Types follow PR title prefixes.</T>
            </p>
            {view.undatedCount > 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">
                <T>
                  <Var>{view.undatedCount}</Var> merged PRs have no merge date and aren't listed.
                </T>
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
              <T>Copy changelog</T>
            </Button>
            <Menu>
              <MenuTrigger
                render={<Button size="sm" variant="outline" disabled={visible.length === 0} />}
              >
                <BotIcon />
                <T>Ask an agent</T>
              </MenuTrigger>
              <MenuPopup align="end">
                <MenuItem onClick={() => void ask("Write release notes")}>
                  <T>Write release notes</T>
                </MenuItem>
                <MenuItem onClick={() => void ask("Write a short standup note")}>
                  <T>Write a standup note</T>
                </MenuItem>
                <MenuItem
                  onClick={() => void ask("Choose what to announce to users and explain why")}
                >
                  <T>What should I announce?</T>
                </MenuItem>
              </MenuPopup>
            </Menu>
          </div>
        </div>
        <div ref={scrollChartToEnd} className="overflow-x-auto">
          <div
            role="group"
            aria-label={gt("Shipped PRs per day, last 31 days")}
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
          <div role="group" aria-label={gt("Range")} className="flex gap-1">
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
          <div role="group" aria-label={gt("Type")} className="flex flex-wrap gap-1">
            <Button
              size="sm"
              variant={type === null ? "secondary" : "ghost"}
              aria-pressed={type === null}
              onClick={() => setType(null)}
            >
              <T>
                All <Var>{inRange.length}</Var>
              </T>
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
                ? gt("No shipped work matches these filters.")
                : gt("Nothing shipped in this range.")}
            </p>
            <div className="flex justify-center gap-2">
              {query ? (
                <Button variant="outline" size="sm" onClick={() => setQuery("")}>
                  <T>Clear search</T>
                </Button>
              ) : null}
              {type ? (
                <Button variant="outline" size="sm" onClick={() => setType(null)}>
                  <T>Show all types</T>
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
                  <T>Show 30 days</T>
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
                    ? gt("Today")
                    : day === changelogDayOffset(now, 1)
                      ? gt("Yesterday")
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
                        setNotice(gt("Couldn't unarchive this thread. Try again."));
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
            <DialogTitle>
              <T>Share changelog</T>
            </DialogTitle>
            <DialogDescription>
              <T>
                Publish a snapshot of the current range, type, and search. Anyone with the link can
                read the published entries. Update it here when you're ready.
              </T>
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
                <T>Include summaries</T>
              </label>
              {shareUrl ? (
                <div className="space-y-2">
                  <Input aria-label={gt("Public changelog link")} readOnly value={shareUrl} />
                  <Button size="sm" variant="outline" onClick={() => void copy(shareUrl)}>
                    <T>Copy link</T>
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
                    <T>Copy embed</T>
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    <T>
                      This server must be reachable by your readers. Local addresses work only on
                      your network.
                    </T>
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
                <T>Revoke link</T>
              </Button>
            ) : null}
            <Button
              disabled={busy || !canShare || visible.length === 0}
              onClick={() => void publish(true)}
            >
              {busy
                ? gt("Saving…")
                : shareId
                  ? gt("Update public snapshot")
                  : gt("Publish selected entries")}
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
              <T>Unarchive and open thread</T>
            </Button>
          ) : (
            <Link
              className="text-primary hover:underline"
              to="/$environmentId/$threadId"
              params={{ environmentId, threadId: entry.threadId }}
            >
              <T>Open thread</T>
            </Link>
          )}
          {/^https?:\/\//i.test(entry.url) ? (
            <a
              className="text-primary hover:underline"
              href={entry.url}
              target="_blank"
              rel="noreferrer"
            >
              <T>
                Open PR #<Var>{entry.pullNumber}</Var>
              </T>
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
