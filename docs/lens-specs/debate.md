# debate — Feature Gap vs Kialo

Category leader (2026): Kialo (structured argument mapping). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `debate` domain macros — pure-compute (evaluateArgument, steelmanPosition, scoreDebate, fallacyCheck) plus debate substrate (debate-create/list/detail/delete, claim-add/edit/delete/vote, debate-dashboard).

## Has (verified in code)
- Debate CRUD with phased lifecycle (opening → rebuttal → voting) and turn enforcement
- Pro/con argument submission with per-argument votes; side switching (P/C keys)
- Claim add/edit/delete/vote (argument tree primitives)
- Debate scoring (args×10 + votes×2); DebateTree visualization; CmvFeed (Reddit r/changemyview)
- AI actions: evaluate argument, steelman a position, score debate, fallacy check
- DebateActionPanel; debate dashboard

## Missing — buildable feature backlog
- [ ] `[M]` Recursive claim tree — claims supporting/attacking other claims to arbitrary depth (Kialo's core)
- [ ] `[M]` Per-claim impact rating that propagates up the argument tree
- [ ] `[S]` Argument-tree visual map with collapse/expand and pro/con coloring
- [ ] `[M]` Multi-thesis debates — multiple positions, not just binary pro/con
- [ ] `[S]` Claim sourcing — attach evidence/citations to each claim
- [ ] `[S]` Perspective filter — view the tree from one side's lens
- [ ] `[S]` Debate sharing / public read-only links

## Parity
~55% of Kialo's feature surface. Pro/con arguments, voting, phases, and AI craft tools are real, but Kialo's defining feature — the recursive impact-weighted claim tree — is only present as flat claim primitives.
