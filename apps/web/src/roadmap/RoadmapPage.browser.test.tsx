import "../index.css";
import { expect, it, vi } from "vite-plus/test";
import { commands, page, userEvent } from "vite-plus/test/browser";
import {
  EnvironmentId,
  ProjectId,
  RoadmapError,
  type RoadmapBoard,
  type RoadmapCard,
  type RoadmapSaveInput,
  type RoadmapLinkedThread,
  ProviderInstanceId,
  ThreadId,
  DEFAULT_SERVER_SETTINGS,
  type OrchestrationV2ThreadLaunchInput,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import * as Cause from "effect/Cause";
import { render } from "../../test/render";

const state = vi.hoisted(() => ({
  board: null as RoadmapBoard | null,
  canSave: true,
  linkedThreads: [] as ReadonlyArray<RoadmapLinkedThread>,
  config: null as unknown,
  launch: vi.fn(),
  startTurn: vi.fn(),
  archive: vi.fn(),
  unarchive: vi.fn(),
  save: vi.fn(),
  reload: vi.fn(),
}));

vi.mock(import("@effect/atom-react"), async (original) => ({
  ...(await original()),
  useAtomValue: ((atom: string) =>
    atom === "board"
      ? AsyncResult.success({ board: state.board!, linkedThreads: state.linkedThreads })
      : atom === "config"
        ? state.config
        : state.canSave) as never,
}));
vi.mock(import("../state/entities"), () => ({
  useProjects: () =>
    [
      {
        id: ProjectId.make("project"),
        environmentId: EnvironmentId.make("env"),
        title: "Local project",
        workspaceRoot: "/project",
        archivedAt: null,
      },
    ] as never,
  useThreadShells: () => [],
}));
vi.mock(import("./roadmapState"), () => ({
  roadmapRead: (() => "board") as never,
  roadmapSave: { kind: "save", permissionAtom: () => "permission" } as never,
  roadmapLaunch: { kind: "launch", permissionAtom: () => "permission" } as never,
}));
vi.mock(import("../state/use-atom-command"), () => ({
  useAtomCommand: ((command: { kind: string }) =>
    command.kind === "launch"
      ? state.launch
      : command.kind === "start"
        ? state.startTurn
        : command.kind === "archive"
          ? state.archive
          : command.kind === "unarchive"
            ? state.unarchive
            : state.save) as never,
}));
vi.mock(import("../state/use-atom-query-runner"), () => ({
  useAtomQueryRunner: (() => state.reload) as never,
}));
vi.mock(import("../hooks/useHandleNewThread"), () => ({ useNewThreadHandler: () => vi.fn() }));
vi.mock(import("../components/ui/sidebar"), () => ({
  SidebarInset: ({ children }: { children?: React.ReactNode }) => <main>{children}</main>,
  SidebarTrigger: () => <button>Sidebar</button>,
}));

vi.mock(import("../state/server"), () => ({
  serverEnvironment: { configValueAtom: () => "config" } as never,
}));
vi.mock(import("../state/threads"), () => ({
  threadEnvironment: {
    startTurn: { kind: "start" },
    archive: { kind: "archive" },
    unarchive: { kind: "unarchive" },
  } as never,
}));
import { RoadmapPage } from "./RoadmapPage";

function setup() {
  state.canSave = true;
  state.linkedThreads = [];
  state.config = null;
  for (const command of [state.launch, state.startTurn, state.archive, state.unarchive])
    command.mockReset().mockResolvedValue(AsyncResult.success({}));
  state.save.mockReset().mockImplementation(async ({ input }: { input: RoadmapSaveInput }) => {
    if (input.expectedRevision !== state.board!.revision)
      return AsyncResult.failure(Cause.fail(new RoadmapError({ reason: "conflict" })));
    state.board = { version: 1, revision: state.board!.revision + 1, cards: input.cards };
    return AsyncResult.success(state.board);
  });
  state.reload
    .mockReset()
    .mockImplementation(async () =>
      AsyncResult.success({ board: state.board!, linkedThreads: state.linkedThreads }),
    );
}

it.each(["save", "navigate away"] as const)(
  "keeps a route-linked card draft across a conflict and reload (%s)",
  async (ending) => {
    setup();
    state.board = {
      version: 1,
      revision: 0,
      cards: [
        {
          id: "one",
          title: "Original idea",
          summary: "A brief",
          type: "feature",
          effort: "M",
          lane: "backlog",
          threadId: null,
          completed: false,
          archived: false,
        },
      ],
    };
    state.save.mockReset().mockImplementation(async ({ input }: { input: RoadmapSaveInput }) => {
      if (input.expectedRevision !== state.board!.revision) {
        return AsyncResult.failure(Cause.fail(new RoadmapError({ reason: "conflict" })));
      }
      state.board = { version: 1, revision: state.board!.revision + 1, cards: input.cards };
      return AsyncResult.success(state.board);
    });
    state.reload
      .mockReset()
      .mockImplementation(async () =>
        AsyncResult.success({ board: state.board!, linkedThreads: [] }),
      );
    await using screen = await render(<RoadmapPage />, {
      router: "/roadmap?project=env%3Aproject&card=one",
    });
    await userEvent.fill(page.getByRole("textbox", { name: "Title", exact: true }), "My draft");
    state.board = {
      ...state.board,
      revision: 1,
      cards: [
        { ...state.board.cards[0]!, title: "Another client's edit", completed: true, effort: "XL" },
      ],
    };
    await screen.rerender(<RoadmapPage />);
    await userEvent.click(page.getByRole("button", { name: "Save card", exact: true }));
    await expect.element(page.getByRole("dialog").getByRole("alert")).toBeVisible();
    await expect
      .element(page.getByRole("textbox", { name: "Title", exact: true }))
      .toHaveValue("My draft");
    expect(state.board.cards[0]?.title).toBe("Another client's edit");
    await userEvent.click(page.getByRole("button", { name: "Reload board and keep my draft" }));
    await expect
      .element(page.getByRole("textbox", { name: "Title", exact: true }))
      .toHaveValue("My draft");
    await userEvent.click(page.getByText("Latest saved card (review before replacing it)"));
    await expect
      .element(page.getByRole("dialog").getByText("Another client's edit", { exact: true }))
      .toBeVisible();
    if (ending === "navigate away") {
      await screen.router!.navigate({ to: "/roadmap", search: { project: "env:project" } });
      await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
      expect(state.board.cards[0]?.title).toBe("Another client's edit");
      return;
    }
    await userEvent.click(page.getByRole("button", { name: "Save card", exact: true }));
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    expect(state.board.cards[0]).toMatchObject({
      title: "My draft",
      completed: true,
      effort: "XL",
    });
  },
);

it("lets a read-only user inspect and close a card", async () => {
  setup();
  state.canSave = false;
  state.board = {
    version: 1,
    revision: 0,
    cards: [
      {
        id: "read",
        title: "Read only idea",
        summary: "",
        type: "feature",
        effort: "M",
        lane: "backlog",
        threadId: null,
        completed: false,
        archived: false,
      },
    ],
  };
  await using screen = await render(<RoadmapPage />, { router: "/roadmap" });
  await userEvent.click(screen.getByRole("button", { name: "Read only idea", exact: true }));
  await expect.element(page.getByRole("button", { name: "Save card", exact: true })).toBeDisabled();
  await userEvent.click(page.getByRole("button", { name: "Cancel", exact: true }));
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
});

function idea(id: string, title = id): RoadmapCard {
  return {
    id,
    title,
    summary: "A brief",
    type: "feature",
    effort: "M",
    lane: "backlog",
    threadId: null,
    completed: false,
    archived: false,
  };
}

function linkedThread(id: string, draft: boolean | null): RoadmapLinkedThread {
  const at = "2026-11-02T12:00:00.000Z";
  return {
    id: ThreadId.make(id),
    title: id,
    archivedAt: null,
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
    runtimeMode: "full-access",
    interactionMode: "default",
    pullRequests:
      draft === null
        ? []
        : [
            {
              host: "github.com",
              repository: "acme/app",
              number: 1,
              url: "https://github.com/acme/app/pull/1",
              source: "manual",
              linkedAt: at,
              stack: null,
              snapshot: {
                state: "open",
                title: "Work",
                headBranch: "feature/work",
                baseBranch: "main",
                isDraft: draft,
                updatedAt: at,
                syncedAt: at,
              },
            },
          ],
  };
}

async function drag(title: string, lane: string) {
  await commands.dragPointer(`button[aria-label="Drag ${title}"]`, `section[aria-label="${lane}"]`);
}

it("groups review work in one lane and hides each empty review section", async () => {
  setup();
  state.board = {
    version: 1,
    revision: 0,
    cards: [{ ...idea("ready"), threadId: ThreadId.make("ready-thread") }],
  };
  state.linkedThreads = [linkedThread("ready-thread", false)];
  await using screen = await render(<RoadmapPage />, { router: "/roadmap" });
  await expect
    .element(screen.getByRole("region", { name: "In Review", exact: true }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("region", { name: "Your review", exact: true }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("region", { name: "Agent review", exact: true }))
    .not.toBeInTheDocument();
  state.board = {
    ...state.board,
    cards: [...state.board.cards, { ...idea("agent"), threadId: ThreadId.make("agent-thread") }],
  };
  state.linkedThreads = [...state.linkedThreads, linkedThread("agent-thread", true)];
  await screen.rerender(<RoadmapPage />);
  await expect
    .element(screen.getByRole("region", { name: "Agent review", exact: true }))
    .toBeVisible();
  state.board = { ...state.board, cards: state.board.cards.filter((row) => row.id !== "ready") };
  await screen.rerender(<RoadmapPage />);
  await expect
    .element(screen.getByRole("region", { name: "Your review", exact: true }))
    .not.toBeInTheDocument();
});

it("opens a right drawer from the card body and persists criteria and a full spec link", async () => {
  setup();
  await page.viewport(1280, 900);
  state.board = { version: 1, revision: 0, cards: [idea("card", "Drawer idea")] };
  await using screen = await render(<RoadmapPage />, { router: "/roadmap" });
  await userEvent.click(screen.getByText("A brief", { exact: true }));
  await expect.element(page.getByRole("dialog")).toHaveAttribute("data-slot", "sheet-popup");
  await userEvent.fill(
    page.getByRole("textbox", { name: "Full spec path or URL", exact: true }),
    "https://example.com/full-spec",
  );
  await userEvent.click(page.getByRole("button", { name: "Add criterion", exact: true }));
  await userEvent.fill(
    page.getByRole("textbox", { name: "Acceptance criterion 1", exact: true }),
    "Works after reload",
  );
  await userEvent.click(page.getByRole("checkbox", { name: "Complete criterion 1", exact: true }));
  await userEvent.click(page.getByRole("button", { name: "Save card", exact: true }));
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  expect(state.board.cards[0]).toMatchObject({
    specPath: "https://example.com/full-spec",
    acceptanceCriteria: [{ text: "Works after reload", checked: true }],
  });
  await userEvent.click(screen.getByRole("button", { name: "Drawer idea", exact: true }));
  await expect
    .element(page.getByRole("checkbox", { name: "Complete criterion 1", exact: true }))
    .toBeChecked();
  await expect
    .element(page.getByRole("link", { name: "Open full spec" }))
    .toHaveAttribute("href", "https://example.com/full-spec");
});

it("dragging an idea into Building launches an agent and links its thread", async () => {
  setup();
  await page.viewport(1800, 900);
  state.config = {
    settings: {
      ...DEFAULT_SERVER_SETTINGS,
      defaultModelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
      defaultThreadEnvMode: "local",
    },
    providers: [],
  };
  state.board = { version: 1, revision: 0, cards: [idea("build", "Build idea")] };
  state.launch.mockImplementation(
    async ({ input }: { input: OrchestrationV2ThreadLaunchInput }) => {
      state.linkedThreads = [linkedThread(input.threadId!, null)];
      return AsyncResult.success({});
    },
  );
  await using screen = await render(<RoadmapPage />, { router: "/roadmap" });
  await drag("Build idea", "Building");
  await vi.waitFor(() => expect(state.launch).toHaveBeenCalledTimes(1));
  const request = state.launch.mock.calls[0]![0].input as OrchestrationV2ThreadLaunchInput;
  expect(request.initialMessage?.text).toContain("Implement this roadmap item");
  expect(request.workspaceStrategy).toEqual({ type: "root" });
  expect(state.board.cards[0]?.threadId).toBe(request.threadId);
  await expect
    .element(
      screen
        .getByRole("region", { name: "Building", exact: true })
        .getByRole("button", { name: "Build idea", exact: true }),
    )
    .toBeVisible();
});

it("dragging linked work into In Review starts an agent review without fabricating a PR state", async () => {
  setup();
  await page.viewport(1800, 900);
  state.board = {
    version: 1,
    revision: 0,
    cards: [{ ...idea("review", "Review idea"), threadId: ThreadId.make("work") }],
  };
  state.linkedThreads = [linkedThread("work", null)];
  await using screen = await render(<RoadmapPage />, { router: "/roadmap" });
  await drag("Review idea", "In Review");
  await vi.waitFor(() => expect(state.startTurn).toHaveBeenCalledTimes(1));
  expect(state.startTurn.mock.calls[0]![0].input.message.text).toContain(
    "Review the existing work",
  );
  expect(state.launch).not.toHaveBeenCalled();
  await expect
    .element(
      screen
        .getByRole("region", { name: "Building", exact: true })
        .getByRole("button", { name: "Review idea", exact: true }),
    )
    .toBeVisible();
});

it("retries a failed launch with the reserved thread instead of creating duplicate work", async () => {
  setup();
  await page.viewport(1800, 900);
  state.config = {
    settings: {
      ...DEFAULT_SERVER_SETTINGS,
      defaultModelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
      defaultThreadEnvMode: "worktree",
    },
    providers: [],
  };
  state.launch.mockResolvedValueOnce(AsyncResult.failure(Cause.fail(new Error("Connection lost"))));
  state.board = { version: 1, revision: 0, cards: [idea("retry", "Retry idea")] };
  await using screen = await render(<RoadmapPage />, { router: "/roadmap" });
  await drag("Retry idea", "Building");
  await vi.waitFor(() =>
    expect(screen.getByRole("alert").element().textContent).toContain("Connection lost"),
  );
  const first = state.launch.mock.calls[0]![0].input as OrchestrationV2ThreadLaunchInput;
  expect(state.board.cards[0]?.threadId).toBe(first.threadId);
  expect(first.workspaceStrategy).toEqual({ type: "worktree", baseRef: "HEAD" });
  await drag("Retry idea", "Building");
  await vi.waitFor(() => expect(state.launch).toHaveBeenCalledTimes(2));
  const retry = state.launch.mock.calls[1]![0].input as OrchestrationV2ThreadLaunchInput;
  expect(retry.threadId).toBe(first.threadId);
  expect(retry.commandId).toBe(first.commandId);
  expect(state.save).toHaveBeenCalledTimes(1);
});

it("resumes archived linked work and prevents read-only users from dragging", async () => {
  setup();
  await page.viewport(1800, 900);
  state.board = {
    version: 1,
    revision: 0,
    cards: [{ ...idea("resume", "Resume idea"), threadId: ThreadId.make("archived") }],
  };
  state.linkedThreads = [{ ...linkedThread("archived", null), archivedAt: "2026-11-01T12:00:00Z" }];
  state.canSave = false;
  await using screen = await render(<RoadmapPage />, { router: "/roadmap" });
  await expect
    .element(screen.getByRole("button", { name: "Drag Resume idea", exact: true }))
    .toBeDisabled();
  expect(state.startTurn).not.toHaveBeenCalled();
  state.canSave = true;
  await screen.rerender(<RoadmapPage />);
  await drag("Resume idea", "Building");
  await vi.waitFor(() => expect(state.startTurn).toHaveBeenCalledTimes(1));
  expect(state.unarchive).toHaveBeenCalledTimes(1);
  expect(state.unarchive.mock.invocationCallOrder[0]).toBeLessThan(
    state.startTurn.mock.invocationCallOrder[0]!,
  );
  expect(state.launch).not.toHaveBeenCalled();
});

it.each([
  ["Up Next", null, "upNext"],
  ["Parked", true, "backlog"],
] as const)(
  "reopens completed work in %s and guards its pending transition",
  async (target, draft, lane) => {
    setup();
    await page.viewport(1800, 900);
    state.board = {
      version: 1,
      revision: 0,
      cards: [
        { ...idea("reopen", "Reopen idea"), threadId: ThreadId.make("finished"), completed: true },
      ],
    };
    state.linkedThreads = [linkedThread("finished", draft)];
    let finishArchive!: () => void;
    const archived = new Promise<void>((resolve) => {
      finishArchive = resolve;
    });
    state.archive.mockImplementation(async () => {
      await archived;
      state.linkedThreads = [
        { ...linkedThread("finished", draft), archivedAt: "2026-11-02T12:00:00Z" },
      ];
      return AsyncResult.success({});
    });
    await using screen = await render(<RoadmapPage />, { router: "/roadmap" });
    await drag("Reopen idea", target);
    await vi.waitFor(() => expect(state.archive).toHaveBeenCalledTimes(1));
    await expect
      .element(screen.getByRole("button", { name: "Add idea", exact: true }))
      .toBeDisabled();
    finishArchive();
    await expect
      .element(
        screen
          .getByRole("region", { name: target, exact: true })
          .getByRole("button", { name: "Reopen idea", exact: true }),
      )
      .toBeVisible();
    expect(state.board.cards[0]).toMatchObject({ completed: false, lane });
  },
);
