# goddess — Feature Gap vs no direct rival (in-world ambient feed)

Category leader (2026): no direct consumer rival — it is the public ambient feed of Concordia's goddess dispatches. Closest analog is an in-app announcement / oracle feed.
Backend: `goddess.recent` macro (inline `register()` in server.js) reading the `goddess_dispatches` table — hourly composed dispatches with tone, ecosystem score, refusal strength, drift kind.

## Has (verified in code)
- Ambient dispatch feed — body text, tone, ecosystem score, refusal strength, drift kind
- Auto-refresh every 60s
- Tone color-coding (exalted / warm / neutral / cold / mourning)
- GoddessGallery component for browsing dispatches

## Missing — buildable feature backlog
- [x] `[S]` Dispatch detail / permalink view
- [x] `[S]` Filter by tone or time range
- [x] `[S]` React / commune on a dispatch (tie into the commune mechanic)
- [x] `[M]` Dispatch history archive with search
- [x] `[S]` Subscribe / notify on a tone change (e.g. mourning dispatch)
- [x] `[S]` Correlate dispatch with the world event that triggered it

## Parity
~90% of an ambient-feed surface for what it scopes. The tone-colored auto-refreshing oracle feed grounded in real ecosystem/refusal/drift state plus a dispatch detail/permalink view, tone + time filtering, commune reactions, a searchable history archive, tone-change subscriptions, and world-event correlation all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
