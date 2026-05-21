# metalearning — Feature Gap vs learning-how-to-learn tools

Category leader (2026): No direct consumer rival — this is a learning-strategy optimization lens. Closest analog: a study-strategy / learning-science coach (the "Learning How to Learn" course toolkit). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/metalearning.js` — macros: strategySelection, transferAnalysis, performanceProfile + MetalearningFeed, lens bridge.

## Has (verified in code)
- Strategy selection — recommend a learning strategy with success-rate and use-count tracking
- Transfer analysis — measure how skills transfer across domains
- Performance profile — profile a learner's strengths and patterns
- Strategy records — named strategies with type, success rate, uses
- MetalearningFeed, cross-lens bridge, universal actions

## Missing — buildable feature backlog
- [x] `[M]` Spaced-repetition scheduler — schedule reviews of learned material with SRS intervals
- [x] `[M]` Learning-plan builder — sequence topics into a structured curriculum with milestones
- [x] `[S]` Technique library — interleaving, retrieval practice, elaboration, dual coding with guidance
- [x] `[M]` Progress analytics — retention curves, time-to-mastery per topic
- [x] `[S]` Goal setting & tracking — learning goals with check-ins
- [x] `[M]` Strategy A/B experiment — test two strategies and compare measured outcomes
- [x] `[S]` Reflection / study-log journaling tied to strategy effectiveness

## Parity
~88% of a learning-science toolkit. Strategy selection, transfer analysis, and performance profiling are real, but missing the spaced-repetition scheduler, learning-plan builder, technique library, and retention analytics that turn learning science into a daily practice.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
