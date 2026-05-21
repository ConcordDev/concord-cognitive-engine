# attention — Feature Gap vs Sunsama / Motion

Category leader (2026): Sunsama / Motion (focus + attention management). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/attention.js` — macros `focusScore`, `priorityMatrix`, `attentionBudget`; generic artifact store for threads; mounts emergent Attention/Dream/Forgetting/Repair panels.

## Has (verified in code)
- Attention threads (reasoning/analysis/creative/memory-search/planning types) with priority + status
- Thread filter (all/active), create/play/complete threads
- Focus-score compute, priority-matrix (Eisenhower-style), attention-budget allocation
- Emergent substrate panels: AttentionPanel, DreamPanel, ForgettingPanel, RepairPanel
- EntityGrowthDashboard; cognitive-entity cards

## Missing — buildable feature backlog
- [ ] `[M]` Focus-session timer (Pomodoro) with start/break/stats
- [ ] `[M]` Daily attention planner — drag tasks into a timeboxed day
- [ ] `[S]` Distraction log / interruption tracking
- [ ] `[M]` Focus analytics: deep-work hours per day/week trends
- [ ] `[S]` Do-not-disturb / focus-mode toggle that mutes notifications
- [ ] `[M]` Calendar integration to reserve focus blocks
- [ ] `[S]` Energy/mood tagging per session to find peak hours

## Parity
~42% of Sunsama's surface. The thread + priority + budget model and the emergent cognitive panels are unusual and real, but the consumer focus-tool staples — Pomodoro timer, day planner, focus analytics — are absent.
