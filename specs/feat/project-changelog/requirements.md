# Project changelog

## Problem

The owner requested a separate changelog view with HyperCoder's changelog functionality, built in a worktree from `main`. Draft [PR #3](https://github.com/vib3oh/coder-t3-omid/pull/3) currently implements a narrower view of merged work retained by T3; this specification records that contract and the remaining parity decisions without treating the narrower scope as owner-approved.

This is a retrospective draft, grounded in product code at `4240713616e5fc12f4d96a1872709aea2d80fc05`. It is a requirements artifact for this PR, not a claim that full HyperCoder parity or independent review has passed. The owner's explicit request to include this artifact in the PR overrides this clone's default `specArtifacts: off` for this file only.

## Acceptance criteria

The criteria below define the current draft PR's contract. Unchecked boxes require review against the cited implementation and evidence; they do not mean that all corresponding behavior is absent.

### Project scope and source

- [ ] **CL-01:** Open Changelog from the sidebar or command palette. Select a project scoped to its environment; retain the selected project in the URL. With no project available, show an empty state. The feature must remain usable without the separate roadmap board.
- [ ] **CL-02:** Include merged PR snapshots linked to non-deleted threads of the selected project, including archived and settled threads. Exclude open or closed-unmerged PRs, links dismissed from a stack, other projects and deleted threads. Do not fetch repository history or load conversation bodies.
- [ ] **CL-03:** Deduplicate by case-normalized host, repository and PR number. When multiple eligible merged snapshots exist, use the first after ordering by snapshot sync time descending and thread ID ascending. Use the snapshot's merge timestamp, never the thread creation/update time or the snapshot sync time, as the entry date.
- [ ] **CL-04:** Omit deduplicated merged PRs whose merge date is missing or invalid and report their count separately. That count is project-wide, since undated records cannot be assigned to a selected date range. Entries use the PR title and URL; a different thread title supplies the summary, otherwise the summary is empty.
- [ ] **CL-05:** Infer type from a case-insensitive conventional PR-title prefix: `feat` becomes Feature, `fix` Bug, `spike` Spike, and `chore`, `refactor`, `docs`, `test`, `build`, `ci`, `perf` or `style` Chore. Other titles are Untyped. Do not represent inferred types as roadmap-card metadata.

### Calendar, filtering and navigation

- [ ] **CL-06:** Default to 7 days. Today includes the current local calendar day; 7 days includes today and the previous six days; 30 days includes today and the previous 29 days. Start at local midnight and exclude the next day's midnight. Calendar arithmetic must preserve local-day boundaries across daylight-saving transitions.
- [ ] **CL-07:** Group entries by local calendar day, newest day first and newest merge first within a day, with a stable identity tie-break. Show a 31-day activity strip, including zero-count days and type-colored marks. Keep that strip independent of the list's type/search filters. A populated day within the 30-day list window clears type/search filters, widens the range when needed and scrolls to its entries; the additional oldest strip day is display-only.
- [ ] **CL-08:** Combine one type filter with case-insensitive substring search over title, summary and `#<PR number>`. The headline and type counts describe the date range before type/search filtering. Changing the date range resets the type filter and preserves search; choosing All clears the type filter. Provide recovery actions for no matching results or no work in the selected range.
- [ ] **CL-09:** Expand an entry to show its full summary, merge timestamp, PR link and thread action. Opening an archived thread is explicitly an unarchive-and-open mutation, available only with permission to change threads. Opening a PR must use its HTTP(S) URL.
- [ ] **CL-10:** Refresh from the selected environment while mounted and offer manual retry/refresh. Distinguish initial loading/read failure from a failed refresh with previously loaded data. A narrow viewport must remain usable through wrapping controls and horizontal scrolling of the activity strip, without page-wide horizontal overflow.

### Export and agent drafts

- [ ] **CL-11:** Copy changelog exports only the currently visible selection as Markdown, grouped by local day, with type, title, PR number and any summary. It does not claim to produce clickable PR links. Disable it when the selection is empty; report clipboard success or failure.
- [ ] **CL-12:** Ask an agent offers release notes, a short standup note and announcement suggestions. For a new or empty composer draft, include the current filtered entries and request PR citations without invented impact or motivation. Use T3's existing draft-preservation rules; do not overwrite user content in an existing draft, send the draft automatically or select a new paid runtime on the user's behalf.

### Public snapshot lifecycle

- [ ] **CL-13:** Sharing is explicit and requires access-management permission on the destination environment, enforced on the server and reflected by the client permission state. Private reads require orchestration-read permission. Show what will become publicly readable before publishing. Summaries are excluded by default.
- [ ] **CL-14:** Publish a static HTML snapshot of the current project, date range, type and search selection. Preserve the publisher's timezone for public day headings. Expose selected titles, dates, inferred types, PR numbers/URLs and optionally summaries; do not expose conversation bodies, thread IDs, thread navigation or project filesystem paths in the page.
- [ ] **CL-15:** Use an opaque random share ID. Updating a published snapshot retains its link and replaces the published content; changing private filters or source threads alone does not update it. Support copying the link and an iframe embed. The public page is a static list, not the private interactive chart/filter/agent view.
- [ ] **CL-16:** Revoke the snapshot so its old URL no longer returns the page. Publishing after revocation creates a different link. Persist share state and pages under this server's `userdata/extensions/changelog`, serialize per-project writes, escape rendered text and restrict public-page script execution. A missing or malformed public ID must not resolve an arbitrary file.
- [ ] **CL-17:** Explain that readers need HTTP reachability to the connected server. A loopback address or an authenticated relay connection alone does not create an internet-reachable public page. Do not claim a hosted publishing service or establish a tunnel implicitly.

### Verification and compatibility

- [ ] **CL-18:** Preserve the fork integration manifest, upstream history, existing provider support and the relative `CLAUDE.md` symlink. Use typed contracts and service methods; do not add an orchestration-event migration, provider adapter or another execution runtime. Keep implementation in the dedicated roadmap/changelog modules and the declared integration paths.
- [ ] **CL-19:** Verify source filtering, duplicate/missing-date behavior, calendar boundaries, combined filters, filtered exports, HTML escaping and publish/update/revoke behavior at their owning test layer. Run `vp run check:changed` before pushing. Run an integrated Browser-panel pass against isolated state; capture meaningful desktop and mobile-browser views. Do not write to live T3 data or install over the running app.

### Original HyperCoder parity is not yet complete

| Requested reference behavior                                                   | Current PR behavior                                                          | Remaining decision or gap                                                                                |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| A changelog sourced from Done roadmap cards, dated by merge or a shipped stamp | Retained merged PR snapshots linked to T3 threads                            | Manually shipped cards, durable card completion dates and unlinked completed cards are not represented.  |
| Card types, summaries and navigation back to the source card/spec              | Type inferred from PR title; summary from thread title; thread/PR navigation | Card metadata, slug/spec search and card/spec navigation need roadmap integration.                       |
| HyperCoder's shared public project page                                        | Explicit, revocable static snapshot on the connected T3 server               | A live public page, public address/identity controls and any hosted delivery require a product decision. |
| Detached native changelog window with an always-on-top control                 | Open the current route in a browser window                                   | Native detached-window management, pinning and returning that window to the app are not implemented.     |

This table records known differences from the supplied reference and prior local inspection. It is not an exhaustive certification of HyperCoder parity, and the original request is not complete merely because CL-01 through CL-19 pass.

## Terminology

- **Project:** an environment-local T3 workspace record. A matching project ID on another environment is not the same scope.
- **Changelog entry in PR #3:** one deduplicated, retained merged PR with a valid merge timestamp. This implementation meaning is narrower than a shipped roadmap card.
- **Shipped work:** the original product concept includes Done cards with a merge date or explicit shipped stamp; whether merged-only entries are acceptable for the first release remains an open scope decision.
- **Summary in PR #3:** a differing T3 thread title, not a PR body, conversation excerpt or roadmap brief.
- **Public snapshot:** a deliberately published static copy of a selection, readable without a T3 session by anyone who can reach its URL. It grants no access to the source project or thread.

## Implementation plan

1. Review this retrospective contract against PR #3 and resolve the scope questions below. Do not change product behavior from this spec-only task.
2. Use `packages/contracts/src/changelog.ts` and `apps/server/src/roadmap/ChangelogService.ts` to assess source identity, date omissions, permissions and share lifecycle. Check `ChangelogHttp.ts` for public responses and `packages/shared/src/projectChangelog.ts` for filtering, calendar arithmetic and exports.
3. Use `apps/web/src/roadmap/ChangelogPage.tsx`, `changelogState.ts` and the sidebar/command-palette hooks to assess private-view behavior, agent drafts and permission availability. Check explicit unarchive behavior separately from read-only navigation.
4. Review the focused service/date tests and permission tests, then compare the isolated Browser-panel evidence with CL-01 through CL-19. Resolve known parity gaps through an accepted revised contract before dispatching additional implementation. Any substantial roadmap, hosting or native-window design needs its own technical-plan/review gate within the owning work item, not an invented plan here.

## Out of scope

- Product implementation, fixes, new scope decisions, an independent review verdict or merge authorization during this artifact-only update.
- Unrelated upstream synchronization, provider changes, CI/runner setup, changes to the live installation or live data, and automatic publication or agent sends.
- A native React Native changelog screen, dedicated MCP/CLI commands and all-repository Git history are not delivered by PR #3. They must not be advertised as implemented.
- The parity gaps above are not approved permanent exclusions; they remain unresolved against the owner's original request.

## Risks and rollback

- Completeness: merged-only history omits manual shipments, deleted threads and unlinked work. Snapshot retention/unlinking can change the private history. Do not substitute sync time for missing merge dates or describe inferred card metadata as authoritative.
- Disclosure: public titles and PR URLs can reveal private work; opting into summaries exposes thread titles as well. Revocation removes server access to the page but cannot retract copies already saved by readers.
- Reachability: local, remote, relay and tunnel addresses have different audiences. A link opening for its publisher does not prove external reachability; remote/tunnel scenarios are not established by the recorded local test.
- Availability: a corrupt stored share-state file can fail the project's changelog read. Snapshot storage assumes one server owns its userdata directory; no cross-server locking is provided.
- Compatibility and performance: server and client must understand the new RPCs. Reading metadata avoids conversation payloads, but there is no measured large-history performance budget, server-side pagination or dedicated native-client implementation in this PR.
- Rollback: revert this feature's commits and restore its integration hooks. Revoke active public snapshots deliberately before rollback where possible. Preserve extension files for recovery; never delete or migrate live userdata as part of a code rollback. Reverting this spec-only update changes no runtime behavior.

## Open questions

- **Scope approval:** does the owner accept the merged-work contract as a first slice, or must PR #3 reach the original card-based/full-parity goal before review completion? Prior implementation and a draft PR do not answer this.
- **Public sharing:** should the target remain deliberate snapshots, or include a live hosted public project page and public-address controls comparable to HyperCoder?
- **Remaining parity:** which roadmap receipt/card navigation and native window behaviors must be included before calling the original task complete?
- **spec-route: Revise / owner decision pending on PR #3.** Keep the PR draft; do not dispatch a new build, mark ready, apply workflow labels, create a new issue or infer merge approval from this artifact. GitHub-native policy owns any subsequent decision.

## Product context

- PRD: Not established; this branch has no `docs/product/overview.md` package.
- Requirements: CL-01 through CL-19 are local to this spec; no `PRD-###` IDs exist for this work.
- Decisions: None recorded as owner-approved reductions of the original parity request.
- Product delta: artifact.
- PRD sync: No central product package to reconcile. This file records the current draft behavior and unresolved original intent; it does not approve a new product direction.

## References

- [Draft PR #3](https://github.com/vib3oh/coder-t3-omid/pull/3), including the declared PR scope, reported validation and uploaded desktop/mobile-browser evidence.
- Owner-supplied HyperCoder Changelog screenshot in the originating conversation; local installed-app inspection used [REA](https://github.com/morluto/rea). Neither the screenshot nor inspection is a product-approval record.
- `packages/contracts/src/changelog.ts`; `packages/contracts/src/clientRpcPermissions.ts`; `apps/server/src/auth/RpcAuthorization.ts`.
- `apps/server/src/roadmap/ChangelogService.ts`; `apps/server/src/roadmap/ChangelogHttp.ts`; `apps/server/src/roadmap/ChangelogService.test.ts`.
- `packages/shared/src/projectChangelog.ts`; `packages/shared/src/projectChangelog.test.ts`; `packages/client-runtime/src/state/commandPermissions.test.ts`.
- `apps/web/src/roadmap/ChangelogPage.tsx`; `apps/web/src/roadmap/changelogState.ts`; `apps/web/src/routes/_chat.changelog.tsx`.
- `docs/user/changelog.md`; `docs/fork/changelog.md`; `fork.json`; `AGENTS.md`; `docs/README.md`.

Historical verification on code revision `4240713616e5fc12f4d96a1872709aea2d80fc05`: the prior task recorded a passing `vp run check:changed origin/main --concurrency 2` run with 102 tests and six selected React Compiler checks, plus local Browser-panel checks. Those records are evidence to inspect, not a new spec approval, complete acceptance run, formal Vibe QA-manifest approval or proof of native/mobile/remote/tunnel coverage.
