# All-Lens Render Walkthrough — Findings

Playwright walk of **all 230 lenses** under `app/lenses/<name>/page.tsx`,
each with an authed session + the four onboarding wizards pre-dismissed
via localStorage. Per lens: navigate → wait 3.5s for hydration → detect
LensErrorBoundary fallback → screenshot → bucket the result.

## Summary

| Bucket | Count | % of 230 |
|---|--:|--:|
| **green** (clean render, no console errors) | **212** | 92.2% |
| **noisy** (renders but emits console.error) | **14** | 6.1% |
| **crashed** (error-boundary fallback visible) | **3** | 1.3% |
| **timeout** | **1** | 0.4% |

**Effective ship rate: 226 / 230 lenses render to the user. 98.3%.**

Generated 2026-05-13.

## Crashed (3)

### `atlas` — Leaflet `Map container is already initialized`
Same React-strict-mode double-init pattern as the world-lens Rapier
physics-destroy crash documented earlier. Fix: guard the Leaflet
init with a ref-counter or move init to a `useEffect` cleanup that
properly releases the container.

### `code` — `Event`
Terse — likely a top-level `error` event handler that received an
`ErrorEvent` instance and called `String(event)` instead of `event.error`.
Need to expand `<details>` on a re-screenshot to get the real trace.

### `genesis` — `TypeError: Cannot read properties of undefined (reading 'replace')`
```
at renderContent (app/lenses/genesis/page.tsx:284:36)
at ActivityItem    (app/lenses/genesis/page.tsx:317:35)
```
An `ActivityItem` is being rendered with one of its string fields
missing. Add an `?? ''` or guard before `.replace()`.

## Noisy (14)

### Single backend-500 pattern — 12 lenses
All emit `console.error: Server error: {error: Internal server error}`:

`audit · docs · export · fork · grounding · ingest · invariant · lock · metalearning · queue · reflection · transfer`

Lens UI renders fine; a specific macro returns HTTP 500 and the
client logs the failure into `console.error`. **One backend fix
likely fixes all twelve.** Suspect a shared helper or a freshly-
broken macro the lenses all call (likely from a domain-utility
library — these 12 lenses are typically the ones that fetch some
common "system state" metadata on mount).

### `analytics` — React Query returns undefined
`Query data cannot be undefined. Please make sure to return a value
other than undefined from your query function. Affected query key:
["my-s...`. The query function needs to return `null` or an empty
shape instead of undefined.

### `neuro` — 28 errors, `Network error - no response received`
Polling loop is hammering an endpoint that's not responding. Either
add a circuit breaker or stop polling on the first failure with
a backoff.

## Timeout (1)

### `feed`
`page.waitForTimeout: Test ended.` Lens compile or render exceeded
the 120s per-lens timeout in dev mode. May simply be a heavy bundle
(feeds usually pull RSS/Atom + render rich previews). Re-run with
larger timeout to disambiguate from a real hang.

## Spec details

- `tests/e2e/all-lenses-walk.spec.ts` — parameterised by `LENS_LIST`
  env var so partial re-runs target specific lenses + the `afterAll`
  merges results.
- `playwright.smoke.config.ts` — `globalTimeout: 90 * 60_000` (90 min)
  so all 230 visits fit one suite run.
- `docs/all-lens-walk/<lens>.png` — one screenshot per lens.
- `docs/all-lens-walk/<lens>.log` — console errors when present.
- `docs/all-lens-walk/results.json` — full per-lens bucket assignment.

Run command:
```bash
cd concord-frontend
BASE_URL=http://localhost:3000 \
  ./node_modules/.bin/playwright test \
  --config=playwright.smoke.config.ts \
  tests/e2e/all-lenses-walk.spec.ts \
  --reporter=list --workers=1 --timeout=120000
```

## Fix plan

1. **Diagnose the 12-lens backend 500 pattern.**
   Visit one (e.g. `/lenses/audit`), open devtools Network tab, find the
   failing `/api/lens/run` call, identify the `domain` + `name` of the
   failing macro. Likely a single missing-table or shared-helper bug.

2. **Patch `genesis/page.tsx:284`** — add `?? ''` or guard before
   `.replace()` on the activity-item field.

3. **Patch `atlas` Leaflet init** — wrap container init in a ref-counter
   like the world lens's R3F gate, or move to one-shot useEffect with
   stable cleanup.

4. **Diagnose `code` lens.** Expand technical details disclosure in a
   targeted re-run to get the real stack.

5. **Patch `analytics` query function** — return `null` on no-data
   instead of falling through to undefined.

6. **Throttle `neuro` poll loop** — add exponential backoff or stop on
   first 5xx.

7. **Re-run `feed` with longer timeout** to determine if it's a real hang
   or just a heavy bundle.

After (1)–(6), the ship rate goes from 98.3% to ~99.5%. Then a
backend audit on the macro shared by the 12 noisy lenses likely
gets us to 100%.
