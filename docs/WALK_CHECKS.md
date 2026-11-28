# Walk checks and ticket ingest

Two tools for the live walks, in `scripts/walk/`:

- **Check specs**: one fixed way to write "what I checked and what I expected",
  and a runner that does that check on the live site. Builders write NEEDS_HUMAN
  checks this way, and a folder of specs is a walk the machine can repeat (walker v4).
- **Ingest**: turns a walk's raw results into clean builder tickets, grouped by
  lens, root cause and triage wave, with duplicates folded and the evidence attached.

Both read and write the formats already in `audit/fix-list/`.

## Check specs

A spec is one JSON file. The format is defined and enforced in
`scripts/walk/check-spec.mjs`: an unknown key is refused, never ignored, so a typo
can't turn a check into a pass.

```json
{
  "id": "CS-calendar-ics-export",
  "lens": "calendar",
  "ticket": "FIX-calendar-010",
  "why": "Export makes a real .ics with the event at 2 PM ET",
  "path": "/lenses/calendar",
  "account": "member",
  "viewport": "desktop",
  "steps": [
    { "do": "click", "target": { "role": "button", "name": "Export" } }
  ],
  "expect": [
    { "download": { "ext": ".ics", "contains": "DTSTART:20421112T190000Z" } },
    { "noConsoleErrors": {} }
  ]
}
```

- **Targets** are what a person or a screen reader sees, never CSS:
  - `{ role, name }`
  - `{ label }`
  - `{ text }`
  - `{ testId }`

  Add `nth` when the same target appears more than once, and `"match": "contains"` for a partial name.
- **Steps:** `goto`, `click`, `fill`, `select`, `press`, `wait`, `scroll`.
- **Expectations:**

  | Expectation | What it checks |
  |---|---|
  | `visible` / `hidden` | the target is or isn't on screen; `visible` also needs it uncovered (it waits for a splash to clear, and names a cover that stays: a sticky bar, a floating button). It's a hit test, so a see-through overlay that ignores the pointer isn't caught |
  | `text` | the target's text: `equals`, `contains` or `matches` |
  | `count` | how many match: `eq`, `min` or `max` |
  | `url` | the address matches a regex |
  | `download` | a download started, with an extension and optional text |
  | `focusInside` | keyboard focus is inside the target (dialogs trap focus) |
  | `noHorizontalScroll` | nothing is wider than the viewport (the 390px rule) |
  | `contrast` | the target's text contrast is at least `min` (WCAG: 4.5 for body text, 3 for large text) |
  | `noConsoleErrors` | no console error and no uncaught exception during the run |
  | `status` | a path's real HTTP status |
- **Accounts** are `anon`, `member`, `member2` or `admin`. The credentials come only from the environment, never from a spec:
  - `CONCORD_WALK_MEMBER_USER` / `CONCORD_WALK_MEMBER_PASS` (and `MEMBER2`, `ADMIN`)
  - A spec whose account has no credentials is ERROR, not a pass.
- **Login:** the runner sends `email` when the account is an address, `username` otherwise (the login route checks `email` is an address). If the site turns away automated browsers, set `CONCORD_WALK_UA`; it's your own site.
- **Viewports** are `desktop` (1280×800) or `mobile` (390×844).

Run one spec, or a folder of them:

```
node scripts/walk/run-check.mjs specs/CS-calendar-ics-export.json --base https://concord-os.org \
  --out audit/walk/check-results.jsonl --shots audit/walk/shots
```

- **Result:** each spec gives one `check_result` line, with the verdict, every step, every expectation and its detail (for example `600px page in a 390px viewport; wider: div[data-testid=wide]`, or `1.42:1 (rgb(221, 221, 221) on rgb(255, 255, 255))`), the console errors and a screenshot.
- **Exit code:** 0 if all pass, 1 if any FAIL, 2 if any ERROR or invalid spec.
- **A step that can't be done is a FAIL**, with the step named; the person could not do it either.
- **Browser version:** if the project's Playwright doesn't match the installed browsers, set `CONCORD_WALK_CHROMIUM` to a Chromium binary.

Specs click and type, so point them at fixture accounts and fixture data, the same rule the human walks follow.

## Ingest (tonight's walk → tickets)

On the machine with the walk results:

```
node scripts/walk/ingest.mjs <walk result files or folders> \
  --existing audit/fix-list/fix_tickets.jsonl \
  --triage docs/LENS_REDESIGN_TRIAGE.md \
  --out audit/walk/ingest-2026-11-28 --date 2026-11-28
```

**What it reads:** every JSONL line the walker writes, in both formats.

Tonight's walker (v3) writes either a merged export, where each line is `{ "_file": "<file>.jsonl", "_run": "<run id>", "row": {…} }`, or its files separately. The ingest reads each line by its shape, so either works. Pass the export file or the run folders.

| Walker file | Becomes |
|---|---|
| `findings.jsonl` | ticket rows. The walker's `check` sets the root cause: escape → focus trap, `fab_overlap` → mobile FAB, `http` → server error on load, contrast, export. |
| `ledger.jsonl` | re-verifications of existing tickets. FIXED goes to `verified.jsonl` for a glance, then VERIFIED. STILL_FAILING on a ticket marked fixed means the fix didn't hold; on an open ticket it's seen again. NEEDS_HUMAN goes to a person. |
| `needs_tester.jsonl` | a person, with a check-spec draft |
| `dedup.jsonl` | a sighting of the ticket it names |
| `fixtures.jsonl` | `fixtures-to-clean.jsonl` (anything not deleted) |

The November formats are still read:
- ticket rows (`fix_tickets.jsonl` shape)
- per-lens result records with a `cases` map (`lens` or the older `slug`)
- `check_result` lines from the runner

**What it writes**, into `--out`:

| File | What's in it |
|---|---|
| `tickets.jsonl` | new tickets in the `fix_tickets.jsonl` shape, status OPEN, numbered after the existing log's highest id for each lens; ready to append |
| `seen-again.jsonl` | findings that match a ticket already in the log: an occurrence, not a new ticket |
| `reopen.jsonl` | findings that match a ticket marked fixed and were seen **after** the fix's timestamp: the fix didn't hold. Earlier sightings go to `seen-again` with a note. |
| `needs-human.jsonl` | NEEDS_HUMAN or BLOCKED cases, failures with no detail and check ERRORs, each with a check-spec draft to complete |
| `TICKETS.md` | everything above, grouped by triage wave → lens → root cause, with the evidence |
| `verified.jsonl` | tickets the walker re-ran and found fixed |
| `walker-review.jsonl` | findings matching a reviewed walker false positive (below): kept with every lens and its evidence, never ticketed |
| `fixtures-to-clean.jsonl` | fixtures the walk left behind |
| `unreadable.jsonl` | lines that weren't JSON, or findings with no lens |

**How it decides.** Each decision is written on the ticket, so a builder can see why.
- **Folding:** duplicates fold when the lens matches and the title and actual behaviour say the same thing (word overlap of at least 0.6). A walker's terse case note also matches an existing ticket when at least half its words are in that ticket, or when it names the ticket's id. The fold keeps every occurrence and all its evidence, and the worst severity reported.
- **Root cause:**
  1. the walker's own `root_cause_group`;
  2. otherwise a named rule for the families the November audit found (escape and focus trap, form hotkeys, export that does nothing, contrast, mobile clipping, delete without confirm or control, a silent assistant, lost saves);
  3. otherwise the nearest already-labelled ticket;
  4. otherwise `unclassified`. It never guesses.

  `root_cause_basis` says which applied.
- **Triage wave and family:** from `docs/LENS_REDESIGN_TRIAGE.md`. A lens the triage doesn't list is unassigned.

- **Shared code:** the same walker check on the same control across lenses, or a server error on the same endpoint, is one bug in shared code. It becomes one `FIX-shared-NNN` ticket that lists `affected_lenses`.
- **The walker's own verdicts get checked:**
  - a FIXED whose only steps opened the lens hasn't tested the ticket, so it goes to a person;
  - a STILL_FAILING whose own overflow measurement was clean contradicts itself, so it goes to a person rather than being reopened.
- **Reviewed walker false positives** (`KNOWN_WALKER_FALSE_POSITIVES` in `ingest.mjs`; each entry says why, with the code). The first one: Escape not closing "Expand … sub-lenses". That control is the shared left bar's inline expand/collapse toggle (`components/shell/Sidebar.tsx`, a button with `aria-expanded`), not an overlay, and WAI-ARIA gives a disclosure no Escape behaviour. The fix belongs in the walker's escape check (skip `aria-expanded` disclosures that don't open a dialog, menu or popover).

The same inputs always give the same ids and the same files.

**Checked on the 2026-11-27 walk sample** (65 lines, 2 shards):
- 2 new tickets.
- 10 Escape findings on 10 lenses set aside as the sidebar false positive.
- 7 fixes confirmed; 1 "fixed" sent to a person because its only step opened the lens.
- 9 fixes that didn't hold.
- 10 sightings of tickets already open.
- 22 items for a person, including one walker verdict that contradicts its own measurement.
- 2 fixtures left to clean.

**Checked on real data:**
- **The November ticket log against itself** (2,496 ticket rows): **0 new tickets.** Every row matches its own ticket.
- **The November `findings.jsonl` against the log:** 3 new tickets. 23 matched existing tickets, all seen before their fixes, so none counts as a fix that didn't hold. 22 cases need a person.
