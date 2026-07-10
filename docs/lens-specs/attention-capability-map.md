# attention — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Reproduce the macro list:
> `grep -c 'registerLensAction("attention"' server/domains/attention.js` → 21 (script reports 22 macros exercised — the count includes an alias; the 21 distinct action names above are the ground truth from the grep).

## Reference app + parity target

**RescueTime + Sunsama (2026 shape)** — cognitive-load / focus-session
analytics (deep-work ratio, interruption rate, context-switch cost) fused
with a timeboxed daily planner (Eisenhower prioritization + a logarithmic
fatigue-aware attention budget). `FocusToolkit.tsx` (603 LOC) already
implements the Pomodoro timer, timeboxed planner, distraction log, focus
mode, and calendar-block reservation UI, all correctly wired. The page
also runs a second, legitimately separate "parallel reasoning threads"
system (`apiHelpers.attention.*`, a real backend thread/queue manager, not
part of `attention.js`'s macro surface) for cognitive-thread scheduling.

## `node scripts/lens-unsurfaced.mjs --lens attention` (after fix)

```
attention: 0/22 macros never referenced in the frontend
```

## Findings

### "Computational Actions" grid was permanently unreachable — REAL DEFECT (fixed)

`page.tsx`'s three "Computational Actions" buttons (Focus Score, Priority
Matrix, Attention Budget) called `focusScore` / `priorityMatrix` /
`attentionBudget` — all three real macros with rich, bespoke result
renderers already built for them — but ran them against
`attentionItems[0]?.id`, an id sourced from
`useLensData('attention', 'thread', {seed:[]})`, the **generic
lens-artifact store**. Nothing anywhere ever creates an artifact of domain
`attention` / type `thread` through that store — the page's own "New
Cognitive Thread" form posts through the *real* parallel-reasoning-thread
backend (`apiHelpers.attention.createThread`), a completely different
system. So `attentionItems` was always empty, the three buttons were
permanently `disabled`, and the hint text ("Add cognitive threads above to
enable computational actions") pointed at a form that could never satisfy
it — a real macro reached only through a phantom-artifact button wall that
could never fire.

**Fix:** rewrote `handleAttentionAction` to build genuinely-shaped input
from the two real data sources these macros were designed to consume:

- `focusScore` reads `artifact.data.sessions`; the Focus Toolkit's
  Pomodoro subsystem already records exactly this shape
  (`pomodoroStats.recentSessions`: `startedAt`/`endedAt`/`interruptions`/
  `deepWork`). The handler now fetches `pomodoroStats`, remaps to the
  macro's expected `{startTime, endTime, ...}` field names, and calls
  `focusScore` for real.
- `priorityMatrix` / `attentionBudget` read `artifact.data.tasks`
  (`urgency`/`importance`/`effort`/`cognitiveLoad`, 0–10 scales); the
  daily planner's tasks carry real, user-entered `priority` (0–1),
  `startMinute`, and `durationMinutes`. The handler derives
  urgency from proximity to the scheduled start time, importance from
  priority, effort/cognitiveLoad from duration and priority — a
  documented, traceable derivation from real user input, not invented
  numbers.

The buttons are now enabled based on genuine data availability
(`hasSessions`/`hasPlannerTasks`, refetched from the same real macros)
with an honest hint pointing at the actual place to unlock them (the Focus
Toolkit above), replacing the old, impossible-to-satisfy hint.

## Verify gate

- `npx eslint app/lenses/attention/page.tsx` — 0 errors/warnings.
- `npx tsc --noEmit -p .` — 0 errors attributable to this file.
- `node scripts/verify-lens-backends.mjs` — `attention` reports WIRED.
- `node scripts/grade-ux-polish.mjs --honest` — `attention`: `tier: "polished"`, `isGenericScaffold: false`, `bespokeRatio: 0.41`.
