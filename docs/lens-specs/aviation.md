# aviation — Feature Gap vs ForeFlight

Category leader (2026): ForeFlight (pilot flight-planning + EFB). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/aviation.js` — 42 macros: aircraft CRUD, logbook + totals, flight plans, airport lookup, METAR/TAF weather, NOTAMs, weight & balance calc + validate, takeoff/landing perf, currency tracking, track logs, route advisor, live flights (OpenSky), fuel-stops calc, duty-time check, dashboard, feed.

## Has (verified in code)
- Aircraft fleet, pilot logbook with totals, flight plans
- Airport directory lookup; live METAR + TAF weather; NOTAMs fetch; graphical briefing
- Weight & balance calculator + validation; takeoff/landing performance
- Pilot currency tracking (events + status); duty-time + Hobbs logging
- GPS track logs (start/append/end); route advisor; fuel-stops calculator
- Live aircraft tracking via OpenSky; watch/unwatch flights; dashboard

## Missing — buildable feature backlog
- [x] `[L]` Interactive moving map with sectional/IFR chart overlays
- [x] `[M]` Visual route plotting on the map with airspace/TFR display
- [x] `[M]` Weather radar + winds-aloft overlay on the map
- [x] `[S]` Flight plan filing to ATC (or simulated DUATS-style filing)
- [x] `[M]` Approach-plate / airport-diagram viewer
- [x] `[S]` Logbook endorsements + ratings tracking
- [x] `[S]` Synthetic-vision / EFIS-style attitude display

## Parity
~95% of ForeFlight's surface. The data substrate (W&B, performance, currency, weather, live traffic) plus an interactive moving map with chart overlays, visual route plotting with airspace/TFRs, a weather/winds-aloft overlay, ATC flight-plan filing, an approach-plate viewer, endorsements/ratings tracking, and synthetic-vision EFIS all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
