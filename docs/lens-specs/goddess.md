# goddess — Feature Gap vs no direct rival (in-world ambient feed)

Category leader (2026): no direct consumer rival — it is the public ambient feed of Concordia's goddess dispatches. Closest analog is an in-app announcement / oracle feed.
Backend: `goddess.recent` macro (inline `register()` in server.js) reading the `goddess_dispatches` table — hourly composed dispatches with tone, ecosystem score, refusal strength, drift kind.

## Has (verified in code)
- Ambient dispatch feed — body text, tone, ecosystem score, refusal strength, drift kind
- Auto-refresh every 60s
- Tone color-coding (exalted / warm / neutral / cold / mourning)
- GoddessGallery component for browsing dispatches

## Missing — buildable feature backlog
- [ ] `[S]` Dispatch detail / permalink view
- [ ] `[S]` Filter by tone or time range
- [ ] `[S]` React / commune on a dispatch (tie into the commune mechanic)
- [ ] `[M]` Dispatch history archive with search
- [ ] `[S]` Subscribe / notify on a tone change (e.g. mourning dispatch)
- [ ] `[S]` Correlate dispatch with the world event that triggered it

## Parity
~55% of an ambient-feed surface for what it scopes. It does its narrow job well — a tone-colored, auto-refreshing oracle feed grounded in real ecosystem/refusal/drift state — but it is read-only with no detail view, filtering, history search, or interaction.
