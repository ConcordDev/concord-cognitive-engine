# Autonomous loop — progress journal

Append-only. The loop writes here each unit (via `loop.mjs --pass/--fail/--escalate`)
so a fresh session resumes with continuity. Newest at the bottom.

- `2026-06-29` Stage 1 toolkit authored: `docs/AUTONOMOUS_LOOP.md` (north-star) + `scripts/autoloop/{lib,next,verify,guard,loop,status}.mjs` + this journal. Backlog seeded from the live rankers — 93 units (depth 60, lens 23, gameloop 1, connector 4, conkay 5). Proven: `next` selects `depth:worldmodel` (highest leverage); `guard` blocks edits to graders/baselines (exit 1); `verify` default-FAILs without a captured preGate (exit 1); `status` reads live ratchets (honest floor 0.684, ux-polish 0.955, orphans 0). Loop runs in-session (Stage 1); cron driver is Stage 3. Prerequisite to running waves: PR #840 merged + a fresh long-running branch off main.

## Pre-existing debt surfaced by PR #840 (loop worklist — NOT #840's to fix)

Fixing #840's value-assertions gate un-masked latent full-suite failures in
`structural-audits` (they were always there, but the job exited at value-assertions
before reaching the full suite). Verified pre-existing: PR #840 touches none of these
domains, the depth harness, or frontend coverage-affecting code.

- **`gameloop`/`depth` stream — failing depth tests in untouched domains** (boot the
  server; cause TBD per test — drifted expectation à la studio, real bug, or full-suite
  STATE/ordering): `hvac` (energyAudit grade & issue logic), `inheritance` (asset
  inventory + category rollup), `system` (Prometheus alert eval; log search + heartbeat),
  `observe`/traces (trace-record normalize + clamp + 4xx error-rate). First loop action
  per domain: run the depth test in isolation → if it passes, it's full-suite ordering
  (harness STATE isolation gap); if it fails, classify drifted-expectation vs real bug.
- **`lens` stream — frontend branch coverage 78.77% < 80% threshold** (`concord-frontend/
  vitest.config.ts`). statements/lines/functions are already pinned to their real measured
  floors there with a ratchet-up note; branches=80 was the old passing floor and has since
  drifted. Loop options: recover the ~1.3% with real frontend tests (preferred — raises the
  ratchet), or pin branches to the real floor matching the other three thresholds.

PR #840's OWN gates are green (Adversarial Audit, detector ratchet, value-assertions, server
lint/typecheck, frontend lint/typecheck, validate_lens_quality, build, every touched-domain
parity/lens test). The studio depth test (the only failure #840 caused) is fixed in 18fdaab1.

## Stage 3 — cron driver shipped

- `2026-06-29` `.github/workflows/autoloop.yml` — scheduled (every 6h) + workflow_dispatch. One bounded iteration/fire: next.mjs selects → Claude Code headless (`claude -p`, one unit, max-turns 60) does the worker step → deterministic gates decide (verify.mjs PASS + guard.mjs clean → commit+push to `autoloop/main`; else discard + record attempt). Model never owns the commit. Honors AGENT_STOP; runs only on `autoloop/main`, never main. PREREQ (human): repo secret `ANTHROPIC_API_KEY` (or `CLAUDE_CODE_OAUTH_TOKEN`) + create branch `autoloop/main` off main once #840 merges. YAML validated; unit-id extraction verified against `next.mjs --json`.
