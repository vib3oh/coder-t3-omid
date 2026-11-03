import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";
import type * as Electron from "electron";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as ElectronShell from "../electron/ElectronShell.ts";
import { getDesktopUrl } from "../electron/ElectronProtocol.ts";
import { CHANGELOG_RETURN_CHANNEL } from "../ipc/channels.ts";

export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const windows = yield* ElectronWindow.ElectronWindow;
  const shell = yield* ElectronShell.ElectronShell;
  const runPromise = Effect.runPromiseWith(yield* Effect.context<ElectronShell.ElectronShell>());
  const mutex = yield* Semaphore.make(1);
  let detached: Electron.BrowserWindow | undefined;
  let owner: Electron.BrowserWindow | undefined;
  const close = () => {
    const window = detached;
    detached = undefined;
    owner = undefined;
    if (window && !window.isDestroyed()) window.close();
  };
  yield* Effect.addFinalizer(() => Effect.sync(close));

  return {
    open: Effect.fn("desktop.changelog.open")(
      function* (senderId: number, project?: string) {
        const main = yield* windows.main;
        if (
          Option.isNone(main) ||
          main.value.isDestroyed() ||
          main.value.webContents.id !== senderId
        )
          return false;
        const url = new URL(getDesktopUrl(environment.isDevelopment));
        const search = new URLSearchParams({ detached: "true" });
        if (project) search.set("project", project);
        // Desktop routes use hash history; the protocol serves the same authenticated app origin.
        url.hash = `/changelog?${search}`;
        if (detached?.isDestroyed()) close();
        const existing = detached;
        if (existing) {
          const current = URL.parse(existing.webContents.getURL());
          const [route, query] = (current?.hash.slice(1) ?? "").split("?");
          const parameters = new URLSearchParams(query);
          if (
            route !== "/changelog" ||
            parameters.get("detached") !== "true" ||
            (parameters.get("project") ?? undefined) !== project
          ) {
            const loaded = yield* Effect.promise(() =>
              existing.loadURL(url.href).then(
                () => true,
                () => false,
              ),
            );
            if (!loaded || existing.isDestroyed()) return false;
          }
          yield* windows.reveal(existing);
          return true;
        }
        const window = yield* windows.create(
          {
            title: "Changelog",
            width: 800,
            height: 900,
            minWidth: 420,
            minHeight: 500,
            show: false,
            autoHideMenuBar: true,
            webPreferences: {
              preload: environment.preloadPath,
              session: main.value.webContents.session,
              contextIsolation: true,
              nodeIntegration: false,
              sandbox: true,
            },
          },
          { auxiliary: true },
        );
        detached = window;
        owner = main.value;
        const parent = main.value;
        const onParentClosed = () => {
          if (owner === parent) close();
        };
        parent.once("closed", onParentClosed);
        window.once("closed", () => {
          parent.removeListener("closed", onParentClosed);
          if (detached === window) {
            detached = undefined;
            owner = undefined;
          }
        });
        window.webContents.setWindowOpenHandler(({ url: external }) => {
          void runPromise(shell.openExternal(external));
          return { action: "deny" };
        });
        window.webContents.on("will-navigate", (event, target) => {
          const next = URL.parse(target);
          if (next?.protocol === url.protocol && next.host === url.host) return;
          event.preventDefault();
          void runPromise(shell.openExternal(target));
        });
        const loaded = yield* Effect.promise(() =>
          window.loadURL(url.href).then(
            () => true,
            () => false,
          ),
        );
        if (!loaded || window.isDestroyed()) {
          close();
          return false;
        }
        yield* windows.reveal(window);
        return true;
      },
      mutex.withPermits(1),
      Effect.orElseSucceed(() => false),
    ),
    setPinned: Effect.fn("desktop.changelog.setPinned")((senderId: number, pinned?: boolean) =>
      Effect.sync(() => {
        if (!detached || detached.isDestroyed() || detached.webContents.id !== senderId)
          return false;
        if (pinned !== undefined) detached.setAlwaysOnTop(pinned);
        return detached.isAlwaysOnTop();
      }),
    ),
    returnToApp: Effect.fn("desktop.changelog.returnToApp")(function* (
      senderId: number,
      project?: string,
    ) {
      if (
        !detached ||
        detached.isDestroyed() ||
        detached.webContents.id !== senderId ||
        !owner ||
        owner.isDestroyed()
      )
        return false;
      owner.webContents.send(CHANGELOG_RETURN_CHANNEL, project);
      yield* windows.reveal(owner);
      close();
      return true;
    }),
  };
});
