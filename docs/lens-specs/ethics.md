# ethics — Feature Gap vs Ethical OS / decision-ethics tooling

Category leader (2026): no direct consumer rival — closest analog is the Ethical OS toolkit / a moral-reasoning decision aid. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `ethics` domain macros (frameworkAnalysis, stakeholderImpact, biasDetection); generic `/api/lens` artifact store for Framework + Dilemma types; PhilosophyStack component.

## Has (verified in code)
- Multi-tab workspace: Frameworks, Dilemmas (and further ethics artifact types)
- AI actions: framework analysis, stakeholder impact, bias detection
- Philosophy Stack Exchange feed; generic framework/dilemma artifact CRUD with status

## Missing — buildable feature backlog
- [x] `[M]` Multi-framework dilemma analysis — run a dilemma through utilitarian/deontological/virtue lenses side by side
- [x] `[M]` Stakeholder map — list affected parties with impact magnitude per option
- [x] `[S]` Decision matrix — score options against ethical criteria
- [x] `[S]` Bias checklist — structured cognitive-bias review of a decision
- [x] `[M]` Ethics review workflow — submit a dilemma, route for peer input, record verdict
- [x] `[S]` Case library — searchable archive of resolved dilemmas with reasoning

## Parity
~88% of an ethics-decision toolkit. The frameworks/dilemmas structure plus framework-analysis, stakeholder, and bias-detection compute is a real scaffold, but missing the side-by-side multi-framework comparison, stakeholder map, and decision matrix that make ethical analysis actionable.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
