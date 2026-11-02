# Roadmap architecture

The board owns planning. T3 owns execution. Keep those responsibilities separate
so upstream can change its agent runtime without requiring a second runtime here.
The fork introduces no new provider, worktree manager, authentication system, or
GitHub client.

Cards have a title, a brief, type, effort, a planning lane, optional linked thread,
an explicit completion flag, and an archive flag. Array order is rank. Only
Backlog and Up Next are planning lanes. Building, Agent reviewing, Your turn,
Parked and Done are derived from the linked thread and its existing PR snapshots.
Open PRs outrank historical merges; dismissed stack links do not count.

An unarchived linked thread counts as Building even when its agent is idle. A
draft PR is Agent reviewing while that thread is unarchived, or Parked while it
is archived. A ready PR is Your turn. With no open PR, an observed merge is Done.
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
concurrent changes to fields the local draft did not edit.

Board reads query T3’s projection store for the explicitly linked thread ids,
scoped to the project, in both active and archived storage. They include older
settled threads that T3 omits from its active client window. A narrow thread
summary crosses the wire; conversation history stays unloaded.

The existing new-thread handler opens a draft with the brief. It preserves text
already in an existing draft. Sending, provider selection and worktree selection
stay in T3’s composer. Link the resulting thread in the card editor. Opening a
draft does not assert that work started.

## Further parity

This first implementation has capture, editing, search, ranking, drag between
planning lanes, keyboard/touch reorder controls, archive/restore, explicit
completion/reopen, thread linking and the seven-state board. The shared web
surface serves desktop and mobile browsers. The native React Native client does
not yet have a roadmap screen. Agents can call the service once a dedicated MCP
tool is added; this version does not expose one or promise CLI command parity.

HyperCoder additionally has spec-file reconciliation, cross-machine ownership,
public requests/voting, attachments, review/test receipts, start/handover commands,
public sharing, and a permanent merge stamp. Those are separate additions. Here,
merge completion follows the retained T3 PR snapshot; mark complete explicitly
if completion must survive unlinking or deletion of that thread. Native mobile,
automatic draft-to-card linking, durable merge receipts and an agent API should
extend these contracts rather than copy T3’s execution machinery.
