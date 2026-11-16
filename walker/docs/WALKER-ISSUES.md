# Walker issues log
Every problem that interrupted or skewed a walker run. Each entry: what happened, root cause, fix, regression test, still-open follow-up.
Read this before starting the next walker version.

## 2026-11-15 — Deploy restarted backend mid-walk (502 at `tick`)
- Cause: #2368 deploy restarted the backend while the walk was running; the walker had no deploy awareness.
- Fix: manual resume with START_FROM=tick and EXPECT updated to 495efb7.
- Follow-up (open): walker should detect 502 or a sha change, pause, re-check /health buildSha, and auto-resume. Deploys should check whether a walk is running.

## 2026-11-16 05:42 ET — Crash at `ethics` (missing audit/reports dir)
- Cause: util.append_text wrote into a directory that didn't exist.
- Fix: append_text now creates parent dirs. Regression test added. Resumed from ethics (run 20261116-054435).

## 2026-11-15 — Selftests polluted the live ledger
- Cause: selftests wrote to records/walker.jsonl.
- Fix: pollution moved to .selftest-pollution-20261115.bak; run_selftest.py uses --expect-sha.
- Follow-up (open): selftests should write only to a temp ledger.

## 2026-11-15 — Keyword match could grade a ticket VERIFIED (Dutch's critique)
- Cause: reverify trusted keyword matches as proof of a fix.
- Fix: only a hand-written recipe can grade VERIFIED; keyword-only caps at NEEDS_HUMAN, a keyword STILL can reopen; coverage table lists every pending ticket with attempted/not and a reason. test_coverage 55/55.

## Open upgrades for next version
- ~~Auto-resume on crash or 502~~: done in Wave 0 (2026-11-16). See the entries below.
- Walker CI job on GitHub.
- ~~Record endpoints hit per control~~: done in MST-W0-02 (2026-11-16). See below.

## 2026-11-16 06:22 ET — Stale "WALK DONE" line in run.log
- Cause: run.log is appended across resumes, so a Nov 15 4:19 PM "WALK DONE" (line 575) is still in it. A plain grep could start the reverify early.
- Fix: the hourly routine now only counts a WALK DONE that comes after the last resume line.
- Follow-up (open): each resume should write its own log, or the walker should print WALK DONE with a run id.

## 2026-11-16 07:11 ET — Live walk stopped early by Dutch
- Reason: the walk lacked per-control endpoint recording, so its data couldn't pre-map tickets. Dutch: "no point, needs its upgrades."
- Next: build Wave 0 (endpoint recording + packer) from the master plan, then run a fresh full walk as the real baseline.

## 2026-11-16 07:06 ET — Walk aborted at translation, but start.sh printed "WALK DONE"
- What happened: auth/me returned no response (status None) before the translation lens, so the walker aborted correctly. start.sh then ran the admin sweep (which wrote 0 lens files) and printed "WALK DONE" as if the walk had finished. Only about 65 of about 220 lenses have results across all runs.
- Likely cause: a short backend or network blip around 7:06 ET (the Mac disk cleanup was running then). Not confirmed.
- Follow-up (open): start.sh must not print WALK DONE after an ABORT; it should print WALK ABORTED with the lens. The walker should retry auth/me with backoff before aborting. Any "done" signal must include lenses walked out of total.

## 2026-11-16 08:55 ET: Wave 0 fixes for the issues above (MST-W0-01..05, box selftests only)

**auth/me blip aborted a whole walk (07:06 entry)**
- Fix: `auth.whoami_with_retry` retries transient answers before giving up. Transient means no response, 408, 429 or 5xx. The backoff is 2/5/15/30 s (`thresholds.auth_retry_backoff_s`).
- A real 401, or the wrong user, still aborts at once.
- Tests: test_w0_schema `auth_retry` (None→503→200 passes; 401 is not retried; it gives up after the list; a persistent 502 still aborts); test_w0_walk (fixture `/api/auth/me` drops once).

**"WALK DONE" printed after an abort (06:22 and 07:06 entries)**
- Fix: the walker now prints `WALK DONE run X: walked N/M lenses` only when it finished.
- Otherwise it prints `WALK ABORTED run X at <slug>: walked N/M lenses (<reason>). Resume: walker.py sweep --resume X` and exits 3.
- Every lens is recorded in `walk-manifest.json`, along with its build sha.
- Test: test_w0_walk (abort exits 3 and prints the ABORTED line; the manifest has an aborted row).
- Still open: `/workspace/walker-runs/live-20261115/start.sh` lives outside the repo and still echoes WALK DONE unconditionally. It should check the walker's exit code (3 = aborted) before echoing anything.

**Resume, 502 and crash handling (2026-11-15 502-at-tick entry)**
- `--resume <run>` skips the lenses the manifest already has as walked.
- Navigation retries 502/503/504 (`gateway_retries`, default 2, with a backoff).
- A browser crash ("Target page, context or browser has been closed") relaunches Chromium and re-walks that lens once (`--auto-resume N`, default 2).
- `/health` buildSha is stamped per lens. A sha change mid-run is flagged `drift`, and `--expect-sha` flags `mismatch`.
- Tests: test_w0_walk (fixture `/lenses/flaky` 502 then 200; resume skips walked lenses); test_w0_schema (crash classification, drift and mismatch).
- Limit: the crash relaunch is only covered by unit tests (classification). No selftest actually kills Chromium.

**Build stamp is first-class (Dutch, 08:11)**
- Every record, control row, endpoint row, finding, premap finding, registry-diff row and packet carries `build_sha` and `walked_at`.
- `lensrecord.build_verdict` gives "ran against build X, which CONTAINS / does NOT contain fix commit Y". The answer comes from `git merge-base --is-ancestor`, or is UNKNOWN when there is no repo, the sha isn't hex, git doesn't have the object, or git errors. A sha is never assumed.
- A missing or mismatched sha is flagged ⚠ in packets, never treated as current. v1 records show as "UNKNOWN build".
- Reverify rows now carry a `build` block (`--fix-commit TICKET=SHA`, `--containment-repo`).
- `pack.py --check-live` marks a packet STALE.
- Tests: test_w0_schema (11 containment and stamp cases); test_w0_pack (CONTAINS / NOT / UNKNOWN / STALE).

**False positives in the observed-vs-registered diff (Dutch, 08:11)**
- Risk: a naive string match calls dynamic routes "missing". Examples: `:id` vs a uuid, `[...slug]`, Next.js `(group)` and `@slot` folders, routers mounted at runtime, `${PREFIX}` template routes.
- Design (`concord_walker/routematch.py`):
  - Both sides are normalised (`:p`, `*`, `**`; groups, slots and intercepts stripped) and matched by pattern. The most specific route wins. Bare `/*` or `/api/*` 404 catch-alls are not counted as declared routes.
  - Routers mounted at runtime match by suffix, but only when the route has a literal segment. A bare `/:id` must not claim every path.
  - Severity comes from the live response, not the match. Classes: `real_missing` (no route and non-2xx), `matched_failing` (declared route, non-2xx), `unmatched_but_ok` (no route, 2xx), `matched_ok` and `unused_route`.
  - Only the first two are defects. `unmatched_but_ok` is reported as a noise count and never reaches packets as a bug.
- Found while building it: scanning only `server.js` and `routes/` produced 4 false `real_missing` rows on the live sample (`/api/guidance/first-win` and `/suggestions`, which `registerGuidanceEndpoints(app)` registers from `server/guidance.js`).
  - Scanning every file instead attributed routes to code inside a generator template (`lib/forge-template-generator.js`) and to comments.
  - Fix: scan the files reachable from server.js by import, plus `routes/**` and `domains/**`. Skip commented-out routes. Attribute duplicates to server.js, then routes/, ahead of lib/.
- Tests: test_w0_registry covers param, catch-all, route-group, runtime-mount, optional-param and template-prefix routes (2xx is never `real_missing`); a true 404, a network failure and a wrong-method 405 (always `real_missing`); a registrar outside routes/; a test-only route; a commented-out route; and a generator-only route.
- Live sample (live-20261115, all v1, so only console 4xx/5xx exist): real_missing 0, matched_failing 35, unmatched_but_ok 0, matched_ok 0, unused_route 3826 (meaningless without 2xx data).

**Upgrades approved by Dutch at 08:27 (fixture `/lenses/upgrades`; test_w0_upgrades)**
1. Per-control errors: JS exceptions, React error boundaries, unhandled rejections and failed assets are attributed to the click's time window. A click that crashes gets `effect: error`, so it is never counted as a dead button.
2. Write-then-read-back: a persisting 2xx write (PUT/PATCH/DELETE, a POST that isn't a lens run, or a lens run with a save-like action) is followed by a reload and a text check. If the change is gone, that is `fake_success`, with one screenshot. Walker test accounts only, and only safe controls.
3. `--two-account` (opt-in): replays up to 12 non-DELETE object calls as t2 (saved session, `assert_account t2`). A 2xx that isn't a refusal is an `ownership` finding. Credentials are never printed.
4. Speed budget: calls over 3 s are `slow_call` (`thresholds.slow_call_ms`). Long tasks, and a click or AX snapshot blocked for over 1 s, are `freeze`.
5. Stable control ids: `sid = c_ + sha1(role|norm_name|a11y path)[:12]`. They survive reordering, whitespace changes and counters.
6. Run-to-run diff: `tools/run_diff.py`, keyed by sid. It reports new_broken, fixed, unchanged and disappeared, pins both builds, and treats an unwalked lens as `lens_not_walked`, never "fixed".
7. Screenshots on failure only: one image per broken control in the sweep. Its path appears in the finding and in the packet.
- Fixture counts: asset_fail 1, fake_success 1, freeze 1, js_error 2, ownership 3, slow_call 1.

**Packer (MST-W0-05)**
- `tools/pack.py`. The format is in `premap/README.md`.
- Caps: 12 KB per ticket packet and 24 KB per lens packet. Trimming is explicit, and a packet still over the cap exits 3. An unknown slug exits 2. Output is byte-identical for the same inputs.
- A ticket naming more than 4 lenses gets one row per lens (MST-W6-05 names 20 and was 13.9 KB before this).
- Test: test_w0_pack.

## 2026-11-16 09:12 ET: Premap sweep could click payment-adjacent controls (found before the MST-W0-06 baseline walk)
- Cause: `sweep_decision` allowed "Upgrade", "Upgrade plan", "Get Pro", "Go Pro", "Pricing" and "Billing", because they read as navigation and are not in HARD_DENY or SWEEP_DENY. On prod they can open a checkout or plan flow. The standing rule is that payments stay untouched.
- Fix: a new `safety.SWEEP_PAYMENT` regex covers upgrade, pro, premium, pricing, plan(s), subscri*, billing, credits, top up, wallet, invoice, payout, stripe, card, refund, cart, paywall, tier, license. Matching controls are refused with reason `payments` and recorded as skipped.
- Test: test_w0_schema `payment-adjacent controls refused` (15 names).

