# sponsorship — Feature Gap vs Patreon

Category leader (2026): Patreon. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: REST macros in server.js (`sponsorship.create`, `sponsorship.cancel`, `sponsorship.list_for_user`) over the `npc_sponsorships` table. Currency: CC.

## Has (verified in code)
- Create a sponsorship of an NPC (monthly CC, configurable dispatch frequency)
- List active sponsorships; cancel a sponsorship
- NPC sends periodic dispatches composed from its emergent state (grudges, schemes, kingdom events)
- SponsorRepos discovery panel

## Missing — buildable feature backlog
- [ ] `[M]` Tiered membership — multiple support tiers per creator/NPC with distinct benefits
- [ ] `[M]` Creator/NPC discovery & browse page — currently you must already know the NPC id
- [ ] `[S]` Sponsorship history / past dispatches archive view
- [ ] `[M]` Pause (vs cancel) + change-tier without losing the relationship
- [ ] `[M]` Sponsor-only content gating — exclusive DTUs/posts visible only to sponsors
- [ ] `[S]` Sponsor leaderboard / badges / public sponsor list per NPC
- [ ] `[M]` Billing dashboard — upcoming charges, payment history, total contributed
- [ ] `[S]` Direct messaging / thank-you from sponsored NPC to sponsor

## Parity
~30% of Patreon. The recurring-payment-for-content primitive works end to end, but there are no tiers, no discovery, no sponsor-only gating, and no billing surface — it is a minimal subscription, not a creator-membership platform.
