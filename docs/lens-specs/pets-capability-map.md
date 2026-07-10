# Pets Lens — Capability Map (Frontend Rebuild Program, Wave 2)

> Derived, not asserted. This unit's sub-agent (combined with `veterinary`,
> given the two lenses' scope-boundary overlap) was interrupted by a
> container restart before it could write this artifact or send a
> completion report. The code on disk was complete and coherent; this
> document was written by the orchestrator post-restart from direct
> verification against the live backend and the actual committed diff.
>
> Reproduce the macro list:
> `grep -c 'registerLensAction("pets"' server/domains/pets.js` → 59

## Scope boundary vs. `veterinary` (both real, deliberately separate)

`pets` is the **owner-facing** lens (a caller's own pets: health records,
vaccines, weight/activity tracking, care services, breed reference).
`veterinary` is the **clinic/practice-management** lens (patients under a
clinic's care, appointments, billing, SOAP charting, pharmacy, inventory) —
32 separate domain macros, a different `STATE` namespace, genuinely
different users (pet owner vs. clinic staff). Confirmed real, not a
duplicate — see `docs/lens-specs/veterinary-capability-map.md`.

## What was fixed (fake-data finding)

The previous page's primary visible surface was a generic "Pets/Health/
Feeding/Activity/Expenses/Documents" CRUD library backed by
`useLensData('pets', 'PetProfile'|'HealthRecord'|…)` — a fabricated,
fully disconnected data model (the generic `STATE.lensArtifacts` store, not
the real STATE-backed `pets.js` pet/vaccine/medication/weight records).
`PetActionDrawer`, `PetCarePlanner`, and `ActivityWeightDashboard` all read
from that same fake store. Retired entirely. The real, already-macro-wired
`PetCareSection` (Health/Wellness/Reminders/Care Services/Records & ID
tabs, all real `pets.*` macros) is now the lens's one and only pet-record
surface, extended with two new tabs (Insights, Discover) folding in the
fixed calculator/breed panels.

Also retired: the generic scaffold trio + a permanently-dark realtime
indicator (`pets` has no `DOMAIN_EVENTS` entry in
`hooks/useRealtimeLens.ts`, so `isLive` was always `false` — the same
honesty smell the `supplychain` rebuild found and removed).

## Verification

- `npx eslint app/lenses/pets/page.tsx components/pets/*.tsx` — clean.
- `npx tsc --noEmit -p .` — 0 errors project-wide (post-restart, no concurrent load).
- `node scripts/grade-ux-polish.mjs --honest` — `pets`: `tier: "polished"`, `isGenericScaffold: false`, `divAsButtons: 0`.
- No existing pets-lens test file (confirmed by grep) — nothing to update.
