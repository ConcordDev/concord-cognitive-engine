# Expedition Journal Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

## Backend surface

```
grep -c 'registerLensAction("expedition-journal"' server/domains/expedition-journal.js
```
→ **11** macros, all real, all server-side-persisted (per-user `Map`s under
`globalThis._concordSTATE.expeditionJournalLens`, same durable-in-process
pattern as `agriculture.js`): `worlds`, `progress`, `mark-stage`, `entry-add`,
`entry-list`, `entry-delete`, `photo-add`, `photo-list`, `photo-delete`,
`rewards`, `summary`. `server/domains/expedition-journal.js` is 504 lines.

The file's own header comment documents a prior wiring fix (not part of this
pass — verified already landed): the domain used to register through the
legacy `registerLensAction` convention but was **never imported by
`server.js`**, so every call hit `unknown_macro`. It's now wired through the
canonical `register`/`MACROS` registry via
`registerExpeditionJournalActions(register)`, reachable both through
`POST /api/lens/run` and through `runMacro` (confirmed live —
`node scripts/lens-unsurfaced.mjs --lens expedition-journal` →
`0/11 macros never referenced in the frontend`, and the domain's own test
suite passes, see Verification below).

Two other domain files matched a loose `expedition` grep and were checked and
ruled unrelated: `server/domains/desert.js` (desert-biome survival lens, no
expedition-journal overlap) and `server/domains/_recent-mine-bulk.js` /
`server/domains/index.js` (registry plumbing, not lens logic). Neither is
touched by this pass.

**Dead code found, left in place (documentation-only note, not fixed):**
`badNumericField` (`expedition-journal.js:42-49`) is defined and its header
comment claims it's "wired defensively," but no macro in the file actually
calls it — every numeric-adjacent field the domain accepts (`worldId`,
`stageId`, `text`, `dataUrl`, `caption`, `mood`) is coerced via `String()`
before use, so there is genuinely no numeric write path for it to guard
(confirmed: `grep -n badNumericField server/domains/expedition-journal.js` →
only the definition + its own doc comment, zero call sites). This is inert,
not exploitable, and not a fabrication — the comment overstates a defense
that isn't needed yet, nothing more. Left as-is; out of scope for a
frontend-focused pass and `eslint` raises no unused-declaration warning on
it (`cd server && npx eslint domains/expedition-journal.js` → clean).

## Reference apps

- **Expedition/summit tracker**: Strava's "Adventures"/segment-completion
  UX + AllTrails' trip-log — per-objective checklist, photo capture,
  written trip notes, XP/badge progression (the gamified layer maps to
  Duolingo-style streak/level framing).
- **Base-camp conditions strip**: any real mountaineering-planning tool
  (e.g. mountain-forecast.com) surfacing sunrise/sunset/day-length per
  base camp — used here as a live, on-brand ambient data panel.

## Classification (before this pass)

**Genuinely strong — no fabrication found, one realized-but-unrendered data
gap.** Read every line of `app/lenses/expedition-journal/page.tsx` (247
lines) and all three `components/expedition-journal/*.tsx` files (`StageCard`
247 lines, `ExpeditionSummary` 139 lines, `BaseCampAlmanac` 104 lines — 737
lines total) plus the full 504-line domain file.

1. **All 11 macros have real, live call sites**, not just static references:
   - `worlds` → page load (`loadWorlds`).
   - `progress` → per-world tab switch (`loadProgress`).
   - `mark-stage` → `StageCard`'s "Mark complete" button, which also fires a
     real `concordia:game-juice` reward event carrying the actual XP amount
     the backend awarded (not a hardcoded number).
   - `entry-add` / `entry-list` / `entry-delete` → `StageCard`'s expanded
     journal panel — full CRUD with a live list, not a form that writes into
     the void.
   - `photo-add` / `photo-list` / `photo-delete` → `StageCard`'s screenshot
     strip — real `FileReader`-to-`dataUrl` upload (1.4MB client-side cap
     enforced before the backend's 2MB stored cap), with delete.
   - `rewards` / `summary` → the "Cross-world summary" tab
     (`ExpeditionSummary`), a real stacked bar chart (`ChartKit`) of
     per-world stage completion plus a badge ledger rendering actual
     `awardedAt` timestamps and per-world XP totals computed server-side.
   - Confirmed via `grep -n "lensRun('expedition-journal'" concord-frontend/app/lenses/expedition-journal/page.tsx concord-frontend/components/expedition-journal/*.tsx`
     — one call site per macro, each inside a real event handler wired to a
     real DOM control, none behind a dead/disabled button.
2. **No fabrication signatures**: `grep -n "Math.random\|MOCK\|mock\|fake\|Lorem\|lorem\|hardcoded" app/lenses/expedition-journal/page.tsx components/expedition-journal/*.tsx` → zero hits. The only client-side data that isn't
   from the `expedition-journal` domain is `BaseCampAlmanac`'s direct call to
   the free `sunrise-sunset.org` API for 8 real mountaineering base camps
   (Everest, Denali, Aconcagua, Kilimanjaro, McMurdo, Svalbard, Cape Horn,
   Elbrus) — a live external source, honestly labeled ("sunrise-sunset.org ·
   live"), with an honest per-camp error state ("unreachable") instead of a
   silent fallback, and a `SaveAsDtuButton` that only appears once real data
   has loaded. This is the same "designed feature over a real free API"
   pattern already validated in the `eco` lens's `WeatherPanel`/`AQIPanel`.
3. **`GENERIC_TRIO` present but not load-bearing.** `ManifestActionBar`,
   `AutoActionStrip`, and `RecentMineCard` are all mounted, but the page
   around them is overwhelmingly bespoke (world tabs, `StageCard`,
   `ExpeditionSummary`, `BaseCampAlmanac`) — the same "kept as a secondary
   strip, not a substitute for a real page" disposition documented in the
   `eco` capability map. `grade-ux-polish.mjs --honest`'s `GENERIC_TRIO`
   detector requires the trio **plus** a thin page with no substantial
   bespoke component to flag — this page has 737 lines of bespoke,
   domain-specific UI, so it doesn't trip the detector and shouldn't.
4. **One realized-but-unrendered data gap (now fixed, see below):**
   `photo-list`'s handler (`expedition-journal.js:414-429`) returns the
   **full stored photo objects, including `dataUrl`**, unlike `photo-add`'s
   response which deliberately omits it (`const { dataUrl: _omit, ...meta }
   = photo;`, line 406). The frontend's `PhotoMeta` interface in
   `StageCard.tsx` didn't declare `dataUrl` and rendered every captured
   screenshot as a generic camera-icon placeholder + caption text — even
   though the real captured image was already present on the wire from every
   `photo-list` call. This is the "backend produces real data the frontend
   never uses" class the audit is looking for, just a small, contained
   instance of it (display fidelity, not a missing feature or dead button).

## What changed

- **`concord-frontend/components/expedition-journal/StageCard.tsx`** —
  `PhotoMeta` now declares the optional `dataUrl` field `photo-list` already
  returns; the screenshot grid renders a real `<img>` thumbnail
  (`object-cover`, captioned via `title`) when `dataUrl` is present, falling
  back to the previous camera-icon placeholder only if it's ever absent
  (defensive, e.g. a future response shape that omits it). No backend change
  was needed — the data was already there.

## Verification

- `cd concord-frontend && npx eslint components/expedition-journal/StageCard.tsx` — clean, exit 0.
- `node scripts/lens-unsurfaced.mjs --lens expedition-journal` → `0/11 macros never referenced in the frontend` (unchanged — this pass improved *fidelity* of an already-reachable macro, not reachability).
- `cd server && node --test tests/expedition-journal-domain-macros.test.js tests/expedition-journal-domain-parity.test.js` → `31 pass / 0 fail`.
- Fabrication re-grep after the edit: `grep -n "Math.random\|MOCK\|mock\|fake\|Lorem\|lorem" app/lenses/expedition-journal/page.tsx components/expedition-journal/*.tsx` → no hits, unchanged.
- Did not touch `server/domains/expedition-journal.js`, `page.tsx`,
  `BaseCampAlmanac.tsx`, or `ExpeditionSummary.tsx` — no gap found in any of
  them.
- Project-wide `tsc --noEmit`, `verify-lens-backends.mjs`, and
  `grade-ux-polish.mjs` are left to the orchestrator's single end-of-wave
  run, per the task's instructions.
