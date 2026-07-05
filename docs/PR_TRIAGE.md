# Open PR Triage (Browser-Ready Campaign, 2026-07-04)

18 pre-existing open PRs were audited alongside this campaign's own draft PR (#845). None were merged or closed autonomously — **all actions below are recommendations for a human to execute**, per the campaign's stop-point rule on GitHub write actions (merge/close). Data source: `list_pull_requests` on `ConcordDev/concord-cognitive-engine`, 2026-07-04.

## Dependabot (9) — recommend: let Dependabot handle normally

| PR | Bump | Last updated | Recommendation |
|---|---|---|---|
| #201 | `actions/upload-artifact` 6→7 | 2026-04-28 | Merge after main is green (this campaign). Low risk (CI-only action). |
| #209 | `docker/build-push-action` 6→7 | 2026-04-28 | Same. |
| #210 | `docker/setup-buildx-action` 3→4 | 2026-04-28 | Same. |
| #211 | `docker/login-action` 3→4 | 2026-04-28 | Same. |
| #246 | `github/codeql-action` 3→4 | 2026-04-28 | Same. |
| #262 | server dev-deps group (5 updates) | 2026-05-22 | Rebase-and-review; dev-deps only, low risk. |
| #355 | frontend dev-deps group (20 updates) | 2026-05-25 | Rebase-and-review; wider surface (20 packages) — run full frontend test+build before merge. |
| #356 | frontend production-deps group (33 updates) | 2026-05-25 | **Higher risk** — 33 production dependency bumps. Review changelogs for breaking changes before merging; run full E2E + build after rebase. |
| #762 | server production-deps group (18 updates) | 2026-05-25 | **Higher risk** — review for breaking changes; run full server test suite after rebase. |

All 9 are stale relative to current `main` (last real activity Apr–May 2026 vs. main at July 2026) — each needs a rebase before merge regardless of content.

## Stale `claude/*` CI-remediation branches (7) — recommend: close as superseded

These predate this campaign and targeted CI/lint/test issues that this campaign's Wave A/B either already fixed differently (on top of a much newer `main`) or superseded. All are 2+ months stale against the current `main` (518ad60b, July 2026) and would need substantial rebasing to even apply.

| PR | Title | Last updated | Recommendation |
|---|---|---|---|
| #133 | CI/CD improvements, test coverage expansion, server decomposition | 2026-02-17 | Close — 5 months stale; server decomposition work this old has almost certainly diverged irreconcilably from current `server.js` (77,424 lines now vs. whatever baseline this PR was cut from). |
| #220 | fix: resolve CI failures across lint, typecheck, tests, and OOM issues | 2026-03-14 | Close — superseded; this campaign's Wave A fixed the actual current CI failures (which are different from what this PR addressed 4 months ago). |
| #236 | fix: pin ESLint to ~9.39, remove deprecated --ext flag | 2026-03-15 | **Worth a quick check before closing** — if `main`'s current ESLint version still has the `--ext` deprecation warning, cherry-pick just that one change; otherwise close as already resolved. |
| #254 | fix: wire unused variables, fix React warnings, clean up imports | 2026-04-01 | Close — cosmetic lint cleanup, 3 months stale, `lint-sweep.yml`'s weekly automated sweep (per CLAUDE.md) has likely already covered this ground repeatedly since. |
| #299 | ci: build+start frontend for E2E (replace next dev webServer) | 2026-05-07 | **Worth checking** — `playwright.config.ts`'s current webServer block (`npm run start:ci` in CI) suggests this was already adopted in some form. Diff against current config; close if superseded, otherwise the idea may still be relevant. |
| #354 | feat(detector): null-check detector (404-class) + autofix + 5 real bugs | 2026-05-14 | **Worth reviewing before closing** — this adds a NEW detector (not one of the existing suite this campaign touched) and claims 5 real bugs found. If the detector doesn't already exist in the current suite (`server/lib/detectors/`), this may still be valuable — check for a `null-check-detector.js` or similar before deciding. |
| #763 | fix(ci): server 0/0 lint + 3 frontend rules-of-hooks (incl. real 403 bug) | 2026-05-18 | **Worth reviewing before closing** — claims "a real 403 bug" fix; verify whether that specific bug is already fixed on current `main` (server lint is already 0/0 per CLAUDE.md's Phase A) before closing to avoid losing a genuine fix. |

## Sci-fi/roadmap PRs (2) — recommend: individual review, out of this campaign's scope

| PR | Title | Last updated | Recommendation |
|---|---|---|---|
| #104 | Add 10/10 Concord Reality hardening roadmap and link from README | 2026-02-14 | Docs-only roadmap PR — review on its own merits; unrelated to this campaign's browser-readiness scope. Low risk to merge if the content is still accurate (re-check against `docs/NEXT_ARC_PLAN.md`, which has since superseded most standalone roadmap docs). |
| #107 | Wave 1: SQLite migrations, paginated Global APIs, Global/Lens... | 2026-02-14 | **Needs careful review** — adds migrations. 5 months stale; current migration count is 355 (highest 356). Any migration numbers in this PR have almost certainly collided with migrations added since. Do not merge without renumbering and testing against current schema — see CLAUDE.md's migration-collision history (209/213/226) for the exact failure mode to avoid. |

## This campaign's own PR

| PR | Status |
|---|---|
| #845 | Draft — the browser-ready campaign itself. Ready for review once Phase 4-6 final verification completes (see `docs/BROWSER_READY_CAMPAIGN.md`). |

## Summary recommendation

1. **Merge the 9 Dependabot PRs** after this campaign's `main` gates are green — rebase each, run its test suite, merge the low-risk ones (#201/209/210/211/246/262) freely, review changelogs carefully for the three larger dependency-group bumps (#355/356/762).
2. **Individually review #236, #299, #354, #763** before closing — each claims a specific fix that may or may not already be covered; a 10-minute diff-check avoids losing real work.
3. **Close #133, #220, #254** as superseded — safe to close without further review given their age and scope overlap with work already redone on current `main`.
4. **Review #104 and #107 separately** — unrelated to browser-readiness; #107 specifically needs migration-collision care before any merge attempt.

No PR was merged, closed, or commented on as part of this campaign — this table is a recommendation only.
