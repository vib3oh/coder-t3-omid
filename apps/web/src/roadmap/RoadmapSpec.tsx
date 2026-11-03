import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import * as Option from "effect/Option";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import ChatMarkdown from "../components/ChatMarkdown";
import { projectEnvironment } from "../state/projects";

export default function RoadmapSpec({
  project,
  path,
}: {
  project: EnvironmentProject;
  path: string;
}) {
  const result = useAtomValue(
    projectEnvironment.readFile({
      environmentId: project.environmentId,
      input: { cwd: project.workspaceRoot, relativePath: path },
    }),
  );
  const file = Option.getOrNull(AsyncResult.value(result));
  if (!file)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {AsyncResult.isFailure(result)
          ? "Could not read this spec. Check its path and your file-read permission."
          : "Loading spec…"}
      </p>
    );
  return (
    <>
      {file.truncated ? (
        <p role="alert" className="text-sm text-muted-foreground">
          This spec is too large to display in full.
        </p>
      ) : null}
      <ChatMarkdown
        text={file.contents}
        cwd={project.workspaceRoot}
        environmentId={project.environmentId}
      />
    </>
  );
}
