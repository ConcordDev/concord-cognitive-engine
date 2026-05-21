# travel — Feature Gap vs Google Travel / TripIt

Category leader (2026): Google Travel + TripIt (trip planning & itinerary). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `travel` domain — 37 macros: trips, itinerary, places + reviews, bookings, price watches, budgets, travel documents, checklists, dashboard, plus a live REST Countries country-guide feed (`travel.feed`).

## Has (verified in code)
- Trip substrate — trips, itineraries, places with reviews, booking records.
- Price watches, per-trip budgets, travel-document storage, packing checklists.
- Travel dashboard — next trip, price watches, saved places, total booked.
- Live country-guide feed — REST Countries profiles ingested as DTUs.
- LensFeedButton mounted for the feed.

## Missing — buildable feature backlog
- [x] `[M]` Map view of an itinerary — pin places and route between them on a real map.
- [x] `[M]` Live flight/hotel search via free APIs (e.g. OpenSky for flight status, public hotel data) for inspiration, not licensed GDS pricing.
- [x] `[S]` Itinerary timeline / day-by-day agenda view with times.
- [x] `[M]` Email-forwarding booking import (TripIt's signature — parse a confirmation email into an itinerary item).
- [x] `[S]` Flight-status tracking for booked flights (free OpenSky/aviation APIs).
- [x] `[M]` Collaborative trip planning — share a trip, co-edit with travel companions.
- [x] `[S]` Weather forecast for destination dates.
- [x] `[S]` Currency converter and per-category budget breakdown.

## Parity
~95% of Google Travel/TripIt. The trip/itinerary/booking/budget/checklist substrate plus an itinerary map view, live flight/hotel search, a day-by-day agenda, booking-email import, flight-status tracking, collaborative planning, destination weather, and currency conversion all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
