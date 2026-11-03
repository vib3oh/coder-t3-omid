# Keeping the fork current

`origin` is `vib3oh/coder-t3-omid`; `upstream` is `pingdotgg/t3code`. The fork
preserves all upstream history and MIT notices. `fork.json` pins the initial
baseline and lists owned modules separately from integration points. Keep fork
changes as focused commits; avoid mass renames, formatting or vendoring T3 as a
copy. There is no stable public plugin API for this board in the inspected T3
revision, so the extension uses the existing contracts, service layers, router
and sidebar through a small, explicit patch surface.

## Develop locally

Install Vite+ using the upstream README, then:

```sh
vp i
vp run dev --home-dir "$PWD/.t3" --no-seed
```

The explicit home directory matters in this primary checkout: do not use the
running installation’s `~/.t3` state. The dev runner prints its ports and pairing
URL. Never commit that URL or credentials. Open Roadmap from the sidebar.

## Integrate an upstream update

Start with a clean working tree, then create an integration branch from the
current fork branch:

```sh
git fetch upstream main --tags
git switch -c sync/upstream-YYYYMMDD
git merge --no-ff upstream/main
```

Resolve conflicts by preserving upstream runtime behavior and reapplying only
the listed extension hooks. Do not reset the fork to upstream or replace the
entire upstream tree with a snapshot. Review changed integration files from
`fork.json`, including authorization and the single application-owned service
instance. Regenerate `routeTree.gen.ts` through Vite; do not hand-edit it.
Verify `test -L CLAUDE.md` and `readlink CLAUDE.md` returns `AGENTS.md`.

```sh
vp i
vp test run apps/server/src/roadmap/RoadmapService.test.ts apps/web/src/roadmap/roadmap.logic.test.ts packages/client-runtime/src/state/commandPermissions.test.ts
vp run check:changed
```

Build the web app from `apps/web` with `vp build`. Exercise add/edit, rank/move,
archive/restore, reload persistence, project switching and a stale save from a
second client against isolated state. Review linked-thread lifecycle behavior
when upstream changes its shell or PR representation. Merge the integration
branch into the maintained fork branch only after these checks. Keep the original
baseline field as provenance; `git merge-base HEAD upstream/main` records the
latest common baseline without maintaining a second version counter.

## CI and releases

This GitHub fork is public, so the private-repository self-hosted runner policy
does not enroll it. Upstream workflow files and test names are preserved.
Inherited Actions settings are unchanged by this setup. Upstream workflows
reference upstream runner and release services and need a separate fork CI/release
configuration. No private runner was enrolled.

This checkout has not been packaged or installed. Before distributing a desktop
build, give it a distinct product name, bundle id, URL scheme and userdata
directory; configure a fork-owned update repository and disable upstream
auto-updates for that build. The current packaging defaults still identify the
official T3 app. Do not run a distributable build with those defaults and install
it over the official app. Continue taking upstream changes through Git and test
the extension before publishing fork binaries.
