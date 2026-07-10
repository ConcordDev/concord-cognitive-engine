# automotive — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Reproduce the macro list:
> `grep -c 'registerLensAction("automotive"' server/domains/automotive.js` → 58

## Reference app + parity target

**Drivvo + Fuelly + CARFAX Car Care (2026 shape)** — multi-vehicle garage
tracking: fuel log + lifetime MPG, service log + maintenance schedule with
mileage/date reminders, expense breakdown, trips, documents, predictive
maintenance, cost-of-ownership, OBD-II telemetry import, shop directory,
appointments, and warranty/insurance renewals. `GarageSection.tsx` (30KB)
and `AdvancedToolsPanel.tsx` (51KB) already implement almost all of this
for real, correctly wired to `automotive.*` macros.

## `node scripts/lens-unsurfaced.mjs --lens automotive` (after fix)

```
automotive: 1/54 macros never referenced in the frontend
  renewals-* (1): renewals-upcoming
```

## Findings — fabricated/disconnected content, removed

### The primary page mounted an entire dead "shop CRM" scaffold — REAL DEFECT (fixed)

`app/lenses/automotive/page.tsx` mounted the real components
(`GarageSection`, `AdvancedToolsPanel`, `VinDecoder`, `FuelRepairPanel`,
`VehicleHistory`, `AutomotiveActionPanel`) **alongside** a second, much
larger system: a `ModeTab`/`ArtifactType` tab switcher for "Jobs /
Estimates / Codes / Materials / CRM / Invoices / Inspections / Certs" —
a generic auto-*repair-shop* business CRUD app (`TradeArtifact` interface:
`client`, `address`, `laborHours`, `laborRate`, `invoiceNumber`,
`inspector`, `certType`, ...) built entirely on the **generic
lens-artifact store** (`useLensData('automotive', activeArtifactType,
...)`, `useRunArtifact('automotive')`). No macro in
`server/domains/automotive.js` — a real, 58-macro *consumer* car-ownership
domain — creates or reads a `Job`/`Estimate`/`Material`/`Invoice`/`Client`/
`Inspection`/`Certification` artifact. It is the same disconnected
copy-paste shape as the `electrical`/`plumbing` trade-lens scaffolds
(confirmed via a concurrent `tsc` run surfacing byte-for-byte-identical
`ModeTab`/`ArtifactType` type errors in `electrical/page.tsx`).

This wasn't just dead code — it actively lied: the page's top "Stats Row"
showed **"Total Vehicles: {items.length}"**, where `items` was the count
of phantom `Job`-type lens-artifacts (or whatever `ModeTab` happened to be
active), never real vehicles from `vehicles-list`. A user with 3 real cars
and 0 fake "Jobs" would see "Total Vehicles: 0."

**Fix:** removed the entire scaffold (`ModeTab`/`ArtifactType`/
`TradeArtifact` types, `MODE_TABS`, `TRADE_MATERIALS`/`TRADE_CERTS`,
`renderDashboard`/`renderLibrary`/`renderEditor`, the `useLensData`/
`useRunArtifact` wiring, `LensPageShell`, and the unreachable
`UniversalActions` panel it fed) — a ~600-line deletion. Replaced the fake
stats row with a real one backed by `automotive.automotive-dashboard-summary`
(vehicle count, 12-month spend, logged fuel+service entries, overdue/
due-soon reminder counts) — this closes the `automotive-dashboard-summary`
unsurfaced-macro finding in the same fix, in the exact visual slot the fake
stats used to occupy.

## Findings — real gaps, fixed

### `vehicles-update` — REAL GAP (fixed)

Vehicles could be created and deleted but never edited — no way to fix a
typo'd VIN, correct the make/model, or (most importantly for every
mileage/MPG/maintenance calculation downstream) update the odometer
reading directly. **Fix:** added an inline "Edit vehicle" pencil button
next to the active vehicle's name in `GarageSection.tsx`, using the same
`prompt()`-based idiom the file already uses for create/log actions.

### `schedule-delete` — REAL GAP (fixed)

A maintenance-schedule item, once added, could never be removed — only
the derived reminders view (`service-reminders`) was shown, with no delete
affordance tied back to the underlying `scheduleId`. **Fix:** added a
delete button to each reminder row in `GarageSection.tsx`, wired to
`schedule-delete` via the reminder's `scheduleId`.

### `renewals-update` — REAL GAP (fixed)

`RenewalsTab` (`AdvancedToolsPanel.tsx`) supported create/list/delete for
warranty/insurance/registration renewals but not editing — a wrong
premium, expired policy number, or corrected renewal date required delete
+ recreate (losing the record's history). **Fix:** added an edit mode
(pencil button per renewal row) that loads the renewal into the existing
create-form and switches it to "Save changes" via `renewals-update`.

## Findings — deferred, documented rationale

- **`renewals-upcoming`** — a `withinDays`-windowed, status-ranked view of
  renewals. `renewals-list` (already wired, called with no `vehicleId` to
  span all vehicles) already returns every renewal sorted by date with
  `expiredCount`/`dueSoonCount`, which covers the same "what's coming up"
  need inside the Renewals tab. A dedicated dashboard-level "upcoming
  renewals" widget would be a legitimate addition but is lower-priority
  than the fixes above; left as a documented, real, non-urgent gap.
- **`schedule-list`** — the raw schedule-item list; superseded for display
  purposes by `service-reminders`' richer derived view (status/miles-left/
  days-left), which is what's actually shown.

## Verify gate

- `npx eslint app/lenses/automotive/page.tsx components/automotive/GarageSection.tsx components/automotive/AdvancedToolsPanel.tsx` — 0 errors/warnings.
- `npx tsc --noEmit -p .` — 0 errors attributable to these files.
- `node scripts/verify-lens-backends.mjs` — `automotive` reports WIRED.
- `node scripts/grade-ux-polish.mjs --honest` — `automotive`: `tier: "polished"`, `isGenericScaffold: false`, `bespokeRatio: 0.945`.
