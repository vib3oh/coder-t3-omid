# Technical design: role-based workflows for the T3 fork

Discussion draft, 2026-11-02. This is an engineering proposal grounded in inspected code, not an implemented API or an approved plan. It accompanies the [spec](spec.md) and [Hypercoder investigation](understanding.md). All `omid.*` names and schemas below are proposed. Existing APIs are identified explicitly against the source baseline in the [investigation](understanding.md); roadmap modules cited from that baseline are not shipped by this PR.

## Architecture decision

Build a small workflow control layer over T3's execution services. Keep role definitions, assignment contracts, evidence and team relationships in the fork's roadmap modules. T3 continues to own conversations, provider sessions, permissions, commands, effects, worktrees, checkpoints, cancellation and remote execution.

The manager is an agent that proposes work. The server validates whether that work is authorized and whether its prerequisites are satisfied. Do not put an LLM inside the pure orchestrator. Do not give a workflow controller an independent provider launcher.

```text
Web / desktop / native mobile / MCP / scheduled invocation
                       |
              permission-checked service
                       |
       RoadmapAgentService + extension metadata store
          |                 |                 |
     role compiler     workflow rules    intent reconciler
          |                 |                 |
          +------- existing T3 services -------+
                            |
               ThreadManagementService
              commands → events → outbox
                            |
                  provider adapters
                            |
                   child threads/tasks
```

Use the existing `createEnvironmentRpcCommand` client pattern and permission atom. RPC and MCP handlers decode, invoke one service method and map typed errors. Scheduled work calls the service after its existing authorization checks. The UI does not assemble provider prompts or schedule workers.

## Existing behavior to reuse

| Existing source                                                    | Verified behavior                                                                                                  | Design implication                                                               |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `packages/contracts/src/orchestratorMcp.ts`                        | `delegate_task` accepts target/provider options, role hint, shared/worktree isolation and wait/async mode          | Extend rather than introduce another execution API                               |
| `apps/server/src/mcp/delegatedTaskModes.ts`                        | `taskPrompt` adds a short role sentence; child modes cannot exceed parent modes                                    | A preset is richer than the existing enum; retain the permission ceiling         |
| `apps/server/src/mcp/OrchestratorMcpService.ts`                    | Active-run ownership, stable command/message ids, task dispatch, result acknowledgement and sender thread identity | Preserve identity and retry semantics through the extension                      |
| `apps/server/src/orchestration-v2/ThreadManagementService.ts`      | `sendToThread` chooses queue/steer/restart and dispatches canonical messages                                       | Team messages use this path, not terminal input                                  |
| `apps/server/src/orchestration-v2/DelegatedTaskQuestionReactor.ts` | Child user-input requests wake parents with deduplication/catch-up behavior                                        | Reuse human question/approval flow; do not reimplement it as peer chat           |
| `apps/server/src/orchestration-v2/Orchestrator.ts`                 | App-owned child task/lineage and completion-delivery behavior; native children have different controls             | First version uses app-owned participants when durable team addressing is needed |
| `apps/server/src/orchestration-v2/ThreadLaunchService.ts`          | Existing workspace preparation boundary                                                                            | Use it for workflow checkouts; no shell-created worktree controller              |
| `apps/server/src/roadmap/RoadmapService.ts`                        | Fork-owned planning service                                                                                        | Link workflows to cards without changing the board into an executor              |

Existing `t3_thread_send` can communicate across threads today. Its default `auto` may steer an active turn. The team API should default to queueing at a turn boundary; deliberate steering must be explicit. A message to a finished child can create a fresh delegated task. Capture that returned task id instead of assuming a thread has one task for its lifetime.

## Ownership and file boundaries

Proposed owned modules:

```text
packages/contracts/src/roadmapAgents.ts
apps/server/src/roadmap/agents/
  RoadmapAgentService.ts
  RoleCompiler.ts
  WorkflowRules.ts
  AgentWorkflowStore.ts
  WorkflowReconciler.ts
apps/web/src/roadmap/agents/
packages/client-runtime/src/roadmap/agents/
apps/mobile/src/roadmap/agents/
```

These are proposed paths, not existing files. Keep workflow service methods cohesive; split modules only where responsibilities justify it. Client-runtime contains shared commands and state, not server policy.

Expected integration points: contracts RPC/export/permission definitions; server application layer, RPC authorization and `ws.ts`; MCP toolkit definitions/handlers; a narrow internal delegation seam extracted from the current MCP implementation if needed; shared navigation/composer/settings/command palette; native mobile navigation. Record each actual integration path in `fork.json` during implementation. Do not copy the full MCP service or create a parallel provider/worktree runtime.

## Persistence decision

**Proposed:** a separate SQLite database under server-owned `userdata/extensions/roadmap/agents.sqlite`, with schema and migrations owned by the roadmap module. Namespace rows by environment/project. Use T3's existing SQLite facilities and Effect service patterns. Do not attach it to the live user's database during development.

Why a separate store: roles, correlated questions, revisioned artifacts and pending intents need atomic updates and indexed queries. Expanding the current board JSON into an inbox/job log would increase contention and recovery complexity. Keeping extension migrations separate avoids competing for upstream's migration numbering. This database owns workflow metadata, not copies of provider/run/message histories. Canonical T3 ids are references.

There is deliberately no cross-database transaction. Each mutation records workflow state plus its next action intent in one extension transaction. A stable command id bridges to the existing T3 command receipt. The reconciler records the accepted task/message result afterward. This is recoverable at-least-once dispatch with idempotent acceptance, not exactly-once provider execution.

One environment server owns the store, matching T3's userdata ownership model. No distributed locking or cloud dependency is proposed. Use snapshot reads and indexed cursors for client updates; publish small service change notifications after commit. Clients reconcile a snapshot after reconnect. Do not stream prompts and transcripts as workflow status.

## Data model

Types here describe fields; implementation uses Effect Schema and existing branded ids.

| Entity              | Essential fields                                                                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RolePreset`        | project, id, version, name, mission, instructions, skill refs, output kind, preferred model selection, capability requests, enabled flag                                                          |
| `RoleSnapshot`      | preset id/version, resolved instruction hash, skill ids/content hashes, compiler version, effective capability report, model selection                                                            |
| `Workflow`          | id, project, root/manager thread refs, optional card id, accepted spec artifact, generation, status, limits, requested finish, revision                                                           |
| `Participant`       | id, workflow, thread ref, role snapshot, manager participant, management epoch, active assignment, checkout ref                                                                                   |
| `Assignment`        | id, workflow, role snapshot, objective, input artifact refs, criteria, dependencies, deliverable kind, finish, generation, state, workspace/write responsibility                                  |
| `AssignmentAttempt` | assignment, ordinal, command id, parent run, task id, child thread/run, role snapshot, state, terminal event reference                                                                            |
| `TeamMessage`       | id, workflow, authenticated sender/recipient, assignment/generation, kind, question/reply relation, human summary with provenance, bounded content/artifact refs, dispatch intent, delivery facts |
| `Artifact`          | id/version, kind, producer thread/run/attempt, immutable content hash, spec/base/head refs, checks, limitations, validation status                                                                |
| `ActionIntent`      | id, workflow/generation, operation, stable core command/message id, bounded payload ref, status, accepted core ids, retry/recovery classification                                                 |

Do not store a second run status machine. Read actual running/waiting/completed state from T3 projections. Assignment state records acceptance of a responsibility; it may outlive a task attempt.

Separate immutable creation lineage from mutable management. In the first version each workflow has one manager and no nested managers. Keep a management epoch so later transfer can reject stale commands without rewriting parent thread lineage. Persistent named staff and arbitrary manager transfer are deferred.

### Assignment states

```text
draft → ready → dispatched → awaiting_result → validating → accepted
                    ↘ awaiting_peer / awaiting_user
validating → needs_changes → ready (new attempt / revised evidence)
any unfinished state → failed / cancelled
```

`awaiting_peer` and `awaiting_user` are workflow facts, not invented provider states. A yielded agent's underlying run may be completed. Only a valid result marks the assignment accepted. Failed or cancelled attempts do not erase prior artifacts.

Workflow states are `draft`, `running`, `waiting_user`, `paused`, `completed`, `failed`, `cancelled`. `completed` means its requested finish is satisfied, not necessarily merged. A merge finish additionally needs canonical PR evidence and authorization; ordinary reviewed-result workflows require no PR.

## Role compiler and capability resolution

Compile one immutable assignment brief from:

1. Existing platform, repository and provider guidance, preserved through their normal paths.
2. Role mission, working method and expected deliverable.
3. Resolved required skills, with version/hash and bounded content; optional skills loaded on demand.
4. Objective, accepted spec and relevant artifacts.
5. Workspace/base revision, manager/participant addresses, question protocol and finish condition.
6. Effective permissions and known resource limits.

Use the current task input channel for the first version's role/assignment brief. Do not overwrite provider configuration to make a role appear stronger. If provider-specific instruction channels are later used, adapters own their composition and advertise support. Show whether a skill was loaded in full, referenced for on-demand reading or unavailable. Refuse a missing required skill before launching; optional omissions remain visible.

### Skill catalog and role bundles

The [migration matrix](skills.md) covers 14 non-game workflows from the installed
Hypercoder packages. One additional game workflow is inventory evidence only,
explicitly excluded from the feature. Kits/pane templates remain a declared
capability gap. Catalog coverage is not a claim that every workflow is executable.

Resolve each required skill and its transitive dependencies from a versioned
catalog on the destination environment. A proposed `SkillDefinition` contains
identity, version, source/provenance, instructions, dependency refs, tool and
provider requirements, invocation policy and output contract. `RoleSnapshot`
captures the resolved versions/hashes and whether each instruction was loaded,
available on demand or unsupported. Cycles, missing required instructions or
unavailable required tools prevent dispatch with a clear reason.

Use existing Vibe procedures for project lifecycle behavior. Provider-native
skill packaging is optional generated output of the same authored definitions;
the common T3 context/tool path remains available when the provider supports it.
Preserve user-only invocation boundaries across formats and avoid rewriting
agent configuration. Load the small core role bundle first, with optional skill
discovery on demand, rather than copying the full catalog into every task.

Local policy resolution must follow the real repository configuration. In this
fork, a linked worktree without its own policy reads it from the primary checkout.
The current policy uses GitHub-native lifecycle with unattended shipping disabled;
ported instructions must not introduce workflow labels or conductors. Skills
that commit, publish, merge, install or message do not grant their own authority.

No runtime definitions are added by this design. When implementing them, verify
provider packaging, dependency resolution and actual role behavior with focused
tests and evals of the canonical source. The migration document records the
provenance and independently authored adapter approach.

### Deliverables

Require a deliverable schema per assignment kind. This is the effective specialization:

- Planner: problem, scope/non-goals, criteria, dependencies, unresolved decisions and accepted-spec artifact.
- Designer: design artifact, interaction states, references and implementation constraints.
- Builder: base/head/checkpoint refs, change summary, checks, evidence and remaining risks.
- Debugger: reproduction, causal evidence, regression result and fix evidence.
- Reviewer: exact reviewed base/head, verified findings with severity/location/reason, checks and limitations.

Prompts instruct these behaviors; server validation enforces shape, ownership, provenance, revision applicability and transition rules. Semantic correctness still needs review and evaluation.

Effective orchestration authority is the intersection of user authorization, caller scopes, project policy, workflow limits and provider capabilities. A role cannot widen it. Enforce service methods and write responsibility server-side. Do not imply that this blocks arbitrary shell edits: filesystem read-only operation requires an actual provider/OS sandbox capability. When unavailable, label a reviewer as advisory non-editing or reject a request for enforced read-only review.

### Provider decision matrix

| Provider     | First-version role mechanism                                                    | Messaging/lifecycle                                                          | Restriction policy                                                      |
| ------------ | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Codex        | Task brief over existing adapter; preserve developer instructions               | App-owned child threads and existing queue/cancel paths                      | Use catalog-advertised sandbox support; no assumption based on the role |
| Claude       | Same common brief; native helpers remain available outside durable participants | Same T3 services; preserve existing approvals                                | Resolve advertised modes, no hidden privilege increase                  |
| Cursor       | Common brief if existing delegation capability is available                     | Existing adapter only                                                        | Explicit unsupported result for unavailable required capabilities       |
| Grok         | Common brief if delegation available                                            | Existing adapter only                                                        | Same capability resolution                                              |
| OpenCode     | Common brief if delegation available                                            | Existing adapter only                                                        | Same capability resolution                                              |
| Antigravity  | Common brief if delegation available                                            | Existing adapter only                                                        | Same capability resolution                                              |
| Kiro         | Common brief when the installed environment advertises delegation               | Existing adapter when available; not part of the original inspected baseline | Same explicit capability resolution                                     |
| Replay (dev) | Deterministic fixture brief/results                                             | Exercise pipeline, restart and UI                                            | No claim to measure model quality                                       |

This matrix is a proposed compatibility strategy, not a live availability report. Query the running environment's catalog at launch and record its result. Model/provider changes require user choice or previously authorized policy; retain actual selected settings per attempt.

## Service and tool contract

Proposed UI RPC namespace: `omid.roadmap.agents.*`, with methods for roles, workflow start/read/list, assignment start/result, messaging and lifecycle controls. Read needs orchestration read access; mutations need operate access plus the method-specific caller/participant policy. Role editing and workflow limits cannot be changed by workers merely because they can send messages.

Compact proposed MCP tools, calling the same service:

```text
omid_agent_roles(action: list | read)
omid_team_read(workflowId, cursor?)
omid_assignment_start(workflowId, roleId, brief, inputs, requestId)
omid_assignment_result(assignmentId, generation, artifact, requestId)
omid_team_message(workflowId, to, kind, text?, artifacts?, replyTo?, requestId)
omid_team_ack(messageId, assignmentId, generation, requestId)
```

Names remain provisional. Avoid one giant dynamically shaped schema. Tool discovery can expose role metadata without injecting every role's full instructions. Participant identities and sender provenance come from authenticated invocation context, never client-supplied claims.

Keep existing `delegate_task` compatible. `RolePreset` is separate from its current enum (`implementation`, `research`, `review`, `design`, `test`, `general`). Map presets to those coarse hints where useful. A changed enum alone would not supply role instructions, skills or workflow semantics.

### Manager startup and the active-run constraint

Current delegation requires an active parent run owned by the caller. Preserve it. A server event does not pretend to be a manager agent or reuse an expired run id.

Workflow start prepares the context through existing launch services and starts/wakes the authorized manager thread. The manager's active run calls assignment-start; the service validates dependencies/limits, records intent and delegates through the common internal path. On a child result, the extension validates evidence and wakes the manager with the current stage and permitted next actions. The manager chooses and starts the next assignment. Thus the server owns durable rules and the manager owns decisions.

If an intent lacks a core receipt after restart and its parent run has ended, reconcile first. If no accepted dispatch exists, mark it as needing manager resumption, wake the manager once and create a new attempt under its new active run. Do not blindly replay an invalid parent-run command. Accepted receipts are reconciled without relaunching. This seam needs focused integration coverage before implementation proceeds.

## Message semantics

Use kinds `update`, `question`, `answer`, `handoff`, `result`. An answer requires `replyTo` pointing to an unresolved question addressed to the answering participant, in the same workflow and valid assignment generation. A message body cannot supply or forge its sender.

Track durable facts separately:

```text
accepted (persisted) → queued → submitted (T3 receipt)
                                   ↘ acknowledged (explicit recipient ack)
question → answered / expired / cancelled
```

A receipt or acknowledgement does not mean the model understood the content. An `answer` closes only its named question. Repeated same-key mutations return the previous receipt; same key with different content is an error. A different conflicting answer cannot silently replace an accepted one.

Persist a message and action intent atomically. Dispatch via existing `sendToThread` with a stable command/message id, queueing by default and stamping `senderThreadId`. Keep message type, correlation and acknowledgement in the extension store. Include a bounded, server-generated envelope in the agent context with ids and reply tool guidance. The extension, rather than a regex over terminal text, determines correlation.

An ask returns a question id and instructions to yield if the answer is necessary. The recipient gets one queued notification. On answer, the server schedules one reply delivery to the asker. If its old task ended, existing thread send creates a new task attempt; link that attempt to the same assignment. It must not accidentally start a second simultaneous writer. Coalesce notifications and dispose stale-generation notifications after cancellation. Core task-terminal events remain visible but cannot complete the assignment by themselves.

For first-version deadlock detection, record directed waiting edges only when the sender declared the answer blocking. Before adding an edge, test for a cycle and bound the chain length. On a cycle, inform the manager with the question chain and leave a clear unresolved state. Nonblocking progress messages do not add wait edges. A server deadline may expire/escalate a question without occupying an agent turn; use the existing effect/test-clock conventions, not client polling.

Human approvals and secrets use T3's existing pending-request/secret paths. Never turn a peer answer into a human approval or pass a secret through team chat.

### Human-readable presentation contract

The user's screenshot shows the cost of exposing console envelopes and commands as conversation. Treat agent exchanges as typed activity with progressive disclosure. [Interactive concept](communication.html) illustrates the proposal; its fictional identities and state examples are not live task records.

Three levels:

1. Collapsed activity: recognizable sender/recipient, a concise sentence describing the outcome or blocker, a factual status and update count where grouped.
2. Expanded exchange: readable original message content, chronological updates, question/answer relationships, artifacts and permission-checked actions.
3. Diagnostics: original payload, command, ids, revisions and separate transport delivery facts. This level is collapsed independently.

Add an optional human summary to the team-message input and persisted envelope. It is plain text, one sentence, bounded to roughly 180 characters; render escaped text, never interpreted markup or executable content. Store `summarySource` as `sender` or `template`, alongside the immutable original message. The sender is asked to state the meaning before implementation details. This describes proposed message schema/prompt work; run the relevant evals when implementing it.

The server validates length, provenance and content shape, but does not claim to prove the semantics of model-written prose. Delivery and task-state badges derive from canonical persisted facts, never the summary. Where there is no summary, templates use kind and verified state: for example, “Builder sent Planner a progress update” or “Message to Builder could not be delivered.” Never copy a shell command's first line as the supposed human summary. No extra model call is required for every message; readable sender-authored summaries are an output contract, with deterministic fallbacks for old or malformed records.

Useful examples adapted from the screenshot:

- “Web checks passed; native validation is blocked.”
- “Builder started another native validation attempt.”
- “Shared checks passed; native tests are waiting for idle time.”

The second statement is agent-reported unless corroborated by execution evidence. None of these means native validation passed, the PR is ready, or the user must act. Keep work state separate from transport state: a queued message is not a queued native test, and successful delivery does not complete the work.

Build a shared presentation projector in the proposed client-runtime roadmap/agents module. Use stable workflow/assignment/generation, participants, question chain, message kind and revision references for grouping; proximity in time or similar text is insufficient. Routine contiguous updates can share a stable group row with its latest summary and an update count. Questions, user decisions, final outcomes, relevant revision changes and delivery failures remain individually addressable. A group's latest state cannot erase a still-unresolved failure or blocker. Closed/cancelled questions retain their history without continuing to look actionable.

Use canonical message/intent ids to connect outgoing tool activity, message persistence, receipt and incoming reply. Show one human communication event within a given timeline; put its transport events underneath it. Do not deduplicate by matching text. Each participant may still have the same exchange represented in its own thread. Opaque provider/legacy events without reliable identities remain inspectable rather than being guessed into a group.

T3 already folds agent-authored incoming messages into a one-line preview in `apps/web/src/components/chat/TimelineUserMessageRow.tsx`, with sender-thread links and find-to-expand behavior. Its browser tests include “folds a message from another agent into a one-line preview.” Native mobile has corresponding folding in `apps/mobile/src/features/threads/ThreadFeed.tsx`. `packages/client-runtime/src/userMessage.ts` already supplies attribution. Reuse those paths; add semantic summaries and correlation rather than creating a second generic chat feed. Wire namespaced communication metadata through existing typed contracts/projections with small recorded integration hooks. A shell/provider tool call is not automatically a typed team message; the new service supplies reliable identity for the first-version workflow path.

The UI should keep stable row keys, preserve user-controlled expansion and anchor scroll when progress updates arrive. Search explicitly reveals matches; no background update opens a row or steals focus. Native touch layout may move participants/time to secondary metadata to preserve summary and state. Use disclosure buttons with `aria-expanded`/`aria-controls`, keyboard support and touch targets; only meaningful blockers, questions and outcomes enter polite live announcements. Keep answer/retry actions distinct from expansion. A retry uses existing idempotency/assignment-generation checks; the UI cannot replay arbitrary console commands.

## Workflow execution and workspace policy

1. User selects a card/thread and reviews the resolved workflow configuration. Existing authorization determines whether a start is already permitted.
2. Manager/planner reads the relevant project context and produces a versioned spec. Product decisions remain explicit; discussion may pause before implementation.
3. Existing launch/worktree services prepare one workflow checkout from a selected commit. The UI surfaces dirty parent changes. A spec dependent on uncommitted code must be committed/snapshotted through an approved existing path or revised before dispatch.
4. Builder receives the accepted spec hash and write responsibility. It returns revision/checkpoint and evidence.
5. Server validates references/check requirements and relinquishes builder write responsibility. Reviewer gets a fresh context and pinned clean revision.
6. Verified findings return to the builder as a new attempt. On a new head, create a fresh reviewer assignment. Bound correction rounds; exceedance yields an unresolved result for the manager/user.
7. Planner reports the accepted result and limitations. Actions involving PRs, publishing or merging remain subject to repository/user authorization.

The first release serializes code writers. Specs/design artifacts should be server-owned immutable artifacts; writing source-controlled files is an explicit editing action. Do not let a planner writing documentation race a builder simply because both have different role names. If external processes alter the checkout, revision/dirty-state checks invalidate the relevant evidence. The ownership record coordinates this feature's agents; it is not an OS filesystem lock.

Native provider subagents may still perform short local research/review within their supported scope, but they are not independently addressable durable team participants unless the adapter offers the required lifecycle. Do not attempt unsupported messaging into an observed native child.

## Recovery, cancellation and adverse cases

| Failure                                                       | Required response                                                                                                            |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Crash after intent commit, before core dispatch               | Reconcile receipt; dispatch only with a still-valid manager run, otherwise resume manager once                               |
| Crash after core acceptance, before extension acknowledgement | Recover task/message ids from stable receipt; do not launch twice                                                            |
| Duplicate result/wake                                         | Idempotent state transition keyed by assignment generation and event/command reference                                       |
| Answer after cancellation or reassignment                     | Retain for audit; do not dispatch into a new assignment generation                                                           |
| Provider completes with malformed artifact                    | Mark result invalid, show reason; no stage advance or false success                                                          |
| Reviewed head changes                                         | Mark review inapplicable; require fresh review at new head                                                                   |
| Provider absent or limited                                    | Show exact state; await authorized resolution, never silently switch account/model                                           |
| Agent asks user-only decision                                 | Use existing pending-request flow, preserve blocked state                                                                    |
| Client disconnects                                            | Server continues; client reloads snapshot and notifications on reconnect                                                     |
| Workflow paused                                               | No new assignment starts; running work and queued answers remain explicit                                                    |
| Workflow cancelled                                            | Increment generation, cancel owned tasks through existing task cancellation, dispose pending wakes; keep artifacts/worktrees |
| Corrupt extension state                                       | Fail affected workflow clearly; preserve the store for recovery, do not overwrite with an empty workflow                     |

Reconcile on startup and canonical task/message events, with bounded recovery retries for infrastructure failures. Do not retry semantic failures or run agent-side wait loops. Metrics include accepted/invalid artifacts, queue depth, dispatch reconciliation, duplicate suppression and unanswered question chains. Logs use ids, states and counts; raw prompts, secrets and tool outputs do not belong in routine telemetry.

## UI and multi-surface requirements

The shared web/desktop surface provides role settings, launch configuration and a workflow detail view. Show participants, assignment state, dependencies, questions, artifacts, resource coverage and actual task links. A question addressed to the user should be actionable without reading every worker transcript. Let users inspect the role/context snapshot that produced an outcome.

Native mobile initially exposes status, artifacts, answer, pause/resume and cancellation. It does not require a full roadmap editor to operate a thread-linked workflow. Add native navigation deliberately; desktop wrapping web does not supply React Native parity. Command-palette/composer/settings entry points all call the same client commands. Remote/tunnel clients use normal environment addressing; no localhost URL in a bundle.

Respect T3's performance requirements: subscribe to small workflow/assignment summaries; paginate message/artifact bodies; load transcripts on demand; use no continuous status animations. Closing an Electron window is unrelated to workflow execution.

## Validation and rollout

Test at the lowest layer that proves each failure. Extend existing task/message/recovery cases where they fit rather than repeating them in every transport and client.

- Role compiler: preserves existing guidance, snapshots skill content, reports missing requirements and provider capability mismatches.
- Workflow/store: dependency rejection, immutable snapshots, wrong-generation/stale-owner rejection, required-check enforcement, dirty/revision mismatch and bounded attempts.
- Messaging: two concurrent questions plus an unrelated update, wrong-sender reply, duplicate/conflicting reply, cycle detection, answer after cancellation and restart while unresolved.
- Integration: accepted dispatch followed by crash, unaccepted dispatch with expired manager run, finished-child answer creating a new task, permission ceilings, cancellation and wake disposal.
- Workspaces: one writer, safe transfer after a terminal editing attempt, review invalidation and dirty parent inputs.
- Clients: permission-aware operations and one integrated web/desktop and native mobile pass when their changes land. Use project `test-t3-app` / `test-t3-mobile` workflows and isolated state; Replay exercises pipelines without paid provider turns.
- Communication projection: old/missing summaries, concurrent question chains, update grouping without losing failures, differing revisions, misleading sender summaries versus factual badges and exact-id deduplication. Extend existing folding/find behavior coverage where applicable. Capture collapsed/expanded, mobile and keyboard-focused states as visual evidence; avoid UI tests for pure spacing.

Use effect-worker draining, Deferred/Queue milestones and TestClock rather than sleeps, polling or per-test timeout changes. Run focused tests during iteration and `vp run check:changed` before a requested push. No repository-wide check runs are planned here.

Before changing model-visible prompts/tools during implementation, follow `evals/README.md` and extend `mcp-tool-use`. Cases must import actual prompt/tool sources. Include Planner tempted to implement outside scope, Reviewer reporting unverified findings, Builder missing criteria, absent skills, peer permission escalation, unrelated messages during asks, circular waits and ordinary tasks that should use one agent. Compare single-agent and workflow completion quality, verified defects, turns/tokens, latency and known cost coverage on matched tasks. No performance or quality uplift is claimed until measured.

Roll out behind a feature flag: role snapshots first; then messaging/artifacts and recovery; then the supervised template and client operations. Engineering review must cover the extension/core consistency boundary. Product review must settle launch flow, role scope and limits before this becomes a build-ready spec. Engineering/product reviews and paid evals remain follow-up work; this design package does not change runtime behavior.

## References

- [Evidence and Hypercoder findings](understanding.md)
- [Acceptance criteria and scope](spec.md)
- [Launch, assignment and monitoring UX](ux.md)
- [Skill migration and role bundles](skills.md)
- [Human-readable communication concept](communication.html)
- T3 sources and baseline are listed in the investigation's E6 evidence register.
- `docs/fork/roadmap.md`: board owns planning; T3 owns execution.
- `docs/internals/effect-services.md`: service ownership, typed errors and thin transports.
- `docs/orchestration-v2/thread-lineage-and-context-transfer.md`: thread lineage and provider-neutral context transfer.
- `evals/README.md`: model-facing change evaluation requirements.
