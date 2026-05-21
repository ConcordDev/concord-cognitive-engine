# reflection — Feature Gap vs Day One

Category leader (2026): Day One (journaling) + Stoic/reflection apps. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/reflection.js` — ~27 macros: journal CRUD, entry CRUD + search, on-this-day, streaks, stats, daily prompts (today/library/random), templates, tags, calendar month, mood trend, LLM reflect-deepen + entry-summarize, reflection goals, dashboard, insight extraction, growth metrics, habit tracking.

## Has (verified in code)
- Multiple journals; entry CRUD with search; on-this-day memory surfacing
- Journal streak tracking + stats; daily reflection prompts (today/library/random)
- Entry templates + create-from-template; tags; calendar month view
- Mood trend tracking; LLM reflect-deepen + entry-summarize
- Reflection goals (set/status); insight extraction, growth metrics, habit tracking; dashboard

## Missing — buildable feature backlog
- [ ] `[M]` Rich entry editor with photos/media — attach images, location, weather to entries
- [ ] `[S]` Daily writing reminders + notifications
- [ ] `[S]` End-to-end encryption — private-journal encryption at rest
- [ ] `[M]` Timeline / map view of entries — browse the journal spatially and chronologically
- [ ] `[S]` Audio/voice journaling — record and transcribe spoken entries
- [ ] `[S]` Year-in-review / journal export — printable book or PDF export
- [ ] `[S]` Multi-device sync indicator + offline drafts

## Parity
~60% of Day One's feature surface. The journaling substrate is strong — streaks, prompts, templates, mood, on-this-day, and LLM-deepened reflection. Gaps are rich media in entries, reminders, encryption, and timeline/map browsing.
