# analytics — Wave 3 audit (confirming — no changes)

Frontend Rebuild Program, Wave 3. `analytics` already scored `polished`
under `grade-ux-polish.mjs --honest`. This audit reads the actual code
before concluding "nothing to fix."

Backend: `server/domains/analytics.js` (921 LOC). 32 registered macros
covering event track/list/stats, funnels (build/save/list/delete),
segmentation, retention, dashboard, `funnelAnalysis`, `cohortAnalysis`/
`cohort-build`/`cohort-save`, `detectAnomalies`, `trendForecast`, and an
alerting subsystem (`alert-save`/`alert-list`/`alert-evaluate`/`alert-delete`).

## `node scripts/lens-unsurfaced.mjs --lens analytics`

```
analytics: 1/32 macros never referenced in the frontend
  alert-* (1): alert-evaluate
```

## Finding: `alert-evaluate` — FALSE POSITIVE (no change)

Read `server/domains/analytics.js:562-637`. `alert-list` (surfaced, called
from `AdvancedAnalytics.tsx:672`) already maps every saved alert through the
exact same `evaluateAlert()` helper function `alert-evaluate` calls — it
returns each alert's live `{ value, firing, detail }` inline as part of the
list response (`alert-list`'s handler: `anAlerts(...).map((a) => ({ ...a,
...evaluateAlert(log, a) }))`). `alert-evaluate` is a single-alert
convenience re-check (useful for an external caller polling one alert by
id) that duplicates data the list view already renders per-row. There is no
unmet UI capability — the firing/value/detail the standalone macro would
return is already on screen for every alert. No change made.

## Reference-app parity check (Mixpanel / Amplitude)

Spot-verified against `AdvancedAnalytics.tsx` (990 LOC, the largest bespoke
component) and `EventAnalytics.tsx`/`FunnelsPanel.tsx`/`PlatformGrowth.tsx`:

| Feature | Where |
|---|---|
| Saved-dashboard / custom report builder | `AdvancedAnalytics.tsx` dashboard tab |
| Funnel builder + conversion | `FunnelsPanel.tsx` + `funnel-build`/`funnel-save`/`funnel-list` |
| Retention report | `retention-report` |
| Segmentation | `segment` macro |
| Live event stream/debugger | `EventAnalytics.tsx` event log view (`event-list`) |
| Threshold/anomaly alerting | `alert-save`/`alert-list`/`alert-delete` → `AdvancedAnalytics.tsx:672,684,700` |
| Behavioral cohort builder | `cohort-build`/`cohort-save` |
| Anomaly detection / trend forecast | `detectAnomalies`/`trendForecast` |

The grader's `hasKeyboardHandlers: false` flag is a false negative too —
`app/lenses/analytics/page.tsx:4,94` imports and calls `useLensCommand` for
real keyboard bindings; the grader's regex apparently misses this idiom.
Not a functional gap, no fix needed (the grader itself is out of scope for
this rebuild pass — it is PROTECTed per `CLAUDE.md` §4 and would need a
separate bidirectional-correctness fix with authorization, not a Wave-3
lens rebuild).

No `Math.random()`, no fabricated numbers found in the four bespoke
components reviewed here.

**Correction (later Wave-3 pass, see `docs/lens-specs/analytics-capability-map.md`):**
the "no dead clicks found" claim above was wrong — it audited the four
bespoke components but missed the page's own "Actions" tab, which ran a
second, broken copy of the four calculator macros through the generic
`useLensData`/`useRunArtifact` artifact-CRUD hooks against a `dataset`
artifact type that never existed, so all four buttons were dead clicks.
Fixed by mounting the real, already-tested `AnalyticsActionPanel` in that
tab instead. See the capability-map doc for the full writeup.
