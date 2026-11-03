import * as NodeServices from "@effect/platform-node/NodeServices";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { assert, it } from "@effect/vitest";
import {
  DEFAULT_AGENT_WORKFLOW_LIMITS,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  TurnItemId,
  type AgentArtifactInput,
  type AgentAssignment,
  type AgentWorkflow,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { verifyWorkflowEvidence, type WorkflowEvidencePorts } from "./WorkflowEvidence.ts";
import { workflowCheckCommand } from "./checkCommands.ts";

const base = "a".repeat(40);
const head = "b".repeat(40);
const snapshotRef = "refs/t3/agent-workflows/snapshot";
const threadId = ThreadId.make("worker");
const runId = RunId.make("worker-run");
const projectId = ProjectId.make("project");
const selection = { instanceId: ProviderInstanceId.make("codex"), model: "fixture" };

function fixture() {
  const assignment: AgentAssignment = {
    id: "build",
    generation: 0,
    compiledBrief: "",
    objective: "Implement the accepted criteria",
    criteria: [],
    inputArtifactIds: [],
    dependencies: [],
    state: "awaiting_result",
    writeResponsibility: true,
    baseRef: base,
    workspacePath: "/workspace",
    attempts: [],
    artifactIds: [],
    checkpoint: { ref: snapshotRef, commitSha: head },
    requiredChecks: ["vp test run affected.test.ts"],
    role: {
      role: {
        id: "builder",
        name: "Builder",
        kind: "builder",
        version: 1,
        mission: "Implement accepted work",
        instructions: "Preserve scope",
        requiredSkills: [],
        optionalSkills: [],
        outputKind: "implementation",
        modelSelection: null,
        enabled: true,
      },
      instructionHash: "role",
      skills: [],
      modelSelection: selection,
      capabilities: [],
    },
  };
  const artifact: AgentArtifactInput = {
    kind: "implementation",
    summary: "Implemented",
    content: "Revision-bound implementation result",
    baseRef: base,
    headRef: head,
    reviewedHead: null,
    outcome: "accepted",
    criteria: [],
    checks: [
      {
        command: "vp test run affected.test.ts",
        revision: head,
        status: "passed",
        evidence: "turn-item:check",
        required: true,
      },
    ],
    findings: [],
    limitations: [],
  };
  const workflow: AgentWorkflow = {
    id: "workflow",
    projectId,
    title: "Implement a feature",
    objective: "Implement accepted work",
    managerThreadId: ThreadId.make("manager"),
    managerRole: null,
    managerBrief: "",
    roleIds: { planner: "planner", builder: "builder", reviewer: "reviewer" },
    specSnapshot: null,
    sourceThreadId: null,
    cardId: null,
    cardRevision: null,
    generation: 0,
    revision: 0,
    status: "running",
    limits: DEFAULT_AGENT_WORKFLOW_LIMITS,
    modelSelection: selection,
    runtimeMode: "auto-accept-edits",
    interactionMode: "default",
    workspaceStrategy: { type: "root" },
    workspacePath: "/workspace",
    baseRef: base,
    criteria: [],
    requiredChecks: ["vp test run affected.test.ts"],
    createdAt: 0,
    updatedAt: 0,
    assignments: [assignment],
    participants: [],
    messages: [],
    artifacts: [],
    intents: [],
  };
  const commands = [
    {
      id: TurnItemId.make("check"),
      threadId,
      runId,
      type: "command_execution" as const,
      input: workflowCheckCommand(snapshotRef, artifact.checks[0]!.command),
      status: "completed" as const,
      exitCode: 0,
      output: `${head}\nTests passed\n${head}\n`,
      outputIndicatesFailure: false,
      outputOmitted: false,
      monitor: false,
    },
  ];
  const ports: WorkflowEvidencePorts = {
    readThread: () =>
      Effect.succeed({ projectId, workspacePath: "/workspace", runIds: [runId], commands }),
    resolveCommit: (_cwd, revision) => Effect.succeed(revision === snapshotRef ? head : revision),
    matchesSnapshot: () => Effect.succeed(true),
  };
  return {
    assignment,
    artifact,
    workflow,
    ports,
    commands,
    input: { workflow, assignment, artifact, actorThreadId: threadId, actorRunId: runId },
  };
}

it.effect(
  "binds passed checks to canonical commands from the actor run and hashes the actual content",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const result = yield* verifyWorkflowEvidence(f.ports, f.input);
      assert.equal(result.verified, true);
      const canonicalId = TurnItemId.make("turn-item:provider:codex:native-item:check");
      f.commands[0]!.id = canonicalId;
      const canonicalInput = {
        ...f.input,
        artifact: {
          ...f.artifact,
          checks: [{ ...f.artifact.checks[0]!, evidence: canonicalId }],
        },
      };
      const wrapped = workflowCheckCommand(snapshotRef, f.artifact.checks[0]!.command);
      for (const input of [
        wrapped,
        JSON.stringify({ command: wrapped }),
        `/bin/zsh -lc '${wrapped.replaceAll("'", "'\\''")}'`,
        `/bin/bash -c "${wrapped.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`,
      ]) {
        f.commands[0]!.input = input;
        assert.equal((yield* verifyWorkflowEvidence(f.ports, canonicalInput)).verified, true);
      }
      const validInput = f.commands[0]!.input;
      for (const input of [
        `${validInput} && echo forged`,
        `/bin/zsh -lc "$(printf forged)"`,
        `/bin/zsh -lc '${wrapped.replaceAll("'", "'\\''")}' extra`,
      ]) {
        f.commands[0]!.input = input;
        assert.equal(
          (yield* verifyWorkflowEvidence(f.ports, canonicalInput).pipe(Effect.flip)).reason,
          "evidence",
        );
      }
      f.commands[0]!.id = TurnItemId.make("check");
      f.commands[0]!.input = wrapped;
      assert.deepEqual(result.verifiedRequiredChecks, ["vp test run affected.test.ts"]);
      const optionalFlag = {
        ...f.artifact,
        checks: [{ ...f.artifact.checks[0]!, required: false }],
      };
      assert.deepEqual(
        (yield* verifyWorkflowEvidence(f.ports, { ...f.input, artifact: optionalFlag }))
          .verifiedRequiredChecks,
        ["vp test run affected.test.ts"],
      );
      const changed = yield* verifyWorkflowEvidence(f.ports, {
        ...f.input,
        artifact: { ...f.artifact, content: "Changed report" },
      });
      assert.notEqual(result.contentHash, changed.contentHash);
      for (const commands of [
        [{ ...f.commands[0]!, runId: RunId.make("old-run") }],
        [{ ...f.commands[0]!, exitCode: 1 }],
        [{ ...f.commands[0]!, outputIndicatesFailure: true }],
        [{ ...f.commands[0]!, status: "running" as const }],
        [{ ...f.commands[0]!, input: "echo tests passed" }],
        [{ ...f.commands[0]!, monitor: true }],
        [{ ...f.commands[0]!, output: "The tests passed" }],
      ]) {
        const ports = {
          ...f.ports,
          readThread: () =>
            Effect.succeed({ projectId, workspacePath: "/workspace", runIds: [runId], commands }),
        };
        assert.equal(
          (yield* verifyWorkflowEvidence(ports, f.input).pipe(Effect.flip)).reason,
          "evidence",
        );
      }
      const forged = {
        ...f.artifact,
        checks: [{ ...f.artifact.checks[0]!, evidence: "tests passed in a log" }],
      };
      assert.equal(
        (yield* verifyWorkflowEvidence(f.ports, { ...f.input, artifact: forged }).pipe(Effect.flip))
          .reason,
        "evidence",
      );
      const skipped = {
        ...f.artifact,
        checks: [{ ...f.artifact.checks[0]!, required: false, status: "skipped" as const }],
      };
      assert.equal(
        (yield* verifyWorkflowEvidence(f.ports, { ...f.input, artifact: skipped }).pipe(
          Effect.flip,
        )).reason,
        "evidence",
      );
    }),
);

it.effect(
  "rejects changed snapshots or foreign work instead of trusting claimed revision strings",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const blocked = yield* verifyWorkflowEvidence(
        { ...f.ports, matchesSnapshot: () => Effect.succeed(false) },
        {
          ...f.input,
          assignment: { ...f.assignment, checkpoint: null },
          artifact: {
            ...f.artifact,
            outcome: "blocked",
            headRef: null,
            baseRef: null,
            checks: [],
            limitations: ["Native command evidence is unavailable."],
          },
        },
      );
      assert.equal(blocked.verified, false);
      assert.deepEqual(blocked.verifiedRequiredChecks, []);

      assert.equal(
        (yield* verifyWorkflowEvidence(
          { ...f.ports, matchesSnapshot: () => Effect.succeed(false) },
          f.input,
        ).pipe(Effect.flip)).reason,
        "evidence",
      );
      const moved = {
        ...f.ports,
        resolveCommit: (_cwd: string, revision: string) =>
          Effect.succeed(revision === snapshotRef ? "c".repeat(40) : revision),
      };
      assert.equal(
        (yield* verifyWorkflowEvidence(moved, f.input).pipe(Effect.flip)).reason,
        "evidence",
      );
      let observations = 0;
      const changedDuringVerification = {
        ...f.ports,
        matchesSnapshot: () => Effect.sync(() => observations++ === 0),
      };
      assert.equal(
        (yield* verifyWorkflowEvidence(changedDuringVerification, f.input).pipe(Effect.flip))
          .reason,
        "evidence",
      );
      const foreign = {
        ...f.ports,
        readThread: () =>
          Effect.succeed({
            projectId: ProjectId.make("foreign"),
            workspacePath: "/workspace",
            runIds: [runId],
            commands: f.commands,
          }),
      };
      assert.equal(
        (yield* verifyWorkflowEvidence(foreign, f.input).pipe(Effect.flip)).reason,
        "forbidden",
      );
    }),
);

it.effect(
  "invalidates review against a different accepted implementation and never upgrades planning checkboxes",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const reviewer = {
        ...f.assignment,
        writeResponsibility: false,
        role: {
          ...f.assignment.role,
          role: {
            ...f.assignment.role.role,
            kind: "reviewer" as const,
            outputKind: "review" as const,
          },
        },
      };
      const review = { ...f.artifact, kind: "review" as const, reviewedHead: head };
      assert.equal(
        (yield* verifyWorkflowEvidence(f.ports, {
          ...f.input,
          assignment: reviewer,
          artifact: review,
        }).pipe(Effect.flip)).reason,
        "review_stale",
      );
      const implementation = {
        ...f.artifact,
        id: "implementation",
        version: 1,
        assignmentId: f.assignment.id,
        producerThreadId: threadId,
        producerRunId: runId,
        contentHash: "implementation-hash",
        validation: "verified" as const,
        createdAt: 0,
      };
      const workflow = {
        ...f.workflow,
        assignments: [{ ...f.assignment, state: "accepted" as const }],
        artifacts: [implementation],
      };
      assert.equal(
        (yield* verifyWorkflowEvidence(f.ports, {
          ...f.input,
          workflow,
          assignment: reviewer,
          artifact: review,
        })).verified,
        true,
      );
      const unchecked = {
        ...f.artifact,
        checks: [],
        criteria: [{ id: "criterion", passed: true, evidence: ["checked on the board"] }],
      };
      assert.equal(
        (yield* verifyWorkflowEvidence(f.ports, { ...f.input, artifact: unchecked }).pipe(
          Effect.flip,
        )).reason,
        "evidence",
      );
    }),
);

it.live("keeps revision markers separate when a successful check omits its trailing newline", () =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const output = yield* spawner.string(
      ChildProcess.make("sh", [
        "-c",
        `git() { if [ "$1" = rev-parse ]; then printf '%s\\n' '${head}'; fi; }; ${workflowCheckCommand(snapshotRef, "printf checked")}`,
      ]),
    );
    assert.deepEqual(output.trim().split("\n"), [head, "checked", head]);
  }).pipe(Effect.provide(NodeServices.layer)),
);
