# Unity CI (P0-18)

The Unity client's CI lives in `.github/workflows/unity-ci.yml`
(plan: CONCORDIA_PLAN.md §2.4). This file is the operator's half of
that contract: what the runner must provide, and what the workflow
expects from the tickets around it.

## Runner contract

- **One self-hosted runner, label `concordia-build`.** Every job in
  the workflow targets `[self-hosted, concordia-build]` and nothing
  else — GitHub-hosted runners cannot hold this project (~14 GB of
  Assets; the gitignored packs live on the R2 asset rail), and the
  workflow carries no schedule trigger, so it can never fire on a
  timer or land on a machine that merely shares an OS label.
- **Unity 6000.5.9f1**, licenced (the existing Unity licence, Q4).
  The workflow resolves the editor the same way
  `scripts/export-unity-web.mjs` does: `$UNITY_EDITOR` if set on the
  runner, otherwise the Unity Hub install for the pinned version.
  The pin and `ProjectSettings/ProjectVersion.txt` must agree — the
  workflow refuses to run on drift, and
  `server/tests/unity-ci-workflow.test.js` pins the agreement.
- **A GPU** for the PlayMode proofs (they run `-batchmode` without
  `-nographics`).
- **Node 22** for the asset-rail scripts.
- **The AWS CLI**, for the build upload: private R2 over its S3
  API. Configure on the runner / repository:
  - variables `R2_S3_ENDPOINT`, `R2_BUILDS_BUCKET`
  - secrets `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`

  Builds land at `builds/webgl/<sha>/` and
  `builds/desktop-linux/<sha>/` in the bucket. An unconfigured
  runner fails the upload step by name rather than skipping it.

## Pipeline

In order: checkout (with Git LFS) → pull assets
(`scripts/assets/pull-assets.mjs`, the P0-04 rail) → EditMode tests
→ PlayMode tests → WebGL build
(`Concordia.Editor.ConcordiaWebExport.Export`, staged via
`CONCORD_UNITY_STAGING`) → desktop build
(`Concordia.Editor.ConcordiaServerExport.BuildLinuxServer`, the
project's standalone batch build, via `CONCORD_SERVER_BUILD`) →
R2 upload → size report (PF-07's `scripts/assets/budget.mjs`, when
it lands) → AnimationCoverage report (AN-05's EditMode tests,
surfaced into the job summary when they land). Test results and
logs are uploaded as workflow artifacts on every run.

Steps owned by tickets that have not landed yet say so in the log
instead of passing silently; the asset pull is the exception — it
fails the run, because tests and builds without the rail's assets
would be testing a different project.

## State

The workflow is authored and pin-tested. Its first live run is
parked with the build-machine bring-up (P0-30): runner
registration, the Unity install, and the R2 configuration above
are that ticket's done-test. Merge gating on this workflow's
results (EditMode green, PlayMode proofs green, WebGL build,
asset budget) is P0-19.
