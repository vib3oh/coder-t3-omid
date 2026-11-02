# Verification

Verified on 2026-11-02 against the initial upstream commit in `fork.json`.

`vp run check:changed` passed formatting, lint, both unused-code checks, GraphQL
generation validation, typechecking of the 39 affected packages, 95 tests in
ten files, and React Compiler coverage for ten changed client modules. The
complete upstream test and release suites were not run.

The roadmap tests exercise persisted boards across fresh service instances,
project isolation, competing saves, duplicate ids, corrupt files, failed atomic
replacement and recovery after that failure. A real in-memory SQLite projection
test verifies linked archived and older settled threads are returned while
foreign-project and unlinked threads are excluded.

Chromium component tests exercise a card draft during a competing edit and a
background refresh, conflict feedback, reloading without losing the draft,
preserving concurrent metadata when saving the rebased draft, and closing a
read-only drawer. They also verify review-section visibility, checklist/spec
edits, real pointer drags that route to thread launch or review, reserved-thread
launch retry, worktree defaults, and archived-thread resume. Transport calls are
mocked in these Chromium tests; no paid provider is launched. Screenshots and a
short drag recording are attached to the PR rather than committed.

Lifecycle tests cover draft/ready/merged PRs, archived work,
dismissed stack links, mixed open and merged PRs, and card ranking. The existing
permission test table now exercises the roadmap mutation’s target-environment
grant at availability and execution, including the existing launch-thread RPC.
Persistence tests include optional spec/checklist fields on legacy boards and
duplicate criterion-id rejection; merge tests cover independent checkbox/text
edits and concurrent criterion additions.

The production web build (`vp build` from `apps/web`) passed. It emitted the
upstream large-chunk warning. An isolated dev server also started successfully
with `--home-dir <checkout>/.t3 --no-seed`, including database migrations and
WebSocket service construction. No full paired-client, native desktop packaging,
native mobile, or live HyperCoder cloud flow was exercised.

REA’s completed CLI analysis, bounded coverage and the partial ASAR analysis are
documented in [the investigation](hypercoder-investigation.md). Full local REA
Evidence is kept in the ignored `.t3/research/hypercoder` directory. Proprietary
source, credentials and application userdata are excluded from commits.
