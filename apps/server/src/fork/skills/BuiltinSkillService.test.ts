import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProviderInstanceId, type AgentRolePreset } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  compileBuiltinRole,
  prepareBuiltinSkillPackage,
  verifyBuiltinSkillPackage,
} from "./BuiltinSkillService.ts";

const planner = {
  id: "planner",
  kind: "planner",
  name: "Planner",
  version: 1,
  mission: "Define accepted work.",
  instructions: "Preserve the requested scope.",
  requiredSkills: ["spec"],
  optionalSkills: [],
  outputKind: "spec",
  modelSelection: null,
  enabled: true,
} satisfies AgentRolePreset;

const selection = { instanceId: ProviderInstanceId.make("codex"), model: "fixture" };

it.layer(NodeServices.layer)("built-in skills", (it) => {
  it.effect("materializes immutable native packages without replacing modified files", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-builtin-skills-" });
      const [first, again] = yield* Effect.all(
        [prepareBuiltinSkillPackage(stateDir), prepareBuiltinSkillPackage(stateDir)],
        { concurrency: "unbounded" },
      );
      assert.deepEqual(again, first);
      const spec = first.entries.find((entry) => entry.id === "vibe-spec")!;
      assert.include(yield* fs.readFileString(spec.codex.path), "name: t3-vibe-spec");
      assert.include(yield* fs.readFileString(spec.claude.path), "name: vibe-spec");
      assert.equal(
        JSON.parse(
          yield* fs.readFileString(
            path.join(first.claudePluginRoot, ".claude-plugin", "plugin.json"),
          ),
        ).name,
        "t3-vibe",
      );
      yield* fs.writeFileString(spec.codex.path, "changed externally");
      const failure = yield* prepareBuiltinSkillPackage(stateDir).pipe(Effect.flip);
      assert.equal(failure.reason, "modified");
      assert.equal(yield* fs.readFileString(spec.codex.path), "changed externally");
      assert.equal((yield* verifyBuiltinSkillPackage(first).pipe(Effect.flip)).reason, "modified");
    }),
  );

  it.effect(
    "resolves aliases and transitive dependencies once without loading optional operator skills",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-builtin-skills-" });
        const pkg = yield* prepareBuiltinSkillPackage(stateDir);
        const result = compileBuiltinRole({
          role: {
            ...planner,
            requiredSkills: ["spec", "vibe-spec"],
            optionalSkills: ["hypercoder:spec", "vibe-ship", "ship-it"],
          },
          modelSelection: selection,
          provider: "fixture",
          nativeSkills: [],
          capabilities: ["filesystem", "t3.threads"],
          package: pkg,
          delivery: "task-context",
        });
        assert.equal(result.ready, true);
        assert.deepEqual(result.snapshot.role.requiredSkills, ["vibe-spec"]);
        assert.deepEqual(result.snapshot.role.optionalSkills, ["vibe-ship"]);
        assert.equal(result.snapshot.skills.filter((skill) => skill.id === "vibe-spec").length, 1);
        assert.equal(
          result.snapshot.skills.find((skill) => skill.id === "vibe-spec")?.state,
          "loaded",
        );
        assert.equal(
          result.snapshot.skills.find((skill) => skill.id === "vibe-ship")?.state,
          "unsupported",
        );
        assert.notInclude(result.brief, "# Merge request");
        assert.include(result.brief, "Feature specification");
      }),
  );

  it.effect(
    "rejects a disabled or shadowed native skill and never substitutes a same-name local file",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-builtin-skills-" });
        const pkg = yield* prepareBuiltinSkillPackage(stateDir);
        const spec = pkg.entries.find((entry) => entry.id === "vibe-spec")!;
        const input = {
          role: planner,
          modelSelection: selection,
          provider: "codex",
          capabilities: ["filesystem", "t3.threads"],
          package: pkg,
        };
        const shadowed = compileBuiltinRole({
          ...input,
          nativeSkills: [{ name: spec.codex.name, path: "/personal/spec/SKILL.md", enabled: true }],
        });
        assert.equal(shadowed.ready, false);
        assert.include(shadowed.issues.join(" "), "different source");
        const disabled = compileBuiltinRole({
          ...input,
          nativeSkills: [{ ...spec.codex, enabled: false }],
        });
        assert.equal(disabled.ready, false);
        assert.include(disabled.issues.join(" "), "disabled");
        const resolved = compileBuiltinRole({
          ...input,
          nativeSkills: [{ ...spec.codex, enabled: true }],
        });
        assert.equal(resolved.ready, true);
        assert.equal(resolved.snapshot.skills[0]?.path, spec.codex.path);
        assert.equal(resolved.snapshot.skills[0]?.state, "on_demand");
      }),
  );

  it.effect(
    "blocks missing capabilities, unavailable native delivery and excluded game references",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-builtin-skills-" });
        const pkg = yield* prepareBuiltinSkillPackage(stateDir);
        const input = {
          role: planner,
          modelSelection: selection,
          provider: "other",
          nativeSkills: [],
          package: pkg,
        };
        const native = compileBuiltinRole({ ...input, capabilities: ["filesystem", "t3.threads"] });
        assert.equal(native.ready, false);
        assert.include(native.issues.join(" "), "native skill packaging");
        const missing = compileBuiltinRole({
          ...input,
          capabilities: [],
          delivery: "task-context",
        });
        assert.equal(missing.ready, false);
        assert.include(missing.issues.join(" "), "filesystem");
        const game = compileBuiltinRole({
          ...input,
          role: { ...planner, requiredSkills: ["hypergames"] },
          capabilities: ["filesystem"],
          delivery: "task-context",
        });
        assert.equal(game.ready, false);
        assert.equal(game.snapshot.skills[0]?.state, "missing");
      }),
  );

  it.effect(
    "pins the compiled instruction hash and keeps review inspection separate from repair",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-builtin-skills-" });
        const pkg = yield* prepareBuiltinSkillPackage(stateDir);
        const input = {
          role: {
            ...planner,
            kind: "reviewer" as const,
            requiredSkills: ["review-pr"],
            outputKind: "review" as const,
          },
          modelSelection: selection,
          provider: "fixture",
          nativeSkills: [],
          capabilities: ["filesystem", "git", "shell"],
          package: pkg,
          delivery: "task-context" as const,
        };
        const result = compileBuiltinRole(input);
        assert.equal(result.ready, true);
        assert.include(result.brief, "inspect");
        assert.include(result.brief, "Do not edit");
        assert.notEqual(
          result.snapshot.instructionHash,
          compileBuiltinRole({ ...input, role: { ...input.role, instructions: "New mission" } })
            .snapshot.instructionHash,
        );
        assert.equal(
          result.snapshot.instructionHash,
          compileBuiltinRole(input).snapshot.instructionHash,
        );
      }),
  );
});
