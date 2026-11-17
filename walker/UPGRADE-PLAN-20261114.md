# Ultimate lens walker: review + upgrade plan (2026-11-14, ~10:15 PM ET)
Written by Zuko 2 (Grok Bot) for Dutch. **Plan only. No walker code was changed.** The walker must not run live until the combined deploy lands (GB-1542).
Data behind every number: `analysis/FPV-ROWS-CLASSIFIED-20261114.csv` (all 2,322 FPV rows, one line each, with walker class, today's outcome bucket and human-row category), produced read-only by `analysis/fold_and_classify_fpv.py` + `analysis/human_row_categories.py` from `origin/fix/audit-sweep-20261110` @ `2bdf8a92f` (fold: 2,639 tickets · OPEN 294 · FPV 2,322 · VERIFIED 0 · lowercase `open` 23).

---
## 1. What the walker is today (one paragraph)
`walker.py` (sweep | lens | reverify | login | whoami) drives headless system Chrome through Playwright with **no page JavaScript** (all DOM reads are DevTools-protocol: AX tree, DOMSnapshot, box model, layout metrics). Per lens it checks: reach + timing, surface inventory (unnamed / unfocusable controls), every tab clickable, keyboard focus ring, Escape + focus return on safe openers, export download + parse, delete-confirm (only with `--allow-write`, one labelled own fixture, delete by label), 390 px layout, WCAG contrast, console / same-origin 4xx-5xx. It files new tickets into `fix_tickets.jsonl` (testers' key order, dedupe at 0.72 title similarity), keeps a needs-tester queue, logs leftover fixtures, and in `reverify` mode replays a ticket via 2 hand recipes (FIX-007, FIX-deities-002) or a title-keyword classifier into one of 18 standard checks; anything else → NEEDS_HUMAN. Auth = saved Playwright storage_state per account (`auth/<t1|t2|admin>.json`) made by a headed login or a 0600 secrets file; `/api/auth/me` guard before every lens and write; t2/admin always in their own context. Self-test against a local fake lens: PASS (Nov 13).

## 2. Staleness found (ordered by how badly it would hurt a live run)
| # | Problem | Evidence | Effect if run as-is |
|---|---|---|---|
| S1 | **Reads the wrong ledger.** `TicketStore` reads only `<audit_dir>/fix_tickets.jsonl`; the real state now lives in `audit/fix-list/fix_tickets.jsonl` **+ 12 `records/*.jsonl` seat files** on the branch. | Walker's own loader on the branch main file: 2,587 ids · FPV **1,474** · OPEN 1,002 · `open` 111. The fold: 2,639 ids · FPV **2,322**. | `reverify --from-status FIXED_PENDING_VERIFY` would skip **848 FPV (37%)** and 52 records-only ids. Lowercase `open` isn't normalised. |
| S2 | **Writes verdicts into the main file**, not `records/walker.jsonl`; no `live_sha`, `walker_run_id`, `recipe`. No `--expect-sha` gate (LC-03/LC-04 not built). `/health` on the branch exposes **no build sha**, so the gate has nothing to compare yet. | `reverify.status_update` → `store.append_update` into `fix_tickets.jsonl`. `server/routes/system.js` /health has no sha/commit field. | Verdicts land outside the fold's seat-record flow; a run against a stale build could stamp VERIFIED. |
| S3 | **Paths point at a folder that no longer exists.** `audit_dir=/workspace/concord-live-audit` (inventory.json, fix_tickets.jsonl, evidence/, reports/). It is gone on the box **and** absent on the Mac. **The box copy of the walker is gone too** (searched the whole box: no `walker.py`, no `concord_walker/`), with its `auth/`, `runs/` and the Nov 13 per-lens block-reason logs that LC-07 depends on. The Mac copy is now the only copy. | `ls /workspace/concord-live-audit` → missing; `find / -name concord_walker` on box → nothing. | Every mode crashes at `load_inventory` / `TicketStore`. LC-07 must re-derive the 17 block reasons from scratch. |
| S4 | **Accounts don't match the saved test accounts.** Config expects `zuko_qa_t1 / zuko_qa_t2 / zuko_qa_admin` (vault 3945594 / 4482532 / 3912468) and secrets at `/workspace/secrets/walker-zuko_qa_*.txt`. The saved accounts on the box are `concord-zukoqa.env`, `concord-zukoqb.env`, `concord-zukoqadmin.env` (keys: username, password, site[, email, purpose]) whose usernames are **different** from the config names (values not printed). The two `*.session.json` files are `{token, cookies, csrf}` (not Playwright storage_state) and both JWTs **expired** (saved Nov 9). | Flag-name / boolean checks only. | The auth/me guard aborts on username mismatch; sessions can't be loaded. Also: the "JWT removal" call Dutch may make changes how sessions work — re-check after the deploy. |
| S5 | **Mac-hostile bits.** Memory guard reads `/proc/meminfo` → on macOS it silently returns "infinite", so the 1.5 GB guard is off. Headed login assumes `$DISPLAY`. Secrets live on the box only. | `util.mem_available_mb`, `auth.py:133`. | A Mac run can't self-throttle while the Mac also runs backend + builders. **Recommend running on the box** (as the mega plan says) and keeping the Mac copy as source of truth. |
| S6 | **Weak FIXED rules → false-VERIFIED risk on ~379 rows.** Export = "a file downloaded and parsed" (no content check; the GB-1538 export-empty genus is exactly *wrong content*), 171 rows. Contrast with no hex = "main view passes", 144. Unnamed/keyboard/focus with no element = "main view clean", 52. Reach = "page loads", 12. | Simulated against the fold (`today_bucket` column). | Rows flip to VERIFIED without the ticket's actual defect being exercised. |
| S7 | **Classifier misroutes.** `tab_error` regex (`error|blank|404|not found…`) catches validation, export and console tickets (e.g. FIX-trades-009 "accepts blank form", FIX-aviation-001, FIX-mail-001) → 228 rows labelled tab_error; only rows whose quoted tab name is found get a verdict. Element extraction only sees **quoted** names, so "Esc doesn't close New Proposal or Schedule Meeting dialogs" has no element → NEEDS_HUMAN (312 rows in this bucket). | Samples in the CSV. | Big chunk of the NEEDS_HUMAN pile is self-inflicted. |
| S8 | **Lens + admin lists.** Inventory file is gone; current registry (`concord-frontend/lib/lens-registry.ts` @ head) has **268 paths** = 266 top-level lenses + 2 sub-paths (`reasoning/traces`, `world-creator/anomalies`), plus `app/lenses/global` (not in registry, 14 FPV). Old count 267 — close, but must be regenerated, not trusted. Admin list in config is `admin, ops, psyops, repair-telemetry, system`; registry's SOVEREIGN_LENSES is **`admin, command-center`**; the in-flight admin lock (bc-cbb2661a) covers **debug / ops / system / sentinel**; `audit` waits on Q14. | Registry grep at head. | command-center, debug, sentinel get walked as t1 with write/export rules instead of the admin look-only rules; t1's correct result there is now a **403/no-access**, which the non-admin gate check must treat as PASS. |
| S9 | **Non-lens tickets in the FPV set.** 52 FPV ids are HV-/SB-/HV60-/IDLE-/GB- code tickets with no lens. | CSV `human_category=non_lens_code_ticket`. | Walker tries to walk lens `None`. These verify by CI pins / code evidence at the deploy sha, not the browser. |
| S10 | **Only 2 recipes**; everything outside the 18 classes → NEEDS_HUMAN; write classes need `--allow-write` and nobody has set its scope (Q13–Q17 open). | README. | See §3: today ≈ 1,685 of 2,322 FPV rows end NEEDS_HUMAN or never-decided. |
| S11 | README / plans index still say "copy of the box walker at /workspace/concord-live-audit/walker"; setup block and secrets paths are box paths. | README "Setup", "Accounts", plans/README.md. | Confusing; harmless. |

Things that are **not** stale: the walker is selector-free (AX names + coordinates), so #2356's DOM churn mostly doesn't break it; `/api/auth/me` still returns `{ok, user:{username, role,…}}` as `auth.whoami` expects; lens routes are still `/lenses/<slug>`; `forbidden_roles` still fences sovereign/owner/founder.

## 3. What today's walker would actually do with the 2,322 FPV rows (simulation, no browser)
| outcome bucket | rows | meaning |
|---|---:|---|
| walker decides (incl. weak) | 637 | 258 solid (390 overflow 102, crash loop 24, named tab/opener ~126, load timing 5, hex contrast 1) + **379 weak** (S6) |
| free text (no class) | 766 | NEEDS_HUMAN |
| needs `--allow-write` | 401 | delete-confirm 220 · persistence 127 · hotkey 54 (63 of them on write-skip lenses) |
| class but no named element | 312 | NEEDS_HUMAN (S7) |
| interaction timing | 76 | NEEDS_HUMAN |
| console/http (can only say STILL) | 73 | never FIXED → NEEDS_HUMAN when clean |
| 390 visual (no overflow words) | 48 | NEEDS_HUMAN |
| named a11y element | 9 | NEEDS_HUMAN |
So the "≈1,000 human rows" is really **≈1,284 judgment rows + 401 write rows** at today's head, before any upgrade. Plus the **six prod rows** (GB/CB note: chem-003, docs-015, global-016, metalearning-014, ingest-001, repos-002), which are OPEN, not FPV.

## 4. Human-row inventory: the 1,284 judgment rows by category
Category = first keyword family that hits title+actual+expected+repro (rules in `human_row_categories.py`; ordered so money/privacy win ties). Auto = the upgraded walker can reach a confident VERIFIED/REOPENED with evidence; Partial = machine gathers the evidence + a draft verdict and a human confirms in ~15 s from a screenshot pair; Human = needs a person (or is out of scope by rule).

| category | rows | how the walker covers it | auto | partial | human |
|---|---:|---|---:|---:|---:|
| validation / error messages | 264 | **form-fuzz recipe**: type the ticket's bad values (blank, whitespace, negative, 99999, reversed dates, `{bad`), assert inline error or disabled submit **and** no 2xx create on the network (CDP Network); clean up by label if it did create | 224 | 26 | 14 |
| visual / layout / copy | 143 | box-model overlap/clipping checks, DOM text asserts for wording, **before/after screenshot + LLM-vision judge** against the ticket's `expected`; low confidence → human | 64 | 57 | 22 |
| unclear / mixed | 125 | per-ticket recipe generated from text (LLM drafts step list → walker executes with safety policy) | 50 | 38 | 37 |
| keyboard / a11y | 115 | Escape, arrow-key tablist (RCA-arrow-tablist), heading order from AX tree, **fuzzy match of unquoted element names** to AX names | 98 | 12 | 5 |
| missing control / CRUD (no edit, no search, can't rename) | 101 | AX-tree presence of Edit/Delete/Rename/Search/Sort/Filter on the record row or toolbar, then exercise on own fixture | 81 | 15 | 5 |
| LLM / AI output | 90 | reply arrives within budget, no `handler_error`, not canned (2 different prompts → similarity < threshold), tool call surfaces; **quality** stays human. Send budget per lens | 36 | 27 | 27 |
| computed / displayed values (dates off by one, totals, minus sign) | 68 | seed known inputs, compare displayed value to the ticket's expected value; TZ = America/New_York; API read-back via CDP `Network.getResponseBody` | 48 | 14 | 6 |
| cross-account / privacy | 55 | **two-session A/B**: t1 creates labelled record, t2 (own context) and a signed-out context probe UI + the same API routes via `context.request`; assert 0 foreign rows, no body bytes captured | 50 | 3 | 2 |
| non-lens code tickets (HV/SB/HV60/IDLE/GB) | 50 | out of walker scope → verify by CI pin + code evidence at deploy sha (separate `--from-ci` verdict row) | – | – | – |
| audio / DAW / voice | 46 | CDP **WebAudio** domain (context created, state running, render capacity) without page JS; headed run on box with PulseAudio monitor + ffmpeg RMS for "sound actually plays"; exported audio files checked with ffprobe/RMS. Musical quality = human | 23 | 14 | 9 |
| 3D / WebGL / canvas / maps / charts | 44 | screenshot **pixel probes** (non-blank, variance, not uniform), diff after orbit/drag/zoom input, console `WebGL context lost`; correctness of the picture → vision judge/human | 24 | 13 | 7 |
| dead click / fake success | 42 | click → assert a request fired + AX-tree diff + reload read-back; toast-without-record = REOPENED | 32 | 6 | 4 |
| persistence / read-back | 44 | own fixture → reload → new context → read-back | 37 | 4 | 3 |
| payments / money | 27 | **excluded live** (payments untouched; money OFF). Read-only only: the honest money-off notice renders and nothing charges. Purchase legs only on the SB-38 DB clone | 0 | 8 | 19 |
| file upload / media | 24 | CDP `DOM.setFileInputFiles` with tiny fixtures (png, pdf, wav, csv) → thumbnail pixel probe + read-back (write mode) | 19 | 2 | 3 |
| email / OAuth / 2FA / external API | 19 | external-API failures via network assertions; email/OAuth/2FA need an inbox or TOTP secret → human unless Dutch OKs a test-account TOTP | 4 | 4 | 11 |
| realtime / sockets | 14 | t1 + t2 contexts open together; t1 acts, t2's AX tree changes within 10 s; CDP `Network.webSocketFrameReceived` listener (no page JS) | 10 | 3 | 1 |
| hidden text / test data on live | 13 | DOMSnapshot hidden-vs-visible text scan (display/visibility/aria-hidden/off-screen/zero-size/same-colour) for AI-directed phrasing + harness strings | 12 | 1 | 0 |
| **total (lens rows)** | **1,234** | | **812 (66%)** | **247 (20%)** | **175 (14%)** |

The 401 write rows: ≈85% auto once `--allow-write` scope is agreed (the 338 rows on non-write-skip lenses); the 63 on write-skip lenses need t2-only WRITE-OWN profiles or a human.
**Six prod rows:** hidden-text scan covers chem-003 / docs-015 / global-016 / metalearning-014 (auto, evidence = node path + screenshot); repos-002 = 10× reload capture recipe (auto); ingest-001 = global search vs lens list compare for one DTU id (auto, read-only). The fix itself still needs a builder.

**Honest bottom line:** after the upgrade, of ≈1,685 rows that would fall to humans today, roughly **1,150 get machine verdicts**, **≈250 get a pre-cut 15-second human confirm**, and **≈240 stay truly human or out of scope** (payments, OAuth/email, subjective quality, Dutch-gated). Vision-judged verdicts need a **10% random human spot-check** before we trust them in bulk; if the spot-check disagrees > 5%, that category drops back to Partial.

## 5. Upgrade plan, ordered by value
Effort is builder-days for one competent builder (Muse seat or Claude), tests included. Every item ships with selftest fixtures that **fail on the pristine walker** and pass after (buggy + fixed fake-lens pair per recipe), plus failure-path tests (signed out, wrong account, sha mismatch, network 5xx, element missing, partial write, crash mid-run).

### P0: must land before the post-deploy run (all offline; ≈ 4 days)
| # | Change | Fixes | Effort | Maps to |
|---|---|---|---|---|
| U1 | **Ledger in = the fold.** Replace `TicketStore` read path with the fold (reuse `~/.zuko/quality/bin/folded-count.py` logic or LC-01 `fold.mjs --emit canonical.jsonl`) from `git show <deploy-sha>:audit/fix-list/…` (main + `records/*.jsonl`); normalise status case; route non-lens ids to a CI-evidence lane. | S1, S9 | 0.5 d | LC-01 |
| U2 | **Ledger out = `records/walker.jsonl`** union-schema rows `{id, status, ts, live_sha, walker_run_id, recipe, result, evidence_path, account(alias)}`; `fix_tickets.jsonl` untouched except new walker tickets. **`--expect-sha` gate**: needs the build sha on `/health` (tiny server change to ride the combined deploy) or the Next.js build id from page HTML; mismatch → run continues dry, 0 status rows. | S2 | 1 d (+ 1 h server) | LC-03, LC-04 |
| U3 | **Run host + paths.** Restore the walker to the box from the Mac copy (box is the run host: Linux mem guard, `$DISPLAY`, secrets live there); make `audit_dir`/`runs_dir`/`evidence_dir` config-relative; add macOS `vm_stat` memory guard for Mac fallback. | S3, S5 | 0.25 d | – |
| U4 | **Accounts → the saved test accounts.** Map t1/t2/admin to `concord-zukoqa / zukoqb / zukoqadmin`; let `--secrets-file` read the existing `.env` key names (`username`, `password`) and take the expected username from that file instead of hard-coding `zuko_qa_*`; re-login after the deploy (old JWTs expired; re-check if Dutch removes JWT); `whoami` all three; never print values. | S4 | 0.25 d | LC-02 |
| U5 | **Kill false-VERIFIED.** Export: assert the file holds the lens's own rows (count > 0, matches what the lens shows, contains the own-fixture label when one exists). Contrast without hex: must walk the ticket's tab/element. Unnamed/keyboard/focus: require element match or stay NEEDS_HUMAN. Reach: must load the ticket's path, not just the lens root. Narrow the `tab_error` regex; reorder classes so validation/export words win over "error". | S6, S7 | 1 d | LC-05 |
| U6 | **Lens list + profiles from the live registry.** Generate `inventory.json` from `lens-registry.ts` at the deploy sha (266 lenses + 2 sub-paths + `global`); admin look-only set = `admin, command-center` + admin-lock lenses as merged (`debug, ops, system, sentinel`) + `psyops, repair-telemetry` (+ `audit` when Q14 answered); t1's 403/no-access words on those count as PASS. Per-lens profile files for the 17 never-walked lenses (rebuild the reasons; the Nov 13 logs are lost). | S8 | 0.5 d | LC-07 |
| U7 | **Resumable runs + results ledger.** Per-run journal (`runs/<id>/journal.jsonl`: one line per ticket/lens step, done/failed/skipped), `--resume <run-id>` that skips finished ids, crash-safe writes (fsync, temp+rename), heartbeat file, per-lens time budget, `run.lock` with stale-lock detection. One `RESULTS.md` + `results.csv` per run: id, verdict, recipe, evidence, live_sha. | S10 | 0.5 d | LC-10 |

### P1: the human-row module (≈ 6–7 days; biggest payoff first)
| # | Recipe / module | Rows it can clear | Effort |
|---|---|---:|---|
| U8 | **Fuzzy element matching** (unquoted dialog/tab/control names vs AX names, token overlap + verb hints) | ~312 no-named-element + many keyboard rows | 0.75 d |
| U9 | **Form-fuzz validation recipe** (values parsed from ticket text; network assertion that nothing was created; own-label cleanup) | 264 + 53 write | 1 d |
| U10 | **Write mode at scale**: `--allow-write` own-fixture lane for delete-confirm / persistence / hotkey / missing-CRUD on non-write-skip lenses; t2-only WRITE-OWN profiles for shared lenses | 401 + 101 | 1 d |
| U11 | **Cross-account A/B + socket probe** (t1 creates, t2 + signed-out probe UI and API; websocket frames via CDP; covers LC-11 DM/export/room-join checks) | 55 + 10 + Track B live checks | 1 d |
| U12 | **Evidence + vision judge**: before/after screenshot pairs on every verdict, network excerpt JSON (no foreign body bytes), LLM-vision verdict with confidence for visual/layout/390/canvas rows; 10% spot-check sampler | 143 + 48 + part of 44 | 1 d |
| U13 | **Interaction asserts**: dead-click (request fired + AX diff), computed-value oracle, reload read-back, upload via `DOM.setFileInputFiles` | 42 + 68 + 44 + 24 | 1 d |
| U14 | **Media probes**: canvas/WebGL pixel probes; WebAudio CDP domain + box PulseAudio/ffmpeg RMS capture; exported-audio ffprobe | 46 + 44 | 1 d |
| U15 | **Hidden-text / test-data scanner** + the six prod-row recipes | 13 + 6 | 0.5 d |
| U16 | **LLM-output recipe** with send budget (≤ 20/lens, ≤ 5 generations on psyops/detective per Q15) | 90 | 0.5 d |

### P2: human pass tooling + polish (≈ 1.5 days)
| # | Change | Effort |
|---|---|---|
| U17 | **Human review page**: one local HTML page per category: ticket expected, screenshot pair, machine draft verdict, one-key VERIFIED / REOPENED / can't-repro; writes `records/human.jsonl` in the union schema. Turns ~2 min/row into ~15 s/row. | 1 d |
| U18 | README rewrite (Mac source of truth, box run host, new accounts, new modes), plans index line fix, selftest grows to cover every new recipe. | 0.5 d |

**Total ≈ 12 builder-days** (P0 ≈ 4, P1 ≈ 6.5, P2 ≈ 1.5). With 3 Muse seats in parallel after U1–U3, ≈ 4–5 calendar days, which fits inside the mega plan's "≈5 days to the combined deploy" window if started now. P0 alone makes the first post-deploy run safe; P1 is what shrinks the human pile.

## 6. Safe-mode rules (carry forward + new)
- Keep **no page JS**; every new probe above uses CDP domains, screenshots or `context.request`. Selftest grep stays green.
- Click deny list + admin deny list unchanged; add: `transfer, withdraw, payout, mint, stake, tip, gift, donate, subscribe, checkout, buy, purchase, pay` everywhere (payments untouched).
- Writes only with `--allow-write`, one labelled fixture per lens (`qa-walker-<slug>-<date>-<id>`), delete by label only, once; never on write-skip or admin lenses; abort if the form says public/feed/global.
- `/api/auth/me` guard before every lens, write and delete; abort on wrong user/role or forbidden role.
- **No prod account creation, no signup forms, no prod config change.** The walker only signs in to the three existing test accounts.
- **Sha gate**: no status rows unless live sha == `--expect-sha`.
- LLM budgets: ≤ 20 chat sends per lens, ≤ 5 generations on psyops/detective; vision-judge calls counted and capped per run.
- Evidence stays **off the public repo** (screenshots can show user-visible data); records carry box paths only, unless Dutch says otherwise.
- No bridge posts or agent messages from the walker; the desk posts the summary when Dutch asks.
- One walker at a time; memory guard on (Linux `/proc/meminfo`, macOS `vm_stat`).

## 7. Trivial staleness fixes (listed, NOT applied)
1. README "Setup" and "Accounts": replace `/workspace/concord-live-audit/walker` + `zuko_qa_*` / `walker-zuko_qa_*.txt` with the real run host and the saved test-account files.
2. `config.json`: `accounts.*.username` + `secrets_file` → the saved accounts; `admin_lenses` += `command-center`, `debug`, `sentinel` (after the admin lock merges).
3. `config.json`: `audit_dir` → wherever the fold output is written (U1/U3).
4. `util.mem_available_mb`: macOS branch.
5. `~/.zuko/plans/README.md` walker line: "the box copy is gone; Mac copy is the only copy".

## 8. Open questions for Dutch (defaults in brackets)
1. Run host for the live pass: box or Mac? [box]
2. `--allow-write` scope: own fixtures on every non-write-skip lens? [yes]
3. Vision judge model + budget for ~300 screenshot verdicts? [cheapest vision-capable model available, cap per run]
4. Who does the ≈250 partial + ≈240 human rows: Dutch, testers, or a computer-use agent on the test accounts? [desk + computer-use agent, Dutch spot-checks]
5. OK to add the build sha to `/health` so the sha gate works? [yes, rides the combined deploy]
