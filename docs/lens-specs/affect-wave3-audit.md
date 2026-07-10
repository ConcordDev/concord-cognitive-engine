# affect — Wave 3 audit (confirming — no changes)

Frontend Rebuild Program, Wave 3. `affect` already scored `polished` under
`grade-ux-polish.mjs --honest`. This audit reads the actual code before
concluding "nothing to fix."

Backend: `server/domains/affect.js` (1,087 LOC — the older `affect.md` spec's
"504 LOC" figure is stale). 14 registered macros: `sentimentAnalysis`,
`emotionTimeline`, `empathyMap`, `checkin`, `checkinHistory`, `trends`,
`activityCorrelation`, `journalPrompts`, `setReminder`, `nudges`,
`exportReport`, `getScale`, `setScale`, `detect-patterns`.

## `node scripts/lens-unsurfaced.mjs --lens affect`

```
affect: 0/14 macros never referenced in the frontend
```

Every macro is reachable. `concord-frontend/components/affect/MoodTracker.tsx`
(1,097 LOC) is a genuinely bespoke, tabbed check-in/trends/activities/
reminders/scale surface — not a generic action array. Verified directly:

| Feature (Daylio / Hume AI parity target) | Where |
|---|---|
| Daily check-in with streak tracking | `checkin`/`checkinHistory` → `MoodTracker.tsx` check-in tab |
| Weekly/monthly trend charts | `trends` → trends sub-tab |
| Activity/tag correlation | `activityCorrelation` → activities sub-tab |
| Journaling prompts per entry | `journalPrompts` (fetched 3 at a time, `MoodTracker.tsx:210`) |
| Mood-based reminders/nudges | `setReminder`/`nudges` → reminders sub-tab (daily / streak-risk / low-mood conditions) |
| Export report (CSV/JSON) | `exportReport` → `MoodTracker.tsx:384-388` |
| Customizable mood scale | `getScale`/`setScale` → scale sub-tab |

Also present: `LiveAffectStream.tsx` (realtime affect event stream) and the
five-dimension gauge view (valence/arousal/stability/coherence/growth) on
the main `page.tsx`, with `sentimentAnalysis`/`emotionTimeline`/`empathyMap`
as the compute macros behind them.

No `Math.random()`, no fabricated numbers, no dead-click buttons, no
generic-scaffold remnants found. This lens is genuinely complete against
its Daylio/Hume-AI reference bar. No changes made.
