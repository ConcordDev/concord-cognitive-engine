# Frontend test foundation

Frontend has ~2,779 source files under `components/ lib/ hooks/`; before this work
only ~431 were touched by any test (~10% whole-tree statement coverage). The fix
is **not** "backfill 2,779 tests." It's a cheap blanket net + a forcing function +
real tests on the risky few. Five parts:

## 1. Import-smoke net — `tests/smoke/` ✅
`npm run test:smoke` imports **every** coverage-included module (2,365 of them;
the 414 jsdom-incompatible 3D/world-lens/concordia/worker files are explicitly
skipped) and fails on **new** import breakage — bad imports, circular deps,
renamed exports consumed at module scope, top-level crashes. Allowlist
(`import-smoke-allowlist.json`) is empty; regenerate with
`SMOKE_GENERATE=1 npx vitest run tests/smoke/import-smoke.test.tsx`. Kept **out**
of the coverage run (importing-without-rendering tanks function/branch %).

## 2. Diff-coverage gate — `scripts/check-diff-coverage.mjs` ✅
On every PR, each changed `components/lib/hooks` file must clear
`DIFF_COVERAGE_MIN` (60%) statement coverage. This **freezes the untested
backlog** — it can't grow; coverage climbs one PR at a time. Wired into the
`Lint & Test` job after `frontend_coverage`.

## 3. Ratchet ✅ (policy)
Whole-tree floors in `vitest.config.ts` (statements/lines 10, branches 80,
functions 33) only go **up**, never down. Raise them as the diff gate drives
real coverage up. The diff gate (#2) is the per-PR driver; the floor is the
anti-regression backstop.

## 4. Real tests on load-bearing files — seeded, ongoing
Rank by **churn × usage**, not by directory. Seeded so far:
`CookieConsent`, `NetWorthTracker`. Regenerate the ranked target list:
```bash
git log --since='12 months ago' --format= --name-only \
 | grep -E '^concord-frontend/(components|lib|hooks)/.*\.(ts|tsx)$' \
 | grep -vE '\.test\.|world-lens/|concordia/|\.worker\.|/world/(concordia-hud|concord-link|mahjong)/' \
 | sed 's#^concord-frontend/##' | sort | uniq -c | sort -rn | head -40
```
**Top untested, high-churn backlog** (write a real behavior test, ~3–6 cases each):
- `components/chat/ToolPalette.tsx`
- `components/code/TerminalPanel.tsx`
- `components/lens/RivalShapePreview.tsx`
- `hooks/useWorldVoice.ts`
- `components/research/ResearchWorkbench.tsx`
- `components/healthcare/AppointmentScheduler.tsx`
- `components/government/FOIATracker.tsx`
- `components/crypto/ApprovalsManager.tsx`
- `components/dtu/DTUEmpireCard.tsx`
- `components/guidance/FirstWinWizard.tsx`
- `components/feedback/FeedbackWidget.tsx`
- `components/concord-link/ConcordLinkPanel.tsx`

(`lib/realtime/socket.ts`, `lib/lens-registry.ts`, `lib/lenses/manifest.ts` —
the top-churn lib infra — already have tests.) The diff gate (#2) makes any of
these get a test the next time it's touched anyway.

## 5. Critical-path e2e journeys — substantially existing + seeded
A rich journey suite already exists (`tests/e2e/`: `playthrough`, `lens-crud`,
`dtu-integrity`, `social-flow`, `navigation`, `all-lenses-walk`, …) using the
shared `mockAuthSuccess` / `gotoStable` helpers. The real gap was that
**E2E Core never ran** (it `needs: lint-and-test`, which was red) — fixed on the
PR-807 branch by disabling the heartbeat on the CI backends (external feed-poll
hangs were ECONNRESET-ing it into a timeout). Added `wallet-journey.spec.ts`
(the authenticated money path). Each journey transitively exercises hundreds of
components per test.

**Journey backlog:** creator economy (DTU create → cite → royalty → wallet),
chat streaming + DTU-context, marketplace purchase + royalty cascade.

---
**Run it all:** `npm run test:smoke` · `npm run test:coverage` ·
`node scripts/check-diff-coverage.mjs origin/main` · `npm run test:e2e:core`.
