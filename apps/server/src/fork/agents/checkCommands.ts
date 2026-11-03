const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

export function workflowCheckCommand(snapshotRef: string, command: string): string {
  const revision = quote(`${snapshotRef}^{commit}`);
  return `git rev-parse --verify ${revision} && (\n${command}\n) && printf '\\n' && git rev-parse --verify ${revision} && git diff --quiet ${quote(snapshotRef)} --`;
}

export function workflowCheckInstructions(
  checkpoint: { readonly ref: string; readonly commitSha: string },
  commands: ReadonlyArray<string>,
): string {
  return [
    `Pinned snapshot ${checkpoint.ref} (${checkpoint.commitSha}). Run each check separately through your normal approved shell tool. Copy the execution block unchanged, including its newlines; replace <command> only when no check is declared.`,
    ...(commands.length ? commands : ["<command>"]).map(
      (command) =>
        `Declared command: ${command}\n\`\`\`sh\n${workflowCheckCommand(checkpoint.ref, command)}\n\`\`\``,
    ),
    "In checks[].command report the original declared command, not its wrapper. Use this SHA as revision and each command's own current-run canonical command_execution ID as evidence; omid_assignment_checks lists those IDs. A passed check is not an accepted artifact.",
  ].join("\n\n");
}
