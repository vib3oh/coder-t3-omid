# T3 role-based agent workflows

Status: discussion draft, 2026-11-02. The user confirmed supervised workflows first, with targeted peer communication. Detailed defaults and the technical design remain proposals; no implementation, issue creation or build routing is implied. Feature specification requested by the fork owner. Recommended route: **Review remaining decisions**, then engineering planning. Read [findings](understanding.md), [UX](ux.md) and [technical design](technical-design.md).

## Problem

T3 can delegate work, but users must repeatedly explain roles, assemble context, coordinate handoffs and decide whether a stopped agent actually completed its assignment. A multi-agent feature should make those responsibilities inspectable and recoverable while preserving T3's existing execution model and provider choice.

## Acceptance criteria

### Roles and assignment quality

- [ ] Ship Planner, Designer, Builder, Debugger and Reviewer presets. Users can clone a preset into a project role and edit its name, purpose, instructions, skill references, expected output and preferred provider/model settings.
- [ ] Creating a role does not start an agent. Starting an assignment shows the resolved role, provider/model, workspace, instructions/skills and resource limits.
- [ ] Snapshot a role's version/content at assignment start. Edits affect future assignments; active work changes only through an explicit revised assignment.
- [ ] Compose instructions without dropping configured project/provider guidance. Resolve actual skill content or report missing required skills before launch. Do not claim a named skill was loaded merely because it appears in a prompt.
- [ ] Every assignment names the objective, immutable input/spec revision, acceptance criteria, deliverable, responsible manager, workspace, finish condition and relevant permissions. Ambiguous product choices are recorded as questions.

### Workflow and evidence

- [ ] A user can start a supervised workflow from a roadmap card or an existing T3 thread. Thread-only workflows support projects without a card or GitHub repository.
- [ ] Default path: planner prepares a spec → builder implements → independent reviewer checks → builder addresses valid findings → fresh reviewer assignment checks the new revision → planner presents the result. Skip design/debug stages unless needed.
- [ ] Start requires the user's authorization for the workflow and its execution limits. Use existing permission/approval paths; do not add a redundant confirmation for actions already authorized.
- [ ] A planner may answer questions from the user's instructions and accepted spec. Material scope changes and decisions reserved for the user remain pending until the user answers.
- [ ] Completion requires the stage's structured deliverable and server-verifiable references. A provider terminal event alone does not advance the workflow.
- [ ] Reviews are tied to exact base/head revisions. A change to the reviewed head invalidates its applicability to the new head. New review/recheck work is a new assignment, with clean review context.
- [ ] Checks record their command, revision, result and evidence location. Reviewers see failures, skipped checks and known limitations. A required check cannot be bypassed by changing a prose summary.
- [ ] Default finish is a reviewed result presented to the user. Commit, PR creation, publishing and merging follow existing repository policy and explicit authorization; a role preset grants none of them.

### Communication

- [ ] Agents discover a workflow's participants and address exact environment/thread/assignment identities. Friendly labels never select between ambiguous recipients silently.
- [ ] Support targeted updates, questions, correlated answers, handoffs and results. UI and MCP use the same server service and permission checks.
- [ ] A question has an id and explicit reply relationship. Concurrent questions cannot be answered by an unrelated status message. Duplicate identical replies are idempotent; conflicting replies require a deliberate resolution.
- [ ] Show persisted, queued, submitted, acknowledged, answered and failed facts accurately. Submitted or acknowledged does not mean understood or completed.
- [ ] Peer origin is server-stamped and remains distinct from user instructions. A message cannot expand tools, permissions, budgets or scope.
- [ ] While a peer question is pending, the waiting agent may yield. The server resumes it on an answer or exposes a timeout/escalation; no agent polling loop or paid idle turn is required.
- [ ] Detect circular waits and bound question depth/message volume. Escalate the blocking chain instead of letting two agents wait indefinitely.

### Human-readable communication

User requirement: agent communication must be understandable from a concise, expandable summary, without reading console protocol. This requirement was added from the user's Hypercoder screenshot; the [interactive concept](communication.html) is a proposed visual treatment, not an approved final design.

- [ ] Represent each agent exchange in the thread as a collapsed row with recognizable participants, a one-line plain-language summary, meaningful status and a disclosure control. Lead with what happened, what remains blocked or what decision is needed. Raw commands, opaque ids, process numbers and paths belong in diagnostics.
- [ ] Expanding a row reveals the readable exchange, chronological updates, referenced artifacts and relevant next action. A separate disclosure reveals the original payload, delivery facts and technical identifiers. Preserve original content; a summary never replaces the audit record.
- [ ] Distinguish a short summary written by the sending agent from server-verified facts. Delivery success cannot become task success, and shared/web checks passing cannot become native checks passing. If the sender cannot provide a readable summary, use a deterministic factual fallback rather than an additional blocking model call.
- [ ] Group related routine updates by assignment and semantic thread. The group shows its latest applicable summary and update count; expand to inspect earlier messages. Do not collapse unrelated questions, hide unresolved human decisions, swallow failed delivery or combine differing revisions into a misleading success.
- [ ] Surface human decisions and delivery failures with explicit labels and reachable actions. Waiting for another agent or an idle device must not imply that the user needs to act. Routine progress does not repeatedly interrupt or notify the user.
- [ ] Correlate tool invocation, sent message, receipt and incoming reply so they do not appear as duplicate narrative entries in the same feed. Keep those underlying events inspectable in diagnostics. User decisions and final outcomes stay separate from routine progress groups.
- [ ] Use accessible expand/collapse controls, keyboard navigation, visible focus and adequate touch targets. Preserve expansion, scroll position and focus while new updates arrive; screen readers announce consequential state changes rather than every progress update. Search can reveal a matching hidden message.
- [ ] At narrow widths, keep the summary and actionable status readable while moving secondary metadata into details. Web, desktop and native mobile use the same shared presentation rules. Do not rely on hover, color alone, animated spinners or displaying an entire terminal session.

### Workspaces, lifecycle and limits

- [ ] Create the workflow checkout through T3's existing worktree preparation from an explicit commit. Surface uncommitted parent changes; do not silently omit inputs the accepted spec depends on.
- [ ] One writer owns a workflow worktree at a time. Planner, builder and fix handoffs transfer write responsibility; reviewers inspect a pinned clean revision. Concurrent builder assignments require separate worktrees and remain outside the first automated workflow template.
- [ ] Explain the distinction between advisory role behavior, server-enforced orchestration permissions and provider sandbox capabilities. Unsupported restrictions fail explicitly or require a different supported execution mode; do not label a shell as read-only based on a prompt.
- [ ] The first release is scoped to one project/environment. It preserves existing ordinary delegation to linked environments without promising new cross-environment workflow state or artifact transfer.
- [ ] Users can inspect, pause/resume, cancel and retry a workflow or assignment. Pause stops new dispatches; running work is shown and can be interrupted/cancelled separately. Cancel disposes pending wakes and prevents stale completions from advancing stages.
- [ ] Survive server restart with durable assignments, unresolved questions, ownership and dispatch intents. Recovery reconciles existing T3 receipts/tasks rather than blindly launching replacements.
- [ ] Default proposed limits: 3 concurrent agent turns per workflow, 2 implementation/review correction rounds, 12 assignment attempts, no automatic nested managers. Users may explicitly change limits within existing policy.
- [ ] If token/cost data is incomplete, display unknown/estimated coverage. Enforce known concurrency/attempt limits regardless. Never promise an exact dollar ceiling across opaque subscription CLIs.

### Surfaces and validation

- [ ] Web and desktop share workflow launch/detail controls. Settings exposes role editing; command palette and relevant existing shortcuts reach the same operations. Do not create a separate code path for agents or scheduled tasks.
- [ ] Native mobile supports listing, status, artifacts, questions/replies, pause/resume and cancellation. The initial role editor may remain web/desktop only and be labeled accordingly.
- [ ] Local, remote browser and tunnel clients observe server-owned state and permissions. Closing a client does not stop the workflow.
- [ ] Confirm provider/model availability using T3's catalog. Each supported adapter has a recorded capability decision for instructions, skills, sandbox restrictions, cancellation and messaging. No provider switch occurs silently.
- [ ] Focused behavioral tests cover correlation, revision drift, retries, recovery, permissions, worktree ownership, cancellation and waits. Real-model evals cover role adherence, escalation, delegation and avoiding needless agents. Run one integrated real-client pass after implementation, using Replay for pipeline/UI behavior.

## Terminology

Provisional terms for this draft; reconcile against T3's glossary before implementation.

- **Role preset:** versioned instructions and defaults; separate from the existing `delegate_task.role` hint and from a permission profile.
- **Assignment:** one bounded responsibility with acceptance criteria. It may span multiple T3 task attempts/turns.
- **Participant:** a role-bearing thread acting in a workflow. A thread is not a provider-native session id.
- **Workflow:** the supervised group of assignments, dependencies and evidence rules. This is a proposed roadmap extension, distinct from the existing Claude workflow runtime.
- **Manager:** the participant responsible for assignment decisions. Creation lineage remains immutable when management changes.
- **Artifact:** a revisioned spec, design, implementation or review result with provenance.

## Implementation plan

1. Confirm scope and storage decisions in this draft. Review the [technical design](technical-design.md) against the fork contract. No product-wide PRD is needed to explain the idea; reconcile one if the repository later establishes it.
2. Add namespaced role/assignment contracts and services under the roadmap extension. First ship role snapshots over existing delegation, with explicit skill resolution and instruction composition.
3. Add correlated team messages and handoff artifacts over T3's message/task services; implement durable pending intents and restart reconciliation. Preserve the distinction between assignment and task completion.
4. Add the supervised template and server-side transition checks, bounded attempts, writer ownership and revision-bound review.
5. Add shared web/desktop launch/detail/role controls and native mobile operations. Route RPC, MCP and scheduled entry points through the same service.
6. Add the focused tests and evals in the technical design, then perform integrated client verification. Run `vp run check:changed` before any requested push. Keep repo-wide checks in CI.

## Out of scope

- Free-form autonomous swarms, automatic nested management and broadcast chat.
- Permanent always-on staff, cross-project managers, cross-environment workflow replication and remote artifact transport.
- Automatic parallel-builder integration, conflict-resolution bots and a new Git/worktree manager.
- Replacing provider-native subagents, existing delegation or the existing Claude workflow mechanism.
- Arbitrary repository-supplied executable plugins, automatic skill installation, silent provider/model/account switching.
- Automatic PR creation/merge/deployment by virtue of an agent's role.

## Risks and rollback

- Role prompts may drift; snapshot versions and evaluate against the single-agent baseline. Roll back a preset version without rewriting historical assignments.
- More agents can increase cost and coordination failures. Offer a single-agent path; add agents only when decomposition or independent verification helps.
- Cross-store workflow/core dispatch cannot be one transaction. Persist intent first and recover through stable command receipts; never promise exactly-once provider execution.
- Concurrent edits can invalidate review. Enforce the workflow's writer ownership and recheck revisions before stage completion; external filesystem writers remain outside that enforcement boundary.
- Protect cancellation from delayed messages and results with assignment generations and server validation.
- Rollout behind a feature flag. Disabling new starts preserves history and allows management of existing child tasks. Do not delete worktrees, conversations or evidence as rollback.

## Open questions

- Scope settled: the user selected supervised workflows first. Unrestricted teams remain out of scope.
- Should role authoring be project-only initially, or also include personal presets copied into a project? Recommended initial scope: project roles.
- Are the proposed default attempt/concurrency limits appropriate? They are product defaults to validate, not measured performance claims.
- Confirm the extension metadata store and minimal upstream hooks described in the technical design before treating the plan as implementation-ready.
- Review native mobile delivery sequencing; no roadmap screen currently exists there.

## Product context

- PRD: Not established for this feature.
- Requirements: None with existing stable ids.
- Decisions: supervised workflows first, confirmed by the user. Other recommendations remain proposals.
- Product delta: material capability proposal.
- PRD sync: no product files changed. Accepted decisions should be reconciled before build routing if a central product package is introduced.
- Spec route: discuss remaining details; no workflow state or issue created.

## References

- [Hypercoder findings and evidence register](understanding.md)
- [Launch, assignment and monitoring UX](ux.md)
- [Technical design](technical-design.md)
- [Expandable communication concept](communication.html)
- Repository: `AGENTS.md`, `docs/fork/maintenance.md`, `docs/fork/roadmap.md`, `fork.json`
- Existing runtime/contracts: `packages/contracts/src/orchestratorMcp.ts`, `apps/server/src/mcp/delegatedTaskModes.ts`, `apps/server/src/mcp/OrchestratorMcpService.ts`
- Existing service layer and verification rules: `docs/internals/effect-services.md`, `evals/README.md`
