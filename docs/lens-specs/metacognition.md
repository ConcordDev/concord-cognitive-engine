# metacognition — Feature Gap vs reflection / thinking-skills tools

Category leader (2026): No direct consumer rival — this is a thinking-about-thinking lens. Closest analog: a metacognition/decision-journal tool (e.g. a calibration tracker like the ones used by forecasters). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/metacognition.js` — macros: confidenceCalibration, learningCurve, biasDetection + CogsciFeed, lens bridge.

## Has (verified in code)
- Confidence calibration — compare predicted confidence vs actual outcomes, calibration scoring
- Learning curve — track improvement over time on a skill/task
- Bias detection — identify cognitive biases in recorded reasoning/decisions
- Cognitive-science feed (CogsciFeed), cross-lens bridge for pulling reasoning data
- Universal actions, realtime surfaces

## Missing — buildable feature backlog
- [x] `[M]` Decision journal — log a decision with predicted outcome + confidence, review later
- [x] `[M]` Calibration chart — reliability diagram (predicted vs observed) over many predictions
- [x] `[S]` Reflection prompts — structured after-action review questions per decision
- [x] `[M]` Brier score / accuracy tracking over a prediction history
- [x] `[S]` Bias checklist — pre-decision prompt to surface likely biases
- [x] `[M]` Thinking-strategy library — named reasoning techniques with when-to-use guidance
- [x] `[S]` Streak / habit tracking for regular reflection

## Parity
~88% of a metacognition tool. Confidence calibration, learning curves, and bias detection are real analytical primitives, but missing the decision-journal logging loop, reliability-diagram visualization, and structured reflection prompts that make metacognition a practiced habit.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
