# grounding — Feature Gap vs Ground News / fact-check tools

Category leader (2026): Ground News + Snopes/PolitiFact (claim verification). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `grounding` domain — factCheck, sourceCredibility, claimDecomposition; generic artifact store; MindfulnessFeed component (note: page name overlaps a separate "grounding" mindfulness UI — backend is fact-grounding).

## Has (verified in code)
- Claim fact-checking with a verdict
- Source credibility scoring
- Claim decomposition — break a complex claim into atomic verifiable sub-claims
- Verification status surfacing (CheckCircle/XCircle, Antenna/Database/FileCheck icons)
- Search across grounded claims

## Missing — buildable feature backlog
- [ ] `[M]` Multi-source evidence aggregation per claim with citations
- [ ] `[S]` Confidence / probability rating instead of binary verdict
- [ ] `[M]` Bias / political-lean labeling of sources (Ground News's signature)
- [ ] `[S]` Claim history / verification audit trail
- [ ] `[M]` Live news ingestion to surface trending claims to check
- [ ] `[S]` Shareable fact-check cards
- [ ] `[S]` Counter-claim / rebuttal linking

## Parity
~45% of a fact-verification tool's surface. Claim decomposition, source scoring, and verdicts are real building blocks, but it lacks multi-source evidence aggregation, source bias labeling, and live-news claim discovery — the features that make Ground News and the fact-checkers useful day to day.
