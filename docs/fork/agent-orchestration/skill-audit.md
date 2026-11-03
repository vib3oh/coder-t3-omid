# Combined Vibe and Hypercoder skill audit

Audit date: 2026-11-02. This is a static contract and portability audit for the
proposed T3 feature, not a claim that a combined runtime has been implemented.
The user requested built-in Vibe skills after auditing them against Hypercoder.
Games remain excluded.

## Decision

Build one versioned T3 workflow library, preserving `vibe-*` names as familiar
entry points and adding Hypercoder's useful role procedures. Deduplicate shared
behavior underneath those entry points. Do not ship two competing systems for
worktrees, PR state, review, approval or agent messaging.

The installed inventory contains 31 Vibe skills. Excluding `vibe-game-design`
leaves 30; Hypercoder contributes 14 non-game workflow names. These are **44
source entries to reconcile**, not 44 unrelated procedures to load into every
agent. No differences were found between the inspected Vibe entry-point/command
files and their installed Codex mirrors.

The proposed release grouping is 19 core Vibe candidates and 11 conditional
extensions. Core means part of the principal catalog, not unrestricted access
for every role. Extensions remain discoverable with prerequisites and disabled
actions where unavailable. Hypercoder's missing kits capability stays deferred.

The built-in package must work without the developer's personal Vibe installation.
Existing local Vibe can remain an explicit compatibility backend, with its version
and effective policy shown. It cannot be the only way the feature works.

The subsequent [native T3 compatibility review](upstream-compatibility.md)
constrains delivery: reuse T3's discovered provider skills, invocation and composer
paths. The proposed library supplies authored content and role/dependency
metadata, not a second skill runtime or generic catalog. Native package exposure
per provider still needs a proof; static source compatibility does not establish
seamless integration.

## What each set contributes

Hypercoder contributes concise role responsibilities, concrete kickoff/reply
addresses, spec freshness checks, independent review expectations and practical
workspace/device workflows. Its built-in roles name small workflow bundles, which
is a useful model for avoiding unnecessary context.

Vibe contributes a broader delivery contract: idea qualification, product
requirements, feature specs, isolated build/patch flows, dirty-work preservation,
revision-bound review/CI/QA evidence, draft publication, gated shipping, decisions,
reporting and optional operational workflows. Its shared contract already
distinguishes portable execution from a verified Hypercoder host. That is evidence
that host ownership needs an adapter, not another executor.

Keep both reporting meanings: Hypercoder changelog describes shipped work; Vibe
wins can also describe unmerged progress. Keep both planning levels: product-wide
PRD and a bounded feature spec. Similar names do not make these interchangeable.

## Findings to resolve before bundling

Priorities below describe blockers or risks for the **T3 port**. They do not claim
that a live exploit or failure was reproduced in the source products.

### F1. Personal runtime dependencies prevent a built-in product

**Port blocker.** Many Vibe entry points call helper libraries, validators,
decision/result stores, runtime controls and binaries under `VIBE_ROOT`. Some
depend on additional CE/gstack skills. Copying `SKILL.md` alone would create
instructions that cannot run on another machine.

Use one canonical T3 procedure package plus declared, versioned dependencies.
Adapt execution to existing environment services and permission checks. Package
permitted required resources or report an unavailable optional capability. No
personal home paths, private config, implicit package installation or silent
provider fallback. Evaluate actual transitive dependencies before marking a
procedure runnable.

Sources: `vibe-build/SKILL.md`; shared delivery contract; `vibe-spec/COMMAND.md`;
`vibe-clonedb/COMMAND.md`; `vibe-email/SKILL.md`.

### F2. Review inspection and review repair have different authority

**Port blocker.** Hypercoder `review-pr` reports findings and requires permission
to mutate. Vibe review is an end-to-end workflow that can rebase, fix, commit and
push findings. Feeding that whole workflow to an independent Reviewer would
violate the proposed writer handoff and could change the revision being reviewed.

Provide one review family with explicit `inspect` and `managed-repair` contracts.
The Reviewer role defaults to inspection and a revision-bound result. Builder
assignments own repairs; fresh review checks the new revision. An explicit Vibe
managed-review invocation can retain its repair behavior when authorized and
holding write responsibility. Never silently turn one mode into the other.

Sources: Hypercoder `commands/review-pr.md`; `vibe-review/COMMAND.md` Step 4.

### F3. Label-driven queues conflict with GitHub-native project policy

**Port blocker.** Vibe supports several workflow modes, and its shared delivery
contract distinguishes them. However, copilot and queue-review command sections
still select work through route/status labels. The local fork policy is
`github-native`, with no conductors or workflow-label writes.

Resolve mode before selection and dispatch. In GitHub-native mode use explicitly
selected work, project scope and native GitHub facts. Do not manufacture labels
to make a selector work. Orchestrated integrations can retain their labels only
when explicitly configured, through their authoritative backend. T3 owns local
assignment state; GitHub owns remote issue/PR/check/merge facts.

Sources: `vibe-deliver/COMMAND.md`, Workflow mode; `vibe-copilot/COMMAND.md`,
Phase 1; `vibe-queue-review/COMMAND.md`, Phase 1; current repository policy.

### F4. Source invocation rights must survive role packaging

**Port blocker.** Hypercoder commit, new-pr and ship-it have explicit invocation
boundaries. An attended Vibe deliver invocation can authorize shipping after
gates; ordinary build/review/spec requests cannot. Vibe deploy includes an
environment auto-approval convenience. Queue-review has gated auto-queue paths.

Loading a skill must grant none of those rights. Record the authorized finish,
target, scope and caller separately from role instructions. Keep publish, merge,
deploy, environment approval and cleanup distinct. The supervised template still
defaults to a reviewed result. Optional operator actions require their own
authorization and current capability checks. A queued merge is reported as
accepted/queued, not completed.

Sources: Hypercoder command frontmatter; `vibe-deliver/SKILL.md` and command;
`vibe-deploy/SKILL.md`; `vibe-ship/SKILL.md`; `vibe-queue-review/COMMAND.md`.

### F5. Queue freshness language is weaker than the ownership contract

**High correctness risk.** Queue-review describes a freshness filter using PR
`updatedAt`, while the shared processing-lock skill says age alone cannot prove
that a lock is safe to reclaim. An idle-looking PR may have a live reviewer.

Use the stronger contract: check live ownership and unchanged head before any
reclamation. Inside T3, use authoritative assignment ownership/generations and
existing worktree checks. Never treat an old timestamp as ownership permission.
In GitHub-native mode this does not justify adding a forbidden label.

Sources: `vibe-queue-review/COMMAND.md`, processing-lock contract and Phase 1;
`pr-processing-lock/SKILL.md`, Consumer rule and Staleness.

### F6. Device and screenshot rules disagree across hosts

**High evidence risk.** Hypercoder's simulator skill treats screenshots as private
self-checks because the user watches a pane. T3 requires UI evidence for changed
surfaces and has a Device panel with device-bound commands. Vibe supplies useful
state/fixture and revision-bound evidence rules, but some capture paths assume
its standalone producer or other browser tooling.

Retain Vibe's coverage/evidence contract and use the active T3 browser/device
backend. Follow repository verification rules. A visible simulator is not proof
that all required states were inspected; a shell cookie is not browser auth.
Do not copy Hypercoder's `simctl` UI-driving instructions or override the active
host's preview rules. Require the actual supported test/install path.

Sources: Hypercoder `ios-simulator`; `vibe-screenshot`; shared delivery contract;
repository device, client verification and live-data rules.

### F7. Human correspondence and peer communication must stay separate

**High privacy/authority risk.** Vibe email references private correspondence
profiles, holdbacks, personal voice rules and a prose-checker installation.
Vibe wins can copy a draft to the machine clipboard after review. Neither is a
replacement for authenticated peer messages.

Keep human drafting as an optional extension. Do not bundle personal profiles or
holdbacks as defaults; load only explicit project-scoped material. Show/copy/send
are separate actions. Agent peer questions use T3's structured message service
and cannot inherit correspondence transmission permissions. A missing prose
checker is a dependency state, not permission to install arbitrary software.

Sources: `vibe-email/SKILL.md` and command; `vibe-wins/COMMAND.md`, Steps 5–6;
T3 message semantics in this design.

### F8. Planning and setup can create redundant artifacts

**Medium scope risk.** Vibe spec, PRD, init and create cover different levels of
planning and setup. Their generic defaults can mention root spec trees or new
product packages; Hypercoder specs are tied to existing cards. Init's stealth
rules apply to generated project policy, while this feature explicitly exposes
Vibe workflow names in its own catalog.

Respect repository authority and existing artifact identity. Do not make every
small assignment create a PRD, repeat accepted discovery or open another planning
PR. Keep project setup inspect/propose/apply distinct. Product catalog labels
may name Vibe; user project scaffolding must not be filled with private runtime
paths or machine-specific workflow instructions. Prevent recursive configuration
such as a review procedure selecting itself as its external review command.

Sources: `vibe-spec`, `vibe-prd`, `vibe-init`, `vibe-create`; Hypercoder `spec`;
local repository policy.

### F9. Operations are profiles, not default worker powers

**Medium portability/scope risk.** Vibe create targets a particular web stack and
cloud tooling. Clone DB uses a local default Postgres connection rather than the
host/port in a URL. Automate and sync assume host jobs or a project manifest.
The Hypercoder adapter requires a separately verified host assignment.

Keep these as capability-gated extensions. Do not run stack bootstrapping, fleet
sync, host schedulers, database cloning or external-host compatibility checks just
because a Planner is running. Use T3's scheduling/linked-environment services
where supported. Clone operations need explicit database identity and a verified
local profile; never point them at T3's live data. Missing providers/tools remain
visible, not silently emulated.

Sources: `vibe-create`, `vibe-clonedb`, `vibe-automate`, `vibe-sync`,
`vibe-hypercoder`; the earlier Hypercoder inventory.

### F10. Summaries and read-only labels cannot substitute for facts

**Medium correctness risk.** Changelog, wins and status have different evidence
coverage. Vibe status permits documented stale-sweep/read-repair behavior. Neither
an agent-authored recap nor a command called status guarantees a pure read or
that work shipped.

Split report modes into shipped-only and activity. Read status from canonical
projections without implicit cleanup; expose any maintenance mutation separately.
Return structured results and evidence references for UI summaries. Display
reported versus verified facts and retain exact revisions and gaps.

Sources: Hypercoder `changelog`; `vibe-wins`; `vibe-status/SKILL.md`;
the communication presentation contract.

## Complete Vibe disposition

All public names below remain aliases to the combined library. A canonical
family may provide several explicit modes; this is a design crosswalk, not a
runtime registry. The receipt records exact source identities and adaptations.

| Vibe entry          | Tier                      | Canonical family                    | Hypercoder overlap / integration                      |
| ------------------- | ------------------------- | ----------------------------------- | ----------------------------------------------------- |
| `vibe-adopt`        | Core                      | Workspace rescue, known destination | Workspaces; preserve before relocating                |
| `vibe-automate`     | Extension                 | Automation planning                 | T3 scheduler; no default host job                     |
| `vibe-build`        | Core                      | Implementation                      | Workspaces, commit and PR handoffs                    |
| `vibe-cleanup`      | Extension                 | Workspace cleanup                   | Workspaces; dry-run and explicit apply                |
| `vibe-clonedb`      | Extension                 | Local database sandbox              | No Hypercoder counterpart                             |
| `vibe-copilot`      | Extension                 | Attended queue coordination         | Roadmap/workspaces; explicit selection scope          |
| `vibe-create`       | Extension                 | New-project profiles                | Setup intent; stack/cloud prerequisites               |
| `vibe-decide`       | Core                      | Durable decisions                   | Manager questions; user-only choices preserved        |
| `vibe-deliver`      | Core, operator invocation | Delivery coordination               | Ship-it; finish authority is explicit                 |
| `vibe-deploy`       | Extension                 | Deployment                          | Target-specific authorization and approval            |
| `vibe-design`       | Core                      | Design work                         | Prototype; shape/create/improve/audit modes           |
| `vibe-dirty`        | Core                      | Workspace provenance audit          | Workspaces; audit before rescue                       |
| `vibe-email`        | Extension                 | Human correspondence drafts         | No peer-chat substitution                             |
| `vibe-game-design`  | Excluded                  | Games                               | User exclusion applies to both sets                   |
| `vibe-hypercoder`   | Extension                 | External-host compatibility         | Optional adapter; no T3 startup dependency            |
| `vibe-idea`         | Extension                 | Business discovery                  | Research, not automatic build/provisioning            |
| `vibe-init`         | Core                      | Project preparation                 | Hyperspace-init intent; preserve T3 configuration     |
| `vibe-issue`        | Core                      | Work intake                         | Roadmap capture; no implicit dispatch                 |
| `vibe-patch`        | Core                      | Focused fixes                       | Debug procedure plus scoped implementation            |
| `vibe-prd`          | Core                      | Product contract                    | Complements, rather than replaces, feature specs      |
| `vibe-publish`      | Core, authorized finish   | Draft PR publication                | New-pr; no merge                                      |
| `vibe-queue-review` | Extension                 | Queue assessment                    | Review/ship modes with separate authority             |
| `vibe-review`       | Core                      | Review                              | Independent inspect and managed-repair modes          |
| `vibe-screenshot`   | Core                      | UI evidence                         | Prototype/mobile evidence through T3 backends         |
| `vibe-ship`         | Core, operator invocation | Merge request                       | Ship-it; exact-head checks and permission             |
| `vibe-spec`         | Core                      | Feature specification               | Spec and accepted-scope handoff                       |
| `vibe-start`        | Core                      | Workspace start/resume              | Workspaces; existing host ownership                   |
| `vibe-status`       | Core                      | Status read                         | Workspaces; no hidden maintenance                     |
| `vibe-sync`         | Extension                 | Fleet reconciliation                | Explicit multi-project scope only                     |
| `vibe-wins`         | Core                      | Activity reporting                  | Shared reporting evidence; separate shipped-only mode |
| `vibe-worktrees`    | Core guidance             | Workspace policy                    | Passive ownership discipline, not a second executor   |

## Combined role bundles

Planner starts with feature spec, status, assignment coordination and spec audit.
Product PRD, issue capture, board operations, decisions and reporting are loaded
when the objective needs them. Business discovery and queue operations are
optional profiles, not background tasks created by the role.

Designer starts with design-shape/prototyping and spec. Design implementation and
evidence capture require the appropriate task scope and tools. Builder uses
implementation/patch, workspace policy and checks, adding commit/PR procedures
only for its authorized finish. Debugger adds the Hypercoder-derived repro-first
procedure and relevant tests. Reviewer uses inspection and evidence interpretation
with fresh context; managed repairs belong to an explicitly authorized writer.

Merge, deployment, destructive cleanup, fleet sync and external correspondence
remain operator capabilities. A role can know that those procedures exist without
receiving authority to execute them.

Hypercoder-only contributions stay explicit: typed board operations, spec
freshness audit, peer coordination, repro-first debugging, mobile verification,
standalone commit mechanics and shipped-only reporting. Reuse a combined family
when semantics match; keep separate modes when the evidence or authority differs.
Kits remain deferred. Neither games workflow is a porting target.

## Built-in delivery requirements

1. Ship versioned procedure definitions, aliases and an audited dependency graph
   with T3. Keep one canonical definition; generate provider packaging from it.
   Skills cannot require a personal Vibe installation for the supported built-in
   path. Do not claim bundled helpers until they are actually packaged and tested.
2. Implement host adapters over existing T3 services. Do not start a Vibe
   conductor, a second agent runtime or an independent worktree/approval manager.
3. Resolve effective project mode and policy before discovery, selection and
   execution. Preserve source invocation rights without granting them on load.
4. Show core/extension, prerequisites, loaded/on-demand/missing state, source,
   version, supported provider mode and allowed actions in the role/catalog UI.
5. Validate role behavior with actual-source evals and focused state/service
   tests. Include inspect-versus-repair, no-label mode, unavailable dependencies,
   human/peer distinction, denied shipping, preserved work and stale evidence.
6. Keep ordinary skills usable without the roadmap. Preserve native discovery,
   precedence, refresh, invocation restrictions and user configuration; test
   exact-source selection and collisions. Record minimal shared-file hooks and
   reassess them when integrating upstream updates.

Audit first is intentional. This PR updates the design and acceptance contract;
it does not install the combined library, enable operations or execute any of
the source workflows. Follow-up implementation must resolve the port blockers
and provide evidence before advertising a skill as ready.

## Evidence and limits

- [Vibe audit receipt](evidence/vibe-skill-audit.json): all 31 installed entry
  points, command files where present, hashes, Codex mirror comparison and
  per-entry disposition. Paths are relative to the Vibe source root.
- [Hypercoder inventory](evidence/skill-inventory.json): 15 source names, 14
  in scope, provider packaging and file hashes.
- [Earlier migration matrix](skills.md): detailed Hypercoder-to-T3 adaptations.
- Shared delivery contract and active repository policy were read. Command
  bodies were scanned as inert text and relevant contract sections inspected.
  Every recursively referenced helper/profile was not audited or executed.
- This is not a test of vendor service behavior, licensing permission, live
  deployments, generated apps or model compliance. Source hashes identify the
  inspected versions; later updates need a new compatibility assessment.
