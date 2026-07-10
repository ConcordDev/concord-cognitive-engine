# Veterinary Lens — Capability Map (Frontend Rebuild Program, Wave 2)

> Derived, not asserted. This unit's sub-agent (combined with `pets`, given
> the two lenses' scope-boundary overlap) was interrupted by a container
> restart before it could write this artifact or send a completion report.
> The code on disk was complete and coherent; this document was written by
> the orchestrator post-restart from direct verification against the live
> backend and the actual committed diff.
>
> Reproduce the macro list:
> `grep -c 'registerLensAction("veterinary"' server/domains/veterinary.js` → 32

## Scope boundary vs. `pets` (both real, deliberately separate)

`veterinary` is the **clinic/practice-management** lens — "patients" are
animals under this clinic's care (not the caller's own pets), reached
through 32 domain macros feeding dedicated panels: Patients, Appointments,
Billing, SOAP Records, Pharmacy, Lab, Inventory, Reminders, Owner Portal,
Calculators. Confirmed real by direct audit — no fake data, no
disconnected CRUD system; every one of the 32 macros was already wired
into a real panel before this rebuild. See `docs/lens-specs/pets-
capability-map.md` for the complementary owner-facing lens.

## What this rebuild changed

The panels underneath were already real and complete — this rebuild's job
was the page shell: retire the generic scaffold and replace a raw tab
strip under a generic hero banner with a real command-bar + KPI-header
identity (mirrors the Finance/News/Mentorship flagship pattern).

## Self-inflicted false positive, found and fixed post-restart

The rebuilt page's own header doc comment named the retired scaffold
components literally, including one backtick-code-formatted
`` `<UniversalActions` `` fragment — the leading `<` made it match the
honest grader's `GENERIC_BODY_RE` (`/<UniversalActions\b|<LensFeaturePanel\b/`),
which scans raw file text with no awareness of "this is inside a comment
explaining why the pattern doesn't apply." Net effect: the comment
describing the fix ironically re-triggered the very flag it was
documenting as resolved (`isGenericScaffold` stayed `true` even though the
component was genuinely rebuilt). Confirmed the exact mechanism by diff
comparison against `pets/page.tsx`'s equivalent comment, which avoids the
`<ComponentName` JSX-tag pattern and correctly does not trip the detector.
Rewrote the comment to describe the retired components in prose instead of
literal tag syntax. Re-ran the grader after the fix: `isGenericScaffold`
flipped to `false`, `tier` to `"polished"`.

## Verification

- `npx eslint app/lenses/veterinary/page.tsx` — clean.
- `npx tsc --noEmit -p .` — 0 errors project-wide (post-restart, no concurrent load).
- `node scripts/grade-ux-polish.mjs --honest` — `veterinary`: `tier: "polished"`, `isGenericScaffold: false`, `importsGenericTrio: false` (verified before AND after the comment fix, to confirm the fix — not a coincidence).
- No existing veterinary-lens test file (confirmed by grep) — nothing to update.
