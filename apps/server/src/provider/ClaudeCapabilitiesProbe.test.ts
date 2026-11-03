// @effect-diagnostics nodeBuiltinImport:off - cleanup uses Node's retrying rm, which the FileSystem service does not expose.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ClaudeSettings, type ServerProvider } from "@t3tools/contracts";
import { vi } from "vite-plus/test";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as ClaudeSdk from "@anthropic-ai/claude-agent-sdk";
import * as ServerConfig from "../config.ts";
import { prepareBuiltinSkillPackage } from "../fork/skills/BuiltinSkillService.ts";

import {
  buildClaudeCapabilitiesProbeQueryOptions,
  probeClaudeWorkspaceSnapshot,
} from "./ClaudeProvider.ts";

vi.mock("@anthropic-ai/claude-agent-sdk", { spy: true });

const decodeClaudeSettings = Schema.decodeEffect(ClaudeSettings);

it.effect.each([true, false])(
  "advertises app skills only after native plugin acceptance (%s)",
  (supported) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3-claude-plugin-probe-" });
      const { stateDir } = yield* ServerConfig.ServerConfig;
      const pkg = yield* prepareBuiltinSkillPackage(stateDir);
      const pluginAttempts: boolean[] = [];
      using _query = vi.spyOn(ClaudeSdk, "query").mockImplementation((request) => {
        const plugins = (request.options?.plugins?.length ?? 0) > 0;
        pluginAttempts.push(plugins);
        return {
          initializationResult: () =>
            plugins && !supported
              ? Promise.reject(new Error("Unknown option: --plugin-dir"))
              : Promise.resolve({
                  account: {},
                  commands: plugins
                    ? pkg.entries.map((entry) => ({
                        name: entry.claude.name,
                        description: "App procedure",
                        argumentHint: "",
                      }))
                    : [
                        {
                          name: "native-help",
                          description: "Ordinary native command",
                          argumentHint: "",
                        },
                      ],
                }),
        } as unknown as ReturnType<typeof ClaudeSdk.query>;
      });
      let accepted: boolean | undefined;
      const snapshot = yield* probeClaudeWorkspaceSnapshot(
        yield* decodeClaudeSettings({ binaryPath: "/usr/bin/claude", homePath: cwd }),
        { skills: [], slashCommands: [] } as unknown as ServerProvider,
        cwd,
        { HOME: cwd },
        (ready) =>
          Effect.sync(() => {
            accepted = ready;
          }),
      );
      assert.equal(snapshot.slashCommandsPending, false);
      assert.equal(accepted, supported);
      assert.deepEqual(pluginAttempts, supported ? [true] : [true, false]);
      assert.equal(
        snapshot.skills.filter((skill) => skill.name.startsWith("t3-vibe:")).length,
        supported ? pkg.entries.length : 0,
      );
      if (!supported)
        assert.isTrue(snapshot.slashCommands.some((command) => command.name === "native-help"));
    }).pipe(
      Effect.provide(
        ServerConfig.layerTest(process.cwd(), { prefix: "t3-claude-plugin-readiness-" }).pipe(
          Layer.provideMerge(NodeServices.layer),
        ),
      ),
    ),
);

it("drops strict MCP mode, and only that, next to an administrator's managed-mcp.json", () => {
  const options = buildClaudeCapabilitiesProbeQueryOptions({
    executablePath: "/usr/bin/claude",
    abortController: new AbortController(),
    environment: { HOME: "/home/user" },
    cwd: undefined,
    managedMcpConfig: true,
  });

  // Claude exits before initializing when handed --strict-mcp-config here.
  assert.equal(options.strictMcpConfig, undefined);
  assert.deepEqual(options.mcpServers, {});
  assert.equal(options.env?.ENABLE_CLAUDEAI_MCP_SERVERS, "false");
});

it.effect("reports a deleted worktree's scan as finished, not pending", () =>
  Effect.gen(function* () {
    const snapshot = yield* probeClaudeWorkspaceSnapshot(
      yield* decodeClaudeSettings({}),
      { skills: [], slashCommands: [] } as unknown as ServerProvider,
      "/nonexistent/t3-deleted-worktree",
      { HOME: "/nonexistent/t3-home" },
    );
    assert.strictEqual(snapshot.slashCommandsPending, false);
  }).pipe(Effect.provide(NodeServices.layer)),
);
