# Test Infrastructure Backlog

Sprint 33 — documented multi-week followup work for the test infrastructure
that's been silently red or de-scoped.

**Last updated:** 2026-05-11
**Reviewer:** Maintainer (solo)

This file enumerates the test-infra gaps that aren't fixed in the
"all-green CI" PR cycle (PR #330, PR #332). Each has documented
rationale + estimated effort + a clear "done when" success criterion.

## 1. E2E suite — 800+ specs silently red for ~2 months

**Status:** `continue-on-error: true` in `.github/workflows/ci.yml`
**Estimated effort:** 1-2 weeks of dedicated work
**Owner:** Maintainer (solo)

### What's broken

The Playwright E2E suites under `concord-frontend/tests/e2e/` cover
auth, lens-CRUD, DTU integrity, navigation, mobile, and infra-tier
flows. The Plan B infra sprint split them into "Core" (purely-self-
contained) and "Infra" (depends on Ollama/OAuth/Stripe that CI
doesn't provision). Both have been silently red because:

1. Many specs were written before the Sprint 17 lens polish landed
   (selectors changed, layouts shifted, the FAB auto-mount changed
   the DOM tree).
2. The Plan B sprint never finished — provisioning Ollama+OAuth+Stripe
   in CI requires either large secrets exposure (bad for PR runs) or
   a self-hosted runner pool.
3. The specs use brittle CSS selectors instead of `data-testid`
   attributes.

### Done when

- E2E Core has spent 7 consecutive days green (no flakes).
- E2E Infra has provisioned Ollama in CI (containerized inference;
  the platinum-performance.yml workflow's Ollama setup is the
  template).
- Both jobs flipped to `continue-on-error: false` (blocking).

### Recommended order

1. Audit which specs broke vs Sprint 17. Likely ~150 selector
   changes — bulk-rewrite via codemod targeting `data-testid` over
   `.classname` selectors.
2. Add `data-testid` attributes to every primary action in the
   lens shell. Sprint 18 has the LensShell wrapper; add testid
   props to its slots.
3. Re-baseline visual snapshots after Sprint 17's polish.
4. Containerize Ollama probe-mocking for Infra tier (or use the
   in-process LLM stub from `lib/llm-router-test-stub.js` if it
   exists; otherwise build one).

---

## 2. 5 test files excluded from c8 coverage

**Status:** Excluded in `.github/workflows/ci.yml` server-coverage step
**Estimated effort:** 1-2 days per file (5-10 days total)
**Files:**
- `tests/auth-security.test.js`
- `tests/storage-parity.test.js`
- `tests/adversarial-critical-endpoints.test.js`
- `tests/edge-cases-critical-paths.test.js`
- `tests/error-paths.test.js`

### What's broken

c8 instrumentation slows each test by ~3-5x. These five files each
have at least one heavy integration-style test that spawns a child
server, waits for /health, exercises 100+ routes, asserts at each
step. Under c8, the wait-for-server + per-route exercise crosses
the 30000ms internal hook timeout, producing `cancelledByParent`
subtests that propagate as exit 1 even when no test FAILS.

### Done when

Each file:
1. Removed from the c8 exclusion list in ci.yml's c8 command.
2. Run under c8 produces no `cancelledByParent` markers.
3. Function coverage doesn't drop more than 0.5pp.

### Recommended approach

- Lower per-test scope: split big test files into smaller ones (one
  test per file) so a single slow test doesn't cancel its siblings.
- Add `CONCORD_DISABLE_BRAINS=true` to spawned-server env vars so
  the child server boots in <10s instead of waiting for Ollama
  probe timeouts. (Already verified locally to drop server startup
  from 75s+ to <10s.)
- Use `--test-concurrency=1` only for the affected file(s) via a
  separate c8 invocation rather than slowing the whole suite.

---

## 3. detectors-suite environment-sensitive flake

**Status:** Documented in CLAUDE.md as "env-sensitive, unrelated to commits"
**Estimated effort:** Hard to estimate — needs root-cause investigation
**File:** `tests/detectors-suite.test.js`

### What's broken

The 60+ in-source code-quality detectors run against the source tree
and produce findings. Some detectors are sensitive to clock skew, fs
timing, or container-runtime differences — they pass on bare-metal
linux but flake in GitHub Actions (or vice versa).

### Done when

7 consecutive days of consistent results across {local mac, local
linux, GitHub Actions ubuntu-latest, GitHub Actions self-hosted}.

### Recommended approach

1. Run the detector matrix in a docker container locally to
   reproduce the CI environment exactly.
2. Identify which specific detector(s) flake. Likely candidates:
   stale-code detector (uses git log timestamps), dependency-entropy
   detector (uses npm ls output that varies by lockfile resolution).
3. Pin the flaky detector(s) with deterministic input fixtures.

---

## 4. Function coverage thin margin (38.87% vs 33% threshold)

**Status:** Passing but only 5.87 percentage points above the floor
**Estimated effort:** Ongoing — every PR with new unfunctioned code lowers it
**Source:** `npx c8` output from CI

### What's broken

The codebase has ~10,400 named functions; tests cover ~4,040. Many
heartbeat handlers, ghost-fleet engines, lens-action implementations
are never invoked by tests directly. As the codebase grows, the
denominator grows faster than the numerator.

### Done when

- Function coverage stays above 38% on every commit (no regression).
- Each new file with >5 exported functions has at least one unit
  test exercising the happy path.

### Recommended approach

1. Pre-commit hook: count new exported functions in the diff;
   require at least one test file changed if N > 0.
2. CI gate: fail if function coverage drops by >1pp vs main.
3. Backlog: pick the top 10 highest-LOC untested files; write one
   smoke test per file.

---

## 5. CodeQL plateau at ~45-49 alerts after wave 6

**Status:** Documented FPs in `docs/security/codeql-suppressions.md`
**Estimated effort:** Per-alert dismissal via GitHub Security UI;
                      OR structural refactor to make CodeQL recognize
                      sanitizers
**Categories:**
- 6 critical SSRF in mcp-client.js + ssrf-guard.js (FP — taint
  tracker can't see validateSafeFetchUrl across function boundary)
- Path injection in storage modules (FP via containedPath helper)
- 3 remaining real new categories surfaced after wave 3.5

### Done when

CodeQL aggregate alert count reaches single digits with documented
FP rationale for any remaining alerts. Drift gate at
`server/tests/platinum-codeql-drift.test.js` catches any new
violations of the excluded categories.

### Recommended approach

1. Dismiss the 6 SSRF FPs via GitHub Security UI with
   "False positive — see docs/security/codeql-suppressions.md"
   justification. (Per-alert dismissal isn't available via the
   CodeQL config or MCP tools — needs manual UI action.)
2. For the remaining real categories:
   - Missing rate-limiting → already fixed in current commit
   - HTML sanitization → audit each flagged site
   - Regex missing anchors → audit each flagged regex for
     intentional prefix-only matching vs strict-equality

---

## Re-review cadence

This file is re-reviewed alongside `docs/security/codeql-suppressions.md`
every 90 days (cron-triggered via
`.github/workflows/codeql-exclusions-review.yml`). Each item's
"Done when" criterion is evaluated; items that have advanced get
marked closed; new infra-tier gaps get added.
