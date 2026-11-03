# AI instructions for Omid's T3 fork

These instructions apply to `vib3oh/coder-t3-omid` alongside the upstream
[AGENTS.md](../../AGENTS.md). Keep the root fork pointer small and maintain
`CLAUDE.md` as an import of the same instructions, without a second policy copy.

## Build on native T3

- Inspect current source and existing extension points before designing a custom
  feature. Extend the existing service, typed contract and client path when they
  already own the behavior. Follow T3's service and event-sourcing boundaries.
- T3 owns provider execution, threads/tasks, permissions, worktrees, checkpoints,
  questions, cancellation and environment routing. Reuse native skill discovery,
  invocation, workspace snapshots and composer selection. Add only the missing
  feature behavior; do not introduce another executor, conductor or state machine
  for facts T3 already owns.
- Keep new logic in cohesive fork-owned modules. Limit edits in shared upstream
  files to necessary integration points. Do not copy large upstream modules to
  avoid editing them. Record actual hooks and their reasons in the fork's
  integration manifest when present, otherwise in concise feature documentation;
  do not invent an implemented manifest or API.
- Keep custom features independent where practical, using optional adapters for
  links between them. Ordinary skills and role use must not require the roadmap
  feature. Shipped features must not require the developer's personal Vibe
  installation, home paths, credentials or local profiles.
- Preserve native defaults and user configuration. Expose unsupported capabilities
  explicitly. For substantial new behavior, provide a disable/rollback path that
  preserves conversations, work and evidence; verify ordinary behavior with the
  feature disabled.

## Contributor workflow

Use applicable installed `vibe-*` skills as the primary workflow and read their
instructions before acting. Load repository-local policy from `.vibe/config.json`
and `.vibe/agent-rules.md` when present. A linked worktree missing those files
reads them from the primary checkout; resolve that checkout from Git rather than
hardcoding a machine path. For portable Vibe worktree creation, use the primary
checkout's `.vibe/worktree.sh` adapter and `vibe_t3_create_or_resume` when available.
Preserve a worktree already assigned by T3 and its branch identity.

Honor the configured workflow mode and authorization. In GitHub-native mode,
GitHub owns lifecycle; do not add workflow labels or start conductors. Preserve
unrelated worktrees and features. Follow the root instructions for live data,
development setup, surface/provider coverage, focused tests and model-facing
evals. Run `vp run check:changed` before a requested push; do not substitute
repository-wide checks. Publication and merging retain their separate authority.

## Maintain compatibility with upstream

When integrating community updates, use an isolated worktree and retain upstream
history. Revisit each affected fork hook against the incoming implementation;
a clean Git merge does not establish behavioral compatibility. Run the relevant
native tests and fork integration checks, including disabled-feature behavior,
then the repository's changed-file validation. Use the existing client verification
workflow for affected surfaces and evals for changed model-facing text.

Adopt equivalent upstream capabilities and remove superseded fork code. Do not
maintain two implementations just to preserve the fork's original shape. Update
hook records, documentation and tests when a boundary changes. Keep the root
fork pointer and CLAUDE import when reconciling upstream instruction updates.

## Keep claims grounded

Check the actual branch/revision before treating a proposed or previously
reverted module as available. Distinguish design coverage, static inspection and
working integration evidence. A design proposal does not authorize product
implementation. Keep active work in its existing issue/PR and temporary research
outside Git; commit durable design material only when requested. The
[orchestration compatibility contract](agent-orchestration/upstream-compatibility.md)
is the feature-specific application of these rules, not proof that its proposed
runtime is implemented.
