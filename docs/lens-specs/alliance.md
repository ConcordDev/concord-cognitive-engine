# alliance — Feature Gap vs Slack Connect / Discord

Category leader (2026): Slack Connect (cross-org collaboration) / Discord servers. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/alliance.js` (433 LOC) — `runArtifact` actions `compatibilityScore`, `networkAnalysis`, `riskAssessment`; generic artifact store for alliances + messages.

## Has (verified in code)
- Alliance creation (research/security/development/governance types)
- Per-alliance member list, shared workspace name, active-proposal count
- Alliance chat (text messages, timestamps); strength meter
- Compute: compatibility score, social-network analysis (brokers/density), risk assessment (HHI, single-points-of-failure)
- Stat cards, FactionWarIntel panel

## Missing — buildable feature backlog
- [x] `[M]` Threaded channels per alliance (single flat chat only)
- [x] `[M]` Real-time message delivery (chat uses artifact create, no socket)
- [x] `[S]` Member invite / join-request flow with roles & permissions
- [x] `[M]` Shared document / proposal workspace actually wired (name string only)
- [x] `[M]` Voting on joint proposals with quorum
- [x] `[S]` File attachments and reactions in chat
- [x] `[S]` Notifications / unread badges

## Parity
~88% of a cross-org collaboration tool. Strong analytics layer (network + risk), but the actual collaboration primitives — real-time channels, invites, shared docs, voting — are stubs.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
