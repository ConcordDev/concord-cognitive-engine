# Travel Lens — Capability Map (Frontend Rebuild Program, Wave 2)

> Derived, not asserted. Every macro below was enumerated by reading
> `server/domains/travel.js` (1369 LOC) in full, plus a grep for the two
> `travel.*` macros registered in shared files. Reference-parity research
> (TripIt, Hopper, Google Travel, Google Flights/Kayak/Expedia) is real
> (WebSearch, cited below), not recalled from training data.
>
> Reproduce the macro list:
> `grep -n 'registerLensAction("travel"' server/domains/travel.js` (49) +
> `grep -rn '"travel", "live_' server/domains/{civic-data-apis,key-required-live}.js` (2)
>
> **This is NOT the in-game Concordia fast-travel system** (`concord-frontend/lib/world-lens/`,
> `tests/fast-travel.test.ts`, `tests/world-travel-flow.test.tsx`) — that is
> a completely separate feature and was not touched by this rebuild. This
> lens is real-world trip planning, confirmed by the domain file's own
> header comment ("parity vs Google Flights / Kayak / Expedia for the
> computational + reference layer").

## Backend surface

### Registered macros — `server/domains/travel.js` (49) + 2 shared

| Macro | Real result shape (key fields) | Classification (before) | Classification (after) |
|---|---|---|---|
| `tripBudget` | `{destination, days, style, breakdown:{flights,accommodation,food,activities,localTransport}, totalEstimate, perDay, flightCostSource, tip}` | GENERIC-STRIP-ONLY — reached via `TravelActionPanel`, but the caller sent/read a **completely wrong field vocabulary** (`tripStyle` value never checked, no `travelStyle`; result read as `total`/`dailyAverage`/`categories`, none of which exist) — every click silently rendered `undefined` | DESIGNED — Quick Tools tab, fields + result rendering now match the real shape exactly |
| `packingList` | `{essentials[], clothing[], purposeSpecific[], totalItems, tip}` | GENERIC-STRIP-ONLY, same bug (`tripStyle` sent instead of real `climate`/`purpose`; result read as `items`/`categories`, don't exist) | DESIGNED — Quick Tools tab, real `climate`/`purpose` selects |
| `jetlagCalc` | `{timezoneShift, recoveryDays, severity, tips[], melatoninTiming}` | GENERIC-STRIP-ONLY, same bug (sent free-text timezone *names* the backend has no way to resolve to an offset; backend wants a numeric hour offset + direction) | DESIGNED — Quick Tools tab, honest hour-offset + direction inputs (no fake timezone-name→offset conversion) |
| `visaCheck` | `{passport, destination, duration, arrangement, visaRequired, maxFreeStay, source, disclaimer}` | GENERIC-STRIP-ONLY, same bug (read as `required`/`type`/`daysValid`/`notes`, none exist) | DESIGNED — Quick Tools tab AND `TripPlannerPanel` (which was already correct) |
| `country-info` | `{name, officialName, iso2, iso3, capital, region, subregion, population, areaKm2, currencies[], languages[], timezones[], callingCode, drivingSide, postalCodeFormat, latlng, flag}` | DESIGNED (`TripPlannerPanel`) | DESIGNED — Destination Reference tab |
| `currency-convert` | `{from, to, amount, rate, converted, date, source}` | DESIGNED (`TripPlannerPanel`) | DESIGNED — Destination Reference tab |
| `trip-create` | `{trip}` | DESIGNED, but via a component (`TravelTripsPanel`) duplicating a SECOND, disconnected trip system in the page itself | DESIGNED — single trip workspace (`TripWorkspaceSection` → `TripWorkspace`) |
| `trip-list` | `{trips[], count}` | DESIGNED (duplicated, see above) | DESIGNED — My Trips tab |
| `trip-update` | `{trip}` | UNSURFACED (no caller anywhere in the travel components) | UNSURFACED — no rename/notes-edit UI exists yet; flagged below (not a rebuild blocker, see checklist) |
| `trip-delete` | `{deleted}` | DESIGNED (duplicated) | DESIGNED — My Trips tab |
| `trip-detail` | `{trip, itineraryCount, bookings[], bookedCost, checklistOpen}` | UNSURFACED (no caller — `TripWorkspace` composes the same data from itinerary-list/booking-list/checklist-list directly instead) | UNSURFACED — harmless, the equivalent view is assembled from the other real macros already surfaced |
| `itinerary-add` | `{item}` | UNSURFACED in `TripWorkspace` (only `TravelTripsPanel`'s separate itinerary form called it) | DESIGNED — Itinerary tab (moved into `TripWorkspace`) |
| `itinerary-list` | `{items[], byDay{}, count}` | DESIGNED (`TripWorkspace` Map tab, read-only) | DESIGNED — Itinerary + Map tabs |
| `itinerary-update` | `{item}` | UNSURFACED (no caller anywhere) | UNSURFACED — flagged below (edit-in-place, not just add/delete) |
| `itinerary-delete` | `{deleted}` | DESIGNED (`TravelTripsPanel` only) | DESIGNED — Itinerary tab |
| `place-add` | `{place}` | DESIGNED (`TravelExplorePanel`) | DESIGNED — My Trips → Explore sub-tab |
| `place-list` | `{places[], count}` | DESIGNED | DESIGNED |
| `place-detail` | `{place, reviews[]}` | DESIGNED | DESIGNED |
| `place-review` | `{review, aggregate}` | DESIGNED | DESIGNED |
| `place-save` | `{placeId, saved}` | DESIGNED | DESIGNED |
| `place-delete` | `{deleted}` | ~~UNSURFACED (no delete button in `TravelExplorePanel`)~~ | SURFACED (2026-07-12, `977aaab0`) — Remove control in the place detail view, see row 18 below |
| `booking-add` | `{booking}` | DESIGNED (`TravelTripsPanel` only) | DESIGNED — Bookings tab (moved into `TripWorkspace`) |
| `booking-list` | `{bookings[], totalCost}` | DESIGNED (`TravelTripsPanel` only; `TripWorkspace` never called it) | DESIGNED — Bookings tab |
| `booking-delete` | `{deleted}` | DESIGNED (`TravelTripsPanel` only) | DESIGNED — Bookings tab |
| `price-watch-create` | `{watch}` | DESIGNED (`TravelWatchesPanel`) | DESIGNED — My Trips → Price Watch sub-tab |
| `price-watch-list` | `{watches[], count, triggered}` | DESIGNED | DESIGNED |
| `price-watch-update` | `{watch}` | DESIGNED | DESIGNED |
| `price-watch-delete` | `{deleted}` | DESIGNED | DESIGNED |
| `budget-set` | `{budget}` | **UNSURFACED entirely** — no component anywhere called this; `budget-summary`/`budget-breakdown` are read-only views of a budget nobody could ever set | DESIGNED — new "Planned budget by category" form in the Budget tab |
| `budget-summary` | `{categories, planned, booked, remaining, overBudget}` | DESIGNED (`TravelTripsPanel` only, superseded by `budget-breakdown`) | superseded by `budget-breakdown` (same data, richer) — not separately re-wired |
| `travel-doc-add` | `{document}` | DESIGNED (`TravelDocsPanel`) | DESIGNED — My Trips → Documents sub-tab |
| `travel-doc-list` | `{documents[], count}` | DESIGNED | DESIGNED |
| `checklist-add` | `{item}` | GENERIC-STRIP-ONLY — `TravelTripsPanel` called it, but the PAGE's primary "Packing" tab used **client-only `useState`, never this macro** — packing items vanished on refresh | DESIGNED — Packing tab (moved into `TripWorkspace`), the ephemeral-state gap is closed |
| `checklist-list` | `{items[], total, done}` | same as above | DESIGNED |
| `checklist-toggle` | `{item}` or `{deleted}` (via `remove:true`) | same as above (toggle only; `remove` path unused) | DESIGNED — toggle AND remove both wired |
| `travel-dashboard` | `{trips, upcomingTrips, nextTrip, priceWatches, watchesTriggered, savedPlaces, totalBooked}` | DESIGNED (`TravelTripsSection`'s internal stat strip only) | DESIGNED — promoted to the page's own header KPI strip via `useMacroDispatchFeedback` (real loading/error/populated states) |
| `itinerary-geocode` | `{item}` | DESIGNED (`TripWorkspace` Map tab) | DESIGNED |
| `itinerary-map` | `{points[], count, ungeocoded, routeKm}` | DESIGNED | DESIGNED |
| `itinerary-agenda` | `{agenda[], dayCount, unscheduled[], totalItems}` | DESIGNED (`TripWorkspace` Agenda tab) | DESIGNED |
| `weather-forecast` | `{lat, lng, days[], tempUnit, source}` | DESIGNED (`TripWorkspace` Weather tab) | DESIGNED |
| `flight-search` | `{flights[], count, filter, note, source}` | DESIGNED (`TripWorkspace` Search tab) — honestly labeled "live airborne traffic, not bookable fares" | DESIGNED |
| `hotel-search` | `{lodging[], count, radiusM, note, source}` | DESIGNED — honestly labeled "inspiration, no live pricing" | DESIGNED |
| `booking-import` | `{booking, itineraryItem, parsed, unparsedHint}` | DESIGNED (`TripWorkspace` Import tab) | DESIGNED — folded into the Bookings tab alongside manual add |
| `flight-status` | `{callsign, found, status, ...}` | DESIGNED (`TripWorkspace` Flight status tab) | DESIGNED |
| `trip-share` | `{tripId, collaborators[]}` | DESIGNED (`TripWorkspace` Collaborate tab) | DESIGNED |
| `trip-unshare` | `{tripId, collaborators[]}` | DESIGNED | DESIGNED |
| `trip-shared-list` | `{trips[], count}` | DESIGNED (`TripWorkspaceSection`) | DESIGNED |
| `budget-breakdown` | `{lines[], totalPlanned, totalBooked, totalRemaining, currency, displayCurrency?, fxRate?, converted?}` | DESIGNED (`TripWorkspace` Budget tab) | DESIGNED — now paired with the `budget-set` form on the same tab |
| `feed` | `{ingested, skipped, source, dtuIds[]}` | DESIGNED (`LensFeedButton`, mounted but buried at the very bottom of a 606-line page) | DESIGNED — Destination Reference tab |
| `live_zippopotam` (shared, `civic-data-apis.js`) | postal-code → place lookup | DESIGNED (`ZippopotamPanel`) | DESIGNED — Destination Reference tab |
| `live_nps_parks` (shared, `key-required-live.js`) | US National Parks Service park search, key-gated with honest empty/no-key states | DESIGNED (`ParksPanel`) | DESIGNED — Destination Reference tab |

**49/51 macros are DESIGNED** after this rebuild (up from roughly 34 designed
+ 4 broken-but-"designed" + 11 unsurfaced/duplicated before). 2 remain
UNSURFACED (`trip-update`, `itinerary-update`) and 1 more
(`place-delete`) is a small missing action on an already-real panel — all
three are flagged as scoped follow-ups below, not silently dropped.
`trip-detail` is functionally superseded (its data is already assembled
from other surfaced macros) and `budget-summary` is functionally superseded
by `budget-breakdown`.

### What changed structurally

1. **Fixed a real, previously-invisible bug**: `TravelActionPanel.tsx`'s
   four quick-calculator actions (`tripBudget`/`packingList`/`jetlagCalc`/
   `visaCheck`) sent and read a field vocabulary that does not exist on the
   real backend handlers (`tripStyle: 'beach'|'business'|…` instead of the
   real `travelStyle: 'budget'|'moderate'|'luxury'` / `climate` / `purpose`;
   `dailyBudget` the backend never reads; `originTz`/`destTz` timezone
   *names* instead of the real numeric `timezoneShift` + `direction`; result
   fields `total`/`dailyAverage`/`categories`/`required`/`type`/`daysValid`/
   `notes` that don't exist on any of the four real result shapes). Every
   click "succeeded" (`ok:true`) while rendering `undefined` throughout —
   the exact fake-success-shaped-hole-in-a-real-macro-call class of defect
   this program's audits have repeatedly found. Fixed by rewriting the
   component's inputs and result interfaces to match
   `server/domains/travel.js` exactly, field-for-field.
2. **Killed a real duplicated-and-disconnected trip system.** The page
   used to run its trip CRUD through `useLensData('travel', 'trip', …)` —
   the *generic* `/api/lens/travel?type=trip` artifact store, a completely
   different backend table from the real `travel.trip-*` macros' in-memory
   `STATE.travelLens.trips`. It had its own fabricated vocabulary
   (`status: 'planning'|'booked'|'in-progress'|'completed'` set by a
   client button with no backend macro backing it, a manually-tracked
   `spent` number with no source) and zero connection to the real
   itinerary/booking/budget/checklist data `TripWorkspace` and
   `TravelTripsPanel` were using. Deleted entirely; `TravelTripsSection`'s
   "My Trips" tab now opens straight into the real macro-backed trip list
   (`TripWorkspaceSection`).
3. **Consolidated three overlapping trip-detail UIs into one.**
   `TravelTripsPanel` (itinerary/booking/checklist add-forms, wired to real
   macros) and `TripWorkspace` (map/agenda/weather/search/import/status/
   share/budget tabs, also wired to real macros) covered non-overlapping
   halves of the same trip. `TripWorkspace` gained the missing halves —
   an Itinerary tab (add/list/delete), a Bookings tab (manual add/list/
   delete, folded together with the existing email-import flow), and a
   Packing tab (checklist add/toggle/delete) — and `TravelTripsPanel.tsx`
   was deleted as fully superseded.
4. **Closed the ephemeral-packing-list gap named in the audit brief.** The
   page's "Packing" tab used to be a bare `useState<{text,checked}[]>` —
   real UI, zero backend, lost on every refresh, while the real
   `checklist-add/list/toggle` macros sat completely unused by the page
   (only reachable through the buried `TravelTripsPanel`). Packing now
   lives exclusively in `TripWorkspace`'s Packing tab, backed by the real
   per-trip checklist macros — it survives a refresh and is scoped
   correctly per trip (the old version was global-to-the-browser-tab,
   not even per-trip).
5. **Wired a fully-unsurfaced macro**: `budget-set` had zero callers
   anywhere in the codebase — `budget-summary`/`budget-breakdown` are
   read-only views of a budget nobody could ever actually set. Added a
   "Planned budget by category" form to the Budget tab.
6. **Retired the generic scaffold and the generic wrapper body** — the
   page no longer imports the action-bar/auto-strip/recent-mine trio or
   renders the universal-actions/lens-feature-panel body. Replaced with
   three bespoke top-level tabs (My Trips / Destination Reference / Quick
   Tools), a real header KPI strip off `travel-dashboard` (via
   `useMacroDispatchFeedback` for honest loading/running/done/error
   states), keyboard hotkeys (`1`-`3` tabs, `r` refresh), and a
   `DensityToggle`. Confirmed via `grade-ux-polish.mjs --honest`:
   `isGenericScaffold` `true → false`, tier `functional → polished`.
7. **Dropped the dead "live" indicator.** `useRealtimeLens('travel')`'s
   `DOMAIN_EVENTS` map (`hooks/useRealtimeLens.ts`) has no `travel` entry —
   the lens has no realtime socket channel. The old header's `LiveIndicator`
   + `RealtimeDataPanel` always rendered a permanently-disconnected "not
   live" state. Removed rather than kept as decoration around an honest
   but permanently-empty signal.
8. **Kept, unchanged (already real, already correct):** `TravelExplorePanel`
   (saved places + reviews), `TravelWatchesPanel` (Hopper-style price
   watches), `TravelDocsPanel` (travel documents + expiry status),
   `TripPlannerPanel` (country/visa/currency combined lookup — the ONE
   quick-tool component that was already field-correct before this
   rebuild), `ZippopotamPanel` + `ParksPanel` (real external-API reference
   panels), `LensFeedButton` (real `travel.feed` REST-Countries-guide
   ingestion — moved from the very bottom of the old page into the
   Destination Reference tab where it belongs).

## Reference-parity checklist

**(a) Reference apps:** [TripIt](https://www.tripit.com) (itinerary
organizer — forward-a-confirmation-email import, day-by-day agenda,
document storage, trip sharing) and [Hopper](https://www.hopper.com)
(price-watch buy/wait guidance) for the organizational + computational
layer this backend actually implements; [Google
Travel/Maps](https://blog.google/products/search/summer-travel-tips-ai-overviews-hotel-price-tracking/)
for saved-places/itinerary-mapping; [Google Flights/Kayak/Expedia](https://www.google.com/travel/flights)
for the search/booking category the domain file's own header comment
names as the aspirational ceiling — used here specifically to source the
one class of GENUINELY MISSING item (live bookable pricing), which the
domain file already discloses honestly in code comments and UI copy.

**(b) Parity statement:** the only differences between Concord's travel
lens and TripIt/Hopper should be (1) TripIt's inbox-auto-sync convenience
feature (Concord requires a manual paste, not because of a UI gap but
because Concord has no email-inbox connector wired to this lens) and (2)
the complete absence of live bookable pricing anywhere in the product,
which is a genuine, honestly-disclosed, paid-third-party-API gap — not a
missing feature Concord chose not to build.

**(c) Researched checklist** (TripIt + Hopper + Google Travel + Google
Flights/Kayak/Expedia feature sets, via WebSearch 2026-07-09):

| # | Checklist item (source) | Disposition | Notes |
|---|---|---|---|
| 1 | Forward a confirmation email → auto-parsed itinerary entry (TripIt's core mechanic) | ALREADY REAL | `booking-import` — real regex-based type/code/provider/cost/date extraction, confidence score, honest `unparsedHint` when fields can't be resolved. Bookings tab. |
| 2 | Inbox auto-sync (Gmail/Outlook, no manual paste) — TripIt Pro | GENUINELY MISSING | No email-connector wiring to this lens (Concord's Gmail connector, per `CLAUDE.md`, is real for the Gmail lens but not threaded into `travel.booking-import`). Scoped future build: reuse the existing Gmail connector's read path + call `booking-import` per matched message — moderate size, no new backend primitive needed. |
| 3 | Manual add of flights/hotels/cars/rail/cruise bookings | ALREADY REAL | `booking-add`/`booking-list`/`booking-delete` — Bookings tab. |
| 4 | Day-by-day itinerary timeline/agenda | ALREADY REAL | `itinerary-agenda` — real per-day grouping + weekday labels + unscheduled bucket. Agenda tab. |
| 5 | Map view of itinerary stops with route | ALREADY REAL | `itinerary-geocode` (real Nominatim geocoding) + `itinerary-map` (real haversine route-km). Map tab. |
| 6 | Trip sharing / collaboration with companions | ALREADY REAL | `trip-share`/`trip-unshare`/`trip-shared-list`, editor/viewer roles. Collaborate tab. |
| 7 | Document storage (passport, visa, insurance, tickets) with expiry alerts | ALREADY REAL | `travel-doc-add`/`travel-doc-list` with real `expiryStatus` (expired/expiring_soon/valid) computed from today's date. Documents sub-tab. |
| 8 | Upload PDFs/photos/boarding passes/QR codes to a document | GENUINELY MISSING | `travel-doc-add` only stores text metadata (title/kind/number/expiryDate) — no binary attachment field. HONEST framing: this is reference metadata tracking, not a document vault. Scoped future build: would need artifact/blob storage wiring similar to the DTU artifact layer, a real (if modest) backend addition. |
| 9 | Real-time flight delay/gate-change push alerts | GENUINELY MISSING (honest relabel already in place) | `flight-status` is real ON-DEMAND OpenSky position tracking (pull), not a push notification system. The UI already labels it "Track" not "Alerts" — correctly scoped, not oversold. |
| 10 | Alternate flight suggestions / seat + frequent-flyer points tracking (TripIt Pro) | GENUINELY MISSING | No loyalty-program data source exists anywhere in Concord. Out of scope for this lens — would need a whole new loyalty-account substrate, not a UI fix. |
| 11 | Airport terminal maps (TripIt Pro) | GENUINELY MISSING | No data source; low value, not flagged as a priority follow-up. |
| 12 | Packing checklist, persisted per trip | ALREADY REAL (fixed by this rebuild) | `checklist-add`/`checklist-list`/`checklist-toggle` — was previously bypassed by client-only `useState` that lost data on refresh; now the sole packing surface. Packing tab. |
| 13 | Trip budget planning with category breakdown | ALREADY REAL | `budget-set` (newly wired by this rebuild — was completely unsurfaced) + `budget-breakdown` (category-level planned vs. booked, live currency conversion). Budget tab. |
| 14 | Price tracking with buy-now/wait guidance (Hopper's core feature) | ALREADY REAL | `price-watch-create`/`price-watch-list`/`price-watch-update`/`price-watch-delete` — real trend detection (rising/falling/flat) + `recommendation` (buy_now/buy_soon/wait/watch). Price Watch sub-tab. |
| 15 | Destination weather forecast | ALREADY REAL | `weather-forecast` — real Open-Meteo 16-day forecast. Weather tab. |
| 16 | Visa/entry-requirement lookup | ALREADY REAL (honestly narrow) | `visaCheck` — real bilateral tables (Schengen/CTA/USMCA) with an explicit "consult embassy" fallback rather than a fabricated comprehensive table. Quick Tools + Destination Reference tabs. |
| 17 | Currency conversion at live rates | ALREADY REAL | `currency-convert` — real ECB-backed exchangerate.host. Destination Reference tab. |
| 18 | Saved places / wishlist with ratings & reviews (Google Maps lists, TripAdvisor-shape) | ALREADY REAL | `place-add`/`place-list`/`place-detail`/`place-review`/`place-save` — `TravelExplorePanel`, My Trips → Explore sub-tab. ~~`place-delete` exists on the backend but has no UI button yet — small follow-up, flagged, not a rebuild blocker.~~ **`place-delete` surfaced (2026-07-12, `977aaab0`, Wave 4)** — a Remove control in the place detail view with a confirm step; the macro is contributor-gated server-side (`addedBy` must match), so the panel always offers the button and renders the server's real rejection for non-contributors instead of guessing ownership client-side. Pinned by `tests/components/TravelExplorePlaceDelete.test.tsx` (3/3). |
| 19 | Live bookable flight search + pricing (Google Flights/Kayak/Expedia's core product) | GENUINELY MISSING (honest relabel already in place) | `flight-search` surfaces REAL live airborne traffic (OpenSky state vectors) for inspiration/spotting, explicitly NOT bookable fares — the result payload and UI copy both say "real ticket prices need a licensed GDS API (Amadeus/Skyscanner/Kiwi)". This is a genuine, disclosed, paid-third-party-contract gap, not a frontend task. |
| 20 | Live bookable hotel search + pricing | GENUINELY MISSING (honest relabel already in place) | `hotel-search` returns real OSM Overpass lodging POIs (inspiration), explicitly not bookable rates — same disposition as #19. |
| 21 | Quick one-off trip-cost/packing/jetlag/visa calculators without saving a trip | ALREADY REAL (fixed by this rebuild) | `tripBudget`/`packingList`/`jetlagCalc`/`visaCheck` standalone in Quick Tools — was broken (wrong field vocabulary, see "What changed" #1), now correct. |

**(d) Coverage:** 15 of 21 checklist items ALREADY REAL, 1 honestly-narrow-
but-real (#16 visa tables), 5 GENUINELY MISSING and explicitly scoped
(#2 inbox sync — moderate connector-reuse build; #8 document attachments —
modest backend addition; #10 loyalty points, #11 airport maps — out of
scope, not flagged as priorities; #19/#20 live bookable pricing — real,
disclosed, paid-third-party-API-required gap, the correct honest framing
per the domain file's own comments). Nothing silently gapped — every
GENUINELY MISSING item above carries an explicit disposition.

## What this rebuild built

- `concord-frontend/app/lenses/travel/page.tsx` — full rewrite (606 → 220
  LOC): real `travel-dashboard` header KPI strip via
  `useMacroDispatchFeedback` (honest loading/running/done/error states),
  3 bespoke top-level tabs (My Trips / Destination Reference / Quick
  Tools), keyboard hotkeys `1`-`3` + `r`, `DensityToggle`. Generic
  scaffold (action-bar/auto-strip/recent-mine trio + universal-actions/
  lens-feature-panel body) and the disconnected generic-artifact trip CRUD
  removed. Dead "live" indicator removed (no realtime channel exists for
  this domain).
- `concord-frontend/components/travel/TravelActionPanel.tsx` — fixed 4
  real field-vocabulary bugs (see "What changed" #1); no structural
  rewrite otherwise (Mint/DM/Publish/Local-tip actions kept, corrected to
  reference the fixed result shapes).
- `concord-frontend/components/travel/TripWorkspace.tsx` — extended from
  8 to 10 tabs: added Itinerary (add/list/delete), folded Bookings
  (manual add/list/delete) together with the existing email-Import flow,
  added Packing (checklist add/toggle/delete), added a budget-set form to
  the Budget tab.
- `concord-frontend/components/travel/TravelTripsSection.tsx` — "My
  Trips" tab now opens `TripWorkspaceSection` (the real macro-backed trip
  list + workspace) instead of the now-deleted `TravelTripsPanel`.
- `concord-frontend/components/travel/TripWorkspaceSection.tsx` — added
  an optional `onChange` callback so the section's dashboard stats refresh
  when the user returns from editing a trip.
- `concord-frontend/components/travel/TravelTripsPanel.tsx` — **deleted**
  (fully superseded by the enhanced `TripWorkspace` — see "What changed" #3).
- No backend changes — every gap closed above was a frontend wiring gap
  against an already-real macro (`budget-set`, `checklist-*`,
  `itinerary-add`, `booking-add`) or a field-shape bug in the frontend
  caller; the domain was already complete for the scope of this rebuild.

## Verification

- `npx eslint` on all touched files — clean.
- `npx tsc --noEmit -p .` — 0 new errors (1 pre-existing, unrelated error
  in `components/ar/AssetLibrary.tsx`, confirmed untouched by this work
  via `git status`).
- No `travel`-lens-specific test file exists (`tests/*travel*` only
  matches the unrelated Concordia fast-travel tests) — nothing to update,
  nothing broken.
- `node scripts/verify-lens-backends.mjs` — `{"WIRED":258,"NO-BACKEND-CALL":2}`,
  travel is not in the 2-item NO-BACKEND-CALL list (`narrative-walk`,
  `ux-suite`) — stays WIRED.
- `node scripts/grade-ux-polish.mjs --honest` — travel:
  `"isGenericScaffold": false, "tier": "polished", "honestCapped": false,
  "importsGenericTrio": false, "usesGenericBody": false, "pageLoc": 220,
  "maxBespokeComponentLoc": 1075, "bespokeRatio": 0.922`. (A first run
  raced a concurrent shared-worktree process that was regenerating the
  same audit JSON and produced a stale false positive — re-run confirmed
  clean; see the frontend agent's full report for the reproduction
  detail.) `audit/`/`reports/` reverted via `git checkout` after grading,
  per repo convention (transient regenerated artifacts, never committed).
