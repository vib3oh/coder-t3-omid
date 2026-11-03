import * as NodeServices from "@effect/platform-node/NodeServices";
import * as DesktopConfig from "../app/DesktopConfig.ts";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Electron from "electron";
import { vi } from "vite-plus/test";

vi.mock("electron", () => ({}));

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as ElectronShell from "../electron/ElectronShell.ts";
import { CHANGELOG_RETURN_CHANNEL } from "../ipc/channels.ts";
import { make } from "./ChangelogWindows.ts";

function fakeWindow(id: number) {
  const listeners = new Map<string, () => void>();
  const navigation = new Map<
    string,
    (event: { preventDefault: () => void }, url: string) => void
  >();
  let destroyed = false;
  let pinned = false;
  let opens: Electron.WindowOpenHandlerResponse | undefined;
  let openHandler: (details: { url: string }) => Electron.WindowOpenHandlerResponse;
  const loaded: string[] = [];
  const sent: unknown[][] = [];
  const window = {
    webContents: {
      id,
      session: { fixture: "authenticated-session" },
      send: (...args: unknown[]) => sent.push(args),
      setWindowOpenHandler: (handler: typeof openHandler) => {
        openHandler = handler;
      },
      on: (event: string, handler: (event: { preventDefault: () => void }, url: string) => void) =>
        navigation.set(event, handler),
    },
    isDestroyed: () => destroyed,
    close: () => {
      destroyed = true;
      listeners.get("closed")?.();
    },
    once: (event: string, handler: () => void) => listeners.set(event, handler),
    removeListener: (event: string, handler: () => void) => {
      if (listeners.get(event) === handler) listeners.delete(event);
    },
    loadURL: async (url: string) => {
      loaded.push(url);
    },
    setAlwaysOnTop: (value: boolean) => {
      pinned = value;
    },
    isAlwaysOnTop: () => pinned,
  };
  return {
    window: window as unknown as Electron.BrowserWindow,
    loaded,
    sent,
    closed: () => destroyed,
    navigate: (url: string) => {
      let prevented = false;
      navigation.get("will-navigate")?.(
        {
          preventDefault: () => {
            prevented = true;
          },
        },
        url,
      );
      return prevented;
    },
    open: (url: string) => {
      opens = openHandler({ url });
      return opens;
    },
  };
}

function setup() {
  const main = fakeWindow(1);
  const created: ReturnType<typeof fakeWindow>[] = [];
  const options: Electron.BrowserWindowConstructorOptions[] = [];
  const revealed: Electron.BrowserWindow[] = [];
  const external: unknown[] = [];
  let rejectLoad = false;
  const layer = Layer.mergeAll(
    DesktopEnvironment.layer({
      dirname: "/app",
      homeDirectory: "/Users/test",
      platform: "darwin",
      processArch: "arm64",
      appVersion: "1.0.0",
      appPath: "/app",
      isPackaged: false,
      resourcesPath: "/app/resources",
      runningUnderArm64Translation: false,
    }).pipe(
      Layer.provide(
        Layer.mergeAll(
          NodeServices.layer,
          DesktopConfig.layerTest({ VITE_DEV_SERVER_URL: "http://127.0.0.1:5733" }),
        ),
      ),
    ),
    Layer.mock(ElectronWindow.ElectronWindow)({
      main: Effect.succeedSome(main.window),
      create: (input, behavior) =>
        Effect.sync(() => {
          assert.isTrue(behavior?.auxiliary);
          options.push(input);
          const popup = fakeWindow(created.length + 2);
          if (rejectLoad) popup.window.loadURL = () => Promise.reject(new Error("offline"));
          created.push(popup);
          return popup.window;
        }),
      reveal: (window) =>
        Effect.sync(() => {
          revealed.push(window);
        }),
    }),
    Layer.mock(ElectronShell.ElectronShell)({
      openExternal: (url) =>
        Effect.sync(() => {
          external.push(url);
          return true;
        }),
    }),
  );
  return {
    main,
    created,
    options,
    revealed,
    external,
    layer,
    failLoad: () => {
      rejectLoad = true;
    },
  };
}

describe("changelog windows", () => {
  it.effect(
    "isolates a reusable authenticated window, guards controls and returns the selected project",
    () => {
      const fixture = setup();
      return Effect.gen(function* () {
        const windows = yield* make;
        assert.isFalse(yield* windows.open(99, "remote:project"));
        assert.equal(fixture.created.length, 0);
        assert.isTrue(yield* windows.open(1, "remote:project"));
        const popup = fixture.created[0]!;
        const url = new URL(popup.loaded[0]!);
        assert.equal(url.protocol, "t3code-dev:");
        assert.equal(url.host, "app");
        assert.equal(url.hash, "#/changelog?detached=true&project=remote%3Aproject");
        assert.equal(
          fixture.options[0]?.webPreferences?.session,
          fixture.main.window.webContents.session,
        );
        assert.equal(fixture.options[0]?.webPreferences?.preload, "/app/preload.cjs");
        assert.isTrue(yield* windows.open(1, "remote:project"));
        assert.equal(fixture.created.length, 1);
        assert.equal(popup.loaded.length, 1);
        assert.isTrue(yield* windows.open(1, "other:project"));
        assert.include(popup.loaded[1], "project=other%3Aproject");
        assert.isFalse(yield* windows.setPinned(1, true));
        assert.isFalse(popup.window.isAlwaysOnTop());
        assert.isTrue(yield* windows.setPinned(2, true));
        assert.isFalse(yield* windows.setPinned(2, false));
        assert.isFalse(yield* windows.returnToApp(99, "other:project"));
        assert.isFalse(popup.closed());
        assert.isTrue(yield* windows.returnToApp(2, "other:project"));
        assert.deepEqual(fixture.main.sent, [[CHANGELOG_RETURN_CHANNEL, "other:project"]]);
        assert.equal(fixture.revealed.at(-1), fixture.main.window);
        assert.isTrue(popup.closed());
        assert.isTrue(yield* windows.open(1, "remote:project"));
        assert.equal(fixture.created.length, 2);
        fixture.main.window.close();
        assert.isTrue(fixture.created[1]!.closed());
      }).pipe(Effect.provide(fixture.layer), Effect.scoped);
    },
  );

  it.effect(
    "cleans up failed loads and blocks foreign navigation inside the privileged window",
    () => {
      const fixture = setup();
      return Effect.gen(function* () {
        const windows = yield* make;
        assert.isTrue(yield* windows.open(1));
        const popup = fixture.created[0]!;
        assert.isFalse(popup.navigate("t3code-dev://app/#/changelog"));
        assert.isTrue(popup.navigate("t3code-dev://other/#/changelog"));
        assert.equal(popup.open("https://example.com/pr/1").action, "deny");
        popup.window.close();
        fixture.failLoad();
        assert.isFalse(yield* windows.open(1));
        assert.isTrue(fixture.created[1]!.closed());
        assert.isFalse(yield* windows.returnToApp(3));
      }).pipe(Effect.provide(fixture.layer), Effect.scoped);
    },
  );
});
