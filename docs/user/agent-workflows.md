# Supervised agent workflows

A workflow assigns a bounded change to Planner, Builder and independent Reviewer
roles. You can follow their assignments, evidence and targeted messages without
keeping their conversations open. Your selected provider and execution modes
remain in effect. An agent role does not grant permission to publish or merge.

Open **Agent workflows**, select a project and enable new workflows. Start from
a stopped thread or an unlinked roadmap card. Choose the stage roles and models,
objective, acceptance criteria, required check commands and execution limits.
Starts require a clean Git checkout; commit the intended input first. Existing
linked card work has an **Open linked thread** action so its owner is preserved.
The ordinary roadmap build and managed review actions remain available.

The role editor is available on web and desktop through Project roles or Project
settings. Clone a preset to customize its mission, instructions and skill bundle.
Readiness resolves the saved role against the destination provider’s actual skill
catalog. Missing, disabled, unsupported or changed required skills block dispatch;
the app does not switch providers or substitute a different skill silently.
Built-in procedures work without a personal Vibe installation. Some operational
procedures require additional capabilities or explicit user invocation. Workspace
kits and built-in games are outside this release.

Open a workflow to inspect its current stage, frozen criteria, assignments and
artifacts. Expand a communication summary to read the exchange; diagnostics keep
its transport facts and identifiers separate. Messages identify their actual
sender. A delivered or acknowledged message is not proof that work passed.
Questions use explicit replies, and unresolved questions remain visible. Native
approvals and user decisions link to the relevant conversation’s existing input
controls. Mobile supports monitoring, evidence, replies and lifecycle controls;
edit role presets on web or desktop.

Pause prevents new assignments while running turns remain visible. Cancel stops
owned work and invalidates stale results without deleting conversations or
worktrees. Retry preserves the accepted inputs and starts a fresh attempt. To
revise active work, cancel that assignment and send the revised instruction to
the manager; its frozen history remains intact. You can explicitly update limits
when more attempts or review rounds are needed. Limits bound workflow-managed
assignments and messages; token or dollar coverage can remain unknown for a
subscription provider.

Builder and Debugger capture a hidden Git checkpoint, run the required commands
against that snapshot and submit structured evidence. Reviewer inspects the same
revision and returns findings without owning repairs. Builder addresses valid
findings, followed by a fresh review. A stopped turn alone cannot accept an
assignment. A reviewed result is presented to you; it does not mark a roadmap
card complete, approve a PR or authorize a merge.

Workflows belong to the selected project and environment. Closing the client
does not stop them. Disabling new starts preserves history and controls for
existing work. Cross-environment workflow replication and simultaneous builders
sharing one checkout are outside the initial supervised template.
