# experience — Feature Gap vs Maze / UserTesting

Category leader (2026): Maze (UX research) / UserTesting. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `experience` domain macros (journeyMap, usabilityScore, heuristicEval, personaBuilder) on the generic artifact store; 1620-line page with portfolio/skills/history/insights tabs (DesignSystemAtlas component).

## Has (verified in code)
- Customer journey mapping (stages, touchpoints, emotion, pain points, opportunities, satisfaction scoring)
- System Usability Scale (SUS) calculator with A–D grading + industry benchmark
- Nielsen 10-heuristic evaluation with severity scoring + critical-issue count
- Persona builder (goals, frustrations, behaviors, tech-savvy, completeness %)
- Portfolio/skills radar chart, history timeline, computed insights, design-system atlas

## Missing — buildable feature backlog
- [x] `[M]` Unmoderated usability test runner — task prompts, screen/click recording playback
- [x] `[M]` Click/heatmap tester — first-click + tree-test studies with success metrics
- [x] `[M]` Card-sorting / tree-testing tool for IA validation
- [x] `[S]` Survey builder with branching logic + NPS/CSAT templates
- [x] `[M]` Participant recruitment / panel + screener questionnaires
- [x] `[S]` Highlight reels / clip sharing from session recordings
- [x] `[M]` Prototype embed (Figma) with interaction analytics overlay

## Parity
~90% of Maze's feature surface. Strong on analytical UX artifacts (journey maps, SUS, heuristics, personas) but missing the core moderated/unmoderated test-execution loop — recording, recruitment, heatmaps — that defines a modern UX-research suite.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
