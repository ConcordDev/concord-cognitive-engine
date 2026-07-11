# Detective lens — capability map (backfill, 2026-07-11)

## What this lens actually is

An in-world detective/investigation minigame — a case browser + evidence
corkboard + a real deduction lock-in — over the `detective` domain
(`server/domains/detective.js`, 120 LOC, a thin delegator; the real logic
lives in `server/lib/detective.js`, 163 LOC). 6 macros: `list`, `get`,
`evidence`, `deduce`, `create` (alias of `deduce`), `mine`.

This lens was rebuilt in an earlier wave of the Frontend Rebuild Program
(commit `96b3d52f`, "feat(detective): rebuild as bespoke case-browser +
evidence-board app", Phase 3 Wave 1, 2026-07-09) — before the
`docs/lens-specs/*-capability-map.md` doc convention existed. This doc
backfills that gap against the current code.

**Frontend:**
- `concord-frontend/app/lenses/detective/page.tsx` — 426 LOC. Two-tab
  layout (Open cases / My case file), a left-rail case browser, center
  dossier with 4 stat tiles + a two-column Evidence/Deduction grid.
  Keyboard commands (`r`, `1`, `2`) via `useLensCommand`.
- `concord-frontend/components/detective/EvidenceBoard.tsx` (158 LOC) —
  the evidence corkboard: an icon per evidence type, a live decay
  countdown recomputed every second from the real `decay_at` epoch (not a
  fake progress animation), and a "Name as suspect" chip that fills the
  deduction form.
- `concord-frontend/components/detective/DeductionPanel.tsx` (197 LOC) —
  the lock-in form (suspect/weapon/motive inputs + submit), real
  dispatch/running/done/error states via `useMacroDispatchFeedback`,
  renders the three real reasons (`suspect_match`/`weapon_match`/
  `motive_offered`) the backend actually credited, ⌘/Ctrl+Enter shortcut.
- `concord-frontend/components/detective/CaseFileHistory.tsx` (133 LOC) —
  a `DataTable` of the player's own solved-case records, verdict badge,
  facts count, click-to-reopen a past case.

**Backend macro registrations** (`server/domains/detective.js`):
`detective.list` (:51), `detective.get` (:66), `detective.evidence` (:79,
marked SUPERSEDED in the file's own header comment — `get` already returns
evidence in one round-trip), `detective.deduce` (:106, "lock in a
deduction — 2-of-3 + suspect_match solves"), `detective.create` (:107,
literal alias of `deduce` — same function reference, the manifest's
generic-verb convention), `detective.mine` (:113).

## Findings — verify pass, one doc-drift correction

**Lock-in mechanic — verified live and matches the CLAUDE.md invariant
exactly.** `server/lib/detective.js`'s `lockInDeduction`:

```js
if (crime.criminal_id && suspectId === crime.criminal_id) { correctCount++; reasons.push("suspect_match"); }
if (weapon && weapon === crime.crime_type) { correctCount++; reasons.push("weapon_match"); }
if (motive && String(motive).length > 0) { correctCount++; reasons.push("motive_offered"); }
...
const solved = correctCount >= 2 && reasons.includes("suspect_match");
```

`DeductionPanel.tsx` lets the player fill suspect (from the evidence
board's "Name as suspect" chip), weapon (a datalist of crime-type hints),
and motive (free text), then submits via `detective.deduce`. Pure
weapon+motive without a named suspect cannot solve the case, matching the
documented invariant.

**Doc-drift correction found: the CLAUDE.md invariant's "persists into
`arrest_records`" claim is stale.** Current code inserts solved/unsolved
attempts into `trial_records`, not `arrest_records`. `server/migrations/
300_trial_records.js` explains why: `trial_records` was split off because
the older bounty-tracking `arrest_records` table (migration 065) lacked
the columns this feature needs (charges/evidence_summary/verdict/sentence)
and writes to it were throwing. `arrest_records` still exists but is used
by `server/lib/world-crime.js` for a distinct concept — NPC bounty/warrant
tracking. **This is a stale line in CLAUDE.md's invariants section, not a
defect in the lens** — flagging it here for a future doc-fix pass; no code
was changed as part of this documentation-only task.

**Wiring cross-check**: frontend calls `detective.list`, `detective.get`
(×2 call sites), `detective.mine`, `detective.deduce` — 4 of 6 macros
actively called. `detective.evidence` and `detective.create` have zero
direct callers, both intentionally (documented redundancy / generic-verb
alias), not genuine gaps.

**Fabricated data**: none. `Math.random()`/`mock`/`fake` greps only hit
comments explicitly disclaiming fakery (e.g. "not a fake spinner timer")
and legitimate `placeholder="..."` input-hint attributes.
`crypto.randomBytes` is used only for a real deduction-attempt id, not
display data.

**Generic-scaffold check**: clean — bespoke `EvidenceBoard`/
`DeductionPanel`/`CaseFileHistory`, no generic-trio scaffold. The page's
own header comment notes the earlier generic `ManifestActionBar` strip was
retired in favor of the real UI.

**Historical-claim verification**: confirmed by commit `96b3d52f`
(2026-07-09) — 975 insertions across `page.tsx` + 3 new components. Prior
commits `ea096f47` (polish pass) and `96ae9f5a` (fake-success-path fixes)
touched the lens earlier but weren't the rebuild itself.

**Overall verdict**: fully wired, no defect. Case browser + evidence board
are real and bespoke; lock-in is genuinely 2-of-3 + suspect-match as
documented; no fabricated data; test coverage is solid at both the lib and
macro layers. The only correction is the persistence table name in
CLAUDE.md's invariant text (`trial_records`, not `arrest_records`).

## Verification (run directly, 2026-07-11)

- `grep -n "registerLensAction(\"detective\"\|register(\"detective\"" server/domains/detective.js server/server.js` — 6 macros registered at `server/domains/detective.js:51,66,79,106,107,113`; none registered inline in `server.js`.
- `wc -l server/domains/detective.js server/lib/detective.js` — 120 + 163 = 283 total.
- Backend tests found: `server/tests/detective.test.js` (111 LOC, lib-level: `listOpenCrimes`, `listEvidenceForCrime`, `lockInDeduction` incl. exact 2-of-3+suspect_match assertions, closed-case rejection, per-user history), `server/tests/detective-domain-macros.test.js` (187 LOC, macro-level: culprit-non-leak, 1/3 no-solve, 2/3-without-suspect no-solve, 2/3-with-suspect solves + verdict persisted, closed-case rejection, `create`≡`deduce` alias). Frontend: `concord-frontend/tests/detective-lens-states.test.tsx`.
- `node --test server/tests/detective.test.js server/tests/detective-domain-macros.test.js` — **all passing**.
- `node scripts/verify-lens-backends.mjs` — `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260, unchanged (documentation-only pass, no code touched).
- `node scripts/grade-ux-polish.mjs --honest` then inspected `audit/ux-polish-honest.json` for the `detective` entry — `tier:"polished"`, `isGenericScaffold:false`. `audit/` reverted afterward (`git checkout -- audit/`).
