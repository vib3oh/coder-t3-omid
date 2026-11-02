# Project roadmaps

Open **Roadmap** from the sidebar and select a project. Local folders work too;
you do not need a GitHub repository. Add an idea with a title, brief, type and
effort. Prioritize it into Up Next, drag by its handle to change lanes or order,
or use the arrow buttons. The handle also supports keyboard dragging with Space,
arrow keys and Space to drop; Escape cancels. Search narrows the visible cards.

Click a card to open its side drawer. Edit its properties, add and check
acceptance criteria, link an existing project thread, and attach a full spec as a
project-relative file path or an HTTP/HTTPS URL. Project files open inside the
drawer through the project's environment; web links open in a new tab. Save card
persists checklist and property edits.

Drag a card into **Building** or choose **Start building** in its drawer to launch
work using the project's provider, model, runtime and workspace defaults. The
brief, spec reference and acceptance criteria go to the agent. An existing linked
thread is resumed, including archived threads. Failed initial launches keep their
thread link so retrying can recover the same launch.

Drag linked work into **In Review**, or choose **Start agent review**, to ask the
agent to review, fix findings, run checks and mark its PR ready for human review.
The lane stacks **Your review** (ready PRs) above **Agent review** (draft PRs),
hiding either section when empty. The card follows real thread and PR state;
starting review does not itself manufacture a PR or mark it ready. Ready means
the PR is ready for review; it does not certify passing checks or approval.

Drop a draft PR into **Parked** to archive its thread. Returning work with no PR
to a planning lane archives its thread; open or merged PR work must be resolved
or unlinked first. Drag work without an open PR to **Done** to mark it complete.
Merged work needs a new card for follow-ups. Clear manual completion in the
drawer to reopen other completed work.

**Plan in thread**
opens T3’s composer with the brief; an existing draft’s text is preserved. Send
the message when ready, then link that thread from the card.

Archive removes a card from the board without deleting it. Open Archived to
restore it. Cards are saved on the project’s T3 server and refresh across clients
about every five seconds. A stale save is rejected. Reload inside the card editor to keep your draft and
review the latest saved card before saving again. Fields you did not edit retain
their latest values. Keep the browser connected
to edit. Boards on separate servers are independent.
