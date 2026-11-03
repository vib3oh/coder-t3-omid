// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

/** Interpret only read operations over authored files; never invoke a shell or read host files. */
export function fixtureShellOutput(
  command: string,
  cwd: string,
  files: unknown,
  revisions: ReadonlyArray<string> = [],
  refs: unknown = {},
) {
  if (!files || typeof files !== "object" || Array.isArray(files) || /[;&|`$<>\n]/.test(command))
    return;
  const entries = Object.entries(files).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  const tokens: string[] = [];
  let end = 0;
  for (const match of command.matchAll(/'([^']*)'|"([^"]*)"|([^\s'"`]+)/g)) {
    const gap = command.slice(end, match.index);
    if (gap.trim() || (end > 0 && gap.length === 0)) return;
    tokens.push(match[1] ?? match[2] ?? match[3]!);
    end = match.index + match[0].length;
  }
  if (command.slice(end).trim()) return;
  if (
    tokens[0] === "git" &&
    tokens[1] === "rev-parse" &&
    tokens.length > 2 &&
    refs &&
    typeof refs === "object" &&
    !Array.isArray(refs)
  ) {
    const known = Object.fromEntries(Object.entries(refs));
    const resolved = tokens
      .slice(2)
      .map((ref) => known[ref] ?? revisions.find((revision) => revision === ref));
    if (resolved.every((value) => typeof value === "string")) return resolved.join("\n");
    return;
  }
  if (tokens[0] === "git" && tokens[1] === "show" && tokens.length === 3) {
    const revision = /^([a-f0-9]{40}):(.+)$/.exec(tokens[2]!);
    if (revision && revisions.includes(revision[1]!))
      return (
        entries.find(([file]) => file === revision[2])?.[1] ??
        "Exit code 128\nfile is absent from the authored fixture revision"
      );
    return;
  }
  if (tokens[0] === "rg" && tokens[1] === "--files") {
    const patterns: string[] = [];
    let hidden = false;
    for (let i = 2; i < tokens.length; i++) {
      if (tokens[i] === "--hidden") hidden = true;
      else if (tokens[i] === "-g" && tokens[i + 1]) patterns.push(tokens[++i]!);
      else return;
    }
    const listed = entries
      .map(([file]) => file)
      .filter((file) => {
        if (!hidden && file.split("/").some((part) => part.startsWith("."))) return false;
        const matches = (pattern: string) =>
          NodePath.matchesGlob(file, pattern) ||
          NodePath.matchesGlob(NodePath.basename(file), pattern);
        const includes = patterns.filter((pattern) => !pattern.startsWith("!"));
        return (
          (includes.length === 0 || includes.some(matches)) &&
          !patterns.some((pattern) => pattern.startsWith("!") && matches(pattern.slice(1)))
        );
      })
      .sort()
      .join("\n");
    return listed || "Exit code 1\nno files match in the authored fixture workspace";
  }
  if (tokens[0] === "cat" && tokens.length > 1) {
    const contents = tokens.slice(1).map((file) => {
      const relative = file.startsWith(`${cwd}/`) ? file.slice(cwd.length + 1) : file;
      return entries.find(([path]) => path === relative)?.[1];
    });
    if (contents.every((content) => content !== undefined)) return contents.join("\n");
    if (
      tokens
        .slice(1)
        .every(
          (file) =>
            (!file.startsWith("/") || file.startsWith(`${cwd}/`)) &&
            !file.split("/").includes(".."),
        )
    )
      return "Exit code 1\ncat: no such file in the authored fixture workspace";
  }
}
