# HyperCoder roadmap investigation

Inspected on 2026-11-02 with [morluto/rea](https://github.com/morluto/rea), REA
`6.8.0`, using Node `26.12.1`. Target: the installed
`/Applications/HyperCoder.app`, version `0.2.0-nightly.20261102.290.1`.
Analysis was static: the packaged JavaScript was read as inert text. No account
credentials, application databases, cloud records or private network APIs were
accessed, and the installed app was not modified.

## Evidence and limits

The target ASAR SHA-256 is
`845f0daab03e7183873212ba7fe8c50b2c10c0c15d5ccf372707ee0f85a3b1a7`.
REA found an integrity mismatch in its unpacked `node-pty` native binary. The
retry used `--integrity-policy record-and-continue`, as REA recommended. This
retains the contradiction; it does not establish integrity of the native binary.

The ASAR contains 7,960 selected application files. Broad analysis and a focused
attempt on `dist/renderer/assets/index-XMZ_k1bp.js` returned partial evidence at
their per-source deadlines. The renderer’s roadmap strings and call sites were
then inspected directly from the archive. Do not represent those partial REA
results as a complete reconstruction of HyperCoder.

REA completed a separate focused analysis of the packaged
`Contents/Resources/hc-roadmap.mjs` copied to an isolated temporary directory.
Its SHA-256 is
`800e7ec324be1c1e3363f92a30f30e197eff77e2de9aafaf901042c9fee68149`.
It parsed one JavaScript file, recovered 77 module candidates and reported 243
findings with zero parse failures. The semantic graph was capped at 1,000 nodes
and 1,000 unknowns; dynamic relationships remain unknown. The complete local
Evidence bundle was about 4 MB. The bounded, original REA summary is retained
at [evidence/hypercoder-rea-summary.json](evidence/hypercoder-rea-summary.json).
Its parent Evidence id is
`ev_53083b214de307c0608968e87d0e526cad12a19b955dba22b5afc5405d648b7a`.

A feature trace seeded with the literal `roadmap:listBoard` returned no matches
in that bounded graph. That is a coverage limitation, not evidence that the
feature is absent. The conclusions below also use direct static inspection of
the packaged CLI and renderer, corroborated by HyperCoder’s installed roadmap
skill. Backend implementations and live behavior were not available for review.
No HyperCoder source or extracted bundle is committed in this fork.

## Reproduce the focused REA analysis

Run acquisition outside the repository and use a Node version supported by the
pinned REA release. These commands only copy the designated packaged CLI and
analyze the copy:

```sh
mkdir -p /tmp/hypercoder-roadmap-analysis
cp /Applications/HyperCoder.app/Contents/Resources/hc-roadmap.mjs /tmp/hypercoder-roadmap-analysis/
cd /tmp
npx -y -p node@26.12.1 -p rea-agents@6.8.0 rea analyze-javascript-application /tmp/hypercoder-roadmap-analysis --source-path hc-roadmap.mjs --detail summary --evidence_output /tmp/hypercoder-roadmap-evidence.json --max-semantic-nodes 1000 --max-semantic-unknowns 1000 --analysis-timeout-ms 180000 --json
```

REA does not overwrite an existing Evidence bundle. Choose a new output path on
subsequent runs. The directory digest in a new run can differ because the original
inventory also included a package manifest; the selected CLI’s digest above is
the reproducible identity. Recheck the installed app version and hashes before
applying these findings to a newer version.

## Recovered feature contract

The renderer declares Backlog, Up Next, Building, Agent reviewing, Your turn,
Parked and Done. The CLI exposes separate planned lanes and a derived column.
`toListRow` around lines 12480–12508 of the inspected CLI carries the planning
lane and rank, spec path, branch, owner pane/agent, review/test evidence, PR
number, active workspace and shipped/merged timestamps. It explicitly describes
Ready as waiting on a person and Reviewing as an active agent’s draft PR.

`buildRoadmapApi` around lines 13693–13729 identifies the cloud API boundary:
list/listBoard/listBoards/listArchived, create, captureForWorkspace, setLane,
reorder, archive/restore, setFields, linkBranch, markShipped, report and setOwner.
It separately references public-request acceptance/decline and repository PR
refresh. Convex calls are visible in the bundle; their presence does not reveal
the server-side schema or prove their behavior under races or outages.

The installed roadmap skill adds the operational contract: the board is keyed
to a GitHub repository and owns workflow state, spec files own the body, only
Backlog and Up Next are directly ranked, and execution/review states follow real
workspace and PR evidence. Completion is permanently stamped when a merge is
observed. The renderer’s grouping labels and CLI fields corroborate this model,
but permanence is a documented contract rather than a verified backend fact.

## Application to this fork

Reuse the product model: project board, ordered planning, rich cards, reversible
archive and states tied to actual work. Replace HyperCoder’s cloud and pane
ownership with T3’s server-owned projects, thread shells and PR snapshots.
Support local projects without requiring GitHub. Keep this independent
implementation under the fork’s own modules and API namespace. See
[roadmap.md](roadmap.md) for shipped behavior and the explicit parity gaps.
