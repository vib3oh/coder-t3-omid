import { useAtomValue } from "@effect/atom-react";
import {
  CommandId,
  MessageId,
  ThreadId,
  type RoadmapBoard,
  type RoadmapCard,
  type RoadmapLinkedThread,
} from "@t3tools/contracts";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { resolveNewThreadModelSelection } from "@t3tools/shared/usageLimits";
import { useRef, useState } from "react";
import { randomUUID } from "../lib/utils";
import { resolveProjectDefaultProviderModelSelection } from "../providerInstances";
import { serverEnvironment } from "../state/server";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { roadmapLaunch } from "./roadmapState";
import { roadmapWorkPrompt } from "./roadmap.logic";

export function useRoadmapWork(
  project: EnvironmentProject,
  save: (cards: ReadonlyArray<RoadmapCard>, revision: number) => Promise<RoadmapBoard | null>,
) {
  const config = useAtomValue(serverEnvironment.configValueAtom(project.environmentId));
  const launch = useAtomCommand(roadmapLaunch, { reportFailure: false });
  const startTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const unarchive = useAtomCommand(threadEnvironment.unarchive, { reportFailure: false });
  const active = useRef(false);
  const [working, setWorking] = useState(false);

  async function run(
    card: RoadmapCard,
    board: RoadmapBoard,
    mode: "build" | "review",
    thread: RoadmapLinkedThread | undefined,
  ) {
    if (active.current) return null;
    active.current = true;
    setWorking(true);
    const result = await perform(card, board, mode, thread);
    active.current = false;
    setWorking(false);
    return result;
  }

  async function perform(
    card: RoadmapCard,
    board: RoadmapBoard,
    mode: "build" | "review",
    thread: RoadmapLinkedThread | undefined,
  ): Promise<string | null> {
    const text = roadmapWorkPrompt(card, mode);
    if (thread) {
      if (thread.archivedAt) {
        const restored = await unarchive({
          environmentId: project.environmentId,
          input: { threadId: thread.id },
        });
        if (restored._tag === "Failure") return failureMessage(restored);
      }
      const sent = await startTurn({
        environmentId: project.environmentId,
        input: {
          threadId: thread.id,
          runtimeMode: thread.runtimeMode,
          interactionMode: "default",
          message: { messageId: MessageId.make(randomUUID()), role: "user", text, attachments: [] },
        },
      });
      return sent._tag === "Failure" ? failureMessage(sent) : null;
    }
    if (!config) return "Connect to the project's environment before starting work.";
    const settings = resolveProjectSettings(config.settings, project.id, project).settings;
    const modelSelection = resolveNewThreadModelSelection({
      defaultSelection:
        settings.defaultModelSelection ??
        resolveProjectDefaultProviderModelSelection(config.providers, config.settings, project.id),
      fallbackSelection: settings.fallbackModelSelection,
      providers: config.providers,
      settings,
      projectId: project.id,
      now: Date.now(),
    }).selection;
    if (!modelSelection)
      return "Choose a default model for this project before starting work from the board.";
    const threadId = card.threadId ?? ThreadId.make(randomUUID());
    if (!card.threadId) {
      const linked = await save(
        board.cards.map((row) =>
          row.id === card.id ? { ...row, threadId, completed: false } : row,
        ),
        board.revision,
      );
      if (!linked)
        return "The card changed before work could start. Reload the board and try again.";
    }
    const launched = await launch({
      environmentId: project.environmentId,
      input: {
        commandId: CommandId.make(`roadmap-start-${threadId}`),
        threadId,
        projectId: project.id,
        title: card.title,
        modelSelection,
        runtimeMode: settings.defaultRuntimeMode,
        interactionMode: "default",
        workspaceStrategy:
          settings.defaultThreadEnvMode === "worktree"
            ? { type: "worktree", baseRef: "HEAD" }
            : { type: "root" },
        initialMessage: {
          messageId: MessageId.make(`roadmap-message-${threadId}`),
          text,
          attachments: [],
        },
      },
    });
    return launched._tag === "Failure"
      ? `${failureMessage(launched)} The card keeps its thread link so retrying can recover this launch.`
      : null;
  }

  return { run, working };
}

function failureMessage(result: Parameters<typeof squashAtomCommandFailure>[0]) {
  const cause = squashAtomCommandFailure(result);
  return cause instanceof Error
    ? cause.message
    : "The work could not be started. Reload and try again.";
}
