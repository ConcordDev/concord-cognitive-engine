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
  | `visible` / `hidden` | the target is or isn't on screen |
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

**What it reads:** every JSONL line the walker writes.
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

The same inputs always give the same ids and the same files.

**Checked on real data:**
- **The November ticket log against itself** (2,496 ticket rows): **0 new tickets.** Every row matches its own ticket.
- **The November `findings.jsonl` against the log:** 3 new tickets. 23 matched existing tickets, all seen before their fixes, so none counts as a fix that didn't hold. 22 cases need a person.
