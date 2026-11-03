import type {
  AgentRolePreset,
  AgentRoleSnapshot,
  AgentSkillSnapshot,
  ModelSelection,
  ServerProviderSkill,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../../config.ts";
import {
  BUILTIN_SKILL_PACKAGE_VERSION,
  builtinSkillDefinitions,
  findBuiltinSkill,
  listBuiltinSkills,
  skillContentHash,
  type BuiltinSkillDefinition,
} from "./catalog.ts";

export { listBuiltinSkills } from "./catalog.ts";

export class BuiltinSkillPackageError extends Schema.TaggedError<BuiltinSkillPackageError>()(
  "BuiltinSkillPackageError",
  {
    reason: Schema.Literals(["storage", "modified"]),
    path: Schema.String,
  },
) {
  override get message(): string {
    return this.reason === "modified"
      ? "The built-in skill package was modified. Its contents were preserved and cannot be used."
      : "The built-in skill package could not be prepared.";
  }
}

export interface BuiltinNativeSkill {
  readonly name: string;
  readonly path: string;
  readonly contentHash: string;
}

export interface BuiltinSkillPackage {
  readonly version: string;
  readonly contentHash: string;
  readonly codexRoot: string;
  readonly claudePluginRoot: string;
  readonly entries: ReadonlyArray<{
    readonly id: string;
    readonly codex: BuiltinNativeSkill;
    readonly claude: BuiltinNativeSkill;
  }>;
}

export interface BuiltinRoleCompileInput {
  readonly role: AgentRolePreset;
  readonly modelSelection: ModelSelection;
  readonly provider: string;
  readonly nativeSkills: ReadonlyArray<ServerProviderSkill>;
  readonly capabilities: ReadonlyArray<string>;
  readonly package: BuiltinSkillPackage;
  readonly delivery?: "native" | "task-context";
  readonly invocation?: "agent" | "user";
}

export interface BuiltinRoleCompilation {
  readonly snapshot: AgentRoleSnapshot;
  readonly brief: string;
  readonly ready: boolean;
  readonly issues: ReadonlyArray<string>;
}

function nativeName(id: string): string {
  return id.startsWith("t3-") ? id : `t3-${id}`;
}

function renderSkill(skill: BuiltinSkillDefinition, provider: "codex" | "claude"): string {
  const name = provider === "codex" ? nativeName(skill.id) : skill.id;
  return `---\nname: ${name}\ndescription: ${JSON.stringify(skill.description)}\n${skill.userInvocationOnly ? "disable-model-invocation: true\n" : ""}---\n\n${skill.instructions}`;
}

function packageFiles(root: string, path: Path.Path) {
  const files = new Map<string, string>();
  const codexRoot = path.join(root, "codex", "skills");
  const claudePluginRoot = path.join(root, "claude");
  const entries = builtinSkillDefinitions.map((skill) => {
    const codex = renderSkill(skill, "codex");
    const claude = renderSkill(skill, "claude");
    const codexDirectory = path.join(codexRoot, nativeName(skill.id));
    const codexPath = path.join(codexDirectory, "SKILL.md");
    const claudePath = path.join(claudePluginRoot, "skills", skill.id, "SKILL.md");
    files.set(codexPath, codex);
    files.set(
      path.join(codexDirectory, "agents", "openai.yaml"),
      `interface:\n  display_name: ${JSON.stringify(skill.name)}\n  short_description: ${JSON.stringify(skill.description.slice(0, 64))}\npolicy:\n  allow_implicit_invocation: ${!skill.userInvocationOnly}\n`,
    );
    files.set(claudePath, claude);
    return {
      id: skill.id,
      codex: { name: nativeName(skill.id), path: codexPath, contentHash: skillContentHash(codex) },
      claude: {
        name: `t3-vibe:${skill.id}`,
        path: claudePath,
        contentHash: skillContentHash(claude),
      },
    };
  });
  files.set(
    path.join(claudePluginRoot, ".claude-plugin", "plugin.json"),
    JSON.stringify(
      {
        name: "t3-vibe",
        version: BUILTIN_SKILL_PACKAGE_VERSION,
        description: "T3 built-in workflow procedures",
        skills: "./skills",
      },
      null,
      2,
    ) + "\n",
  );
  return { files, codexRoot, claudePluginRoot, entries };
}

const packageIdentity = skillContentHash(JSON.stringify(builtinSkillDefinitions));

export const verifyBuiltinSkillPackage = Effect.fn("BuiltinSkillService.verify")(function* (
  pkg: BuiltinSkillPackage,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = path.dirname(path.dirname(pkg.codexRoot));
  const expected = packageFiles(root, path);
  if (
    pkg.version !== BUILTIN_SKILL_PACKAGE_VERSION ||
    pkg.contentHash !== packageIdentity ||
    pkg.entries.length !== expected.entries.length ||
    pkg.entries.some((entry, index) => {
      const target = expected.entries[index];
      return (
        !target ||
        entry.id !== target.id ||
        entry.codex.name !== target.codex.name ||
        entry.codex.path !== target.codex.path ||
        entry.codex.contentHash !== target.codex.contentHash ||
        entry.claude.name !== target.claude.name ||
        entry.claude.path !== target.claude.path ||
        entry.claude.contentHash !== target.claude.contentHash
      );
    }) ||
    pkg.claudePluginRoot !== expected.claudePluginRoot
  ) {
    return yield* new BuiltinSkillPackageError({ reason: "modified", path: root });
  }
  for (const [filename, contents] of expected.files) {
    const actual = yield* fs
      .readFileString(filename)
      .pipe(
        Effect.mapError(() => new BuiltinSkillPackageError({ reason: "modified", path: filename })),
      );
    if (actual !== contents)
      return yield* new BuiltinSkillPackageError({ reason: "modified", path: filename });
  }
});

export const prepareBuiltinSkillPackage = Effect.fn("BuiltinSkillService.prepare")(function* (
  stateDir: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const parent = path.join(stateDir, "extensions", "agent-skills");
  const root = path.join(parent, `${BUILTIN_SKILL_PACKAGE_VERSION}-${packageIdentity}`);
  const expected = packageFiles(root, path);
  const pkg: BuiltinSkillPackage = {
    version: BUILTIN_SKILL_PACKAGE_VERSION,
    contentHash: packageIdentity,
    codexRoot: expected.codexRoot,
    claudePluginRoot: expected.claudePluginRoot,
    entries: expected.entries,
  };
  const prepare = Effect.gen(function* () {
    if (yield* fs.exists(root)) {
      yield* verifyBuiltinSkillPackage(pkg);
      return pkg;
    }
    yield* fs.makeDirectory(parent, { recursive: true, mode: 0o700 });
    yield* Effect.scoped(
      Effect.gen(function* () {
        const temporary = yield* Effect.acquireRelease(
          fs.makeTempDirectory({ directory: parent, prefix: "preparing-" }),
          (directory) => fs.remove(directory, { recursive: true, force: true }).pipe(Effect.orDie),
        );
        const staged = packageFiles(temporary, path);
        for (const [filename, contents] of staged.files) {
          yield* fs.makeDirectory(path.dirname(filename), { recursive: true, mode: 0o700 });
          yield* fs.writeFileString(filename, contents, { mode: 0o600 });
        }
        yield* fs.rename(temporary, root).pipe(Effect.catch(() => verifyBuiltinSkillPackage(pkg)));
      }),
    );
    yield* verifyBuiltinSkillPackage(pkg);
    return pkg;
  });
  return yield* prepare.pipe(
    Effect.catchTags({
      PlatformError: () =>
        Effect.fail(new BuiltinSkillPackageError({ reason: "storage", path: root })),
    }),
  );
});

function codexBuiltinSkillRoots(pkg: BuiltinSkillPackage) {
  return { extraRoots: [pkg.codexRoot] };
}

export function claudeBuiltinSkillPlugin(pkg: BuiltinSkillPackage) {
  return { type: "local" as const, path: pkg.claudePluginRoot };
}

export const optionalServerBuiltinSkillPackage = Effect.fn("BuiltinSkillService.optionalPackage")(
  function* () {
    const config = yield* Effect.serviceOption(ServerConfig.ServerConfig);
    if (Option.isNone(config)) return undefined;
    return yield* prepareBuiltinSkillPackage(config.value.stateDir).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Built-in skills are unavailable.", { cause }).pipe(Effect.as(undefined)),
      ),
    );
  },
);

export const registerCodexBuiltinSkillRoots = Effect.fn("BuiltinSkillService.registerCodex")(
  function* <E, R>(
    request: (input: {
      readonly extraRoots: ReadonlyArray<string>;
    }) => Effect.Effect<unknown, E, R>,
    pkg: BuiltinSkillPackage,
  ): Effect.fn.Return<boolean, never, R> {
    return yield* request(codexBuiltinSkillRoots(pkg)).pipe(
      Effect.as(true),
      Effect.catch(() =>
        Effect.logDebug("Codex does not accept built-in skill roots.").pipe(Effect.as(false)),
      ),
    );
  },
);

const normalizedPath = (value: string) => value.replaceAll("\\", "/");

export function compileBuiltinRole(input: BuiltinRoleCompileInput): BuiltinRoleCompilation {
  const canonicalIds = (references: ReadonlyArray<string>) => [
    ...new Set(references.map((reference) => findBuiltinSkill(reference)?.id ?? reference)),
  ];
  const requiredSkills = canonicalIds(input.role.requiredSkills);
  const optionalSkills = canonicalIds(input.role.optionalSkills).filter(
    (id) => !requiredSkills.includes(id),
  );
  const snapshots = new Map<string, AgentSkillSnapshot>();
  const visiting = new Set<string>();
  const issues: string[] = [];
  const loaded: string[] = [];
  const caps = new Set(input.capabilities);
  const delivery = input.delivery ?? "native";

  const resolve = (reference: string, required: boolean) => {
    const definition = findBuiltinSkill(reference);
    const id = definition?.id ?? reference;
    const prior = snapshots.get(id);
    if (prior && (!required || prior.required)) return;
    if (visiting.has(id)) {
      const reason = `Skill dependency cycle at ${id}.`;
      issues.push(reason);
      return;
    }
    visiting.add(id);
    let state: AgentSkillSnapshot["state"] = "on_demand";
    let reason: string | null = null;
    let skillPath: string | null = null;
    let hash = definition ? skillContentHash(definition.instructions) : "";
    if (!definition) {
      state = "missing";
      reason = `Unknown built-in skill ${reference}.`;
    } else {
      if (definition.deferredReason) {
        state = "unsupported";
        reason = definition.deferredReason;
      } else if (definition.userInvocationOnly && (input.invocation ?? "agent") !== "user") {
        state = "unsupported";
        reason = `${id} requires explicit user invocation and cannot be loaded into an autonomous role.`;
      } else {
        const missing = definition.requiredCapabilities.filter(
          (capability) => !caps.has(capability),
        );
        if (missing.length > 0) {
          state = "unsupported";
          reason = `${id} requires capabilities: ${missing.join(", ")}.`;
        } else if (delivery === "task-context") {
          state = required ? "loaded" : "on_demand";
        } else {
          const entry = input.package.entries.find((skill) => skill.id === id);
          const expected =
            input.provider === "codex"
              ? entry?.codex
              : input.provider === "claude" || input.provider === "claudeAgent"
                ? entry?.claude
                : undefined;
          if (!expected) {
            state = "unsupported";
            reason = `${input.provider} has no verified native skill packaging for ${id}.`;
          } else {
            const native = input.nativeSkills.find((skill) => skill.name === expected.name);
            if (!native) {
              state = "missing";
              reason = `Native discovery did not return ${expected.name}. Refresh the provider's project skills.`;
            } else if (!native.enabled) {
              state = "unsupported";
              reason = `${expected.name} is disabled by native provider configuration.`;
            } else if (normalizedPath(native.path) !== normalizedPath(expected.path)) {
              state = "unsupported";
              reason = `${expected.name} resolves to a different source; the pinned built-in package cannot be substituted.`;
            } else if (native.userInvocationOnly && (input.invocation ?? "agent") !== "user") {
              state = "unsupported";
              reason = `${expected.name} is reserved for user invocation by its provider.`;
            } else {
              skillPath = expected.path;
              hash = expected.contentHash;
            }
          }
        }
      }
      for (const dependency of definition.dependencies) resolve(dependency, required);
    }
    visiting.delete(id);
    const snapshot: AgentSkillSnapshot = {
      id,
      version: definition ? BUILTIN_SKILL_PACKAGE_VERSION : "unknown",
      contentHash: hash,
      path: skillPath,
      source: "builtin",
      state,
      required,
      reason,
    };
    snapshots.set(id, snapshot);
    if (required && reason) issues.push(reason);
    if (definition && required && state === "loaded") loaded.push(definition.instructions);
  };
  for (const reference of input.role.requiredSkills) resolve(reference, true);
  for (const reference of input.role.optionalSkills) resolve(reference, false);
  if (!input.role.enabled) issues.push("This role is disabled.");
  const skills = [...snapshots.values()];
  const guidance =
    input.role.kind === "reviewer"
      ? "Review mode: inspect. Do not edit, commit, push, rebase, mark ready or merge. Return findings against the pinned base/head; Builder owns repairs."
      : "Work only within the assignment's accepted objective, write responsibility, limits and authorized finish.";
  const brief = [
    `Role: ${input.role.name} (${input.role.id}, version ${input.role.version})`,
    `Mission: ${input.role.mission}`,
    input.role.instructions,
    `Expected deliverable: ${input.role.outputKind}`,
    guidance,
    `Instruction delivery: ${delivery}. This role does not replace configured project/provider guidance.`,
    ...skills.map(
      (skill) =>
        `Skill ${skill.id}@${skill.version}: ${skill.state}${skill.path ? `; read ${skill.path}` : ""}${skill.reason ? `; ${skill.reason}` : ""}; content ${skill.contentHash || "unavailable"}`,
    ),
    ...loaded,
  ].join("\n\n");
  return {
    snapshot: {
      role: { ...input.role, requiredSkills, optionalSkills },
      instructionHash: skillContentHash(brief),
      skills,
      modelSelection: input.modelSelection,
      capabilities: [...new Set(input.capabilities)].sort(),
    },
    brief,
    ready: issues.length === 0,
    issues,
  };
}

export class BuiltinSkillService extends Context.Service<
  BuiltinSkillService,
  {
    readonly prepare: () => Effect.Effect<BuiltinSkillPackage, BuiltinSkillPackageError>;
    readonly list: () => ReturnType<typeof listBuiltinSkills>;
    readonly compileRole: (
      input: Omit<BuiltinRoleCompileInput, "package">,
    ) => Effect.Effect<BuiltinRoleCompilation, BuiltinSkillPackageError>;
  }
>()("t3/fork/skills/BuiltinSkillService") {}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const context = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
  const prepare = Effect.fn("BuiltinSkillService.preparePackage")(function* () {
    return yield* prepareBuiltinSkillPackage(config.stateDir).pipe(Effect.provide(context));
  });
  return BuiltinSkillService.of({
    prepare,
    list: listBuiltinSkills,
    compileRole: Effect.fn("BuiltinSkillService.compileRole")(function* (input) {
      const pkg = yield* prepare();
      return compileBuiltinRole({ ...input, package: pkg });
    }),
  });
});

export const layer = Layer.effect(BuiltinSkillService, make);
