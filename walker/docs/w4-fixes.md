# ULW v3 W4 — the four small fixes (GB-1575)

**Selftest:** `selftest/test_w4_fixes.py` · **Builds on:** W3 (`docs/w3-sharding.md`)

## (1) Formfuzz per-lens budget — 600 s, overflow to carry-over

`FormFuzz` reads `thresholds.formfuzz_budget_s` (config carries 600; the
default is 600 when unset). The clock starts when the battery starts; the
case loop checks it before every case (and before the date-pair case).
Cases the budget cuts are recorded on the result as `not_run`, named in
the notes, and reported to the Reverifier's `not_run` sink; the replay
block carries them per lens and the sweep queues them in the
CarryoverQueue — the same revisit path as the other caps (C5/C7). A
battery cut short can no longer return FIXED: with no created/silent
finding it files NEEDS_HUMAN (battery incomplete), never a clean pass on
a partial battery.

## (2) DEPLOY_DETECTED — pause and confirm, never abort on silence

Origin: the 05:15 walk-2 abort — `/health` failed to answer twice while
the buildSha was in fact unchanged and the backend uptime continuous.

`DeployGuard.check()` now works in three steps:

1. A readable sha decides as before: same → proceed, different → stop.
2. An unreadable sha starts a **confirm window** (~60 s, backoff retries,
   `confirm_window_s`): a recovered read with the same sha clears the
   pause (logged); a different sha stops, with the reason noting it was
   confirmed after a pause.
3. If the window expires unreadable, the **uptime witness** decides
   (`sha_gate.health_uptime`, wired in `cmd_walk`): uptime continuous
   since the guard started means the same process is alive — not a
   deploy, the walk proceeds with the pause logged; an uptime **reset**
   proves a restart and is treated as a deploy. Only when neither
   witness can be read does the old fail-closed stop fire.

## (3) Test writes run as the write account

The reverify chat dispatch passed no account, so chat checks **sent as
the observer t1**; clickpersist's upload recipe likewise opened its
driver walk on the walk account. Both are test writes: the chat dispatch
now passes `write_account_key(cfg)`, and the upload category opens its
driver walk on the write account. Which account that is stays the arming
config's ruling (GB-1561: t2). Read-only recipes (dead_click, computed)
keep the walk account.

## (4) Walker version from a WALKER_SHA file

`lensrecord.walker_sha` resolved the version by git only, so a packaged
run dir that is not a git checkout stamped `walker=?`. It now falls back
to a `WALKER_SHA` file — `<walker_dir>/WALKER_SHA`, then
`<walker_dir>/code/WALKER_SHA` — validated as a hex sha; the dirty flag
is None for the file form (unknown, never guessed). Git behaviour is
unchanged when a checkout exists.

## Limits

- The uptime witness depends on `/health` carrying an uptime field under
  one of the common key names (`uptime`, `uptime_s`, `uptimeSec`,
  `uptimeSeconds`, `uptime_seconds`); where it does not, the guard keeps
  the fail-closed stop after the confirm window — strictly better than
  the old two-read abort, never weaker.
- The formfuzz budget covers the case battery (open form → last case);
  form-open and cleanup time ride the lens's own budgets as before.
