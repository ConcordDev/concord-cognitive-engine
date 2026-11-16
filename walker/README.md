# Concord ultimate lens walker

Automated walker for the Concord live lens audit. It walks every lens in `inventory.json`, runs the
standard checks, saves screenshot evidence, files tickets in the exact `fix_tickets.jsonl` format (deduped
against what's already there), cleans up its own fixtures, and re-verifies tickets by ID.

**Status (2026-11-13):** built and self-tested. Per Dutch's sequence, **do not run a sweep or re-verify
against the live site until the builders finish their fixes.** The only live run so far was a signed-out,
read-only, dry-run smoke on `deities` and `chat`.

**Copies (WALK-02, 2026-11-14):** this tree (on the Mac, `~/.zuko/walker/`) is the **source of truth**.
The old box copy is **gone** — live runs execute from the box, restored from this source of truth by
Zuko 2, who also owns the test-account sign-ins. Paths in `config.json` are relative to the walker
dir, so the tree runs from wherever it is checked out.

## Layout
```
walker/
  walker.py              CLI (sweep | lens | reverify | login | whoami)
  config.json            base URL, accounts, admin lenses, write-skip lenses, thresholds
  concord_walker/
    checks.py            per-lens standard checks (LensWalk)
    reverify.py          re-verify mode, FIX-007 and FIX-deities-002 recipes, generic classifier
    tickets.py           fix_tickets.jsonl load / dedupe / id assignment / locked append
    records.py           run outputs, needs-tester queue, fixtures, LEFTOVER_FIXTURES.md
    auth.py              sessions + /api/auth/me guard
    cdp.py               DevTools-protocol reads (Accessibility tree, DOMSnapshot, box model, metrics)
    colors.py            CSS colour parsing (rgb/hsl/oklch/oklab/lab/lch/color()) + WCAG ratio
    safety.py            click allow/deny policy
  selftest/              local fake lens with deliberate bugs + run_selftest.py
  inventory.json         the lens list, generated from concord-frontend/lib/lens-registry.ts
                         (tools/generate_inventory.py); a copy in the audit dir overrides it
  tools/                 generate_inventory.py
  secrets/               saved test-account .env files (0600, gitignored); never commit or print
  auth/                  saved sessions (0600, gitignored); never commit or print
  audit/                 the audit dir (config-relative): fix_tickets.jsonl, evidence/, reports/
  runs/<run-id>/         walker.log, lens-<slug>.json, findings.jsonl, new_tickets.jsonl, dedup.jsonl,
                         needs_tester.jsonl, fixtures.jsonl, SUMMARY.md / REVERIFY.md, LEFTOVERS.md
  queue/needs_tester.jsonl   cumulative judgment queue (also mirrored to audit/reports/NEEDS_TESTER_QUEUE.md)
```
Evidence for real (non-dry) runs goes to `audit/evidence/<slug>/walker-<run-id>/` (or the configured
`evidence_dir`). Dry runs keep their screenshots in `runs/<run-id>/evidence/`.

## Setup (on the run host — the box; the Mac copy is the source of truth)
```
cd <walker checkout>
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
```
It uses the system Google Chrome (`channel="chrome"`), headless, so there's no Playwright browser download.

## Accounts and sign-in (required before any authenticated run)
The saved test accounts (names only — the credentials live in the 0600 `.env` files, owned by Zuko 2):
| key | account file | used for |
|---|---|---|
| `t1` | `secrets/concord-zukoqa.env` | the walker account: every lens except the admin lenses |
| `t2` | `secrets/concord-zukoqb.env` | cross-account checks only, always in its **own isolated context** (incognito equivalent) |
| `admin` | `secrets/concord-zukoqadmin.env` | **only** the admin look-only set — admin, command-center, debug, ops, system, sentinel, psyops, repair-telemetry — with `--admin`, forced look-only |

The config names each account (`concord-zukoqa`, `zukoqb`, `zukoqadmin`); the **expected username** for
the `/api/auth/me` guard is taken from the account's `.env` file (`username=` line) whenever that file is
present — the real usernames live only in those files. A username mismatch aborts the run.

The walker can't read vault passwords. It gets a session in one of two ways:
1. **Headed login (preferred):** `.venv/bin/python walker.py login --account t1 --headed`
   This opens a visible Chrome at `/login` on `$DISPLAY`. A human, or a computer-use agent, signs in with
   the account's **username** (the email form returns "Invalid credentials"). The walker polls
   `/api/auth/me`, refuses to save if the username differs from the expected one, and writes
   `auth/t1.json` (0600). Add `--login-timeout N` (default 600) to cap the session wait.
2. **Secrets file:** with the account's 0600 `.env` file in place at the path in `config.json`
   (`secrets/concord-zukoqa.env` with `username=` and `password=` lines), run
   `walker.py login --account t1 --secrets-file [--login-timeout N]`. The values are typed, never printed or logged.
   The walker waits (up to 30s) for the splash to clear before typing, retries an empty username once,
   and falls back to clicking Sign In if Enter is swallowed.

It never copies cookies from the shared tester browser profile. Its sessions are its own logins. After each
lens it writes rotated cookies back to `auth/<acct>.json`, but only while auth/me still shows the right account.
Check a session with `walker.py whoami --account t1`.

## Modes
```
# one lens, read-only (default)
.venv/bin/python walker.py lens deities
# one lens, also create + delete ONE own labelled fixture (checks the delete confirm)
.venv/bin/python walker.py lens notes --allow-write
# full sweep of every lens in inventory.json (270 at the 2026-11-14 registry; resume with
# --start-from <slug>, subset with --only a,b,c / --category X / --limit N)
.venv/bin/python walker.py sweep
.venv/bin/python walker.py sweep --start-from music
# include the admin lenses on the admin account (look-only); without --admin they get a gate check
# as t1 — a held gate (403, no-access page, or login redirect) is a PASS, not a failure
.venv/bin/python walker.py sweep --admin
# don't touch shared audit files (no tickets, queue or leftovers written)
.venv/bin/python walker.py sweep --only chat,board --dry-run
# signed-out smoke (implies --dry-run)
.venv/bin/python walker.py sweep --only deities,chat --no-auth
# limit phases
.venv/bin/python walker.py lens studio --phases reach,contrast,mobile

# re-verify tickets by ID (also runs a read-only nearby smoke of each lens)
.venv/bin/python walker.py reverify FIX-007 FIX-deities-002
# --apply-status REQUIRES --expect-sha <git sha>: rows are written only if /health's buildSha matches it
# (a Next.js build id never counts); any gate failure runs dry with 0 rows
.venv/bin/python walker.py reverify --from-status FIXED_PENDING_VERIFY --apply-status --expect-sha <git-sha>
.venv/bin/python walker.py reverify FIX-007 --allow-write     # lets FIX-007 actually send its labelled message
# grade a sweep: --from-status takes a comma list; --walked-run names the sweep run dir(s);
# tickets on lenses that sweep never finished are NOT_ATTEMPTED "lens not walked this run"
.venv/bin/python walker.py reverify --from-status FIXED_PENDING_VERIFY,OPEN --walked-run <run-id> --apply-status --expect-sha <git-sha>
```
Recipe-only VERIFIED (Nov 15): only a hand-written recipe (per-ticket `r_*`/prod recipes in
`Reverifier.recipes`, the form bad-input validation recipe, the two-account privacy probe) can produce
FIXED -> VERIFIED. A FIXED from a keyword-classified standard check is capped at NEEDS_HUMAN with
"no hand-written repro recipe; keyword match only (<category>)"; a keyword STILL_FAILING still reopens.
Every in-scope FIXED_PENDING_VERIFY/OPEN ticket gets exactly one row in `reverify_coverage.json`/`.md`
(run dir always; audit dir unless dry) with attempted, verdict, coverage_basis (recipe/keyword/none)
and a never-empty reason.
Only one walker runs at a time (`run.lock`). Before each lens it waits for at least 1.5 GB of free memory
(`min_mem_available_mb`) and stops if memory stays low.

## Check list (per lens)
| check | how | ticket when |
|---|---|---|
| **reach_desktop + timing** | load at 1280x900 (dark scheme). Records DCL, load, network-idle and *visually ready* time (waits out the splash) | load error, error text or 4xx/5xx document → high. Load > 5 s low, > 10 s medium. Network never idle → judgment |
| **surface inventory** | Accessibility tree: tabs, buttons, links, inputs | buttons with no accessible name (low). Enabled buttons/tabs not keyboard-focusable (medium) |
| **every tab reachable** | clicks each safe `role=tab` (max 30). Waits for `aria-selected`, screenshots each tab, catches error text, uncaught errors and crashes | tab shows an error (medium, high if crash). Switch > 1 s (low). Never selects → judgment |
| **keyboard focus** | Tab sweep (40 presses). Compares focused and unfocused pixels for up to 12 stops | pixel-identical focus (no visible focus ring) → low |
| **Escape and focus return** | opens safe openers (Settings/Filters/More/Menu/Help/…, max 8). Checks Tab stays inside dialogs, Escape closes, focus returns to the opener | Escape doesn't close (dialog medium, menu low). Focus escapes the dialog (low). Focus doesn't return (low) |
| **export works** | clicks safe Export/Download controls, follows a format menu once, saves the file into evidence and parses JSON/CSV | no file (medium), 0-byte or unparseable file (medium). Empty dataset, "nothing to export", clipboard-only or a control missing that the human walk marked PASS → judgment |
| **delete asks for confirmation** | `--allow-write` only: auth/me → New/Create/Add → type the `qa-walker-<slug>-<date>-<id>` label (also the hotkey-steal check) → auth/me → Create → reload-verify → auth/me → Delete **once**, on the control tied to the label → native or in-app confirm? → reload | instant delete with no confirm (medium). Form closes while typing (high, RCA-form-hotkey-steal). Delete didn't remove it (medium). Ambiguous delete control → leftover + judgment |
| **390 px layout** | new context at 390x844 (mobile, touch). Page.getLayoutMetrics, full-page and viewport screenshots | page scrolls sideways (low/medium, lists the widest elements). Tabs/buttons off-screen with no scroll container (low). Renders an error (high) |
| **colour contrast** | DOMSnapshot computed colours, effective background through ancestors with alpha blending, WCAG AA 4.5:1 or 3:1 for large text. Skips disabled controls and text over images or gradients (counted as unknown) | any failing pair (low, medium if normal text < 3:1). Crops of the worst pairs as evidence. Tags `RCA-contrast-theme-tokens` when < 2:1 |
| **console / network** | page errors, console errors and same-origin 4xx/5xx across the whole walk | uncaught JS errors (medium), API 5xx (medium). 4xx are listed in the report only |

Lens JSON reports also record perf metrics (JS heap, DOM nodes, layout count), tap targets under 24 px,
and every opener and tab result. They're useful for the per-lens redesign pass.

## Tickets and dedupe
- New tickets use exactly the testers' key order: `id, lens, severity, title, repro_steps, expected,
  actual, evidence_path, suspected_area, status, tester, ts` (+ `root_cause` when an RCA applies, as 261
  existing tickets do). `tester` is `Zuko Lens Walker`, `status` is `OPEN`, `ts` looks like `2026-11-13T01:51-05:00`,
  and IDs are the next `FIX-<slug>-NNN`.
- Dedupe (same lens): title similarity ≥ 0.72. Element findings (a named tab, dialog or control) are dupes
  only when the category keywords and the element name both appear in the existing ticket. Lens-level
  findings (contrast, 390 overflow, unnamed buttons, delete confirm…) are dupes when the category hits the
  existing title. Dupes go to `runs/<id>/dedup.jsonl`. A dupe of a VERIFIED ticket goes to the judgment queue as a possible regression.
- Appends take a file lock and write a backup first (`fix_tickets.jsonl.bak-walker-<run>-<ts>`).
- Ticket text is built only from templates, control labels (long labels are replaced with
  `[long-label control]`), colours, sizes and timings. It **never** copies page body text, record content or
  hidden text. Error messages are scrubbed and truncated.
- Every finding must carry at least one screenshot. If the capture fails, the finding goes to the judgment queue instead.

## Re-verify mode
For each ticket ID:
1. **Recipe**, if registered:
   - `FIX-007` (chat composer at 390x844): auth/me, focus the composer, type, check the value is set and
     Send is enabled, and time it. Read-only it clears the text and returns **NEEDS_HUMAN** ("fill/click
     timeout not reproduced; send not exercised"). With `--allow-write` it sends one labelled message and
     waits for it in the transcript (FIXED / STILL_FAILING), then logs the thread as a leftover.
   - `FIX-deities-002` (390 reload crash): 10 cold mobile contexts × load + reload, watching for renderer
     crashes. Any crash → STILL_FAILING. None → FIXED, with "not reproduced in 10 tries".
2. **Otherwise it classifies the ticket** (title first) into a standard check (crash, hotkey, delete confirm,
   Escape/focus, export, contrast, 390 overflow, labels/keyboard, timing, tab error, reach,
   console/HTTP, persistence). It runs the lens walk and decides only when the evidence is
   unambiguous. For example, the ticket's named dialog must be among the walked openers, and contrast
   tickets that name hex colours are matched pair by pair.
3. Anything else (free-text repro, named element not found, visual layout, write needed but not allowed) →
   **NEEDS_HUMAN**, with screenshots in the queue.
4. A nearby smoke (full read-only walk of the same lens) is always attached, and new smoke findings are filed (deduped).

`--apply-status` (which requires `--expect-sha`, a hex git sha that must match `/health` `buildSha`; the HTML Next build id is logged as `frontend_build` but never satisfies the gate) appends `retest_update` records in the existing format:
- STILL_FAILING → `REOPENED` if the ticket was FIXED_PENDING_VERIFY or VERIFIED, else `OPEN` ("still reproduces").
- FIXED → `VERIFIED` **only** if a builder marked the ticket FIXED_PENDING_VERIFY. Otherwise it goes to the queue ("no longer reproduces; close?").
- NEEDS_HUMAN → no status change, queue only.

## Needs tester / Zuko queue
`queue/needs_tester.jsonl` plus `audit/reports/NEEDS_TESTER_QUEUE.md`. Kinds include `timing`,
`tab_selection`, `export_empty`, `export_nothing`, `export_clipboard`, `export_missing`, `instant_create`,
`create_unverified`, `delete_ambiguous`, `possible_regression`, `reverify`, `fixed_not_claimed`.

## Safety model (hard rules baked in)
- **No page JavaScript at all.** It doesn't use `evaluate`, `locator`, init scripts or bindings (the self-test
  greps the package and fails if any appear). DOM reads use DevTools-protocol domains only
  (Accessibility.getFullAXTree, DOMSnapshot.captureSnapshot, DOM.getBoxModel/scrollIntoViewIfNeeded/focus,
  Page.getLayoutMetrics, Performance.getMetrics). Clicks and keys are native input at element coordinates.
- **Click policy (`safety.py`):** read-only mode clicks only tabs and opener controls. A deny list covers
  restore, rollback, revert, reset, replay, undo, publish, share, send, post, approve, vote, mint, deploy, run,
  trigger, page, alert, notify, pay, buy, import, sync, archive, clear, delete, save, submit, create, global,
  public and more. Admin lenses also deny page/trigger/ingest/alert/notify/escalate/test/incident/toggle/etc.
  and skip export.
- **Writes only with `--allow-write`.** Never on admin lenses or the `write_skip_lenses` list (social and
  shared surfaces, money, sync, vault, privacy…). It aborts if the create form mentions public, feed or global
  visibility. It writes exactly one labelled fixture and deletes by label, never by position. Delete is clicked
  once.
- **`/api/auth/me` guard** before every lens, create (open and submit), delete and delete-confirm. It aborts
  the whole run if the session isn't the expected username or role, or the role is owner, founder or sovereign.
- The `t2` and `admin` accounts always get their own browser contexts. It never signs anything into the shared tester profile.
- Leftovers (anything not verified deleted) go to `runs/<id>/LEFTOVERS.md` and `audit/reports/LEFTOVER_FIXTURES.md`.
- No repo, DB, server, Mac or tmux access. It's a pure browser client of https://concord-os.org.

## Wave 0: premap, endpoint ledger, registry diff, run diff, packets

- `sweep --premap` writes lens record schema v2 (`SCHEMA-LENS-V2.md`). Each record carries a per-control endpoint ledger, stable control ids, per-control errors, slow calls and freezes, `fake_success` read-back, failure-only screenshots, and the backend build stamp on every row.
- `--two-account` (opt-in) runs the t2 ownership replay.
- `--resume <run>` skips lenses already walked; `--auto-resume N` relaunches a crashed browser; `--expect-sha` flags a mismatch.
- The walker prints `WALK ABORTED … walked N/M` and exits 3 when a walk aborts.
- Tools:
  - `tools/action_registry.py`: registry snapshot.
  - `tools/unused_actions.py`: observed vs registered, false-positive safe.
  - `tools/run_diff.py`: run-to-run progress.
  - `tools/pack.py`: builder packets.
- Full usage and the packet format are in `premap/README.md`. The problems Wave 0 fixed are logged in `docs/WALKER-ISSUES.md`.

## Self-test (offline, no live site)
```
.venv/bin/python selftest/run_selftest.py
```
This starts a local fake lens with deliberate bugs (error tab, slow tab, Escape-proof dialog, focus leak,
unnamed and unfocusable buttons, low contrast, 390 overflow, no-confirm delete, chat composer). It asserts
that every check fires, findings carry existing screenshots, ticket keys match, contrast dedupes against an
existing ticket, the fixture is deleted, re-verify gives STILL_FAILING/FIXED correctly for two Escape
tickets, FIX-deities-002 → FIXED, FIX-007 → NEEDS_HUMAN read-only and FIXED with `--allow-write` (leftover
logged), and there are no page-JS calls. All output goes to a temp dir. Last result: **PASS**.


## Replay of the original lens-walk tickets (replay-original-tickets)

A live `sweep` / `lens` run now sits ON TOP of the original tickets: after the general checks for a
lens, every OPEN / FIXED_PENDING_VERIFY ticket for that lens is replayed on the same walk (no second walk).

    walker.py sweep --from-repo <checkout> --deploy-sha <sha> --expect-sha <sha> [--allow-write ...]

* `--from-repo` + `--deploy-sha` are REQUIRED (the fold is read at that pinned sha, same as `reverify`).
  `--no-replay` opts out explicitly and is logged loudly; `--no-auth` smokes cannot replay.
* Verdict rows go to `records/walker.jsonl` only, and only when `--expect-sha` equals `/health`'s buildSha;
  otherwise the run is dry for the ledger (verdicts still land in the run dir).
* `repro_steps` (the testers' own prose steps) are executed by `concord_walker/repro.py`. A ticket verifies on basis
  `repro-steps` only if every step mapped AND executed AND the `expected` outcome was machine-checked; otherwise
  NEEDS_HUMAN naming the first unmapped step / unchecked clause. STILL_FAILING from any path stands.
* Nothing is VERIFIED without a walker replay row on a sha-gated build: `ledger.assert_verifiable` is the single gate
  (run id, hex live sha == expect sha, allowed basis, non-empty evidence). The fold reads an unbacked VERIFIED
  (any file, no matching gate-shaped `walker.jsonl` row) as FIXED_PENDING_VERIFY.
* Every in-scope ticket gets exactly one row, with a reason, in `reverify_coverage.json/.md`; each lens record
  (`lens-<slug>.json`) carries a `replay` block (counts + ids by verdict).
