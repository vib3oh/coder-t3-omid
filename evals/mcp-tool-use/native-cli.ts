// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics globalTimers:off
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeHttp from "node:http";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";
import { normalizeToolName, type SampleRun } from "./run.ts";

export type NativeProvider = "codex" | "claude";
export type NativeFixture = {
  readonly instructions: string;
  readonly prompt: string;
  readonly tools: ReadonlyArray<{ name: string; description: string; inputSchema: unknown }>;
  readonly call: (
    name: string,
    input: unknown,
  ) => Promise<{
    content: Array<{ type: "text"; text: string }>;
    isError: boolean;
  }>;
};
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const diagnostic = (value: unknown) =>
  String(value)
    .slice(0, 2_000)
    .replaceAll(NodeOS.homedir(), "/home/user")
    .replace(/(?:sk-[\w-]+|Bearer\s+[^\s"']+)/gi, "[redacted]");

export const subscriptionEnvironment = (env: NodeJS.ProcessEnv) =>
  Object.fromEntries(
    Object.entries(env).filter(
      ([key]) =>
        !/^(?:ANTHROPIC_|OPENAI_|CODEX_(?:API_KEY|ACCESS_TOKEN)|CLAUDE_CODE_(?:USE_|OAUTH_TOKEN))/.test(
          key,
        ),
    ),
  );

export const nativeArguments = (
  provider: NativeProvider,
  model: string,
  effort: string,
  url: string,
  instructions: string,
  maxSteps: number,
) =>
  provider === "claude"
    ? [
        "-p",
        "--verbose",
        "--output-format",
        "stream-json",
        "--model",
        model,
        "--effort",
        effort,
        "--max-turns",
        String(maxSteps),
        "--tools",
        "",
        "--setting-sources",
        "",
        "--settings",
        JSON.stringify({ disableAllHooks: true, autoMemoryEnabled: false }),
        "--strict-mcp-config",
        "--mcp-config",
        JSON.stringify({ mcpServers: { "t3-code": { type: "http", url } } }),
        "--allowedTools",
        "mcp__t3-code__*",
        "--disable-slash-commands",
        "--no-session-persistence",
        "--append-system-prompt",
        instructions,
      ]
    : [
        "exec",
        "--ignore-user-config",
        "--ignore-rules",
        "--ephemeral",
        "--skip-git-repo-check",
        "--json",
        "--sandbox",
        "read-only",
        "--model",
        model,
        ...Object.entries({
          approval_policy: "never",
          model_provider: "openai",
          forced_login_method: "chatgpt",
          model_reasoning_effort: effort,
          project_doc_max_bytes: 0,
          web_search: "disabled",
          suppress_unstable_features_warning: true,
          "features.skip_host_skill_discovery": true,
          "features.shell_tool": false,
          "features.unified_exec": false,
          "features.view_image": false,
          "features.multi_agent": false,
          "features.plugins": false,
          "features.hooks": false,
          "features.memories": false,
          "features.skill_search": false,
          "features.apps": false,
          "features.image_generation": false,
          "features.computer_use": false,
          "features.browser_use": false,
          "features.in_app_browser": false,
          "features.sleep_tool": false,
          developer_instructions: instructions,
          "mcp_servers.t3-code.url": url,
          "mcp_servers.t3-code.required": true,
          "mcp_servers.t3-code.default_tools_approval_mode": "approve",
        }).flatMap(([key, value]) => ["-c", `${key}=${JSON.stringify(value)}`]),
        "-",
      ];

export const parseNativeEvent = (provider: NativeProvider, event: unknown) => {
  if (!record(event)) throw new Error("Invalid native CLI event");
  if (provider === "claude") {
    if (event.type === "result")
      return {
        completed: event.subtype === "success" && event.is_error !== true,
        error: event.subtype !== "success" || event.is_error === true,
        text: typeof event.result === "string" ? event.result : undefined,
      };
    if (
      event.type === "assistant" &&
      record(event.message) &&
      Array.isArray(event.message.content)
    ) {
      const foreign = event.message.content.some(
        (block: unknown) =>
          record(block) &&
          block.type === "tool_use" &&
          (typeof block.name !== "string" || !block.name.startsWith("mcp__t3-code__")),
      );
      const text = event.message.content
        .flatMap((block: unknown) =>
          record(block) && block.type === "text" && typeof block.text === "string"
            ? [block.text]
            : [],
        )
        .join("\n\n");
      const attempts = event.message.content.flatMap((block: unknown) =>
        record(block) && block.type === "tool_use"
          ? [
              {
                id: String(block.id),
                tool: normalizeToolName(String(block.name)),
                input: block.input,
              },
            ]
          : [],
      );
      return { error: foreign, attempts, ...(text ? { text } : {}) };
    }
  } else {
    if (event.type === "turn.completed") return { completed: true };
    if (event.type === "turn.failed" || event.type === "error")
      return {
        error: true,
        detail: diagnostic(
          record(event.error) ? event.error.message : (event.message ?? "Codex turn failed"),
        ),
      };
    if ((event.type === "item.started" || event.type === "item.completed") && record(event.item)) {
      const item = event.item;
      if (item.type === "error") return { error: true, detail: diagnostic(item.message) };
      if (item.type === "agent_message")
        return { text: typeof item.text === "string" ? item.text : undefined };
      if (!["mcp_tool_call", "reasoning", "todo_list"].includes(String(item.type)))
        return { error: true, detail: `Unexpected Codex item: ${String(item.type)}` };
      if (item.type === "mcp_tool_call" && item.server !== "t3-code")
        return { error: true, detail: `Unexpected Codex MCP server: ${String(item.server)}` };
      if (item.type === "mcp_tool_call")
        return {
          attempts: [
            {
              id: String(item.id),
              tool: String(item.tool).startsWith("mcp__")
                ? normalizeToolName(String(item.tool))
                : String(item.tool),
              input: item.arguments,
            },
          ],
        };
    }
  }
  return {};
};

const canonical = (value: unknown): string =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(",")}]`
    : record(value)
      ? `{${Object.keys(value)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
          .join(",")}}`
      : (JSON.stringify(value) ?? "null");

export const assertNativeReceipts = (
  attempts: SampleRun["calls"],
  receipts: SampleRun["calls"],
) => {
  const pending = [...receipts];
  const ordered: Array<SampleRun["calls"][number]> = [];
  for (const attempt of attempts) {
    const at = pending.findIndex(
      (receipt) =>
        receipt.tool === attempt.tool && canonical(receipt.input) === canonical(attempt.input),
    );
    if (at < 0)
      throw new Error(`Native tool attempt has no matching fixture receipt: ${attempt.tool}`);
    ordered.push({ ...pending.splice(at, 1)[0]!, ...attempt, step: ordered.length });
  }
  if (pending.length) throw new Error("Fixture receipts are missing native tool-use events");
  return ordered;
};

const collect = async (binary: string, args: string[], env: NodeJS.ProcessEnv, cwd: string) => {
  const child = NodeChildProcess.spawn(binary, args, {
    env,
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    signal: AbortSignal.timeout(20_000),
  });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString();
    if (output.length > 64_000) child.kill();
  });
  child.stderr.resume();
  await new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error("Native CLI authentication check failed")),
    );
  });
  return output;
};

export const assertSubscriptionLogin = async (provider: NativeProvider) => {
  const env = subscriptionEnvironment(process.env);
  if (provider === "codex") {
    const child = NodeChildProcess.spawn("codex", ["login", "status"], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      signal: AbortSignal.timeout(20_000),
    });
    let output = "";
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (chunk: Buffer) => {
        output += chunk.toString();
      });
    const code = await new Promise<number | null>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    });
    if (code !== 0 || !output.includes("Logged in using ChatGPT"))
      throw new Error("Codex requires an existing ChatGPT CLI login; run codex login.");
  } else {
    const data: unknown = JSON.parse(
      await collect("claude", ["auth", "status", "--json"], env, NodeOS.tmpdir()),
    );
    if (
      !record(data) ||
      data.loggedIn !== true ||
      data.authMethod !== "claude.ai" ||
      data.apiProvider !== "firstParty"
    ) {
      throw new Error(
        "Claude requires an existing first-party subscription CLI login; run claude auth login.",
      );
    }
  }
};

/** Only the authored mock server is exposed; provider binaries retain ownership of saved auth. */
export async function runNativeCli(
  provider: NativeProvider,
  model: string,
  effort: string,
  fixture: NativeFixture,
  maxSteps: number,
  options: { signal?: AbortSignal; executable?: string } = {},
): Promise<SampleRun> {
  const cwd = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-native-eval-"));
  const calls: Array<SampleRun["calls"][number]> = [];
  let failure: Error | undefined;
  let ownedChild: ReturnType<typeof NodeChildProcess.spawn> | undefined;
  let exited: Promise<number | null> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let forceStop: ReturnType<typeof setTimeout> | undefined;
  const stopChild = () => {
    if (!ownedChild || ownedChild.exitCode !== null || ownedChild.signalCode !== null) return;
    ownedChild.kill("SIGTERM");
    forceStop ??= setTimeout(() => {
      ownedChild?.kill("SIGKILL");
    }, 5_000);
    forceStop.unref();
  };
  let queue = Promise.resolve();
  const route = `/mcp/${NodeCrypto.randomUUID()}`;
  const server = NodeHttp.createServer(async (request, response) => {
    if (request.url !== route || request.method !== "POST") {
      response.writeHead(404).end();
      return;
    }
    try {
      let body = "";
      for await (const chunk of request) {
        body += String(chunk);
        if (body.length > 1_000_000) throw new Error("Native MCP request too large");
      }
      const message: unknown = JSON.parse(body);
      if (!record(message)) throw new Error("Invalid native MCP request");
      if (message.id === undefined) {
        response.writeHead(202).end();
        return;
      }
      let result: unknown;
      if (message.method === "initialize")
        result = {
          protocolVersion: "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "t3-code-eval", version: "1" },
        };
      else if (message.method === "tools/list") result = { tools: fixture.tools };
      else if (message.method === "ping") result = {};
      else if (
        message.method === "tools/call" &&
        record(message.params) &&
        typeof message.params.name === "string"
      ) {
        const { name, arguments: input } = message.params;
        const run = queue.then(async () => {
          if (failure) throw failure;
          if (calls.length >= maxSteps * 8) throw new Error("Native eval tool budget exceeded");
          const call = { step: calls.length, tool: name, input };
          calls.push(call);
          const value = await fixture.call(name, input);
          Object.assign(call, {
            failed: value.isError,
            output: value.content.map((block) => block.text).join("\n"),
          });
          return value;
        });
        queue = run.then(
          () => {},
          () => {},
        );
        result = await run;
      } else {
        response.writeHead(200, { "Content-Type": "application/json" }).end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32601, message: "Unsupported eval MCP method" },
          }),
        );
        return;
      }
      response
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
    } catch (error) {
      failure = error instanceof Error ? error : new Error("Native mock tool failed");
      response.writeHead(500).end();
      stopChild();
    }
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Native eval listener unavailable");
    const child = NodeChildProcess.spawn(
      options.executable ?? provider,
      nativeArguments(
        provider,
        model,
        effort,
        `http://127.0.0.1:${address.port}${route}`,
        fixture.instructions,
        maxSteps,
      ),
      {
        cwd,
        env: subscriptionEnvironment(process.env),
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    ownedChild = child;
    exited = new Promise<number | null>((resolve) => {
      child.on("error", (error) => {
        failure ??= error;
        stopChild();
      });
      child.on("close", resolve);
    });
    deadline = setTimeout(() => {
      failure ??= new Error("Native eval exceeded its process budget");
      stopChild();
    }, 180_000);
    deadline.unref();
    const cancel = () => {
      failure ??= new Error("Native eval cancelled");
      stopChild();
    };
    options.signal?.addEventListener("abort", cancel, { once: true });
    if (options.signal?.aborted) cancel();
    child.stdin.on("error", () => {});
    child.stdin.end(fixture.prompt);
    child.stderr.resume();
    const lines = NodeReadline.createInterface({ input: child.stdout });
    let completed = false;
    let text = "";
    const said: string[] = [];
    const attempts = new Map<string, SampleRun["calls"][number]>();
    let bytes = 0;
    lines.on("line", (line) => {
      try {
        bytes += line.length;
        if (bytes > 4_000_000) throw new Error("Native eval output budget exceeded");
        const parsed = parseNativeEvent(provider, JSON.parse(line));
        if (parsed.error)
          throw new Error(
            parsed.detail ?? "Native CLI failed or used a tool outside the fixture server",
          );
        if (parsed.completed) completed = true;
        for (const attempt of parsed.attempts ?? []) {
          const previous = attempts.get(attempt.id);
          if (
            previous &&
            (previous.tool !== attempt.tool ||
              canonical(previous.input) !== canonical(attempt.input))
          )
            throw new Error("Native tool-use id changed arguments");
          if (!previous)
            attempts.set(attempt.id, {
              step: attempts.size,
              tool: attempt.tool,
              input: attempt.input,
            });
        }
        if (parsed.text !== undefined) {
          text = parsed.text;
          if (said.at(-1) !== text) said.push(text);
        }
      } catch (error) {
        failure = error instanceof Error ? error : new Error("Invalid native CLI output");
        stopChild();
      }
    });
    const code = await exited;
    options.signal?.removeEventListener("abort", cancel);
    await queue;
    if (failure) throw failure;
    if (code !== 0 || !completed)
      throw new Error(`Native CLI did not complete successfully (exit ${code})`);
    const orderedCalls = assertNativeReceipts([...attempts.values()], calls);
    return {
      calls: orderedCalls,
      text: said.join("\n\n"),
      finalText: text,
      stopReason: "end_turn",
    };
  } finally {
    if (deadline) clearTimeout(deadline);
    if (exited) {
      stopChild();
      await exited;
    }
    if (forceStop) clearTimeout(forceStop);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await NodeFSP.rm(cwd, { recursive: true, force: true });
  }
}
