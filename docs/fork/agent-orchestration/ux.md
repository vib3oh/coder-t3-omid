# Starting and following an agent workflow

Proposed UX for the supervised first version. The workflow scope is confirmed;
the controls and visual treatments below remain a design proposal. See the
[spec](spec.md) for behavior and the [technical design](technical-design.md) for
implementation constraints.

## Start from the work

A roadmap card offers **Start workflow**. An existing thread offers
**Use agent workflow**, carrying the relevant conversation into the brief.
Thread-based workflows also support projects without a board or GitHub repository.
The launch sheet shows the objective, selected role presets, the resolved
provider/model for each stage and the finish line. Resource limits and advanced
options sit behind a disclosure.

The initial team is Planner → Builder → Reviewer. An accepted spec supplies the
starting contract; otherwise the planner prepares it. The default finish is a
reviewed result presented to the user. PR creation, publishing, merging and
deployment use existing authorization and repository policy.

**Start** authorizes the configured workflow. Agents start when their stages are
ready, rather than all consuming turns at launch. The user can inspect the
effective brief and configuration before starting. A missing required skill or
unsupported execution capability is reported before work begins; provider/model
substitution is never silent.

## Reuse roles and make assignments explicit

Project settings contains Planner, Designer, Builder, Debugger and Reviewer role
presets. A user can clone a preset, such as a Frontend Builder, and edit its
purpose, instructions, skill references, deliverable requirements and preferred
provider/model. Saving a role does not start an agent or consume a model turn.

The role's Skills section distinguishes required and optional workflows and shows
whether each is loaded, available on demand, missing or unsupported. A missing
required dependency gives a specific remedy before launch. Bundles follow the
[skill migration plan](skills.md); agents receive the skills appropriate to the
assignment rather than the entire catalog. Games are excluded.

The catalog distinguishes Built in from an explicitly configured external
backend, and core procedures from conditional extensions. Show missing tools and
available modes beside each entry. Operator actions such as deploy, merge or
fleet sync remain outside a worker's default bundle. The [combined audit](skill-audit.md)
defines these dispositions; an entry appearing in the catalog is not a claim
that it is ready or authorized to run.

An assignment gives a role actual work: an objective, relevant context, criteria,
expected deliverable, workspace and manager. Its details preserve the exact role
configuration used. Editing a preset affects future assignments; changes to work
already underway appear as an explicit revised assignment.

## Follow the handoffs

1. The planner prepares or checks the spec and assigns implementation. Decisions
   reserved for the user remain explicit questions.
2. The builder starts when the contract is ready and returns a revision,
   verification evidence and any remaining risks.
3. A reviewer starts with fresh context and the exact revision to inspect.
4. Valid findings return to the builder. A fresh reviewer assignment checks the
   resulting revision. Correction rounds are bounded.
5. The planner presents the result, evidence and unresolved limitations.

The user does not need to start each stage manually. Designer and Debugger stages
are available when the task needs them. The first version serializes writers in
the workflow checkout; a role name alone does not make concurrent editing safe.

## Monitor from the thread

The thread header shows the stage and latest meaningful update, for example:
**Building · Native checks are waiting for device access**. Workflow details show
participants, assignments, dependencies, questions and artifacts, with links to
the underlying conversations. Roadmap cards can expose the same supplementary
status without inventing a second execution lifecycle or replacing board lanes.

Statuses distinguish preparing, working, waiting on another agent, needing the
user, failing and finishing. A stopped provider turn is not proof that an
assignment completed. Delivery state is separate from work state.

Routine communication appears as a readable one-line summary. Expanding it shows
the exchange, related updates and artifacts. Raw commands, ids, process details
and payloads have their own diagnostics disclosure. Related routine updates group
together; questions, relevant failures and final outcomes remain addressable.
The [communication concept](communication.html) shows progress, human-input and
delivery-failure examples.

## Ask for attention when it helps

A human decision appears with enough context to answer directly. The question
names the decision and its consequence, rather than requiring the user to read
worker transcripts. Answering resumes the affected assignment. Waiting for a peer
or an idle device does not automatically create a human-action notification.

A failure states what stopped, what remains incomplete and which recovery action
is available. Exhausted correction limits return the unresolved findings to the
manager or user. Repeated progress messages do not repeatedly interrupt them.

## Keep control without losing context

The user can revise an assignment, pause new starts, resume, cancel an assignment
or stop the workflow. Pause shows work that is still running; stopping a running
task is a separate explicit action. Cancellation preserves conversations,
worktrees and evidence while preventing stale results from advancing the workflow.

Web and desktop share launch and editing controls. Native mobile provides status,
artifacts, answering, pause/resume and cancellation; its initial version can defer
full role editing. Execution belongs to the environment server, so closing a
client does not stop the work. Reconnecting restores the current state.

First-version agents belong to a particular workflow. Permanent staff,
cross-project managers and unrestricted autonomous teams remain outside scope.
