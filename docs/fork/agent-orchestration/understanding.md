# Hypercoder agent orchestration: findings and recommendations for T3

Investigation date: 2026-11-02. Target: installed HyperCoder `0.2.0-nightly.20261102.290.1`. T3 source baseline: [`36f7afa9c7`](https://github.com/vib3oh/coder-t3-omid/tree/36f7afa9c7a6a87e331c09c001f426e35e894d5a). Roadmap modules and fork documentation cited below belong to that inspected revision; this design-only branch does not add them to main.

Read the [product spec](spec.md) for proposed behavior and the [technical design](technical-design.md) for architecture. Both are discussion drafts, not accepted implementation contracts.

## The model

A useful agent team has five separate concepts:

1. **Role**: a reusable description of responsibility, working method, tools and expected output.
2. **Agent instance**: one conversation running a provider/model with that role.
3. **Assignment**: a bounded task with inputs, acceptance criteria, an owner and a finish line.
4. **Workflow**: dependencies and rules for moving assignments through planning, implementation and review.
5. **Communication**: addressed messages, questions, replies and handoff artifacts.

The role is an operating procedure, not a new model or a guarantee of expertise. The same provider can run a planner, builder and reviewer in separate conversations. A manager may itself use the planner role. Provider-native subagents and persistent project staff are different lifecycle choices, not additional role types.

## What Hypercoder actually contains

The following distinguishes packaged implementation, installed workflow guidance and inference. Static code proves that a path exists; it does not prove that it executes correctly in a live session.

### Roles

The main bundle contains a versioned catalog with the following visible presets. Names of workflows below are Hypercoder identifiers, not instructions to install or run them here.

| Role     | Intended responsibility                                        | Workflows named by the preset                                 |
| -------- | -------------------------------------------------------------- | ------------------------------------------------------------- |
| Planner  | Own roadmap/specs and steer workers                            | `roadmap`, `spec`, `roadmap-audit`, `workspaces`, `changelog` |
| Designer | Produce visual options, settle design, hand off implementation | `prototype`, `spec`                                           |
| Builder  | Complete one card, including code, tests and PR                | `commit`, `new-pr`, `ship-it`                                 |
| Debugger | Reproduce one defect and fix it with evidence                  | `debug`, `ios-simulator`                                      |
| Reviewer | Verify and rank findings, send fixes to the author             | `review-pr`                                                   |

The catalog also has unlisted DJ and Chief of Staff entries. The catalog is a fixed array in this build. I did not find a general custom-role authoring path in the inspected paths; this is not a claim that no other build or interface has one.

Each entry has an id, version, display metadata, a short instruction called `lean`, workflow names, pane defaults and a mascot. All inspected role pane arrays are empty. The prompt generator adds general testing guidance and explicitly makes the role a preference that agents may move beyond. Thus a Planner is encouraged to delegate implementation, but the preset does not enforce a prohibition on writing code.

The role generator names workflows in the prompt. That alone does not preload their complete instructions or prove the agent has read them. The packaged plugin supplies workflow files separately.

Claude role guidance is injected with `--append-system-prompt`. Codex receives `--config developer_instructions=…`; the CLI's own help says this replaces the user's configured value for that session. The role-specific launch path supports Claude and Codex; general agent control recognizes additional providers. Do not infer equal role support from the general provider list. Saved role identity and resume handling are visible in code and documented by the plugin; restart behavior was not exercised.

Evidence: [E2], [E3], [E4].

### Creating workers, helpers and staff

These are examples of the recovered interface, not commands executed during this investigation:

```sh
# A role-bearing helper in the current workspace; it shares the checkout.
hc agent spawn --agent codex --role reviewer --prompt "Review the named revision; report verified findings."

# Standing project staff, when the user requests it.
hc project staff add planner --name "VP Product"

# Discover addresses before communicating.
hc agent list --json
hc agent ask --pane <planner-pane-id> "Which acceptance criterion owns this behavior?"
hc agent reply <question-id> "Use the accepted spec's second criterion."
hc agent send --pane <builder-pane-id> "The review artifact is ready at <path>."
```

Feature work is normally started through `hc workspace create` or `hc roadmap start`, with its own workspace/worktree and kickoff brief. Same-workspace helpers are cheaper and intended for review, research or testing. The installed guidance explicitly puts concurrent builders in separate worktrees. It also says spawned helpers cannot recursively spawn more helpers.

Staff have stable project/slug addresses that resolve to panes, survive app restarts as project configuration and can be started by incoming messages. This is useful for a long-lived planner, but does not eliminate context growth or the need for clear assignments.

Evidence: [E2], [E4], [E5].

### Communication

`hc` is a client of the app's control plane. The packaged control client submits to a loopback hook server, then retrieves results with a submit-and-poll protocol. Its credentials and caller pane identity come from app-injected environment variables. This investigation read the variable names in source, not their values.

The recovered path is:

```text
agent calls hc → control bridge → validated app command
  → resolve exact recipient/session → submit to its pane/provider input
  → log the message and correlation → recipient acts/replies
```

Addresses include full pane ids and readable handles containing provider, workspace and a short pane-id suffix. A workspace name with multiple eligible recipients is rejected rather than guessed. Delivery rechecks the selected session. Cross-project control needs an explicit flag, and the inspected control path requires both panes to belong to the same app window.

The app builds the sender header itself. Claude also receives hook context identifying the sender as a peer; other supported recipients receive a textual reply command. This distinction preserves the user's authority over peer requests.

There are separate operations for one-way sends, questions and replies. `ask` waits for a correlated answer; `reply` names the message id. Replies can be returned through the waiting CLI process instead of being typed as another prompt. The message log includes a fallback that submits an unclaimed reply if the waiting process disappears. This is real recovery logic, not just a raw terminal paste.

Two important limitations are visible. The `JQ` message log is an in-memory map pruned to 24 hours in the inspected main-process instance. It is distinct from durable worker wake delivery. Also, backward compatibility allows the first subsequent ordinary send from the recipient to count as an answer. With concurrent questions, an unrelated status update can satisfy the wrong wait. That risk follows from `answerTo`; it was not reproduced live.

Evidence: [E1]–[E4].

### Managers and completion

A worker records who started/manages it. Its kickoff brief includes a trusted question/reply address. Managers receive worker outcomes, questions and PR-related notices. Agents can delegate a group of workers to another manager; the app updates routing rather than requiring the old manager to forward every message.

The renderer handler verifies worker ownership and rejects manager cycles. It validates before changing workers, then changes management metadata and sends notifications. Notification failures are reported per worker. A queued manager launch can fail later; the code restores workers still assigned to that failed manager and attempts to notify the caller. This is thoughtful recovery, although metadata transfer and agents learning about it are visibly separate steps.

The worker-wake code has lease/accept/fail APIs, deduplication of unchanged stops and PR trouble tracking. It assembles facts including branch, local HEAD, PR HEAD, finish target and remaining background work. The implementation behind those APIs was not traced end to end, so its transactional guarantees remain unknown.

There is also a different, CLI-level waiting mechanism: `hc agent wait` polls state every three seconds and uses multiple idle readings plus roughly eight seconds of quiet to distinguish completion from a goal loop's temporary idle period. These heuristics should not be confused with a validated deliverable.

Evidence: [E2]–[E5].

## What makes the roles effective

| Role     | Inputs and access it needs                                                                | Required output and quality check                                                                                                                |
| -------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Planner  | User objective, constraints, current code/board, known decisions, resource limits         | A scoped spec, acceptance criteria, dependencies, ownership and unresolved decisions. A builder should not have to invent the product contract.  |
| Designer | User flows, existing components/tokens, reference material, viewport/accessibility needs  | Reviewable design or prototype, interaction states and implementation notes. Visual work needs visual evidence.                                  |
| Builder  | Accepted spec revision, exact base commit, bounded write responsibility, build/test tools | Commit/checkpoint, changed behavior, checks and failures, evidence, remaining risks. A prose claim alone cannot complete it.                     |
| Debugger | Reproduction, logs/fixtures, expected behavior, test harness                              | Repro evidence, causal explanation, failing regression before the fix where appropriate, fix and verification.                                   |
| Reviewer | Acceptance criteria, exact base/head diff, relevant architecture, test evidence           | Findings tied to locations and consequences, or an explicit no-findings result with limits. Start with fresh review context to reduce anchoring. |

Every assignment also needs a named manager, a question path, a finish condition, bounded context, a cancellation path and a resource budget. Skills should be resolved to actual available instructions/tools, not merely mentioned. Provider/model choice should reflect the task and available configuration; a role name should not silently choose an expensive model.

Independence is operational: separate reviewer context, a pinned revision and a handoff back to the author. Different models may add diversity, but neither a different model nor a fresh conversation guarantees a good review. Measure findings and outcomes.

## What to improve, and what to keep

**Keep:** lightweight role presets, explicit addresses, refusal to guess recipients, manager routing, dedicated worktrees for writers, clear blocked-on-human state, sender provenance, background delivery and launch recovery.

**Improve instruction composition.** Compose role guidance with existing project and provider instructions. Show exactly what was loaded, its version and what was missing. The Codex replacement behavior is a concrete reason to make this explicit.

**Improve role contracts.** Keep roles adaptable but distinguish advice from enforceable capabilities. Require structured deliverables and check evidence. A reviewer label is not read-only enforcement; a server tool restriction does not sandbox arbitrary shell commands.

**Improve question correlation.** Require explicit question ids, support simultaneous questions and retain unresolved questions across restart. Ordinary progress messages must never implicitly answer a question.

**Improve completion semantics.** A quiet agent, a stopped turn, a completed assignment and a merged PR are four different facts. Advance stages using validated artifacts and revision-specific checks, not quiet-time inference. Preserve the useful wake/lease mechanisms already visible in Hypercoder.

**Improve control-plane independence.** Put scheduling, messages and durable workflow facts in T3's environment server. Browser/Electron panes should observe them. This follows T3's remote architecture and removes the inspected Hypercoder path's same-window dependency.

**Improve handoff consistency.** Version manager changes, acknowledge the new assignment and reject stale management actions. Show when ownership changed but a worker has not yet received that change.

**Improve human readability.** The user's supplied Hypercoder screenshot shows incoming peer headers, reply commands, opaque ids/process details and repeated prose about the same native-validation blocker. This is user-provided visual evidence, separate from the static REA analysis. T3 should show a concise expandable activity row that states the meaning, then a readable exchange, with raw protocol separately disclosed. Group routine related updates, keep questions/failures visible and distinguish delivery from task completion. T3 already has basic agent-message folding; extend it with semantic summaries and correlation. See the [communication concept](communication.html) and the spec's Human-readable communication requirements. The concept remains a draft.

**Improve bounded execution.** Make concurrency, attempts, review rounds and estimated spend visible. Prevent question cycles and unbounded manager nesting. These are proposed requirements; this inspection does not establish that every corresponding control is absent in Hypercoder.

## Recommended T3 approach

Three approaches are plausible:

| Approach                                         | Benefit                                                        | Cost                                                      |
| ------------------------------------------------ | -------------------------------------------------------------- | --------------------------------------------------------- |
| Role presets over existing delegation            | Small change, useful immediately                               | Coordination remains largely prompt-driven                |
| Supervised workflow with targeted peer questions | Explicit handoffs, evidence, recovery and useful collaboration | Needs durable workflow state and correlation              |
| Unrestricted autonomous teams                    | Flexible exploration                                           | Harder ownership, cost, completion and conflict semantics |

Recommend the middle approach, delivered in slices. The planner owns the objective and assignments. The server validates transitions and records facts. Workers use existing T3 child threads. Questions can go directly to an appropriate teammate, while material scope decisions return to the planner or user. Review findings go to the builder; a fresh reviewer assignment checks the new revision.

Do not broadcast every message to every agent. Send the minimum context needed and link immutable artifacts. Begin with one project/environment, one workflow worktree and sequential writers. Add parallel builders in separate worktrees only when integration is explicitly designed.

T3 already has `delegate_task`, role hints, child threads, shared/worktree isolation, cross-provider selection, parent permission ceilings, child questions, cancellation and result wakes. It also already has `t3_thread_send` with sender identity, queue/steer behavior and idempotency keys. The missing product is a usable contract over these primitives, not a second execution runtime. Current role hints are only a sentence prepended to the task.

## Evidence register and reproduction

- **E1:** REA `6.8.0` from the official [morluto/rea repository](https://github.com/morluto/rea), run with cached Node `26.12.1`. [CLI analysis summary](evidence/rea-summary.json) and [target hashes](evidence/target-manifest.json). Parsed `hc-agent.mjs` and `hc-control.mjs` as inert JavaScript. No parse failures; 111 findings. Semantic graph reached its 4,000-node limit; whole-app coverage is partial. A complete summary view is not complete whole-app analysis.
- **E2:** Packaged `Contents/Resources/hc-agent.mjs`: `HELP`, `parseSpawnArgs`, `waitForWorkspace`, main send/ask/reply/delegate handling; `hc-control.mjs`: `readControlEnv`, `post`, `runControl`. REA selected these original files; direct reading supplied implementation details.
- **E3:** ASAR member `dist-electron/main-G1ilvf_H.js`: catalog at line 43584; `rye`/`oye` at 43689/43697; `JQ` at 25301; `answerTo` at 25368; cross-project/window validation `aZ` at 25510; hook config `fZ` at 25580; log construction at 61334, using the 24-hour constant at 40312. Lines refer to the extracted bundle, not original source files.
- **E4:** ASAR renderer member `dist/renderer/assets/index-XMZ_k1bp.js`, SHA in manifest. Decoded-text offsets: role payload generator `Sd` at 134566; manager handler `UR` at 845377; manager-transfer helper `OR` immediately after `UR`; worker-wake controller `cT` at 815515; `agent.send` handler at 928820; sender-delivery helper `iD` at 906808. These minified symbol names are build-specific. This source was read directly, not included in the successful focused REA graph.
- **E5:** Installed `Contents/Resources/hypercoder-plugin/skills/workspaces/SKILL.md`, sections on orchestration, managers, helpers, addressing, questions, staff and recovery. This documents intended behavior; it is not runtime proof. No operational workflow from that skill was invoked here.
- **E6:** T3 source: `packages/contracts/src/orchestratorMcp.ts`; `apps/server/src/mcp/{OrchestratorMcpService,delegatedTaskModes}.ts`; `apps/server/src/orchestration-v2/{ThreadManagementService,DelegatedTaskQuestionReactor,Orchestrator}.ts`; `docs/fork/{maintenance,roadmap}.md`; `evals/README.md`.
- **E7:** Follow-up [skill inventory](evidence/skill-inventory.json): 11 skill files and four command workflows in bundled plugin `0.12.80`, with all 15 names packaged as Codex skills. Hashes identify each provider variant. The [migration plan](skills.md) covers the 14 non-game workflows; games were excluded by the user. This inventory is static and does not claim that the workflows were executed.
- **E8:** [Combined audit](skill-audit.md) and [Vibe source receipt](evidence/vibe-skill-audit.json): 31 installed Vibe entry points and command files where present, with no differences against their inspected Codex mirrors. Thirty non-game Vibe entries are in scope. The receipt describes targeted contract inspection and explicitly excludes live execution and exhaustive recursive helper verification.

Extracted material and full evidence bundles were retained locally during the investigation and are not published here. The evidence directory contains path-normalized summaries and hashes, not Hypercoder's application source. Each normalized JSON records the original file digest and normalization performed; its embedded evidence ids still identify the original REA results. Example paths below use `/tmp/hypercoder-analysis`. Reproduction: copy the two packaged CLI modules to an isolated directory and run:

```sh
rea analyze-javascript-application <isolated-directory> \
  --source-path hc-agent.mjs --source-path hc-control.mjs \
  --detail summary --evidence_output <new-evidence-file.json> \
  --max-semantic-nodes 4000 --max-semantic-unknowns 2000 \
  --analysis-timeout-ms 120000 --json
```

Use the supported Node version and pinned REA version above. REA does not overwrite an existing evidence bundle. The separate main-bundle attempt and its final coverage are recorded in `evidence/analysis-status.json`. No app launch, paid agent run, private service request, credential inspection or live application database access was needed. No live end-to-end behavior is claimed.
