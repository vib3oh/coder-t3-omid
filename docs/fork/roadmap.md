# Roadmap architecture

The board owns planning. T3 owns execution. Keep those responsibilities separate
so upstream can change its agent runtime without requiring a second runtime here.
The fork introduces no new provider, worktree manager, authentication system, or
GitHub client.

Cards have a title, a brief, type, effort, a planning lane, optional linked thread,
an explicit completion flag, an archive flag, an optional full-spec reference and
acceptance criteria with stable ids. The new fields are optional so version-one
boards remain readable. Array order is rank. Only Backlog and Up Next are planning
lanes. Building, In Review, Parked and Done are derived from the linked thread and
its existing PR snapshots. In Review stacks Your review above Agent review and
hides each empty subsection.
Open PRs outrank historical merges; dismissed stack links do not count.

An unarchived linked thread counts as Building even when its agent is idle. A
draft PR is Agent review while that thread is unarchived, or Parked while it
is archived. A ready PR is Your review. With no open PR, an observed merge is Done.
Explicit completion takes precedence. A missing thread supplies no evidence of
execution; the card remains in its planning lane. This is intentionally T3’s
thread lifecycle, rather than a claim to observe HyperCoder workspaces.

The server stores versioned boards under its own
`userdata/extensions/roadmap/project-<encoded-project-id>.json`. Environment
identity comes from the RPC connection, so identical project ids on two machines
cannot mix. No writes go into a project’s source tree. No schema is added to
T3’s event log or SQLite migration sequence, which avoids migration-number
conflicts during upstream updates. Back up this directory with the server’s
userdata. Moving or cloning a project onto a different environment does not copy
its board automatically.

One server-wide service serializes saves per project. The client sends its
expected revision; stale saves fail before any write. A successful write replaces
the file atomically and increments the revision. Invalid or corrupt input is
rejected; corrupt stored files are preserved for recovery. This assumes the
existing T3 invariant that one server owns a userdata directory. The lock does
not coordinate multiple servers pointed at the same directory.

Read and save use typed `omid.roadmap.*` RPCs through T3’s existing connection
runtime. Reading requires orchestration read access; saving requires orchestration
operate access, checked both on the server and at client execution. The UI uses
the command’s permission atom. Boards refresh every five seconds while mounted;
they are not a separate push subscription. The editor retains the board revision
from when it opened, even while queries refresh. An edit conflict preserves the draft. Reload inside the editor to review
the latest card, then save deliberately; a three-way field merge preserves
concurrent changes to fields the local draft did not edit. Acceptance criteria
merge by stable id and field, preserving concurrent additions and independently
changed checkbox/text values. Duplicate criterion ids are rejected on save.

Board reads query T3’s projection store for the explicitly linked thread ids,
scoped to the project, in both active and archived storage. They include older
settled threads that T3 omits from its active client window. A narrow thread
summary crosses the wire; conversation history stays unloaded.

Dropping into Building uses the existing protected launch-thread command with
project defaults, or unarchives and sends a turn to the linked thread. A new
thread id is first reserved in the board through its revision check, so a failed
save cannot launch orphaned work. Stable initial command and message ids let a
failed or uncertain launch be retried. The execution runtime, provider adapters
and worktree setup remain T3's. Launch-thread now shares the standard operate
permission mapping; its existing runtime caller uses the guarded request helper.

Dropping into In Review sends an agent-review turn to linked work. Its brief asks
for findings to be fixed, checks to pass and the PR to be marked ready; the board
continues deriving review sections from actual PR snapshots. No drag pretends to
change GitHub state. Parking archives a draft PR's thread. Returning no-PR work
to planning archives its thread; open/merged PR work cannot silently return to
planning, and historical merged work cannot restart as a follow-up. Same-state
drops only reorder. The existing operation permission gates both controls and
execution on the destination environment.

The side drawer edits criteria, spec and properties. Spec references accept only
HTTP/HTTPS URLs or project-relative paths. Relative files use T3's protected
project-file query in the project's environment and render lazily as markdown.
The existing new-thread handler also opens a draft with the brief. It preserves text
already in an existing draft. Sending, provider selection and worktree selection
stay in T3’s composer for that planning action. Link the resulting thread in the
card drawer. Opening a
draft does not assert that work started.

## Further parity

This implementation has capture, a spec/checklist drawer, search, ranking,
pointer/keyboard dragging between lanes, work/review launch, keyboard/touch
reorder controls, archive/restore, explicit completion/reopen, thread linking and
six visible lanes over seven derived states. The shared web
surface serves desktop and mobile browsers. The native React Native client does
not yet have a roadmap screen. Agents can call the service once a dedicated MCP
tool is added; this version does not expose one or promise CLI command parity.

HyperCoder additionally has spec-file reconciliation, cross-machine ownership,
public requests/voting, attachments, review/test receipts, handover commands,
public sharing, and a permanent merge stamp. Those are separate additions. Here,
merge completion follows the retained T3 PR snapshot; mark complete explicitly
if completion must survive unlinking or deletion of that thread. Native mobile,
automatic draft-to-card linking, durable merge receipts and an agent API should
extend these contracts rather than copy T3’s execution machinery.

## External synchronization boundary

The optional Hypercoder adapter runs on the destination T3 environment, where the
owner explicitly selects the source context. Sync metadata retains source IDs,
confirmed baselines and operation receipts; credential bytes remain in
Hypercoder's context file. Board data and T3 execution links have separate owners.
An external status must not claim that T3 observed a native thread or PR.

Conditional writes are a source capability, not a hash computed by T3 before an
unconditional update. If that capability is unverified, outbound changes remain
read-only. Confirmed per-card receipts survive local commit conflicts and process
interruption; an uncertain create must not be blindly replayed. Ordinary roadmap
saves cannot forge source ownership or edit a locked card. Disconnect is an
explicit ownership change that preserves retained data.
