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
- Auto-resume on crash or 502 (today the hourly routine does this from outside).
- Walker CI job on GitHub.
- Record endpoints hit per control (needed for the lens redesign capability trace).

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
