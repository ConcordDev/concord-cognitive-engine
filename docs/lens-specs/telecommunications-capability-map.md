# Telecommunications Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

## Backend surface

```
grep -c 'registerLensAction("telecommunications"' server/domains/telecommunications.js
```
→ **22** macros in `server/domains/telecommunications.js` (959 lines),
registered via `registerTelecommunicationsActions(register)`. No inline
`server.js` registrations, no domain-string collisions with any other lens
(`grep -rn '"telecom"' server/` returns only an unrelated cartographer
keyword-routing entry that maps unrelated content to the `mesh` lens, not a
macro registration).

Two real surfaces sharing the one domain string:
- **4 legacy single-shot calculators** — `networkCapacity`, `signalQuality`,
  `coverageMap`, `costPerLine` (pure compute, no persisted state).
- **18-macro RF planning suite** — tower CRUD (`towerList/Save/Delete`), a
  real COST-231 Hata path-loss propagation model (`propagationModel`),
  cell-overlap/co-channel interference analysis (`interferenceAnalysis`),
  subscriber-growth capacity projection (`capacityProjection`), network
  topology with backhaul aggregation (`topology`), a frequency-band
  allocation planner with overlap/guard-band detection
  (`spectrumList/Allocate/Delete/Plan`), an outage/SLA dashboard
  (`outageList/Report/Resolve/slaReport`), and drive-test measurement
  import/validation against predicted coverage
  (`driveTestImport/List/Validate`). All persistent state lives in
  `globalThis._concordSTATE.telecom` Maps keyed by user id.

## Frontend surface (4 files, 1,700 LOC per `grade-ux-polish.mjs`)

`concord-frontend/app/lenses/telecommunications/page.tsx` +
`concord-frontend/components/telecommunications/{RFPlanner,
TelecommunicationsActionPanel, TelcoRepos}.tsx`.

## The defect: a 7-tab fabricated parallel CRUD system sitting beside two
## fully real, already-complete macro-backed workbenches

Unlike some lenses in this program, **all 22 real macros were already
wired** before this pass — `RFPlanner.tsx` (the 18-macro planning suite,
internally tabbed Sites/RF Coverage/Interference/Capacity Plan/Topology/
Spectrum/Outages/Drive Test) and `TelecommunicationsActionPanel.tsx` (the 4
legacy calculators + mint/DM/publish/agent actions) between them call every
one of the 22 registered macros with correct field shapes. This is
confirmed by direct read of both files plus the passing
`telecommunications-lens-macros.test.js` / `telecommunications-domain-parity.test.js`
/ `depth/telecommunications-behavior.test.js` suites (72/72).

The defect was entirely in `app/lenses/telecommunications/page.tsx`, which —
*despite* mounting both real components at the bottom of the page — carried
a **7-tab (`Dashboard, Networks, Towers, Spectrum, Subscribers, Outages,
Fiber`) generic CRUD system** as its primary surface:

- `useLensData<ArtifactDataUnion>('telecommunications', currentType, …)`
  with `ArtifactType ∈ {Network, Tower, Spectrum, Subscriber, Outage,
  Fiber}` — **none of these six type strings is a registered macro action.**
  `useLensData` hits the generic `/api/lens/telecommunications/list`
  artifact store, not `domains/telecommunications.js`. This is a **second,
  divergent data model**: fake `NetworkData` (`.loadPercent`, `.uptime`,
  `.type: '5G'|'4G_LTE'|...`) and fake `TowerData`
  (`.siteId`, `.antennas`, `.lastInspection`) have no field-name overlap
  with the real `Tower` shape RFPlanner already uses
  (`.freqMhz`, `.gainDbi`, `.terrain`, `.backhaul`, `.sectors`) — they are
  not the same object wearing a different name, they are an entirely
  invented parallel product (fiber/subscriber tracking has **zero** backend
  macro anywhere in the 22-macro surface).
- The page's top stat strip (`Connections`, `Bandwidth Utilization`,
  `Uptime`, `Active Outages`) was computed entirely from these fake
  `networks`/`towers`/`outages` arrays — always zero/empty on a fresh
  install since nothing ever seeds them, and never reconcilable with the
  real tower/outage/spectrum data one tab-switch away in `RFPlanner`.
- `useRunArtifact('telecommunications')` + `handleAction('analyze', …)` +
  `<UniversalActions domain="telecommunications" artifactId={items[0]?.id}>`
  — a generic AI action bar wired to whatever fake artifact happened to be
  first in the list, not any of the 22 real macros.
- Net effect: a user landing on the lens saw a Dashboard/Towers/Spectrum/
  Outages tab bar that looked authoritative but was **entirely
  disconnected** from the real RF planner and NOC panel rendered below it —
  the classic "fabricated parallel CRUD next to the real backend" defect
  class, in a lens where, unusually, 100% of the real macros were already
  surfaced elsewhere on the same page.

## What changed

### `app/lenses/telecommunications/page.tsx` — rewritten (409 → 166 lines)

Removed: the `ModeTab`/`ArtifactDataUnion`/`NetworkData`/`TowerData`/
`SpectrumData` types, `getTypeForTab`, `STATUS_COLORS`, all four
`useLensData(...)` calls, `useRunArtifact`, `handleAction`, the 7-tab bar,
the search box (it searched the fake artifact store only), the fabricated
stat strip, the fake-data item list + create/delete affordances, and
`<UniversalActions>` (no meaningful target once the fake artifact ids were
gone — same reasoning as the insurance-lens precedent).

Replaced with:
- **A real overview stat strip** — on mount, the page calls
  `lensRun('telecommunications', 'towerList'|'spectrumList'|'outageList',
  {})` directly (three real macros, no artifact persistence needed) and
  renders active/total sites, total MHz allocated, sites without an open
  incident, and open-outage count — all computed from the same live state
  `RFPlanner` reads. A `role="alert"` surface (matching the `insurance`/
  other Wave-3 precedent) shows the real fetch error instead of silently
  staying blank on failure.
- **RFPlanner + TelecommunicationsActionPanel + TelcoRepos**, unchanged in
  behavior, now the page's only content besides the honest overview strip
  and the standard `RecentMineCard`/`AutoActionStrip`/
  `CrossLensRecentsPanel` footer.
- **Discoverable keyboard shortcuts** (fluidity invariant) — `RFPlanner`
  gained an optional controlled-tab API (`tab`/`onTabChange` props,
  falling back to internal state when omitted, so no other caller breaks)
  and the page registers `useLensCommand` bindings `1`–`8` to jump directly
  to each of its 8 real sub-tabs (Sites/RF Coverage/Interference/Capacity
  Plan/Topology/Spectrum/Outages·SLA/Drive Test) — surfaced via the
  existing command-palette/shortcut-help modal, not just functional.

### `components/telecommunications/RFPlanner.tsx` — controlled-tab support

Exported `RF_PLANNER_TABS` (the tab key/label list, previously a private
`TABS` const with icons only) and changed `RFPlanner()` to accept optional
`{ tab, onTabChange }` props; `tab = controlledTab ?? internalTab` and
`setTab = onTabChange ?? setInternalTab`. Purely additive — every other
caller (there are none besides this page) is unaffected, and internal
`useState` still drives the component when no props are passed.

### `tests/telecommunications-lens-states.test.tsx` — rewritten

The prior test pinned the *removed* fabricated architecture (mocked
`useLensData`/`useRunArtifact`, asserted a `NETWORK` fake-artifact object
rendered with a status badge). Left as-is it would simply fail against the
new page — same as the equivalent `insurance-lens-states.test.tsx`, which
was left broken (5/5 failing, confirmed by direct run) after the prior
insurance rebuild pass. Rather than repeat that regression, this pass
rewrote the test to pin the new, honest contract instead: overview stats
are computed from real `lensRun('telecommunications', 'towerList'|
'spectrumList'|'outageList', {})` calls (asserted by domain + action +
rendering the computed MHz total), a failed fetch surfaces `role="alert"`,
the three real workbenches mount, and the 8 RF-Planner tab-jump shortcuts
register under `lensId: 'telecommunications'`. 4/4 pass.

## Macro → UI classification (all 22 macros)

**DESIGNED** (real, bespoke UI, no fabrication) — 22/22, unchanged by this
pass except for the page-level plumbing described above:

| Macro group | Count | Where |
|---|---:|---|
| `networkCapacity`, `signalQuality`, `coverageMap`, `costPerLine` | 4 | `TelecommunicationsActionPanel.tsx` |
| `towerList`, `towerSave`, `towerDelete` | 3 | `RFPlanner.tsx` → Sites tab (map + form + list) |
| `propagationModel` | 1 | `RFPlanner.tsx` → RF Coverage tab (COST-231 Hata prediction map) |
| `interferenceAnalysis` | 1 | `RFPlanner.tsx` → Interference tab (C/I chart + pair table) |
| `capacityProjection` | 1 | `RFPlanner.tsx` → Capacity Plan tab (area + line charts) |
| `topology` | 1 | `RFPlanner.tsx` → Topology tab (tree diagram + link table) |
| `spectrumList`, `spectrumAllocate`, `spectrumDelete`, `spectrumPlan` | 4 | `RFPlanner.tsx` → Spectrum tab (band-layout bar + gap/guard-violation callouts) |
| `outageList`, `outageReport`, `outageResolve`, `slaReport` | 4 | `RFPlanner.tsx` → Outages/SLA tab (timeline + SLA compute) |
| `driveTestImport`, `driveTestList`, `driveTestValidate` | 3 | `RFPlanner.tsx` → Drive Test tab (CSV import + measured-vs-predicted scatter) |

Total: 4+3+1+1+1+1+4+4+3 = **22**. Matches
`grep -c 'registerLensAction("telecommunications"' server/domains/telecommunications.js`.

**GENERIC-STRIP-ONLY**: none. `TelecommunicationsActionPanel`'s 8-button
action grid (`Capacity/Signal/Coverage/Unit econ/Mint/DM/Publish/Action`)
is a bespoke, domain-specific NOC-brief panel with typed inputs and typed
result cards per macro — not a `<UniversalActions>`/`ManifestActionBar`
generic wall (the grader's `hasMacroButtonWall: true` flag on this lens is
a raw-pattern match on the button-grid shape, not on genericness — it's
outweighed by `isGenericScaffold: false` + 5/5 pillars present, see
Verification).

**UNSURFACED**: none, before or after this pass — all 22 macros were
already reachable; the defect was the disconnected fabricated tab system
sitting *beside* the real surface, not a missing wire.

## Confirmed real and left alone, with reason

`grep -n "Math.random|MOCK|mock|fake|Lorem|lorem|hardcoded"
components/telecommunications/*.tsx` → no fabrication signatures in
`RFPlanner.tsx` or `TelecommunicationsActionPanel.tsx` (only this doc's own
prose and code comments describing the honesty invariant mention the
words). Both files were read in full and confirmed to call real macros
with correctly-shaped input everywhere.

- **`RFPlanner.tsx`** (1,177 LOC before this pass, +14/-3 for the
  controlled-tab change) — all 18 planning-suite macros wired correctly,
  real COST-231 Hata physics implemented server-side and consumed
  faithfully client-side (haversine distance, circle-overlap geometry for
  interference, binary-search range solving). No fabrication found.
- **`TelecommunicationsActionPanel.tsx`** — all 4 legacy calculators wired,
  plus real DTU mint/publish/DM/agent actions reusing the established
  `pipe.publish`/`useRecallableAction` patterns seen elsewhere in the
  program. No fabrication found.
- **`TelcoRepos.tsx`** — an honest external-feed panel (live GitHub repo
  search by telecom-related topic, `SaveAsDtuButton` to capture results),
  same pattern as other lenses' community-signal panels. No defect.

## Genuinely missing, deferred

None identified. Every real telecom capability implied by the 22 macros
has a designed UI; the fake `Subscriber`/`Fiber` artifact types the removed
tab system implied (subscriber-account management, fiber-plant tracking)
have no corresponding real macro anywhere and were themselves the
fabrication — not a genuine gap this pass is deferring, since nothing in
the 22-macro backend suggests those products were ever meant to exist here
(the lens is an **RF/wireless network-planning workbench**, not a telecom
BSS/OSS subscriber-billing system — that's a different, larger product
outside this lens's scope per its own backend).

## Verification

- `node --check server/domains/telecommunications.js` — clean (file
  untouched this pass; verified anyway per the assignment brief).
- `node --test tests/telecommunications-domain-parity.test.js
  tests/telecommunications-lens-macros.test.js
  tests/depth/telecommunications-behavior.test.js` (from `server/`) —
  **72/72 pass**, unmodified.
- `npx vitest run tests/telecommunications-lens-states.test.tsx` (from
  `concord-frontend/`) — **4/4 pass** (rewritten this pass, see above).
- `npx eslint app/lenses/telecommunications/page.tsx
  components/telecommunications/*.tsx
  tests/telecommunications-lens-states.test.tsx` (from `concord-frontend/`)
  — clean, exit 0.
- `node scripts/verify-lens-backends.mjs` (from repo root) —
  `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260 (telecommunications was
  already WIRED and stays WIRED).
- `node scripts/grade-ux-polish.mjs --honest` (from repo root) —
  telecommunications entry: `"tier": "polished"`, `"isGenericScaffold":
  false`, `"bespokeRatio": 0.903`, `"pillarsPresent": 5`, `"antiPatterns":
  0`. `audit/` outputs reverted via `git checkout -- audit/` per the
  transient-artifact rule.
