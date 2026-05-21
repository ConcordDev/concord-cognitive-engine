# death-insurance — Feature Gap vs in-game inheritance pact (no consumer rival)

Category leader (2026): no direct consumer rival — this is an in-game Concordia mechanic (sparks-only inheritance pacts). Closest analog: a peer-to-peer life-insurance / dead-man's-switch contract. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `insurance` domain macros via `/api/lens/run` — list_for_user, write_contract, revoke. Currency is ⚡ Sparks only (CC insulated per no-pay-to-win invariant).

## Has (verified in code)
- Write contract: beneficiary, premium sparks, payout sparks, duration days
- Two ledgers: contracts you wrote + contracts you are beneficiary of
- Revoke an active contract; status display (active/expired)
- Anti-abuse guards: beneficiary ≠ insured, payout cannot fire within 24h of write
- InsuranceChatter flavor component

## Missing — buildable feature backlog
- [x] `[S]` Multi-beneficiary split — distribute payout across several friends with percentages
- [x] `[S]` Contract renewal / auto-renew before expiry
- [x] `[S]` Premium payment schedule (recurring) instead of single up-front
- [x] `[M]` Beneficiary acceptance handshake — require the recipient to opt in
- [x] `[S]` Payout history log — see contracts that actually fired
- [x] `[S]` Notification when a contract is about to expire or fires

## Parity
~95% of a peer inheritance-pact mechanic. The contract write/revoke/list loop plus multi-beneficiary splits, contract renewal/auto-renew, recurring premium schedules, a beneficiary acceptance handshake, a fired-payout history log, and expiry/fire/premium-due notifications all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
