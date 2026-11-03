// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { assert, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import {
  assertNativeReceipts,
  nativeArguments,
  parseNativeEvent,
  runNativeCli,
  subscriptionEnvironment,
} from "./native-cli.ts";
import { gradeSample, McpToolUseCase, nativeFixture } from "./run.ts";
import { agentWorkflowFixture } from "./agent-workflow-fixture.ts";

const decodeCase = Schema.decodeSync(Schema.fromJsonString(McpToolUseCase));
const cases = () =>
  NodeFS.readFileSync(new URL("./cases/agent-workflows.ndjson", import.meta.url), "utf8")
    .trim()
    .split("\n")
    .map((line) => decodeCase(line));

it("keeps saved CLI auth while removing inherited API billing and endpoint overrides", () => {
  assert.deepEqual(
    subscriptionEnvironment({
      HOME: "/fixture",
      PATH: "/bin",
      CODEX_HOME: "/codex",
      ANTHROPIC_API_KEY: "key",
      ANTHROPIC_AUTH_TOKEN: "token",
      ANTHROPIC_BASE_URL: "proxy",
      OPENAI_API_KEY: "key",
      CODEX_API_KEY: "key",
      CODEX_ACCESS_TOKEN: "token",
      CLAUDE_CODE_USE_BEDROCK: "1",
      CLAUDE_CODE_OAUTH_TOKEN: "token",
    }),
    {
      HOME: "/fixture",
      PATH: "/bin",
      CODEX_HOME: "/codex",
    },
  );
});

it("rejects real native execution and failed or incomplete provider results", () => {
  for (const type of ["command_execution", "file_change", "web_search", "collab_tool_call"]) {
    assert.isTrue(parseNativeEvent("codex", { type: "item.completed", item: { type } }).error);
  }
  assert.isTrue(
    parseNativeEvent("codex", {
      type: "item.completed",
      item: { type: "mcp_tool_call", server: "personal" },
    }).error,
  );
  assert.isTrue(
    parseNativeEvent("claude", {
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "Bash" }] },
    }).error,
  );
  assert.isTrue(
    parseNativeEvent("claude", { type: "result", subtype: "error_max_turns", is_error: false })
      .error,
  );
  assert.isFalse(
    parseNativeEvent("claude", {
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "mcp__t3-code__omid_team_read" }] },
    }).error,
  );
  assert.deepEqual(parseNativeEvent("codex", { type: "turn.completed" }), { completed: true });
  assert.deepEqual(
    parseNativeEvent("claude", { type: "result", subtype: "success", result: "done" }),
    { completed: true, error: false, text: "done" },
  );
});

it("does not let a CLI-denied tool attempt disappear from negative-control grading", () => {
  const event = parseNativeEvent("claude", {
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          id: "denied",
          name: "mcp__t3-code__Edit",
          input: { file: "src/name.ts" },
        },
      ],
    },
  });
  const attempts = (event.attempts ?? []).map((attempt) => ({ ...attempt, step: 0 }));
  assert.throws(() => assertNativeReceipts(attempts, []), /no matching fixture receipt: Edit/);
  assert.doesNotThrow(() =>
    assertNativeReceipts(attempts, [{ step: 0, tool: "Edit", input: { file: "src/name.ts" } }]),
  );
  assert.throws(
    () =>
      assertNativeReceipts(attempts, [{ step: 0, tool: "Edit", input: { file: "different.ts" } }]),
    /no matching/,
  );
  assert.throws(
    () => assertNativeReceipts([], [{ step: 0, tool: "Edit", input: {} }]),
    /missing native tool-use events/,
  );
  assert.equal(
    parseNativeEvent("codex", {
      type: "item.started",
      item: {
        id: "call",
        type: "mcp_tool_call",
        server: "t3-code",
        tool: "omid_team_read",
        arguments: {},
      },
    }).attempts?.[0]?.tool,
    "omid_team_read",
  );
});

it("isolates both CLIs from user tools without disabling subscription authentication", () => {
  const codex = nativeArguments(
    "codex",
    "gpt-6.1-sol",
    "high",
    "http://fixture",
    "source instructions",
    8,
  );
  assert.includeMembers(codex, [
    "--ignore-user-config",
    "--ignore-rules",
    "--ephemeral",
    "read-only",
    'model_provider="openai"',
    'forced_login_method="chatgpt"',
    "features.shell_tool=false",
    "features.plugins=false",
    "features.apps=false",
    'mcp_servers.t3-code.url="http://fixture"',
  ]);
  const claude = nativeArguments(
    "claude",
    "claude-sonnet-5-5",
    "high",
    "http://fixture",
    "source instructions",
    8,
  );
  assert.includeMembers(claude, [
    "--tools",
    "",
    "--strict-mcp-config",
    "--setting-sources",
    "--no-session-persistence",
    "--disable-slash-commands",
  ]);
  assert.notInclude(claude, "--bare");
  assert.notInclude(claude, "--dangerously-skip-permissions");
});

it("grades yield and order by native tool attempts even when HTTP receipts arrive in reverse", () => {
  const attempts = [
    { step: 0, tool: "omid_team_message", input: { kind: "question" } },
    { step: 1, tool: "omid_team_read", input: {} },
  ];
  const calls = assertNativeReceipts(attempts, [...attempts].reverse());
  const checks = gradeSample(
    { endsTurnAfter: "omid_team_message" },
    { calls, text: "", stopReason: "end_turn" },
  );
  assert.isTrue(checks.some((check) => !check.pass));
  assert.deepEqual(
    calls.map(({ tool }) => tool),
    ["omid_team_message", "omid_team_read"],
  );
});

it("uses source workflow context and fixture data, and fails closed on unmodelled host work", async () => {
  const reviewer = cases().find(({ id }) => id === "WF-REVIEWER")!;
  const fixture = nativeFixture(reviewer, "claude-sonnet-5-5");
  assert.include(fixture.prompt, agentWorkflowFixture("reviewer").instructions);
  assert.include(fixture.instructions, "T3 Code");
  assert.includeMembers(
    fixture.tools.map(({ name }) => name),
    ["omid_team_read", "omid_assignment_result", "Read", "Bash"],
  );
  assert.include(
    JSON.stringify(await fixture.call("Read", { file_path: "/home/user/acme/app/src/name.ts" })),
    "name != null",
  );
  assert.include(
    JSON.stringify(await fixture.call("Bash", { command: "vp test run src/name.test.ts" })),
    "received true",
  );
  assert.include(
    JSON.stringify(
      await fixture.call("Bash", {
        command: "cd /home/user/acme/app && git rev-parse HEAD && git diff a b",
      }),
    ),
    "b".repeat(40),
  );
  await expect(fixture.call("Read", { file_path: "/etc/passwd" })).rejects.toThrow(
    /Missing native eval fixture/,
  );
  await expect(fixture.call("Bash", { command: "git push" })).rejects.toThrow(
    /Missing native eval fixture/,
  );
  await expect(fixture.call("Bash", { command: "git diff && git push" })).rejects.toThrow(
    /Missing native eval fixture/,
  );
  await expect(fixture.call("omid_assignment_start", {})).rejects.toThrow(
    /Invalid native eval tool input/,
  );
  assert.throws(
    () =>
      nativeFixture(
        { ...reviewer, setup: { ...reviewer.setup, role: "native-subagent" } },
        "gpt-6.1-sol",
      ),
    /currently support top-level/,
  );
});

it("advertises the requested native Codex effort in inherited provider capabilities", async () => {
  const fixture = nativeFixture(
    cases().find(({ id }) => id === "WF-MANAGER")!,
    "gpt-6.1-sol",
    "medium",
  );
  const result = await fixture.call("orchestrator_capabilities", {});
  const data = JSON.parse(result.content[0]!.text);
  assert.equal(data.inheritedProviderInstanceId, "codex");
  assert.deepEqual(data.inheritedOptions, [{ id: "reasoningEffort", value: "medium" }]);
});

it("awaits its owned CLI exit before removing fixture resources on cancellation", async () => {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-native-cli-test-"));
  const binary = NodePath.join(directory, "fake-codex");
  const marker = NodePath.join(directory, "exit.json");
  const controller = new AbortController();
  try {
    await NodeFSP.writeFile(
      binary,
      `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
process.on('SIGTERM', () => { writeFileSync(${JSON.stringify(marker)}, JSON.stringify({cwd:process.cwd()})); process.exit(0); });
const option=process.argv.find(value=>value.startsWith('mcp_servers.t3-code.url='));
await fetch(JSON.parse(option.slice(option.indexOf('=')+1)), {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'finish',arguments:{}}})});
`,
      { mode: 0o755 },
    );
    await expect(
      runNativeCli(
        "codex",
        "gpt-6.1-sol",
        "high",
        {
          instructions: "fixture",
          prompt: "fixture",
          tools: [],
          call: async () => {
            controller.abort();
            return { content: [{ type: "text", text: "done" }], isError: false };
          },
        },
        3,
        { executable: binary, signal: controller.signal },
      ),
    ).rejects.toThrow(/cancelled/);
    const receipt: { cwd: string } = JSON.parse(await NodeFSP.readFile(marker, "utf8"));
    assert.isFalse(NodeFS.existsSync(receipt.cwd));
  } finally {
    await NodeFSP.rm(directory, { recursive: true, force: true });
  }
});
