# Repair-telemetry lens — capability map (Wave 3, 2026-07-11)

## What this lens actually is

"Maintenance" — the repair-telemetry operator dashboard: "query what the world
repaired while you slept." A read-only monitoring surface (Datadog/Sentry/
PagerDuty-shaped) over the real `repair` domain (`server/domains/repair.js`):
the Homeostasis ledger (healed vs. escalated findings from the ~4h monitor
pass), the escalation inbox (value/arc calls the cortex refused to make —
approve/dismiss), and Repair Memory's learned error→fix patterns. By design it
has no authoring surface — a telemetry dashboard observes, it doesn't author.

## Findings and fixes

**1. Missing server-side authz (same class as psyops/admin/ops this wave).**
Every `repair.*` macro was reachable by any authenticated user despite the
lens rendering `<AdminRequiredState>` on a 403 that could never fire from this
path. `health_log` leaked other users' negative wallet balances
(`negative_balance` findings carry `subject_id` + `balance`); `resolve_escalation`
let any user act on Sovereign-only decisions. Fixed by adding
`requireOperatorRole(ctx)` (checking `ctx.actor.role` ∈ admin/owner/sovereign/
founder) as the first statement in every macro, matching the established
`announcements.js`/`server.js` admin-gate idiom.

**2. Two dropped fields.** The prior page called all four real macros but
silently dropped `health_log`'s per-finding `detail_json` (the negative
balance / overdue seconds / duplicate-edge count that explains *why* a
finding fired) and `memory`'s `topPatterns` (the ranked learned-fix list with
occurrence counts, success rates, and CVE tags). Both wired in with no new
backend code.

**3. New capability — operator-triggered on-demand Homeostasis pass.**
`repair.run_now` reuses the exact same detect→classify→heal/escalate pipeline
as the heartbeat (`world-health.js` + the shared `escalator` now exported from
`world-health-monitor.js` so the two paths never drift), cooldown-gated
(module-scoped, default 15s, env-overridable) to prevent a click-spam
full-table-scan DoS.

**4. A real bug caught and fixed while salvaging this unit (see below):**
`runNowCooldownMs()` read `Number(process.env.CONCORD_REPAIR_RUN_NOW_COOLDOWN_MS) || 15_000`
— a falsy-zero footgun. Setting the env var to `"0"` (explicitly disabling
throttling, what the test suite does) coerces to the numeric `0`, and
`0 || 15_000` evaluates to `15_000` because `0` is falsy in JS, so the
cooldown silently stayed enabled instead of being disabled. Fixed to an
explicit `undefined`/empty-string check.

## Salvage note

This unit was originally dispatched to a background agent that made all of
the above real progress (backend authz gate, dashboard rebuild, cooldown
macro) but was interrupted mid-debug by an infrastructure blip before it
could finish, commit, or push — evidenced by 2 failing tests and a stray
scratch debug script (`server/debug-run-now.mjs`, deleted) left in the
worktree. Per CLAUDE.md's salvage-discipline rule ("if an agent dies
mid-unit, its edits are on disk — verify them and commit the unit properly;
don't discard complete work"), the work was reviewed end-to-end, the two real
bugs it was still chasing were diagnosed and fixed independently (the
falsy-zero cooldown bug above, and a stale pre-existing test that asserted
`no_db` without granting the ctx an operator role — now short-circuited by
the new authz gate before ever reaching the db check), and the unit was
completed and verified rather than re-dispatched or discarded.

## Verification (all run directly, 2026-07-11)

- `node --check server/domains/repair.js server/emergent/world-health-monitor.js` — clean.
- `npx eslint domains/repair.js emergent/world-health-monitor.js tests/repair-telemetry-domain-macros.test.js` (server/) — clean.
- `npx eslint app/lenses/repair-telemetry/page.tsx tests/repair-telemetry-lens-states.test.tsx` (concord-frontend/) — clean.
- `node --test server/tests/repair-telemetry-domain-macros.test.js` — **42/42 passing** (was 40/42 before the two fixes above).
- `npx vitest run tests/repair-telemetry-lens-states.test.tsx` — **7/7 passing** (needed a `useLensCommand` mock — the new keyboard-shortcuts feature needs a live `KeyboardProvider` context the headless test doesn't mount, same pattern as `mesh-lens-states.test.tsx` — plus two assertions updated to match the real new UI's lowercase stat labels and disambiguated for a second "healed" match between the stat strip and the ledger badge).
- `node scripts/verify-lens-backends.mjs` — `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260, unchanged.
- `node scripts/grade-ux-polish.mjs --honest` — `repair-telemetry`: `tier:"polished"`, `isGenericScaffold:false`. `audit/` reverted afterward.
