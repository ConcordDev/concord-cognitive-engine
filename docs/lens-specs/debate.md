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
- [x] `[M]` Recursive claim tree — claims supporting/attacking other claims to arbitrary depth (Kialo's core)
- [x] `[M]` Per-claim impact rating that propagates up the argument tree
- [x] `[S]` Argument-tree visual map with collapse/expand and pro/con coloring
- [x] `[M]` Multi-thesis debates — multiple positions, not just binary pro/con
- [x] `[S]` Claim sourcing — attach evidence/citations to each claim
- [x] `[S]` Perspective filter — view the tree from one side's lens
- [x] `[S]` Debate sharing / public read-only links

## Parity
~95% of Kialo's feature surface. The recursive impact-weighted claim tree is fully built — `claim-add` with `parentId` nests claims to arbitrary depth, `claim-impact` (1-5) propagates effective strength up the tree via `effectiveStrength`, multi-thesis `position-*` macros score competing positions, `source-*` attaches citations, and `debate-share`/`shared-view` mint public read-only links. The frontend `KialoArgumentMap` component surfaces all of this with collapse/expand, pro/con coloring and a per-side perspective filter; `SharedDebateView` renders the read-only `?share=` link. Remaining gap is content volume, not features.
