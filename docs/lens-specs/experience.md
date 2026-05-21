# experience — Feature Gap vs Notion Portfolio / Behance + Maze (UX research)

Category leader (2026): hybrid — Behance/personal-site for portfolio, Maze/Dovetail for UX research. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `experience` domain macros (journeyMap, usabilityScore, heuristicEval, personaBuilder — 31 LOC, thin) + generic `/api/lens` artifact store for portfolio/skill/history items.

## Has (verified in code)
- Portfolio tab — projects/releases/art/collaboration items with type badges and filters
- Skills tab + History tab + Insights tab; profile stats (projects, collabs, sales, followers)
- DesignSystemAtlas component mounted (design-token surface)
- UX-research macros: journey map (touchpoints/emotions), usability score, heuristic eval, persona builder
- DTU export, realtime panel, cross-lens recents

## Missing — buildable feature backlog
- [ ] `[M]` Public shareable portfolio page — render the profile at a public URL like a Behance/personal site
- [ ] `[M]` Case-study editor — long-form rich project write-ups with embedded media, not just item cards
- [ ] `[M]` Usability test sessions — record task flows, success rate, time-on-task per participant
- [ ] `[S]` Heatmap / click-map view on journey-map touchpoints
- [ ] `[M]` Survey builder + response collection (Maze-style unmoderated tests)
- [ ] `[S]` Skill endorsements / verification from collaborators
- [ ] `[S]` Affinity-diagram clustering of research notes

## Parity
~40% of a Behance+Maze hybrid. Portfolio cataloguing works and the UX-research macros are real but shallow (no participant sessions, no public share page). A real designer's two core jobs — showing work publicly and running tests — are both stubbed.
