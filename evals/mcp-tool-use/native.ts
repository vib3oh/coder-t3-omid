#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import * as Schema from "effect/Schema";
import { gradeSample, McpToolUseCase, nativeFixture } from "./run.ts";
import { assertSubscriptionLogin, runNativeCli } from "./native-cli.ts";

const positive = (value: string, flag: string) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`${flag} must be a positive integer`);
  return n;
};

async function main() {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  const { values } = NodeUtil.parseArgs({
    options: {
      model: { type: "string", default: "gpt-6.1-sol" },
      effort: { type: "string", default: "high" },
      cases: {
        type: "string",
        default: NodePath.join(import.meta.dirname, "cases/agent-workflows.ndjson"),
      },
      case: { type: "string", multiple: true },
      samples: { type: "string", default: "2" },
      out: { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
  });
  const model = values.model;
  if (!["gpt-6.1-sol", "gpt-6-astra", "claude-sonnet-5-5", "claude-opus-5-5"].includes(model))
    throw new Error("Unsupported native eval model; no automatic substitution is performed.");
  const typedModel = model as Parameters<typeof nativeFixture>[1];
  if (!["low", "medium", "high", "xhigh", "max"].includes(values.effort))
    throw new Error("Unsupported effort");
  const samples = positive(values.samples, "--samples");
  if (!values.out && !values["dry-run"]) throw new Error("Pass --out <directory>");
  const provider = model.startsWith("gpt-") ? "codex" : "claude";
  const decode = Schema.decodeUnknownSync(Schema.fromJsonString(McpToolUseCase));
  const cases = (await NodeFSP.readFile(values.cases, "utf8"))
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => decode(line));
  const wanted = values.case?.flatMap((ids) => ids.split(","));
  if (wanted?.some((id) => !cases.some((testCase) => testCase.id === id)))
    throw new Error("Unknown --case id");
  const selected = cases.filter(
    (testCase) =>
      (!wanted || wanted.includes(testCase.id)) &&
      (!testCase.setup.harness || testCase.setup.harness === provider),
  );
  if (!selected.length) throw new Error("No compatible cases selected");
  // Build all fixtures before invoking a provider, so unsupported setups spend no quota.
  for (const testCase of selected) nativeFixture(testCase, typedModel, values.effort);
  if (values["dry-run"]) {
    process.stdout.write(
      `${JSON.stringify({ backend: "native-cli", provider, model, cases: selected.map(({ id }) => id), samples, auth: "saved-subscription-login", shell: "deterministic-fixtures" })}\n`,
    );
    return;
  }
  await assertSubscriptionLogin(provider);
  const out = NodePath.resolve(values.out!);
  await NodeFSP.mkdir(out, { recursive: true });
  const head = NodeChildProcess.execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const dirty =
    NodeChildProcess.execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim() !==
    "";
  const version = NodeChildProcess.execFileSync(provider, ["--version"], {
    encoding: "utf8",
  }).trim();
  const rows: Array<{ id: string; pass: boolean; [key: string]: unknown }> = [];
  evaluation: for (const testCase of selected) {
    for (let sample = 1; sample <= samples; sample++) {
      if (controller.signal.aborted) {
        process.exitCode = 130;
        break evaluation;
      }
      const identity = {
        backend: "native-cli",
        provider,
        model,
        version,
        head,
        dirty,
        id: testCase.id,
        sample,
      };
      try {
        const run = await runNativeCli(
          provider,
          model,
          values.effort,
          nativeFixture(testCase, typedModel, values.effort),
          testCase.maxSteps ?? 10,
          { signal: controller.signal },
        );
        const checks = gradeSample(testCase.expect, run);
        rows.push({ ...identity, ...run, pass: checks.every((check) => check.pass), checks });
      } catch (error) {
        rows.push({
          ...identity,
          pass: false,
          error: error instanceof Error ? error.message : "Native eval failed",
        });
      }
      process.stdout.write(
        `${testCase.id} ${sample}/${samples}: ${rows.at(-1)?.pass ? "pass" : "FAIL"}\n`,
      );
      await NodeFSP.writeFile(
        NodePath.join(out, "results.jsonl"),
        `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
      );
    }
  }
  const failed = rows.filter((row) => !row.pass);
  const summary = [
    "# Native CLI MCP eval",
    "",
    `Source: ${head}${dirty ? " (dirty; provisional results)" : " (clean)"}.`,
    `Provider: ${version}; model ${model}; effort ${values.effort}.`,
    `Backend: native-cli. Saved subscription login; usage counts against the provider plan. No API-price estimate.`,
    "Real provider harness, current T3 instructions/tool schemas, deterministic fixture tools. No model shell simulator or host tool execution.",
    "These results are separate from API capture replay and are not a full API-suite pass.",
    "",
    `Passed ${rows.length - failed.length}/${rows.length} samples; ${rows.filter((row) => "error" in row).length} infrastructure/model errors count as failures.`,
    "",
    "| Case | Passed |",
    "| --- | --- |",
    ...selected.map(
      ({ id }) =>
        `| ${id} | ${rows.filter((row) => row.id === id && row.pass).length}/${samples} |`,
    ),
    "",
  ].join("\n");
  await NodeFSP.writeFile(NodePath.join(out, "summary.md"), summary);
  process.stdout.write(`${summary}\n`);
  if (failed.length) process.exitCode = 1;
}

if (import.meta.main)
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Native eval failed"}\n`);
    process.exitCode = 1;
  });
