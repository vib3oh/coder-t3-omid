# Building on upstream T3

Design constraint added after the skill audit: keep pulling community T3 updates
and build on its existing capabilities. This package contains research and design
only. No combined skills, role compiler or workflow controller have been installed
or tested in a running T3 client. Seamless integration is an acceptance goal,
not a result this PR demonstrates.

## Current fork base and rebase audit

The design branch was rebased onto `origin/main`
[`08f7150f56`](https://github.com/vib3oh/coder-t3-omid/commit/08f7150f560df3f43ad0745c8f2e88f932a8424d),
which merges roadmap PR #1. The incoming range from `aeb2e46aa9` contains one
commit and 41 changed files. The five design commits rebased without conflicts.
This audit follows the changed contracts, service/storage, launch/review UI,
permissions, navigation, test coverage and fork instruction boundaries for their
effect on this specification. It does not certify the incoming implementation's
live behavior or re-run its entire shipping verification.

| Incoming capability or change                                                                                                                 | Consequence for this proposal                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Revision-checked `RoadmapService.read/save/readView`, per-project atomic JSON and linked active/archived thread projections                   | Reuse board storage and environment/project scoping. Keep workflow facts separate; do not replace the service or overwrite a stale full-board snapshot.                                               |
| Optional full-spec reference and acceptance criteria with stable ids; conflict-aware card editing                                             | Snapshot resolved content and source revisions for an accepted assignment. A path, mutable checklist or checked row is not execution evidence.                                                        |
| `useRoadmapWork` reserves a thread link before initial launch, with stable command/message ids; linked work resumes through existing commands | Preserve ordinary launch retry and project defaults. Resolve existing writer ownership before workflow start. Agent/scheduled entry needs a server service over native execution, not the React hook. |
| Existing agent-review prompt fixes findings and marks a passing draft ready without merging                                                   | Keep managed repair distinct from the inspect-only supervised Reviewer. Preserve the existing control; add an explicit workflow action instead of changing its meaning.                               |
| Only Backlog/Up Next are stored lanes; other columns derive from thread/PR snapshots and explicit completion                                  | Workflow state supplements the board. Idle linked work can remain Building; PR-ready is not approval; reviewed-result completion is not a merge. Archive/parking is not workflow cancellation.        |
| Board read requires read scope; save and native launch are guarded by operate scope, including the shared runtime caller                      | Preserve permission atoms and execution-time destination grants. New UI/MCP calls use the same service policy; do not bypass the guarded launch path.                                                 |
| Roadmap route/sidebar and web UI exist; dedicated roadmap MCP and native mobile board do not                                                  | Reuse the shell and board entry points. Continue to declare agent and native mobile gaps; thread-based workflow operations cannot depend on those missing surfaces.                                   |
| `fork.json`, maintenance docs, root fork instructions and a relative `CLAUDE.md → AGENTS.md` symlink now exist                                | Retain the roadmap manifest entry and original upstream pin. Register actual new hooks only during implementation; consolidate contributor policy and preserve the symlink.                           |

The native skill discovery/dispatch, delegated-task and peer-message service files
reviewed below are unchanged by this incoming commit. It does change the shared
launch permission mapping and caller, so the new acceptance criteria explicitly
retain those guards. Existing source tests cover reserved-thread retry, stale
edits, review-lane behavior and destination grants; implementation should extend
those cases for workflow interactions. Their prior passing receipt belongs to
the roadmap PR, not to this design audit.

The [spec](spec.md#existing-roadmap-compatibility), [technical design](technical-design.md#roadmap-integration-on-the-refreshed-base)
and [UX](ux.md) now incorporate these constraints. The original Hypercoder/skill
receipts remain unchanged. This is a fork-base rebase, not integration of the
separately inspected newer community `upstream/main` ref below.

## Earlier native capability review

Before this rebase, the follow-up compared the fork's then-`origin/main` at
[`aeb2e46aa9`](https://github.com/vib3oh/coder-t3-omid/tree/aeb2e46aa96a08a95547d11bd97dd067895f5b61)
with the fetched upstream `main` at
[`5b9731cedc`](https://github.com/pingdotgg/t3code/tree/5b9731cedc06f310c394f48e66d50a614397c0aa).
It inspected the following native boundaries. This is a targeted source review,
not a merge rehearsal or a test of every provider.

| Native T3 boundary                                                                                                                                                                                                                                                                                               | Observed behavior                                                                                                                         | Fork responsibility                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Skill contracts](https://github.com/pingdotgg/t3code/blob/5b9731cedc06f310c394f48e66d50a614397c0aa/packages/contracts/src/server.ts)                                                                                                                                                                            | `ServerProviderSkill` and workspace snapshots already carry names, paths, enabled state, descriptions and invocation flags.               | Add only role-bundle references, provenance, dependency requirements and immutable assignment snapshots. Do not replace the provider skill catalog.       |
| [Codex discovery](https://github.com/pingdotgg/t3code/blob/5b9731cedc06f310c394f48e66d50a614397c0aa/apps/server/src/provider/CodexProvider.ts)                                                                                                                                                                   | Uses native `skills/list` scoped to the working directory.                                                                                | Package authored skills for native discovery; do not add a second filesystem scanner or Codex launcher.                                                   |
| [Claude discovery](https://github.com/pingdotgg/t3code/blob/5b9731cedc06f310c394f48e66d50a614397c0aa/apps/server/src/provider/Drivers/ClaudeSkills.ts) and [dispatch](https://github.com/pingdotgg/t3code/blob/5b9731cedc06f310c394f48e66d50a614397c0aa/apps/server/src/provider/Drivers/ClaudeSkillDispatch.ts) | Reads personal/project/plugin skills with precedence and invocation restrictions; dispatch handles Claude's native expansion constraints. | Preserve precedence and restrictions. Do not implement another parser or translate every provider's invocation through a new common dispatcher.           |
| [Shared composer support](https://github.com/pingdotgg/t3code/blob/5b9731cedc06f310c394f48e66d50a614397c0aa/packages/client-runtime/src/providerSkills.ts)                                                                                                                                                       | Resolves workspace-specific skills, filters menus and refreshes snapshots for the selected environment/provider/cwd.                      | Extend the existing picker and role setup only where bundle readiness needs additional information. No independent refresh loop or generic skill browser. |
| [Delegation service](https://github.com/pingdotgg/t3code/blob/5b9731cedc06f310c394f48e66d50a614397c0aa/apps/server/src/mcp/OrchestratorMcpService.ts)                                                                                                                                                            | Owns task dispatch, scoped messaging and cancellation over T3 services.                                                                   | Add supervised assignment rules over these services. No Vibe conductor, independent provider runtime or terminal-paste messaging.                         |
| [Agent message presentation](https://github.com/pingdotgg/t3code/blob/5b9731cedc06f310c394f48e66d50a614397c0aa/apps/web/src/components/chat/TimelineUserMessageRow.tsx)                                                                                                                                          | Already folds agent messages and supports revealing them.                                                                                 | Add readable summaries, correlation and consequential status to the existing feed. Preserve native attribution and expansion behavior.                    |

The skill contract, shared skill helpers and Codex/Claude files above have no
diff between these two refs. The delegation service and
`ThreadManagementService.ts` do have changes, including narrower projection
reads and a child-thread lookup for cancellation. That demonstrates why internal
service calls need compatibility checks even when the intended feature behavior
has not changed.

## Keep the patch small

Ship independently authored skill content and its resources as a versioned,
fork-owned package. Use native provider packaging and discovery as the default.
The bundle manifest is an overlay describing roles, dependencies, aliases and
versions, not a replacement for T3's discovered skills or their enabled state.
Do not assume every provider reads the same directory or supports the same
invocation. First prove how an app-bundled package becomes visible to each
supported provider without overwriting personal configuration. A task-context
fallback must be explicit, tested and consistent with invocation restrictions;
unsupported packaging remains unavailable.

Keep ordinary skill use independent of the now-available roadmap. Neither
publishing the library nor using a role should require opening a board or
linking a card. Supervised workflows may link existing threads to an optional
card through the current service. Roles supply purpose, inputs and deliverables;
T3 supplies the agent runtime, permissions, worktrees, questions, checkpoints and
cancellation.

Keep new code in cohesive fork-owned modules. Limit edits in shared upstream
files to imports/registration, additive typed contracts and feature entry points
that cannot be supplied through existing interfaces. There is no verified stable
general-purpose plugin API covering all these needs. Some shared-file edits are
expected; do not promise zero conflicts or hide an entire copied service behind
an adapter. Record each actual hook and why it exists in the existing `fork.json`
integration manifest when implementing the hook. Do not add entries for
unimplemented workflow modules.

Choose persistence after a small integration proof. First assess existing T3
storage and projection facilities for workflow-only metadata. The separate
SQLite store described in the technical draft is an option with cross-store
recovery costs, not a required first implementation or a proven conflict-saving
shortcut. Do not duplicate canonical task, message or provider state.

## Compatibility gates for implementation and updates

1. Prove one independently usable built-in skill through native discovery,
   selection and invocation on each initially supported provider. Verify refresh
   after a package update, local-name collisions, disabled skills and user-only
   invocation. A role must report the actual selected source/version/hash; if a
   pinned source cannot be resolved, report it rather than silently substituting
   a personal skill. Do not inject a user-only skill into an autonomous bundle.
2. Prove one planner → builder → reviewer handoff using existing T3 services
   before adding the full controller or committing to a storage design. Verify
   cancellation, a finished-child reply and restart recovery. Run without the
   roadmap extension and without a personal Vibe runtime.
3. Extend existing focused skill, delegation and message tests at the native
   boundary. Run required actual-source evals for changed model-facing content.
   Verify ordinary skill/delegation behavior with the feature disabled, plus one
   integrated client pass for the enabled behavior. Do not change upstream wire
   meanings or replace native tests with fork-specific mocks.
4. During an authorized upstream update, integrate into an isolated checkout;
   compare the recorded hooks against the incoming source and resolve semantic
   changes even when Git merges cleanly. Run affected native tests and the
   repository's `vp run check:changed` gate. A clean text merge alone is not
   compatibility evidence.
5. Keep the feature behind a flag and preserve readable history when new starts
   are disabled. When upstream supplies an equivalent capability, adapt to it
   and remove the fork implementation instead of maintaining two versions.

The fork-base rebase and specification impact audit are complete. Workflow
packaging, runtime behavioral tests/evals and a community upstream-update
rehearsal remain unperformed. The [spec](spec.md) and [technical design](technical-design.md)
make these follow-up requirements explicit; this document does not certify a
working agent-workflow integration.
