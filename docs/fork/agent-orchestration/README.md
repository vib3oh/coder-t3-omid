# Agent orchestration for the T3 fork

Design proposal based on static inspection of Hypercoder and T3, requested by the
fork owner. The confirmed direction is a supervised planner → builder → reviewer
workflow with targeted peer messages and readable, expandable communication.
Detailed defaults, storage choices and visual treatments remain drafts.

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

Two self-contained HTML concepts illustrate the proposal:

- [Role responsibilities and workflow](workflow.html)
- [Readable agent communications](communication.html)

Download either HTML file and open it locally to try it. The concepts use local
sample data and do not start or contact agents. They are design references, not
application components or evidence that the proposed feature already works.

## Source baseline and evidence

The investigation inspected T3 fork revision
[`36f7afa9c7`](https://github.com/vib3oh/coder-t3-omid/tree/36f7afa9c7a6a87e331c09c001f426e35e894d5a),
including its roadmap extension. The current main branch does not include that extension.
References to its modules and fork documentation describe the inspected baseline;
this PR does not reintroduce that implementation or depend on merging it.

HyperCoder `0.2.0-nightly.20261102.290.1` was inspected using REA `6.8.0` and direct
static reading of packaged JavaScript. The focused REA pass parsed two CLI/control
modules, with partial graph coverage. A separate main-bundle analysis timed out.
No live orchestration or private backend guarantees were verified.

The [evidence register](understanding.md#evidence-register-and-reproduction) links
to bounded summaries, target hashes and analysis status. Published JSON records
normalize local paths and retain a hash of their original source file. Extracted
application code, full evidence bundles and the supplied personal screenshot are
not included.

This package records a proposed capability contract and its research basis. It
does not change runtime prompts, tools, provider behavior or the shipped UI.
