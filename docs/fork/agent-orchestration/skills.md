# Skill migration for role-based agents

Proposal: carry over the useful behavior of Hypercoder's non-game workflows through
T3-native skills and existing Vibe workflows. Availability depends on the actual
tools in the destination environment. This document defines the migration;
it does not install skills or claim feature parity.

## Inventory and scope

The inspected Hypercoder app bundles **15 distinct workflows**: 11 Claude skill
files plus four commands. Codex packages those same 15 names as skills. The
11 shared skill files and the review command are byte-identical across the
inspected packages; commit, new-pr and ship-it have provider-specific variants.
The [inventory receipt](evidence/skill-inventory.json) records paths, hashes,
packaging and versions. This is the bundled set in the inspected app, not every
personal or third-party skill a user may have installed.

The user excluded games. The porting scope is therefore **14 workflows**;
`hypergames` remains in the historical inventory only and is not a migration
target, including its standalone game-authoring portion.

Porting means preserving the working method and output contract while replacing
Hypercoder-specific services, commands, identity and authorization. For this
fork, applicable `vibe-*` workflows remain primary. Do not introduce another
commit, PR, review, shipping or worktree lifecycle beside them.

| Hypercoder workflow | T3 route                                                                                         | What needs adaptation                                                                                                                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `roadmap`           | T3 roadmap service and planned agent API; Vibe intake where appropriate                          | Typed board reads/mutations, card identity, revision conflicts and assignment launch. Never write board files directly or claim the agent API exists before it is implemented. Thread-only workflows can start without it.                      |
| `spec`              | `/vibe-spec`                                                                                     | Read the repository's actual config and spec authority. Preserve existing issue/card/document identity and accepted criteria. Do not create a second backlog or spec location.                                                                  |
| `roadmap-audit`     | Proposed T3 spec-audit skill, composed with `/vibe-spec` and `/vibe-status`                      | Read current spec and source, check named paths and completion evidence, report valid/stale/shipped/superseded with reasons. Vibe status alone does not perform this audit. Verification stamps require actual review at the recorded revision. |
| `workspaces`        | `/vibe-start`, `/vibe-worktrees`, `/vibe-status` and T3 delegation/messaging tools               | Use the repository's worktree adapter, exact T3 thread/assignment identities and existing launch/cancel services. Replace pane-based control, polling and manager messaging with the proposed workflow service.                                 |
| `changelog`         | Proposed T3 shipped-work reporting skill; reuse Vibe reporting where suitable                    | Report from actual merged PR/card evidence, preserve dates and uncertainty, distinguish uncarded work. Do not treat an agent's completion claim as shipped. Report generation does not authorize sending messages.                              |
| `prototype`         | `/vibe-design` plus T3's HTML/browser tools when appropriate                                     | Preserve design exploration and review before implementation. Use actual T3 tokens, accessible states and permitted preview tools. No Hypercoder pane server or launcher is required.                                                           |
| `debug`             | Proposed T3 debug procedure, with `/vibe-patch` or `/vibe-build` for the authorized fix          | Preserve reproduction, causal evidence, focused regression proof and honest blocked results. Apply the repository's testing rules and existing shell tools.                                                                                     |
| `ios-simulator`     | T3 Device tools and the project's mobile verification workflow                                   | Discover/open the selected device; drive it through the returned device command. In this fork use `test-t3-mobile` and the established install path. Do not copy Hypercoder's simulator/pane targeting or its screenshot rules.                 |
| `hyperspace-init`   | `/vibe-init` and T3 project setup/run configuration                                              | Translate setup intent into existing `t3.json`/project scripts and repo policy. Do not require `hyperspace.json`, Hypercoder cache paths or its environment variables.                                                                          |
| `commit`            | Commit stage of the authorized Vibe workflow; an existing commit helper can supply the mechanics | Preserve explicit scope, staged-change protection and verification. A role or available skill does not independently authorize commit or push.                                                                                                  |
| `new-pr`            | `/vibe-publish`                                                                                  | Resolve the repository/base/current branch, validate, publish or update one draft PR, and link it in T3. Respect the configured workflow mode.                                                                                                  |
| `review-pr`         | `/vibe-review`                                                                                   | Preserve full-diff review, findings and revision-bound evidence. Use T3/Vibe result records rather than Hypercoder's review receipt commands. A workflow review/recheck is a fresh assignment.                                                  |
| `ship-it`           | `/vibe-ship`, or `/vibe-deliver` when explicitly authorized                                      | Preserve current-head checks and review. Shipping remains a separate authorized action; do not silently attach merge authority to Builder.                                                                                                      |
| `kits`              | Capability gap; defer the pane/layout-template portion                                           | T3 currently has no equivalent established here for reusable Hypercoder kits that create pinned panes and install integrations. Record the skill as unavailable with a reason until that product capability exists.                             |

The named T3 audit, reporting and debugging procedures are proposed adapters, not
existing installed skills. Mapping to a Vibe skill does not prove the necessary
T3 service or underlying tooling is available. Track implementation and evidence
per workflow rather than marking the table as migrated.

## Give each role a small skill bundle

| Role     | Core bundle                                                  | Conditional additions                                                                       |
| -------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Planner  | Spec, assignment/workspace coordination, spec audit          | Roadmap API and shipped-work reporting when the project uses those surfaces                 |
| Designer | Design/prototyping and spec                                  | Browser/device inspection when needed for the design                                        |
| Builder  | Implementation, focused checks and scoped commit procedures  | PR publishing only for an authorized PR finish; mobile verification for mobile changes      |
| Debugger | Reproduction/debug procedure and focused fix workflow        | Device/browser tooling appropriate to the actual failure                                    |
| Reviewer | Review workflow and applicable check/evidence interpretation | Browser/device verification for the changed surface; no implied permission to edit or merge |

The role editor shows the bundle's required and optional skills. Assignment
startup shows which are loaded, available on demand, missing or unsupported.
Missing required skills block that assignment with a specific remedy; optional
skills do not prevent unrelated work. A role name never substitutes for a skill
that was not resolved.

Keep the catalog broad and each assignment's context small. Load the role's
necessary instructions and summaries of optional skills, then fetch additional
instructions when needed. Do not inject the full catalog into every agent's
context. Preserve an explicit version/content hash so a later skill update does
not change the instructions of an in-flight assignment silently.

## Portability contract

One authored procedure should describe the intent, inputs, evidence and outputs.
Provider adapters may package it differently for native skill discovery or expose
it through T3's task context and tool discovery. This avoids keeping separate
hand-edited behavioral copies for Claude, Codex and every other provider.

Resolve these requirements at assignment start:

- Skill identity/version, trusted source and transitive skill references.
- Required T3 capabilities, external executables and relevant project commands.
- The environment in which those capabilities are present, not the client machine.
- Effective caller permissions, repository policy, scope and user authorization.
- How instructions reach this provider: loaded, discoverable on demand or unsupported.

The canonical skill stays separate from Vibe's local policy. A worktree loads the
project's actual configuration, including the primary checkout's local policy
when required. A `github-native` project must not gain workflow labels,
conductors or unattended merge behavior because a ported workflow once used them.

Do not translate `hc` shell strings by textual substitution. Replace them with
service operations and typed input/output. Detect dependency cycles and missing
tools before dispatch. Resolve paths within the authorized project/environment;
never infer another agent's identity or copy its credentials. Fetching a skill
does not execute a skill, install its dependencies or authorize its side effects.

User-triggered actions keep their invocation boundary. The inspected commit,
new-pr and ship-it commands explicitly disable model invocation in the Claude
package. A T3 port must preserve their authorization meaning across providers,
even if their native skill formats encode it differently. A task explicitly
authorized to publish can use `/vibe-publish`; discovering that skill is not
publication authority.

## Packaging and provenance

Write independent T3 procedures/wrappers around the existing Vibe workflows.
Keep versioned definitions in the fork's owned extension modules, with provider
packaging generated from that source if necessary. Choose the actual packaging
path during implementation; no runtime skill directory is added by this design PR.

The inspected app package declares `UNLICENSED`, and the bundled plugin manifest
does not state redistribution terms. The inventory does not establish permission
to redistribute its original instruction text. This package therefore records
behavior, hashes and migration requirements without copying the original skills.
Any proposal to ship verbatim third-party material needs its provenance and
redistribution basis established separately.

Personal and third-party skills are a separate import path. Preserve the source
and license, resolve provider/tool requirements, and let the user attach compatible
skills to roles. Do not automatically copy the entire global skill installation
or overwrite existing agent configuration. Arbitrary plugin installation remains
outside the first release.

## Completion and verification

Every one of the 14 in-scope entries must eventually have one recorded disposition:
adapted and verified, optional with explicit prerequisites, or deferred with a
concrete missing capability. A deferred entry is not parity. Core role bundles
must have their required skills verified before those roles are advertised as
ready for the supervised template.

For implemented skills, validate dependency resolution, provider packaging,
instruction composition, missing-tool behavior, permission boundaries and
revision-bound outputs. Use fixture-backed service tests for state mutations and
real-model evals for choosing/using skills and honoring role boundaries. Include
ordinary tasks that should not trigger planning, shipping or extra agents.

When implementation changes model-facing instructions or tool definitions,
follow `evals/README.md`, test the actual source text and report the evaluated
provider/model coverage. File presence or a skill appearing in a menu is not
proof of effective execution.
