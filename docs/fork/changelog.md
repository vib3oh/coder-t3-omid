# Changelog boundary

This extension starts from the fork's `main`, where the separate roadmap board
has been reverted. Its source is T3's retained PR snapshots, rather than a
second board or a GitHub fetch. This makes it usable independently and offline;
unlinked repository merges and deleted threads are outside its history. A future
roadmap integration should supply explicit card types and completion receipts
through the same changelog contract rather than infer completion from agent text.

The service reads only PR metadata from project-scoped projection rows, including
archived and settled threads. Deduplication uses host, repository and PR number.
No conversation bodies cross the wire. Clients pass calendar bounds computed in
their own timezone. Public snapshots preserve the publishing client's timezone.

Public snapshots live under this server's `userdata/extensions/changelog`, outside
project source trees. They contain the selected titles, PR links, dates and types,
and summaries only when requested. Sharing requires access-management permission;
normal reads require orchestration-read permission. A random link grants access
to one static snapshot, never to a project or thread. Revocation deletes its page;
republishing rotates the link. Readers need direct HTTP reachability to the server;
an authenticated relay route alone does not make the page publicly reachable.
Back up this directory with userdata. One server must own that directory.

The React view serves web, desktop and mobile browsers. Desktop opens a dedicated
auxiliary window on the same app origin and Electron session, using the app preload.
It reuses one window, supports always-on-top, and closes with its owning app window.
Window controls validate the IPC sender; auxiliary windows cannot create pop-outs
or control the main window through those methods. Browser clients use a pop-up.
Native React Native navigation is not supplied. There is no new provider adapter or dedicated MCP/CLI command; Ask an agent uses
the existing composer with the selected facts.
