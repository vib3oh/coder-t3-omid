# Agent orchestration for the T3 fork

Implementation candidate based on the fork owner’s accepted design and static
inspection of Hypercoder and T3. The confirmed direction is a supervised planner → builder → reviewer
workflow with targeted peer messages and readable, expandable communication.
The runtime now adds supervised assignments, bundled procedures and readable
communications over native T3 services. Release verification is recorded on the
[owning PR](https://github.com/vib3oh/coder-t3-omid/pull/2); unverified gates remain explicit.

Start with the [UX](ux.md) for how a person launches and follows work, then the
[spec](spec.md) for acceptance criteria and scope. The
[technical design](technical-design.md) describes how this can use T3's existing
delegation and thread services. The [investigation](understanding.md) separates
recovered Hypercoder behavior from recommendations and unknowns.

The [combined skill audit](skill-audit.md) covers the installed Vibe set and the
14 non-game Hypercoder workflows. It identifies contract conflicts, core versus
conditional procedures and requirements for a built-in T3 library. The detailed
[migration matrix](skills.md) maps Hypercoder behavior into that library. Each
role gets a small, versioned bundle; games remain outside scope.

The [upstream compatibility contract](upstream-compatibility.md) identifies T3's
existing skill discovery, invocation and composer paths. It constrains the fork
to reuse them and keep integration hooks small. The implementation uses native Codex extra skill roots and Claude local plugins,
with unsupported packaging reported as unavailable. This does not establish
HyperCoder feature parity. See the [user guide](../../user/agent-workflows.md).

Two self-contained HTML concepts illustrate the proposal:

- [Role responsibilities and workflow](workflow.html)
- [Readable agent communications](communication.html)

Download either HTML file and open it locally to try it. The concepts use local
sample data and do not start or contact agents. They are design references, not
application components or evidence that the proposed feature already works.

## Source baseline and evidence

The original investigation inspected T3 fork revision
[`36f7afa9c7`](https://github.com/vib3oh/coder-t3-omid/tree/36f7afa9c7a6a87e331c09c001f426e35e894d5a),
including its roadmap extension. This design is now rebased onto `origin/main`
[`08f7150f56`](https://github.com/vib3oh/coder-t3-omid/commit/08f7150f560df3f43ad0745c8f2e88f932a8424d),
which includes the merged roadmap feature. The [base-change audit](upstream-compatibility.md#current-fork-base-and-rebase-audit)
records the resulting launch, review, persistence and permission constraints.
The existing roadmap actions and lane derivation are retained.

HyperCoder `0.2.0-nightly.20261102.290.1` was inspected using REA `6.8.0` and direct
static reading of packaged JavaScript. The focused REA pass parsed two CLI/control
modules, with partial graph coverage. A separate main-bundle analysis timed out.
No live orchestration or private backend guarantees were verified.

The [evidence register](understanding.md#evidence-register-and-reproduction) links
to bounded summaries, target hashes and analysis status. Published JSON records
normalize local paths and retain a hash of their original source file. Extracted
application code, full evidence bundles and the supplied personal screenshot are
not included.

These documents retain the original research and capability contract. The
standalone concepts remain directional references; the application implementation
is the source of truth for supported behavior. Kits and games are excluded from
the initial runtime, and operational procedures retain explicit prerequisites.

Workflow attempt and concurrency limits govern tracked T3 assignments and message
continuations. Active participants must use the workflow services for app-owned
MCP delegation, thread creation and thread sends; those direct native MCP calls
are refused. Provider-native
subagents and direct shell invocations remain controlled by the provider. The
fork does not impose workflow quotas or a filesystem sandbox on those paths;
role instructions alone cannot enforce either restriction.
