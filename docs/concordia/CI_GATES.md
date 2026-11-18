# Concordia Unity CI gates (P0-19)

The gate list of record for the Unity client. Source:
CONCORDIA_PLAN.md §2.4. The gates are enforced by the Unity CI
workflow (P0-18, `.github/workflows/unity-ci.yml`); this document
is what "the gate list matches §2.4" is checked against, and it
names the one step that is not code: turning the workflow's job
into a required status check is a repository setting (below).

## Gating — a failure blocks the merge

| Gate (§2.4) | Enforced by |
|---|---|
| EditMode green | The workflow's EditMode step: the editor's exit code is 0 only when every EditMode test passes |
| PlayMode focused proofs green | The workflow's PlayMode step, same exit-code contract |
| WebGL build succeeds | The WebGL build step, plus its assertion that `index.html` exists in the staged build |
| Asset budget gate passes (PF-07) | `scripts/assets/budget.mjs` in the workflow's size-report step, once PF-07 lands (until then the step is visibly skipped by name — PF-07's own done-test is what makes this gate real) |
| No new `[AuraVerify] … FAIL` in the PlayMode log | `scripts/gate-aura-verify.mjs`, run as a gating step on the PlayMode log; a FAIL line is "new" unless its exact text is recorded in `apps/concordia-living-world/unity-client/aura-verify-baseline.txt` under the baseline discipline below |

## Advisory — reported, never blocking

| Signal (§2.4) | Surfaced by |
|---|---|
| Desktop build | The desktop build step runs `continue-on-error` and writes its outcome to the job summary (amended into the workflow by P0-19, so the step's §2.4 advisory status is real: a desktop failure is visible in every run and blocks nothing) |
| Coverage delta | The AnimationCoverage report step (AN-05) writing into the job summary |

Promoting either advisory signal to gating is an amendment to
this document and the workflow in the same change — never a
silent edit to the workflow alone.

## Required check (the repository-setting half)

Branch protection on `main` must require the check:

    Unity CI / Pull assets, test, build, publish

(the workflow name / the job's display name). With that set, a
red EditMode run blocks a PR — the P0-19 done-test. Setting it is
an admin action for the repository owner; it is recorded here so
the gate system is not considered live until it is done.

## Baseline discipline (AuraVerify)

- The baseline ships empty. Every `[AuraVerify] … FAIL` line is
  new until recorded.
- Recording a line requires, in the same change: the exact line
  in `aura-verify-baseline.txt` and a reason + tracking ticket in
  an entry below.
- A recorded line is removed as soon as its failure is fixed.
- A FAIL line whose text varies between runs is a defect in the
  emitting check, not a baseline candidate: make the line stable
  at its source first.

### Recorded known failures

None.

## State

Authored with the P0-18 workflow (2026-11-18). The gates become
live when (a) the workflow lands, (b) the required check above is
set, and (c) the concordia-build runner is up (P0-30, parked).
The PF-07 row additionally waits on PF-07; the AuraVerify row is
armed now and passes trivially until the Aura L3 slice (P0-11)
emits its first FAIL line.
