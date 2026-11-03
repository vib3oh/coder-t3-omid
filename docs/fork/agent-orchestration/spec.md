# T3 role-based agent workflows

Status: implementation candidate, 2026-11-02. The fork owner authorized implementation and attended delivery in PR #2 after choosing supervised workflows first. The criteria below remain the acceptance contract, not a claim that every release gate has passed. The PR records focused checks, real-model evals and client evidence separately. Read [findings](understanding.md), [UX](ux.md), [technical design](technical-design.md) and the [user guide](../../user/agent-workflows.md).

## Problem

T3 can delegate work, but users must repeatedly explain roles, assemble context, coordinate handoffs and decide whether a stopped agent actually completed its assignment. A multi-agent feature should make those responsibilities inspectable and recoverable while preserving T3's existing execution model and provider choice.

## Acceptance criteria

### Upstream compatibility

- [ ] Build on native T3 skill discovery, provider dispatch, workspace snapshots and composer selection. Keep curated content and role/dependency metadata in a fork-owned package; do not introduce a competing skill scanner, parser, generic picker or provider runtime. Follow the [compatibility contract](upstream-compatibility.md).
- [ ] Prove app-bundled packaging and invocation for each initially supported provider before claiming support. Preserve native precedence, disabled states and invocation restrictions. Report the actual resolved source/version/hash; a collision or unavailable pinned source cannot silently substitute a different skill.
- [ ] Ordinary built-in skills and role invocation work without the roadmap extension, personal Vibe helpers or a Vibe conductor. Workflow execution continues through T3 services; optional roadmap cards are links, not prerequisites.
- [ ] Keep shared upstream edits limited to necessary registration, additive contracts and entry points. Record actual integration hooks and reasons. Assess existing persistence facilities before approving a new workflow store; never duplicate task/message/provider state.
- [ ] Before rollout, prove a minimal supervised handoff through native services and run focused native tests/evals plus integrated client verification. An upstream update must reassess changed hooks and affected behavior even when Git reports no conflicts. Preserve ordinary behavior when the feature is disabled and remove fork duplicates when adopting equivalent upstream capabilities.

### Existing roadmap compatibility

Baseline: `origin/main` at [`08f7150f56`](https://github.com/vib3oh/coder-t3-omid/commit/08f7150f560df3f43ad0745c8f2e88f932a8424d). The board already supports planning, linked-thread launch/resume, managed agent review and checklist/spec editing. These are existing capabilities, not new deliverables of this proposal.

- [ ] Add an explicit supervised workflow action while preserving ordinary **Start building** and **Start agent review** behavior. The latter currently asks an agent to fix findings and mark a passing PR ready; it cannot silently stand in for the proposed inspect-only Reviewer or grant merge authority.
- [ ] Snapshot card/criterion ids, board revision and resolved spec content/version at acceptance. A spec path or checked criterion alone is not evidence of a satisfied assignment. Concurrent card edits require deliberate reconciliation; no full-board write may overwrite unrelated edits. Keep existing expected-revision conflicts and stable criterion ids.
- [ ] Reuse protected native launch/resume services and preserve the board's reserved thread and stable initial command/message ids when recovering an ordinary launch. A workflow start on already-linked work must resolve ownership before dispatch; do not create a second writer or restart active work silently. Server-side workflow dispatch must be callable without the browser-only `useRoadmapWork` hook.
- [ ] Preserve board lane derivation from linked thread/PR facts and explicit completion. Workflow state is separate: a reviewed result is not a merge, a ready PR is not approval, and idle linked work still counts as Building. Do not invent a writable execution lane or automatically mark a card/criteria complete to report workflow progress.
- [ ] Preserve read/operate permission boundaries, including the newly guarded launch-thread command, at the destination environment. Include archived/older linked work through the existing board view. Do not treat board parking/archive as workflow cancellation or pause without an explicit lifecycle operation.
- [ ] Reuse the existing roadmap service for planning metadata; keep workflow-only state out of board JSON until its persistence design is approved. Current roadmap RPCs are read/save only: dedicated agent tools, native mobile roadmap controls, durable merge receipts and cross-environment workflow state remain unimplemented capabilities, not assumed dependencies.

### Roles and assignment quality

- [ ] Ship Planner, Designer, Builder, Debugger and Reviewer presets. Users can clone a preset into a project role and edit its name, purpose, instructions, skill references, expected output and preferred provider/model settings.
- [ ] Creating a role does not start an agent. Starting an assignment shows the resolved role, provider/model, workspace, instructions/skills and resource limits.
- [ ] Snapshot a role's version/content at assignment start. Edits affect future assignments; active work changes only through an explicit revised assignment.
- [ ] Compose instructions without dropping configured project/provider guidance. Resolve actual skill content or report missing required skills before launch. Do not claim a named skill was loaded merely because it appears in a prompt.
- [ ] Every assignment names the objective, immutable input/spec revision, acceptance criteria, deliverable, responsible manager, workspace, finish condition and relevant permissions. Ambiguous product choices are recorded as questions.

### Skill migration and availability

- [ ] Build one versioned skill library into T3, covering all 30 non-game Vibe entries and the 14 Hypercoder migration entries. Preserve familiar entry-point aliases while deduplicating shared procedures. The [combined audit](skill-audit.md) defines source overlap, modes and prerequisites; it does not claim that 44 source names require 44 independent procedures.
- [ ] The supported built-in path works without a personal Vibe installation. Include or replace declared runtime dependencies and resources through T3 services; an existing local Vibe installation is an explicit compatibility backend with a visible version and policy, not a hidden requirement.
- [ ] Address the audit's review inspect/repair, lifecycle-mode, invocation-authority, ownership, evidence, human/peer communication and host-dependency conflicts before marking the affected procedures runnable. Retain 19 core candidates and 11 capability-gated Vibe extensions in the catalog; catalog presence does not grant execution rights.
- [ ] Account for all 14 non-game Hypercoder workflows in the [skill migration matrix](skills.md), including the four commands packaged as skills for Codex. The inventory contains 15 workflows; games are explicitly excluded by the user. Record adapted/verified, optional-with-prerequisites or deferred-with-reason per in-scope entry; do not claim full parity for deferred capabilities.
- [ ] Use applicable Vibe workflows as the primary implementation of spec, worktree, build, publish, review and shipping behavior. T3-specific wrappers translate service/tool boundaries and preserve repository-local policy, including worktrees loading primary-checkout policy where required.
- [ ] Supply the five core roles with small required/optional skill bundles. Resolve actual instructions, transitive dependencies, executable/tool capabilities and effective authorization on the destination environment before advertising a role as ready.
- [ ] Make loaded, on-demand, missing and unsupported skill states visible in role settings and assignment startup. Snapshot versions/content hashes and provider packaging; preserve active assignments when the catalog updates. Do not preload the entire catalog into every context.
- [ ] Preserve user-invocation and side-effect authorization across provider formats. A loaded skill cannot authorize commit, publish, merge, install, device operation or outgoing communication by itself.
- [ ] Defer missing kits/pane-template capabilities explicitly; support an optional workflow only when its real prerequisites are satisfied. Games are out of scope. Do not execute Hypercoder-specific commands as a fallback.
- [ ] Use audited Vibe procedures and independently authored Hypercoder adaptations with recorded provenance. User-attached third-party skills require compatibility and provenance checks; automatic global-skill copying, personal correspondence profiles and arbitrary plugin installation remain outside scope.
- [ ] Before shipping executable skill definitions, run focused service tests and model-facing evals against their actual source for the providers claimed as supported. A dry-run or compiler test alone does not establish real-model behavior.

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
- [ ] Default proposed limits: 3 concurrent child assignments per workflow (manager coordination is separate), 2 implementation/review correction rounds, 12 assignment attempts, no automatic nested managers. Users may explicitly change limits within existing policy.
- [ ] If token/cost data is incomplete, display unknown/estimated coverage. Enforce known concurrency/attempt limits regardless. Never promise an exact dollar ceiling across opaque subscription CLIs.

### Surfaces and validation

- [ ] Web and desktop share workflow launch/detail controls. Settings exposes role editing; command palette and relevant existing shortcuts reach the same operations. Do not create a separate code path for agents or scheduled tasks.
- [ ] Native mobile supports listing, status, artifacts, questions/replies, pause/resume and cancellation. The initial role editor may remain web/desktop only and be labeled accordingly.
- [ ] Local, remote browser and tunnel clients observe server-owned state and permissions. Closing a client does not stop the workflow.
- [ ] Confirm provider/model availability using T3's catalog. Each supported adapter has a recorded capability decision for instructions, skills, sandbox restrictions, cancellation and messaging. No provider switch occurs silently.
- [ ] Focused behavioral tests cover correlation, revision drift, retries, recovery, permissions, worktree ownership, cancellation and waits. Real-model evals cover role adherence, escalation, delegation and avoiding needless agents. Run one integrated real-client pass after implementation, using Replay for pipeline/UI behavior.

## Terminology

Feature terms supplementing T3’s glossary.

- **Role preset:** versioned instructions and defaults; separate from the existing `delegate_task.role` hint and from a permission profile.
- **Assignment:** one bounded responsibility with acceptance criteria. It may span multiple T3 task attempts/turns.
- **Participant:** a role-bearing thread acting in a workflow. A thread is not a provider-native session id.
- **Workflow:** the supervised group of assignments, dependencies and evidence rules. This is a proposed roadmap extension, distinct from the existing Claude workflow runtime.
- **Manager:** the participant responsible for assignment decisions. Creation lineage remains immutable when management changes.
- **Artifact:** a revisioned spec, design, implementation or review result with provenance.

## Implementation plan

1. Preserve the accepted supervised scope and storage decision. Review the [technical design](technical-design.md) against the fork contract. No product-wide PRD is needed to explain the idea; reconcile one if the repository later establishes it.
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
- Built-in games, games-menu integration and game-authoring skill migration.
- Enabling fleet operations, cloud provisioning, deployment, human correspondence or cleanup merely by loading an optional catalog entry. Those procedures require their own capabilities and task authorization.
- Automatic PR creation/merge/deployment by virtue of an agent's role.

## Risks and rollback

- Role prompts may drift; snapshot versions and evaluate against the single-agent baseline. Roll back a preset version without rewriting historical assignments.
- More agents can increase cost and coordination failures. Offer a single-agent path; add agents only when decomposition or independent verification helps.
- Internal T3 interfaces evolve; additive hooks reduce the merge surface but do not guarantee conflict-free updates. Reassess hooks and test affected behavior at each upstream integration.
- If the separate workflow store is selected, workflow/core dispatch cannot be one transaction. Persist intent first and recover through stable command receipts; never promise exactly-once provider execution.
- Concurrent edits can invalidate review. Enforce the workflow's writer ownership and recheck revisions before stage completion; external filesystem writers remain outside that enforcement boundary.
- Protect cancellation from delayed messages and results with assignment generations and server validation.
- Rollout behind a feature flag. Disabling new starts preserves history and allows management of existing child tasks. Do not delete worktrees, conversations or evidence as rollback.

## Open questions

- Scope settled: the user selected supervised workflows first. Unrestricted teams remain out of scope.
- Catalog scope settled: build in the Vibe procedures after auditing them against Hypercoder; games are excluded. The proposed core/extension grouping and adapter details remain subject to design review.
- Should role authoring be project-only initially, or also include personal presets copied into a project? Recommended initial scope: project roles.
- Are the proposed default attempt/concurrency limits appropriate? They are product defaults to validate, not measured performance claims.
- Confirm native package exposure per provider, the minimal upstream hooks and the need for an extension metadata store before treating the plan as implementation-ready.
- Review native mobile delivery sequencing; no roadmap screen currently exists there.

## Product context

- PRD: Not established for this feature.
- Requirements: None with existing stable ids.
- Decisions: supervised workflows first, built-in Vibe procedures after a combined audit, games excluded, and minimizing upstream conflicts by extending native T3 capabilities, confirmed by the user. Catalog tiering and other technical recommendations remain proposals.
- Product delta: material capability proposal.
- PRD sync: no product files changed. Accepted decisions should be reconciled before build routing if a central product package is introduced.
- Spec route: discuss remaining details; no workflow state or issue created.

## References

- [Hypercoder findings and evidence register](understanding.md)
- [Launch, assignment and monitoring UX](ux.md)
- [Technical design](technical-design.md)
- [Skill inventory, migration and role bundles](skills.md)
- [Combined Vibe and Hypercoder contract audit](skill-audit.md)
- [Upstream compatibility contract and targeted native-source review](upstream-compatibility.md)
- [Expandable communication concept](communication.html)
- Repository: `AGENTS.md`, `docs/fork/maintenance.md`, `docs/fork/roadmap.md`, `fork.json`
- Existing runtime/contracts: `packages/contracts/src/orchestratorMcp.ts`, `apps/server/src/mcp/delegatedTaskModes.ts`, `apps/server/src/mcp/OrchestratorMcpService.ts`
- Existing service layer and verification rules: `docs/internals/effect-services.md`, `evals/README.md`
