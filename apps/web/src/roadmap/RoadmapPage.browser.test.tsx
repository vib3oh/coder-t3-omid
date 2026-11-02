import "../index.css";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import {
  EnvironmentId,
  ProjectId,
  RoadmapError,
  type RoadmapBoard,
  type RoadmapSaveInput,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import * as Cause from "effect/Cause";
import { render } from "../../test/render";

const state = vi.hoisted(() => ({
  board: null as RoadmapBoard | null,
  canSave: true,
  save: vi.fn(),
  reload: vi.fn(),
}));

vi.mock(import("@effect/atom-react"), async (original) => ({
  ...(await original()),
  useAtomValue: ((atom: string) =>
    atom === "board"
      ? AsyncResult.success({ board: state.board!, linkedThreads: [] })
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
  roadmapSave: { permissionAtom: () => "permission" } as never,
}));
vi.mock(import("../state/use-atom-command"), () => ({
  useAtomCommand: (() => state.save) as never,
}));
vi.mock(import("../state/use-atom-query-runner"), () => ({
  useAtomQueryRunner: (() => state.reload) as never,
}));
vi.mock(import("../hooks/useHandleNewThread"), () => ({ useNewThreadHandler: () => vi.fn() }));
vi.mock(import("../components/ui/sidebar"), () => ({
  SidebarInset: ({ children }: { children?: React.ReactNode }) => <main>{children}</main>,
  SidebarTrigger: () => <button>Sidebar</button>,
}));

import { RoadmapPage } from "./RoadmapPage";

it("keeps a stale card draft across a conflict and reload without overwriting another client's edit", async () => {
  state.canSave = true;
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
  await using screen = await render(<RoadmapPage />, { router: "/roadmap" });
  await userEvent.click(screen.getByRole("button", { name: "Original idea", exact: true }));
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
  await userEvent.click(page.getByRole("button", { name: "Save card", exact: true }));
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  expect(state.board.cards[0]).toMatchObject({ title: "My draft", completed: true, effort: "XL" });
});

it("lets a read-only user inspect and close a card", async () => {
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
