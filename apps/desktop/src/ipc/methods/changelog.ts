import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as DesktopWindow from "../../window/DesktopWindow.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import * as Channels from "../channels.ts";

const Project = Schema.UndefinedOr(Schema.String.check(Schema.isMaxLength(512)));

export const open = DesktopIpc.makeIpcMethod({
  channel: Channels.OPEN_CHANGELOG_WINDOW_CHANNEL,
  payload: Project,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.changelog.open")(function* (project, event) {
    if (!event) return false;
    return yield* (yield* DesktopWindow.DesktopWindow).openChangelog(event.sender.id, project);
  }),
});

export const pin = DesktopIpc.makeIpcMethod({
  channel: Channels.PIN_CHANGELOG_WINDOW_CHANNEL,
  payload: Schema.UndefinedOr(Schema.Boolean),
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.changelog.pin")(function* (pinned, event) {
    if (!event) return false;
    return yield* (yield* DesktopWindow.DesktopWindow).pinChangelog(event.sender.id, pinned);
  }),
});

export const returnToApp = DesktopIpc.makeIpcMethod({
  channel: Channels.RETURN_CHANGELOG_WINDOW_CHANNEL,
  payload: Project,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.changelog.returnToApp")(function* (project, event) {
    if (!event) return false;
    return yield* (yield* DesktopWindow.DesktopWindow).returnChangelog(event.sender.id, project);
  }),
});
