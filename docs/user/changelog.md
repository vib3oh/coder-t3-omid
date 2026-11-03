# Project changelog

Open **Changelog** from the sidebar or command palette, then choose a project.
Search shipped work, switch between Today, 7 days and 30 days, or filter by type.
The activity chart shows 31 days; select a populated day to jump to its entries.
Expand an entry to open its thread or pull request. Archived threads can be
unarchived and opened when your connection permits changing threads.

Use **Pop out changelog** in the header to open a separate window for the selected
project. Desktop opens a T3 window with an always-on-top pin and **Return changelog
to app**. Browsers open a pop-up, subject to their pop-up permissions; the return
control focuses the original app or restores the full view if it was closed.
Closing the desktop app window also closes its changelog window.

The changelog lists merged pull requests linked to this project's retained
threads, including archived threads. It does not fetch the repository's entire
history. PR title prefixes determine type: `feat` is Feature, `fix` is Bug,
`spike` is Spike, and maintenance prefixes are Chore. Other titles are Untyped.
PRs without a merge date are counted separately. Thread titles supply the
optional summary.

**Copy changelog** copies the filtered entries as Markdown. **Ask an agent**
opens a composer draft for release notes, a standup note or announcement ideas.
Review the draft and choose a provider before sending it.

**Share** publishes a snapshot of the current range, type and search. Summaries
are optional. Anyone with the link can read the published entries without a T3
session. The link uses the connected server's address, which must be reachable
by your readers; a loopback address is local to your machine. Update the
snapshot to publish new content, or revoke the link to remove access. Republishing
after revocation creates a new link. A snapshot stays unchanged when filters or
source threads change. Copy embed produces an iframe for the same snapshot.
