# Concordia Quests Bible

**Status:** Generated index of authored quest content under `content/quests/**`.
**Source of truth for mechanics:** individual JSON files. This bible is the operator/designer catalog.
**Canon frame:** `docs/LORE_BIBLE.md` — hub soft-power, Eight Refusals + Ninth, three pillars as people.

**Quest count:** 120

## How to read an entry

Each entry lists `id`, `title`, `giver`, `world`, `difficulty`, `summary`, and `tags`, plus the source file path.

## Index by world

- **concord-link-frontier:** 9 quests
- **concordia-hub:** 57 quests
- **crime:** 9 quests
- **cyber:** 9 quests
- **fantasy:** 9 quests
- **lattice-crucible:** 9 quests
- **sovereign-ruins:** 9 quests
- **superhero:** 9 quests

## Index by difficulty

- **advanced:** 7
- **beginner:** 30
- **intermediate:** 81
- **master:** 2

---

## Quest entries

### 1. Plaza Urchin — Notice the Watcher

- **id:** `brackish_01_notice`
- **title:** Plaza Urchin — Notice the Watcher
- **giver:** `—`
- **world:** `concordia-hub`
- **difficulty:** beginner
- **summary:** An eleven-year-old has been watching you since you arrived in the hub. She's quick, dirty, sleeps in the bell-tower. Her name is Brackish. She has not decided about you yet.
- **tags:** `hub`, `brackish`, `first_hour`, `domain:hub_side_arc`
- **source:** `content/quests/brackish-trust.json`

### 2. Plaza Urchin — Be Kind or Be Sharp

- **id:** `brackish_02_choice`
- **title:** Plaza Urchin — Be Kind or Be Sharp
- **giver:** `—`
- **world:** `concordia-hub`
- **difficulty:** beginner
- **summary:** Brackish needs to know which kind of person you are. Approach her with food and patience, or with a chase and a threat. Choose.
- **tags:** `hub`, `brackish`, `moral_branch`, `domain:hub_side_arc`
- **source:** `content/quests/brackish-trust.json`

### 3. Plaza Urchin — What She's Seen

- **id:** `brackish_03_intelligence`
- **title:** Plaza Urchin — What She's Seen
- **giver:** `child_mira_brackish`
- **world:** `concordia-hub`
- **difficulty:** intermediate
- **summary:** Brackish has been keeping mental notes. If she trusts you, she'll share three. If she doesn't, you have to earn each by guess.
- **tags:** `hub`, `brackish`, `intelligence`, `domain:hub_side_arc`
- **source:** `content/quests/brackish-trust.json`

### 4. The Stake — Two Ledgers

- **id:** `consolidation_01_two_ledgers`
- **title:** The Stake — Two Ledgers
- **giver:** `scribe_isa_velt`
- **world:** `concordia-hub`
- **difficulty:** intermediate
- **summary:** Junior Curator Isa Velt has laid two dossiers on the same table and is afraid of both. One tracks Vesper Kane's money, contracts, and 'rescue' charters across the superhero skyline, the crime docks, and the Grid. The other is the sealed Voss genealogy — four worlds of one name, and an ancestor who w…
- **tags:** `hub`, `cross_world`, `vesper_kane`, `voss`, `consolidation`, `distributed_agency`, `domain:cross_world_arc`
- **source:** `content/quests/consolidation-stake.json`

### 5. The Stake — Kane in Two Worlds

- **id:** `consolidation_02_two_worlds`
- **title:** The Stake — Kane in Two Worlds
- **giver:** `scribe_isa_velt`
- **world:** `concordia-hub`
- **difficulty:** intermediate
- **summary:** Isa will not leave the hub. You will. Carry a sealed extract of the Kane dossier to two places that still pretend he is only a local problem: the crime docks, where Jax Rivera still names him as the liaison who sold the unit, and the superhero skyline, where Luminary letterhead still buys silence. D…
- **tags:** `hub`, `crime`, `superhero`, `cross_world`, `vesper_kane`, `voss`, `consolidation`, `distributed_agency`, `domain:cross_world_arc`
- **source:** `content/quests/consolidation-stake.json`

### 6. The Reconstruction Project

- **id:** `faction_scholars_1`
- **title:** The Reconstruction Project
- **giver:** `archivist_maren`
- **world:** `concordia-hub`
- **difficulty:** intermediate
- **summary:** Maren needs help locating a retired merchant who once employed a scribe that worked in Vault Twelve before the Purge. The merchant is elderly, reclusive, and has refused Guild contact for twenty years. Approach differently.
- **tags:** `faction_quest`, `scholars_guild`, `purge_investigation`, `faction:scholars_guild`, `domain:concordia_main`
- **source:** `content/quests/faction-quests.json`

### 7. The Borrowed Knowledge

- **id:** `faction_scholars_2`
- **title:** The Borrowed Knowledge
- **giver:** `scribe_tollan`
- **world:** `concordia-hub`
- **difficulty:** intermediate
- **summary:** Three texts that survived the Purge are in private hands — a Warden official's personal library. They were legally borrowed before the Purge and never returned. Legally, they belong to the Guild. Practically, getting them back requires navigating the garrison's bureaucracy without alerting Voss.
- **tags:** `faction_quest`, `scholars_guild`, `garrison`, `texts`, `faction:scholars_guild`, `domain:concordia_main`
- **source:** `content/quests/faction-quests.json`

### 8. Order in the Warren

- **id:** `faction_wardens_1`
- **title:** Order in the Warren
- **giver:** `captain_rael`
- **world:** `concordia-hub`
- **difficulty:** intermediate
- **summary:** A dispute in the Warrens — the Shadow Network's informal territory — has escalated into property destruction. The Wardens have authority to respond, but sending uniformed officers into the Warrens usually makes things worse. Captain Rael needs someone who can move through the district without a unif…
- **tags:** `faction_quest`, `iron_wardens`, `warrens`, `mediation`, `faction:iron_wardens`, `domain:concordia_main`
- **source:** `content/quests/faction-quests.json`

### 9. The Missing Patrol

- **id:** `faction_wardens_2`
- **title:** The Missing Patrol
- **giver:** `captain_rael`
- **world:** `concordia-hub`
- **difficulty:** intermediate
- **summary:** A two-person Warden patrol failed to return from a routine circuit of the archive quarter. Rael is concerned but cannot officially report them missing for another twelve hours without triggering an inquiry she does not want Voss involved in. She needs them found quietly.
- **tags:** `faction_quest`, `iron_wardens`, `investigation`, `shadow_network`, `faction:iron_wardens`, `domain:concordia_main`
- **source:** `content/quests/faction-quests.json`

### 10. The Disrupted Shipment

- **id:** `faction_merchants_1`
- **title:** The Disrupted Shipment
- **giver:** `factor_cade`
- **world:** `concordia-hub`
- **difficulty:** beginner
- **summary:** Factor Cade has a practical problem: a grain shipment from the northern route was turned back at the gate under a new Warden inspection protocol — inspections that are taking three times as long as standard. The delay will spoil the grain. Cade needs the shipment cleared before sundown.
- **tags:** `faction_quest`, `merchant_collective`, `logistics`, `wardens`, `faction:merchant_collective`, `domain:concordia_main`
- **source:** `content/quests/faction-quests.json`

### 11. The Price of Neutrality

- **id:** `faction_merchants_2`
- **title:** The Price of Neutrality
- **giver:** `factor_cade`
- **world:** `concordia-hub`
- **difficulty:** intermediate
- **summary:** Cade has received an offer from a merchant house she suspects has ties to the Shadow Network — a lucrative contract with terms that are slightly too favorable. She wants a second opinion on whether this is a legitimate business opportunity or a trap designed to create leverage. Yshe Dawnmere has agr…
- **tags:** `faction_quest`, `merchant_collective`, `shadow_network`, `investigation`, `faction:merchant_collective`, `domain:concordia_main`
- **source:** `content/quests/faction-quests.json`

### 12. The Dead Drop

- **id:** `faction_network_1`
- **title:** The Dead Drop
- **giver:** `broker_sael`
- **world:** `concordia-hub`
- **difficulty:** intermediate
- **summary:** Sael needs a message delivered to a contact in the Scholars' Guild district — but not through any route the Wardens monitor. They give you a token and an address and nothing else. The Network tests new contacts this way.
- **tags:** `faction_quest`, `shadow_network`, `stealth`, `delivery`, `faction:shadow_network`, `domain:concordia_main`
- **source:** `content/quests/faction-quests.json`

### 13. The Handler's Question

- **id:** `faction_network_2`
- **title:** The Handler's Question
- **giver:** `cipher_venn`
- **world:** `concordia-hub`
- **difficulty:** advanced
- **summary:** Venn has noticed you. You are summoned — which is not how the Network usually phrases things — to a meeting in the undercity. Venn wants to know what you know and whether you are, as they phrase it, 'an instrument or an agent.'
- **tags:** `faction_quest`, `shadow_network`, `venn`, `moral_choice`, `faction:shadow_network`, `domain:concordia_main`
- **source:** `content/quests/faction-quests.json`

### 14. First Day — Claim a Patch

- **id:** `first_day_claim_land`
- **title:** First Day — Claim a Patch
- **giver:** `concordia_first_breath`
- **world:** `concordia-hub`
- **difficulty:** beginner
- **summary:** After the First Cycle, Concordia tells you to claim a small patch of land. Settlers who own a place on the map have a place the world remembers them by. Walk to a quiet meadow east of the glade and place a stake. The patch will be small — twenty meters across — but it will be yours, and the city wil…
- **tags:** `domain:first_day_arc`
- **source:** `content/quests/first-day-arc.json`

### 15. First Day — Invite Someone

- **id:** `first_day_invite_friend`
- **title:** First Day — Invite Someone
- **giver:** `concordia_first_breath`
- **world:** `concordia-hub`
- **difficulty:** beginner
- **summary:** A claim is just a patch until someone else has been there. Find another player or NPC and invite them to your patch as a co-owner or guest. You don't have to share — you just have to acknowledge that the world is bigger than you alone.
- **tags:** `domain:first_day_arc`
- **source:** `content/quests/first-day-arc.json`

### 16. First Day — Show Up

- **id:** `first_day_attend_event`
- **title:** First Day — Show Up
- **giver:** `concordia_first_breath`
- **world:** `concordia-hub`
- **difficulty:** beginner
- **summary:** Concordia hosts a small gathering at dusk — a planted-cycle ritual every settler in their first month is invited to. Walk to the central plaza when the event opens. You don't have to do anything; just be present. The world-event scheduler will mark you as having attended.
- **tags:** `domain:first_day_arc`
- **source:** `content/quests/first-day-arc.json`

### 17. First Day — Witness a Move

- **id:** `first_day_witness_faction_move`
- **title:** First Day — Witness a Move
- **giver:** `concordia_first_breath`
- **world:** `concordia-hub`
- **difficulty:** beginner
- **summary:** Sometime in your first day a faction will make a move — a treaty signed, a war declared, a rebuild begun. The Frontier delegation knows when these happen and will tell you. Find a Witness from the Crucible (or any Frontier broker) and ask them to log you as a witness for the next move. The move may …
- **tags:** `domain:first_day_arc`
- **source:** `content/quests/first-day-arc.json`

### 18. The First Cycle — Concordia Compass

- **id:** `first_cycle_phase_d`
- **title:** The First Cycle — Concordia Compass
- **giver:** `concordia_first_breath`
- **world:** `concordia-hub`
- **difficulty:** beginner
- **summary:** You've cooked, eaten, fought, and communed. The hub is ready to show you four more loops. Concordia herself walks you through: the command palette, NPC contextual actions, building workbenches, and the run-mode hotbar.
- **tags:** `first_cycle`, `phase_d`, `tutorial`, `domain:first_cycle`
- **source:** `content/quests/first_cycle_phase_d.json`

### 19. Founding Day — The Unburned Court

- **id:** `founding_day_01_gather`
- **title:** Founding Day — The Unburned Court
- **giver:** `archivist_maren`
- **world:** `concordia-hub`
- **difficulty:** beginner
- **summary:** Founding Day. The Concordant Law is read aloud at the Unburned Court, and the three who live in the hub are said to stand where the ring can see them. Archivist Maren wants a witness who is not on any embassy payroll. Come to the Court before the reading starts.
- **tags:** `hub`, `founding_day`, `three_pillars`, `cosmology`, `unburned_court`, `domain:hub_cosmology`
- **source:** `content/quests/founding-day-reading.json`

### 20. Founding Day — The Reading

- **id:** `founding_day_02_reading`
- **title:** Founding Day — The Reading
- **giver:** `archivist_maren`
- **world:** `concordia-hub`
- **difficulty:** beginner
- **summary:** The Lamplighter's successor reads the Concordant Law. Around the ring: Concordia stands open-handed and warm at the apex; Concord faces her with a slate he is not writing on; the Sovereign stands with his back to both of them and does not turn. No one names what that arrangement means. You are here …
- **tags:** `hub`, `founding_day`, `three_pillars`, `cosmology`, `triangle`, `domain:hub_cosmology`
- **source:** `content/quests/founding-day-reading.json`

### 21. Founding Day — What the Slate Held

- **id:** `founding_day_03_sign`
- **title:** Founding Day — What the Slate Held
- **giver:** `archivist_maren`
- **world:** `concordia-hub`
- **difficulty:** beginner
- **summary:** Return the witness slate to Maren at the Archive. She will not ask you to interpret the three. She will ask whether the Sovereign looked at anyone — and she will file your answer under a seal even she cannot open twice.
- **tags:** `hub`, `founding_day`, `three_pillars`, `cosmology`, `archive`, `domain:hub_cosmology`
- **source:** `content/quests/founding-day-reading.json`

### 22. Impossible Print — The Ranger's Story

- **id:** `impossible_print_01_kiren`
- **title:** Impossible Print — The Ranger's Story
- **giver:** `ranger_kiren_owl`
- **world:** `concordia-hub`
- **difficulty:** beginner
- **summary:** Ranger Kiren Owl has been tracking a creature whose print matches nothing in the fauna catalogue. He hasn't told the Watch. He'll tell you if you ask the right way.
- **tags:** `hub`, `impossible_print`, `tracking`, `domain:hub_side_arc`
- **source:** `content/quests/impossible-print.json`

### 23. Impossible Print — The Stablemaster's Pattern

- **id:** `impossible_print_02_orin`
- **title:** Impossible Print — The Stablemaster's Pattern
- **giver:** `stablemaster_orin_rede`
- **world:** `concordia-hub`
- **difficulty:** beginner
- **summary:** Orin Rede has been logging horses that come back from a particular Verge path exhausted past explanation. He thinks one rider has been borrowing them without name. The pattern overlaps Kiren's tracks.
- **tags:** `hub`, `impossible_print`, `investigation`, `domain:hub_side_arc`
- **source:** `content/quests/impossible-print.json`

### 24. Impossible Print — The Courier's Portal

- **id:** `impossible_print_03_kel`
- **title:** Impossible Print — The Courier's Portal
- **giver:** `courier_kel_sandren`
- **world:** `concordia-hub`
- **difficulty:** beginner
- **summary:** Crosswind Courier Kel Sandren has noticed one of the standing portals opening off-schedule. By minutes, then hours. Show Kel the print and the stable log.
- **tags:** `hub`, `impossible_print`, `portal`, `domain:hub_side_arc`
- **source:** `content/quests/impossible-print.json`

### 25. Impossible Print — The Three Witnesses Meet

- **id:** `impossible_print_04_synthesis`
- **title:** Impossible Print — The Three Witnesses Meet
- **giver:** `courier_kel_sandren`
- **world:** `concordia-hub`
- **difficulty:** intermediate
- **summary:** Bring Kiren, Orin, and Kel together. The synthesis triggers a procgen region spawn — the creature's territory, accessible now that the breach is mapped.
- **tags:** `hub`, `impossible_print`, `synthesis`, `procgen`, `domain:hub_side_arc`
- **source:** `content/quests/impossible-print.json`

### 26. A Light for the Quiet Streets

- **id:** `kael_torchlight`
- **title:** A Light for the Quiet Streets
- **giver:** `wanderer_kael`
- **world:** `concordia-hub`
- **difficulty:** beginner
- **summary:** Kael caught you in the market with that look they get when they have one foot already moving. They've been told the alley behind the cooper's shop swallows lamps — every torch they've planted there has gone out by morning. Three nights running. They want to try again with proper bound torches and a …
- **tags:** `tutorial`, `onboarding`, `concordia_main`, `kael`, `hand_authored`, `domain:concordia_main`
- **source:** `content/quests/kael-torchlight.json`

### 27. Cracks in the Compact

- **id:** `cracks_in_the_compact`
- **title:** Cracks in the Compact
- **giver:** `archivist_maren`
- **world:** `concordia-hub`
- **difficulty:** intermediate
- **summary:** Maren Ashveil has been watching you since Tollan mentioned your name. She wants to meet — but not at the Guild outpost. She names a location in the archive quarter that isn't on any official map.
- **tags:** `main_arc`, `concordia_main`, `maren`, `purge`, `domain:concordia_main`
- **source:** `content/quests/main-arc.json`

### 28. The Shadow Archive

- **id:** `the_shadow_archive`
- **title:** The Shadow Archive
- **giver:** `archivist_maren`
- **world:** `concordia-hub`
- **difficulty:** intermediate
- **summary:** Maren is ready to show you what she has been building for thirty years. But first she needs to know if you can be trusted. She gives you a test that looks like a small errand and isn't.
- **tags:** `main_arc`, `concordia_main`, `maren`, `purge`, `shadow_archive`, `domain:concordia_main`
- **source:** `content/quests/main-arc.json`

### 29. The Crackdown

- **id:** `warden_crackdown`
- **title:** The Crackdown
- **giver:** `captain_rael`
- **world:** `concordia-hub`
- **difficulty:** intermediate
- **summary:** Voss knows something has shifted. New confiscation orders hit the archive quarter — broader than before, covering any 'unofficial repositories of pre-Year 70 materials.' The shadow archive has days, not weeks. Captain Rael is personally leading the search teams, and she looks like she would rather b…
- **tags:** `main_arc`, `concordia_main`, `rael`, `wardens`, `crackdown`, `domain:concordia_main`
- **source:** `content/quests/main-arc.json`

### 30. The Broker's Gambit

- **id:** `broker_gambit`
- **title:** The Broker's Gambit
- **giver:** `lorekeeper_yshe`
- **world:** `concordia-hub`
- **difficulty:** advanced
- **summary:** Yshe Dawnmere reaches out: Sael is moving. The manifest is being offered for sale and the bidding closes in 72 hours. The Wardens are bidding. So is someone from the Merchant Collective, acting without Cade's knowledge. If the Wardens buy it, it disappears. If the Merchants buy it, it becomes levera…
- **tags:** `main_arc`, `concordia_main`, `sael`, `manifest`, `shadow_network`, `domain:concordia_main`
- **source:** `content/quests/main-arc.json`

### 31. The Merchant's Dilemma

- **id:** `the_merchants_dilemma`
- **title:** The Merchant's Dilemma
- **giver:** `factor_cade`
- **world:** `concordia-hub`
- **difficulty:** advanced
- **summary:** Factor Cade received an anonymous summary of what the manifest contains. She wants to meet — alone, outside the Collective offices. She already knows about the cartel arrangements. She has known, in pieces, for years. Now she has to decide whether Concordia's economic stability is worth protecting w…
- **tags:** `main_arc`, `concordia_main`, `cade`, `merchants`, `moral_choice`, `domain:concordia_main`
- **source:** `content/quests/main-arc.json`

### 32. The Reckoning

- **id:** `the_reckoning`
- **title:** The Reckoning
- **giver:** `warden_voss`
- **world:** `concordia-hub`
- **difficulty:** advanced
- **summary:** The evidence is assembled. Maren has the dossier. You have the manifest. Rael has the suppressed witness statement. Cade has made her disclosure or it has already been made for her. Voss knows what is coming. He has sent you a message asking for a meeting — before it goes to the council.
- **tags:** `main_arc`, `concordia_main`, `voss`, `rael`, `reckoning`, `climax`, `domain:concordia_main`
- **source:** `content/quests/main-arc.json`

### 33. A New Compact

- **id:** `a_new_compact`
- **title:** A New Compact
- **giver:** `wanderer_kael`
- **world:** `concordia-hub`
- **difficulty:** master
- **summary:** The old order has fractured. The Wardens are in disarray. The Merchants are restructuring. The Scholars have their vindication — and Maren is exhausted in a way that looks like relief. The city needs to decide what comes next. Kael, your fellow traveler, finds you in the market and says: 'I think th…
- **tags:** `main_arc`, `concordia_main`, `epilogue`, `new_compact`, `domain:concordia_main`
- **source:** `content/quests/main-arc.json`

### 34. Old Seam — A Following

- **id:** `nesha_seam_01_pattern`
- **title:** Old Seam — A Following
- **giver:** `preacher_old_seam`
- **world:** `concordia-hub`
- **difficulty:** beginner
- **summary:** Old Seam, the wandering preacher, walks the dome perimeter at the same hours as Oracle Nesha. Not behind her — parallel, just out of speaking range. Twenty years.
- **tags:** `hub`, `nesha_seam`, `observation`, `domain:hub_side_arc`
- **source:** `content/quests/nesha-old-seam.json`

### 35. Old Seam — Master and Student

- **id:** `nesha_seam_02_history`
- **title:** Old Seam — Master and Student
- **giver:** `preacher_old_seam`
- **world:** `concordia-hub`
- **difficulty:** beginner
- **summary:** Talk to both. Each will tell a partial story. The shape of the falling-out is the same; the cause is told differently.
- **tags:** `hub`, `nesha_seam`, `history`, `domain:hub_side_arc`
- **source:** `content/quests/nesha-old-seam.json`

### 36. Old Seam — Bring her in

- **id:** `nesha_seam_03_mediate`
- **title:** Old Seam — Bring her in
- **giver:** `—`
- **world:** `concordia-hub`
- **difficulty:** intermediate
- **summary:** Old Seam takes a small supper at the Seven Spokes every Penanus. Persuade her to come, then to walk to the Refusal Keep, then to speak to Nesha.
- **tags:** `hub`, `nesha_seam`, `reconciliation`, `domain:hub_side_arc`
- **source:** `content/quests/nesha-old-seam.json`

### 37. The First Cycle — Cook

- **id:** `first_cycle_cook`
- **title:** The First Cycle — Cook
- **giver:** `concordia_first_breath`
- **world:** `concordia-hub`
- **difficulty:** beginner
- **summary:** You arrived after the Great Refusal. Concordia herself is speaking to you from the glade. She wants to show you how to live here — not as a guest, but as someone who belongs. Begin by gathering ingredients near the cooking station and cooking your first meal. Everything that grows here remembers who…
- **tags:** `tutorial`, `first_cycle`, `cooking`, `domain:first_cycle`
- **source:** `content/quests/onboarding.json`

### 38. The First Cycle — Eat

- **id:** `first_cycle_eat`
- **title:** The First Cycle — Eat
- **giver:** `concordia_first_breath`
- **world:** `concordia-hub`
- **difficulty:** beginner
- **summary:** You have a finished dish. Eat it. Feel what the world gives back when you give it your attention.
- **tags:** `tutorial`, `first_cycle`, `consumption`, `buffs`, `domain:first_cycle`
- **source:** `content/quests/onboarding.json`

### 39. The First Cycle — Fight

- **id:** `first_cycle_fight`
- **title:** The First Cycle — Fight
- **giver:** `concordia_first_breath`
- **world:** `concordia-hub`
- **difficulty:** beginner
- **summary:** Walk to the Training Hollow. Ember Sprites have gathered there. They are not enemies — they are mirrors. Show them who you are becoming. Use what you ate.
- **tags:** `tutorial`, `first_cycle`, `combat`, `flow_combat`, `domain:first_cycle`
- **source:** `content/quests/onboarding.json`

### 40. The First Cycle — Commune

- **id:** `first_cycle_commune`
- **title:** The First Cycle — Commune
- **giver:** `concordia_first_breath`
- **world:** `concordia-hub`
- **difficulty:** beginner
- **summary:** Return to the original glade. The living tree at its center — Concordia's physical anchor — is glowing now. Speak with the world directly.
- **tags:** `tutorial`, `first_cycle`, `concordia`, `commune`, `milestone`, `domain:first_cycle`
- **source:** `content/quests/onboarding.json`

### 41. A Stranger at the Gate

- **id:** `the_arrival`
- **title:** A Stranger at the Gate
- **giver:** `gatekeeper_orin`
- **world:** `concordia-hub`
- **difficulty:** beginner
- **summary:** You have arrived at Concordia's east gate. The Iron Wardens process arrivals with practiced efficiency. A fellow traveler named Kael seems to be having trouble with the entry inspection.
- **tags:** `tutorial`, `onboarding`, `concordia_main`, `domain:concordia_main`
- **source:** `content/quests/onboarding.json`

### 42. The Faction Question

- **id:** `first_contact`
- **title:** The Faction Question
- **giver:** `wanderer_kael`
- **world:** `concordia-hub`
- **difficulty:** beginner
- **summary:** Kael has heard that newcomers to Concordia are expected to affiliate with one of the four factions within their first week — or find a patron who can vouch for independent status. The Scholars' Guild has posted a notice in the market offering 'orientation for interested newcomers.' It seems like a r…
- **tags:** `tutorial`, `onboarding`, `concordia_main`, `factions`, `domain:concordia_main`
- **source:** `content/quests/onboarding.json`

### 43. The First Obligation

- **id:** `the_choice`
- **title:** The First Obligation
- **giver:** `scribe_tollan`
- **world:** `concordia-hub`
- **difficulty:** beginner
- **summary:** Scribe Tollan has a problem: a crate of recovered texts was confiscated at the east gate this morning under the new 'historical materials' category. The texts are pre-Year 70, legitimate scholarship, and not seditious by any reasonable standard. He needs someone to retrieve them from the gate garris…
- **tags:** `tutorial`, `onboarding`, `concordia_main`, `moral_choice`, `factions`, `domain:concordia_main`
- **source:** `content/quests/onboarding.json`

### 44. The First Cycle — Befriend

- **id:** `first_cycle_befriend`
- **title:** The First Cycle — Befriend
- **giver:** `concordia_first_breath`
- **world:** `concordia-hub`
- **difficulty:** beginner
- **summary:** Concordia speaks again: 'There are creatures here that don't fear you yet. Don't catch them — they aren't yours to take. Stay near. Fight beside them. Trust grows on its own time.' Find a wild creature whose temperament suits you, build bond by sharing space and threats, then attempt to tame.
- **tags:** `tutorial`, `first_cycle`, `companion`, `tame`, `bond`, `domain:first_cycle`
- **source:** `content/quests/onboarding.json`

### 45. The First Cycle — Sneak

- **id:** `first_cycle_sneak`
- **title:** The First Cycle — Sneak
- **giver:** `concordia_first_breath`
- **world:** `concordia-hub`
- **difficulty:** beginner
- **summary:** Concordia teaches: 'Not every problem is solved by being seen. Crouch. Move slow. The world rewards those who watch as much as those who act.' Approach the patrol from cover and reach the marker without being detected.
- **tags:** `tutorial`, `first_cycle`, `stealth`, `perception`, `domain:first_cycle`
- **source:** `content/quests/onboarding.json`

### 46. The First Cycle — Visit a Kingdom

- **id:** `first_cycle_kingdom_visit`
- **title:** The First Cycle — Visit a Kingdom
- **giver:** `concordia_first_breath`
- **world:** `concordia-hub`
- **difficulty:** beginner
- **summary:** There is no kingdom in the hub yet. But the wider worlds have rulers — players, factions, NPCs — and some have decreed laws that bind visitors. Cross a kingdom border, observe the active decrees, and choose: obey, resist, or contest.
- **tags:** `tutorial`, `first_cycle`, `kingdom`, `governance`, `domain:first_cycle`
- **source:** `content/quests/onboarding.json`

### 47. The First Cycle — Play

- **id:** `first_cycle_play`
- **title:** The First Cycle — Play
- **giver:** `concordia_first_breath`
- **world:** `concordia-hub`
- **difficulty:** beginner
- **summary:** Concordia smiles for the first time: 'Living here is more than fighting and ruling. Cast a line at the river. Shoot hoops with someone. Race a friend. Joy is the receipt that all of this was worth building.' Choose one: fish, basketball, or race.
- **tags:** `tutorial`, `first_cycle`, `fishing`, `sports`, `play`, `domain:first_cycle`
- **source:** `content/quests/onboarding.json`

### 48. The Sealed Record — Asbir's Distraction

- **id:** `sealed_01_notice`
- **title:** The Sealed Record — Asbir's Distraction
- **giver:** `scribe_isa_velt`
- **world:** `concordia-hub`
- **difficulty:** intermediate
- **summary:** Lord Curator Asbir Thelane has been distracted for weeks. His audience hours stretch. He looks at the south wall of his chamber too often. Junior Curator Isa Velt has noticed.
- **tags:** `hub`, `sealed_record`, `epic`, `domain:hub_epic_arc`
- **source:** `content/quests/sealed-record.json`

### 49. The Sealed Record — Isa's Trust

- **id:** `sealed_02_isa`
- **title:** The Sealed Record — Isa's Trust
- **giver:** `scribe_isa_velt`
- **world:** `concordia-hub`
- **difficulty:** intermediate
- **summary:** Isa needs to know you. Three small tasks — index a corner of the archive, fetch supper from the inn for her, deliver a private letter to her cousin in the watch. Earn her confidence.
- **tags:** `hub`, `sealed_record`, `isa_confidence`, `domain:hub_epic_arc`
- **source:** `content/quests/sealed-record.json`

### 50. The Sealed Record — The Cavity

- **id:** `sealed_03_cavity`
- **title:** The Sealed Record — The Cavity
- **giver:** `scribe_isa_velt`
- **world:** `concordia-hub`
- **difficulty:** advanced
- **summary:** Isa has marked the wall. Wait for Asbir's private writing hours. Enter his chamber. Open the cavity. See what's inside.
- **tags:** `hub`, `sealed_record`, `stealth`, `epic`, `domain:hub_epic_arc`
- **source:** `content/quests/sealed-record.json`

### 51. The Sealed Record — Three Paths

- **id:** `sealed_04_choice`
- **title:** The Sealed Record — Three Paths
- **giver:** `—`
- **world:** `concordia-hub`
- **difficulty:** advanced
- **summary:** You have the record. Three things to do with it. Carry it to Iyatte in Sandrun. Return it to Asbir and confess. Sell it to the Vessine cartel. Each ends differently.
- **tags:** `hub`, `sealed_record`, `epic`, `cross_world`, `moral_branch`, `domain:hub_epic_arc`
- **source:** `content/quests/sealed-record.json`

### 52. Southern Arc — Captain's Quiet

- **id:** `southern_arc_01_notice`
- **title:** Southern Arc — Captain's Quiet
- **giver:** `captain_ren_solare`
- **world:** `concordia-hub`
- **difficulty:** beginner
- **summary:** Captain Ren Solare patrols the southern arc alone every morning. The Watch has rotations; she doesn't take them. The pattern is too consistent to be incidental. Find her on her morning route and ask the right question.
- **tags:** `hub`, `southern_arc`, `investigation`, `domain:hub_main_arc`
- **source:** `content/quests/southern-arc-mystery.json`

### 53. Southern Arc — Witness

- **id:** `southern_arc_02_witness`
- **title:** Southern Arc — Witness
- **giver:** `captain_ren_solare`
- **world:** `concordia-hub`
- **difficulty:** beginner
- **summary:** Ren wants you to see it for yourself. Reach the field-line crack she's been watching and observe a full pre-dawn cycle. Bring back a description of what you saw.
- **tags:** `hub`, `southern_arc`, `observation`, `domain:hub_main_arc`
- **source:** `content/quests/southern-arc-mystery.json`

### 54. Southern Arc — Bring it to the Oracle

- **id:** `southern_arc_03_oracle`
- **title:** Southern Arc — Bring it to the Oracle
- **giver:** `captain_ren_solare`
- **world:** `concordia-hub`
- **difficulty:** intermediate
- **summary:** Ren can't act alone. The Oracle Nesha has to confirm what you saw and the Assembly Speaker has to convene. Carry the observation to Nesha first.
- **tags:** `hub`, `southern_arc`, `oracle`, `glyph`, `domain:hub_main_arc`
- **source:** `content/quests/southern-arc-mystery.json`

### 55. Southern Arc — The Speaker's Choice

- **id:** `southern_arc_04_assembly`
- **title:** Southern Arc — The Speaker's Choice
- **giver:** `oracle_nesha_keep`
- **world:** `concordia-hub`
- **difficulty:** intermediate
- **summary:** Elder Mira Lattice has held the secret. She has not voted on it. With Nesha's confirmation glyph in hand, you can force the Assembly's hand. But forcing them is its own choice.
- **tags:** `hub`, `southern_arc`, `assembly`, `domain:hub_main_arc`
- **source:** `content/quests/southern-arc-mystery.json`

### 56. Southern Arc — Resolution

- **id:** `southern_arc_05_choice`
- **title:** Southern Arc — Resolution
- **giver:** `elder_mira_lattice`
- **world:** `concordia-hub`
- **difficulty:** advanced
- **summary:** Three paths. Support the convene: Mira opens emergency session, the city panics but acts. Expose privately: the Watch starts repair on its own terms. Suppress: the dome holds for now, you and Ren keep the secret, the next failure is worse.
- **tags:** `hub`, `southern_arc`, `resolution`, `moral_branch`, `domain:hub_main_arc`
- **source:** `content/quests/southern-arc-mystery.json`

### 57. The Council Room — Carry a Letter

- **id:** `frontier_mara_01_call`
- **title:** The Council Room — Carry a Letter
- **giver:** `councillor_mara_pin`
- **world:** `concord-link-frontier`
- **difficulty:** intermediate
- **summary:** Councillor Mara Pin writes letters. Some get read. Carry one to Elder Mira Lattice in the hub.
- **tags:** `concord-link-frontier`, `frontier_side`
- **source:** `content/quests/sub-worlds/concord-link-frontier/mara-letter.json`

### 58. The Assembly Hall — Hand to Mira

- **id:** `frontier_mara_02_deliver`
- **title:** The Assembly Hall — Hand to Mira
- **giver:** `councillor_mara_pin`
- **world:** `concord-link-frontier`
- **difficulty:** intermediate
- **summary:** Deliver the letter to Elder Mira Lattice in person. Do not read it. Do not leave with an aide.
- **tags:** `concord-link-frontier`, `frontier_side`
- **source:** `content/quests/sub-worlds/concord-link-frontier/mara-letter.json`

### 59. The Frontier — Return with Reply

- **id:** `frontier_mara_03_return`
- **title:** The Frontier — Return with Reply
- **giver:** `elder_mira_lattice`
- **world:** `concord-link-frontier`
- **difficulty:** intermediate
- **summary:** Mira writes back. Bring the reply to Mara.
- **tags:** `concord-link-frontier`, `frontier_side`
- **source:** `content/quests/sub-worlds/concord-link-frontier/mara-letter.json`

### 60. The Western Road — Watch the Portal

- **id:** `frontier_silas_01_observe`
- **title:** The Western Road — Watch the Portal
- **giver:** `rider_silas_quinn`
- **world:** `concord-link-frontier`
- **difficulty:** intermediate
- **summary:** Silas Quinn has seen a portal opening off-schedule on the western perimeter. Same anomaly Kel Sandren tracks in the hub.
- **tags:** `concord-link-frontier`, `frontier_high`
- **source:** `content/quests/sub-worlds/concord-link-frontier/silas-quinn-portal.json`

### 61. The Hub — Find Kel

- **id:** `frontier_silas_02_kel`
- **title:** The Hub — Find Kel
- **giver:** `rider_silas_quinn`
- **world:** `concord-link-frontier`
- **difficulty:** intermediate
- **summary:** Carry Silas's observation to Kel Sandren at the hub portal plaza.
- **tags:** `concord-link-frontier`, `frontier_high`
- **source:** `content/quests/sub-worlds/concord-link-frontier/silas-quinn-portal.json`

### 62. The Portal Plaza — Synthesise

- **id:** `frontier_silas_03_synth`
- **title:** The Portal Plaza — Synthesise
- **giver:** `courier_kel_sandren`
- **world:** `concord-link-frontier`
- **difficulty:** intermediate
- **summary:** Kel and Silas's observations align. Bring them together at a meeting at the impossible-print breach.
- **tags:** `concord-link-frontier`, `frontier_high`
- **source:** `content/quests/sub-worlds/concord-link-frontier/silas-quinn-portal.json`

### 63. The Perimeter — Captain's Brief

- **id:** `frontier_zara_01_brief`
- **title:** The Perimeter — Captain's Brief
- **giver:** `captain_zara_morn`
- **world:** `concord-link-frontier`
- **difficulty:** intermediate
- **summary:** Captain Zara Morn has noticed lattice-Crucible scouts probing. She wants a back-channel with Emer Voss.
- **tags:** `concord-link-frontier`, `frontier_main`
- **source:** `content/quests/sub-worlds/concord-link-frontier/zara-perimeter.json`

### 64. The Verge — Bring a Token

- **id:** `frontier_zara_02_token`
- **title:** The Verge — Bring a Token
- **giver:** `captain_zara_morn`
- **world:** `concord-link-frontier`
- **difficulty:** intermediate
- **summary:** Cross to the lattice-Crucible verge. Find Emer Voss. Bring back any token of recognition.
- **tags:** `concord-link-frontier`, `frontier_main`
- **source:** `content/quests/sub-worlds/concord-link-frontier/zara-perimeter.json`

### 65. The Frontier — Mutual Watch

- **id:** `frontier_zara_03_watch`
- **title:** The Frontier — Mutual Watch
- **giver:** `captain_zara_morn`
- **world:** `concord-link-frontier`
- **difficulty:** intermediate
- **summary:** Zara sends a token back. Carry it to Emer. Both sides can stop sleeping with one eye open.
- **tags:** `concord-link-frontier`, `frontier_main`
- **source:** `content/quests/sub-worlds/concord-link-frontier/zara-perimeter.json`

### 66. The Morgue — An Unusual Cause of Death

- **id:** `crime_ada_01_morgue`
- **title:** The Morgue — An Unusual Cause of Death
- **giver:** `coroner_ada_pell`
- **world:** `crime`
- **difficulty:** intermediate
- **summary:** Ada Pell has been logging cause-of-death anomalies. The latest body looks like cross-world creature predation. She wants a second opinion.
- **tags:** `crime`, `crime_side`
- **source:** `content/quests/sub-worlds/crime/ada-pell-log.json`

### 67. The Morgue — Cross-Reference

- **id:** `crime_ada_02_cross`
- **title:** The Morgue — Cross-Reference
- **giver:** `coroner_ada_pell`
- **world:** `crime`
- **difficulty:** intermediate
- **summary:** Ada wants you to carry her log to Kiren in the hub. He'll know whether it matches.
- **tags:** `crime`, `crime_side`
- **source:** `content/quests/sub-worlds/crime/ada-pell-log.json`

### 68. The Morgue — Cross-World Confirmation

- **id:** `crime_ada_03_return`
- **title:** The Morgue — Cross-World Confirmation
- **giver:** `coroner_ada_pell`
- **world:** `crime`
- **difficulty:** intermediate
- **summary:** Return to Ada with Kiren's confirmation. The two coroners' logs together are evidence enough.
- **tags:** `crime`, `crime_side`
- **source:** `content/quests/sub-worlds/crime/ada-pell-log.json`

### 69. The Defence Office — A Coffee Meeting

- **id:** `crime_dahlia_01_meet`
- **title:** The Defence Office — A Coffee Meeting
- **giver:** `lawyer_dahlia_kress`
- **world:** `crime`
- **difficulty:** intermediate
- **summary:** Dahlia Kress wants to meet. She defended Silas Thorpe twice. She also defended a kid against Silas once. She wants to know which side you're on.
- **tags:** `crime`, `crime_high`
- **source:** `content/quests/sub-worlds/crime/dahlia-ledger.json`

### 70. The Defence Office — The Privileged Folder

- **id:** `crime_dahlia_02_steal`
- **title:** The Defence Office — The Privileged Folder
- **giver:** `lawyer_dahlia_kress`
- **world:** `crime`
- **difficulty:** intermediate
- **summary:** Dahlia will leave the office unlocked at sixth-bell. The folder is on the third shelf, second from the top. You take it. She did not give it to you.
- **tags:** `crime`, `crime_high`
- **source:** `content/quests/sub-worlds/crime/dahlia-ledger.json`

### 71. The Ledger — Where Does It Go?

- **id:** `crime_dahlia_03_destination`
- **title:** The Ledger — Where Does It Go?
- **giver:** `—`
- **world:** `crime`
- **difficulty:** intermediate
- **summary:** Three places it can go. Iniko's office (she said never bring it). Judge Haldane's chambers (she said the same). Bell at the corner (he'll sell it back to Silas). Choose.
- **tags:** `crime`, `crime_high`
- **source:** `content/quests/sub-worlds/crime/dahlia-ledger.json`

### 72. Bell's Corner — Buy a Tip

- **id:** `crime_thorpe_01_bell`
- **title:** Bell's Corner — Buy a Tip
- **giver:** `detective_iniko_voss`
- **world:** `crime`
- **difficulty:** intermediate
- **summary:** Iniko Voss wants Bell's tip about the Thorpe ring's last shipment. Bell will sell it. Cost: 50 sparks.
- **tags:** `crime`, `crime_main`
- **source:** `content/quests/sub-worlds/crime/thorpe-bust.json`

### 73. The Wharf — Get Maddox to Sign

- **id:** `crime_thorpe_02_maddox`
- **title:** The Wharf — Get Maddox to Sign
- **giver:** `detective_iniko_voss`
- **world:** `crime`
- **difficulty:** intermediate
- **summary:** Maddox Kray owes Iniko three favours. He has paid none. Lean on him until you have his signature on a witness statement.
- **tags:** `crime`, `crime_main`
- **source:** `content/quests/sub-worlds/crime/thorpe-bust.json`

### 74. The Courthouse — Hand it to the Judge

- **id:** `crime_thorpe_03_haldane`
- **title:** The Courthouse — Hand it to the Judge
- **giver:** `judge_pia_haldane`
- **world:** `crime`
- **difficulty:** intermediate
- **summary:** Judge Haldane has been collecting evidence for an indictment. With Maddox's statement, she can move. Hand it directly — never through Iniko.
- **tags:** `crime`, `crime_main`
- **source:** `content/quests/sub-worlds/crime/thorpe-bust.json`

### 75. Neon Quarter — Ask About Ghost-7

- **id:** `cyber_ghost_01_oren`
- **title:** Neon Quarter — Ask About Ghost-7
- **giver:** `fixer_oren_lim`
- **world:** `cyber`
- **difficulty:** intermediate
- **summary:** Oren Lim sells the question for 3000 sparks, the answer for 5000. You pay either way.
- **tags:** `cyber`, `cyber_main`
- **source:** `content/quests/sub-worlds/cyber/ghost-7-trace.json`

### 76. Neon Quarter — Lavren's Door

- **id:** `cyber_ghost_02_lavren`
- **title:** Neon Quarter — Lavren's Door
- **giver:** `—`
- **world:** `cyber`
- **difficulty:** intermediate
- **summary:** Knock twice, then once. Don't kick the door. He's tired.
- **tags:** `cyber`, `cyber_main`
- **source:** `content/quests/sub-worlds/cyber/ghost-7-trace.json`

### 77. Lavren — What He Asks of You

- **id:** `cyber_ghost_03_choice`
- **title:** Lavren — What He Asks of You
- **giver:** `—`
- **world:** `cyber`
- **difficulty:** intermediate
- **summary:** Lavren asks one thing. Carry it or refuse. Either ends the trace.
- **tags:** `cyber`, `cyber_main`
- **source:** `content/quests/sub-worlds/cyber/ghost-7-trace.json`

### 78. The Runners' Den — Bring Hot Tea

- **id:** `cyber_kira_01_tea`
- **title:** The Runners' Den — Bring Hot Tea
- **giver:** `datadiver_kira_zane`
- **world:** `cyber`
- **difficulty:** intermediate
- **summary:** Kira Zane hasn't slept. She'll talk in exchange for hot tea. She means it.
- **tags:** `cyber`, `cyber_side`
- **source:** `content/quests/sub-worlds/cyber/kira-packet-map.json`

### 79. The Runners' Den — The Packet Map

- **id:** `cyber_kira_02_map`
- **title:** The Runners' Den — The Packet Map
- **giver:** `datadiver_kira_zane`
- **world:** `cyber`
- **difficulty:** intermediate
- **summary:** Kira hands you the map of a packet flow that doesn't terminate. Don't show Oren. Don't show Silver. Use it.
- **tags:** `cyber`, `cyber_side`
- **source:** `content/quests/sub-worlds/cyber/kira-packet-map.json`

### 80. The Runners' Den — Follow the Flow

- **id:** `cyber_kira_03_trace`
- **title:** The Runners' Den — Follow the Flow
- **giver:** `datadiver_kira_zane`
- **world:** `cyber`
- **difficulty:** intermediate
- **summary:** Follow the map. The terminal node is in the hub. Find it. Tell only Kira where it leads.
- **tags:** `cyber`, `cyber_side`
- **source:** `content/quests/sub-worlds/cyber/kira-packet-map.json`

### 81. Silver's Office — A Quiet Meeting

- **id:** `cyber_silver_01_visit`
- **title:** Silver's Office — A Quiet Meeting
- **giver:** `broker_silver_vey`
- **world:** `cyber`
- **difficulty:** intermediate
- **summary:** Silver Vey will see you. Be brief. He bills by the minute.
- **tags:** `cyber`, `cyber_high`
- **source:** `content/quests/sub-worlds/cyber/silver-identity.json`

### 82. Silver's Office — Choose Your Path

- **id:** `cyber_silver_02_choose`
- **title:** Silver's Office — Choose Your Path
- **giver:** `broker_silver_vey`
- **world:** `cyber`
- **difficulty:** intermediate
- **summary:** Two paths. Buy new papers for yourself (8000 sparks, three days). Or pay 10000 to learn that Iyatte's son exists and that you must never look further.
- **tags:** `cyber`, `cyber_high`
- **source:** `content/quests/sub-worlds/cyber/silver-identity.json`

### 83. Silver's Office — Close the Door

- **id:** `cyber_silver_03_close`
- **title:** Silver's Office — Close the Door
- **giver:** `broker_silver_vey`
- **world:** `cyber`
- **difficulty:** intermediate
- **summary:** Whichever you chose, Silver closes the file. Whether you press further is on you.
- **tags:** `cyber`, `cyber_high`
- **source:** `content/quests/sub-worlds/cyber/silver-identity.json`

### 84. The Verge Apothecary — The Smuggled Satchel

- **id:** `fantasy_lyra_01_satchel`
- **title:** The Verge Apothecary — The Smuggled Satchel
- **giver:** `apothecary_lyra_thorne`
- **world:** `fantasy`
- **difficulty:** intermediate
- **summary:** Lyra's monthly satchel to Pia Thalis is overdue. The Verge road has been unsafe. She needs a runner.
- **tags:** `fantasy`, `fantasy_side`
- **source:** `content/quests/sub-worlds/fantasy/lyra-thorne-chain.json`

### 85. The Verge Apothecary — Moonleaf Cuttings

- **id:** `fantasy_lyra_02_moonleaf`
- **title:** The Verge Apothecary — Moonleaf Cuttings
- **giver:** `apothecary_lyra_thorne`
- **world:** `fantasy`
- **difficulty:** intermediate
- **summary:** Pia sends moonleaf cuttings every spring. This year's are seedlings, not cuttings — they need a fast carrier and dawn light.
- **tags:** `fantasy`, `fantasy_side`
- **source:** `content/quests/sub-worlds/fantasy/lyra-thorne-chain.json`

### 86. The Verge Apothecary — Master and Student

- **id:** `fantasy_lyra_03_master`
- **title:** The Verge Apothecary — Master and Student
- **giver:** `apothecary_lyra_thorne`
- **world:** `fantasy`
- **difficulty:** intermediate
- **summary:** Lyra's teacher disappeared into the Moonleaf Vigil twenty years ago. She thinks the bog witch Maeris knows what happened.
- **tags:** `fantasy`, `fantasy_side`
- **source:** `content/quests/sub-worlds/fantasy/lyra-thorne-chain.json`

### 87. The Bog — A Lattice Fragment

- **id:** `fantasy_maeris_01_fragment`
- **title:** The Bog — A Lattice Fragment
- **giver:** `witch_maeris`
- **world:** `fantasy`
- **difficulty:** intermediate
- **summary:** Maeris will teach you to cross to the Crucible — but you need to bring her a lattice-fragment first. Any size.
- **tags:** `fantasy`, `fantasy_lattice`
- **source:** `content/quests/sub-worlds/fantasy/maeris-crossing.json`

### 88. The Bog — Eight Steps

- **id:** `fantasy_maeris_02_steps`
- **title:** The Bog — Eight Steps
- **giver:** `witch_maeris`
- **world:** `fantasy`
- **difficulty:** intermediate
- **summary:** Maeris teaches you eight steps. Three she makes up each time. You'll walk the bog with her at moonrise.
- **tags:** `fantasy`, `fantasy_lattice`
- **source:** `content/quests/sub-worlds/fantasy/maeris-crossing.json`

### 89. The Bog — The Return Path

- **id:** `fantasy_maeris_03_return`
- **title:** The Bog — The Return Path
- **giver:** `witch_maeris`
- **world:** `fantasy`
- **difficulty:** intermediate
- **summary:** The path back is the path in. Maeris warned you. The path has changed.
- **tags:** `fantasy`, `fantasy_lattice`
- **source:** `content/quests/sub-worlds/fantasy/maeris-crossing.json`

### 90. Thornwood — The Long Audience

- **id:** `fantasy_seraphine_01_audience`
- **title:** Thornwood — The Long Audience
- **giver:** `lady_seraphine_voss`
- **world:** `fantasy`
- **difficulty:** intermediate
- **summary:** Lady Seraphine summons you to a private audience. The court is half-empty; the rest are listening. She has chosen you for a reason.
- **tags:** `fantasy`, `fantasy_main`
- **source:** `content/quests/sub-worlds/fantasy/seraphine-heir.json`

### 91. Thornwood — The Lacquered Box

- **id:** `fantasy_seraphine_02_lacquer`
- **title:** Thornwood — The Lacquered Box
- **giver:** `lady_seraphine_voss`
- **world:** `fantasy`
- **difficulty:** intermediate
- **summary:** Carry a lacquered box to the Verge crossroads at sunset. Don't open it. A woman in red will be waiting.
- **tags:** `fantasy`, `fantasy_main`
- **source:** `content/quests/sub-worlds/fantasy/seraphine-heir.json`

### 92. Thornwood — Resolution

- **id:** `fantasy_seraphine_03_choice`
- **title:** Thornwood — Resolution
- **giver:** `lady_seraphine_voss`
- **world:** `fantasy`
- **difficulty:** intermediate
- **summary:** Return to Seraphine. She'll know whether you opened the box. The keep's future hangs on the next half-hour.
- **tags:** `fantasy`, `fantasy_main`
- **source:** `content/quests/sub-worlds/fantasy/seraphine-heir.json`

### 93. The Verge — Sketches of the Print

- **id:** `lattice_emer_01_sketches`
- **title:** The Verge — Sketches of the Print
- **giver:** `scout_emer_voss`
- **world:** `lattice-crucible`
- **difficulty:** intermediate
- **summary:** Emer has tracked the same impossible print as Kiren in the hub. Show Kiren's sketch to Emer.
- **tags:** `lattice-crucible`, `lattice_print`
- **source:** `content/quests/sub-worlds/lattice-crucible/emer-print.json`

### 94. The Verge — Track Together

- **id:** `lattice_emer_02_track`
- **title:** The Verge — Track Together
- **giver:** `scout_emer_voss`
- **world:** `lattice-crucible`
- **difficulty:** intermediate
- **summary:** Track the creature with Emer. The prints lead to the verge breach.
- **tags:** `lattice-crucible`, `lattice_print`
- **source:** `content/quests/sub-worlds/lattice-crucible/emer-print.json`

### 95. The Breach — Cross to Meet Kiren

- **id:** `lattice_emer_03_breach`
- **title:** The Breach — Cross to Meet Kiren
- **giver:** `scout_emer_voss`
- **world:** `lattice-crucible`
- **difficulty:** intermediate
- **summary:** Emer wants to meet Kiren in person. Lead Emer across the breach to the hub Verge outpost.
- **tags:** `lattice-crucible`, `lattice_print`
- **source:** `content/quests/sub-worlds/lattice-crucible/emer-print.json`

### 96. The Sage's Hut — Sit and Wait

- **id:** `lattice_ono_01_sit`
- **title:** The Sage's Hut — Sit and Wait
- **giver:** `sage_ono_kell`
- **world:** `lattice-crucible`
- **difficulty:** intermediate
- **summary:** Ono Kell will write to Nesha if you sit and wait. Drink the tea.
- **tags:** `lattice-crucible`, `lattice_main`
- **source:** `content/quests/sub-worlds/lattice-crucible/ono-nesha-letter.json`

### 97. The Bog — Carry the Letter

- **id:** `lattice_ono_02_carry`
- **title:** The Bog — Carry the Letter
- **giver:** `sage_ono_kell`
- **world:** `lattice-crucible`
- **difficulty:** intermediate
- **summary:** Carry Ono's letter to Nesha in the hub. The bog is the fastest route — Maeris will let you through.
- **tags:** `lattice-crucible`, `lattice_main`
- **source:** `content/quests/sub-worlds/lattice-crucible/ono-nesha-letter.json`

### 98. Return Letter — Nesha to Ono

- **id:** `lattice_ono_03_return`
- **title:** Return Letter — Nesha to Ono
- **giver:** `oracle_nesha_keep`
- **world:** `lattice-crucible`
- **difficulty:** intermediate
- **summary:** Nesha writes back the same day. Carry her letter home.
- **tags:** `lattice-crucible`, `lattice_main`
- **source:** `content/quests/sub-worlds/lattice-crucible/ono-nesha-letter.json`

### 99. The Drill Yard — Earn an Audience

- **id:** `lattice_voss_01_drill`
- **title:** The Drill Yard — Earn an Audience
- **giver:** `leader_voss_dren`
- **world:** `lattice-crucible`
- **difficulty:** intermediate
- **summary:** Voss Dren will speak privately if you drill with the cohort first. Bring a blade you trust.
- **tags:** `lattice-crucible`, `lattice_side`
- **source:** `content/quests/sub-worlds/lattice-crucible/voss-pact.json`

### 100. The Lattice Circle — Hear the Pact

- **id:** `lattice_voss_02_pact`
- **title:** The Lattice Circle — Hear the Pact
- **giver:** `leader_voss_dren`
- **world:** `lattice-crucible`
- **difficulty:** intermediate
- **summary:** Meet Voss at the lattice circle after dusk. He'll explain the cross-world pact with Calla Bren.
- **tags:** `lattice-crucible`, `lattice_side`
- **source:** `content/quests/sub-worlds/lattice-crucible/voss-pact.json`

### 101. The Ruins — Carry the Confirmation

- **id:** `lattice_voss_03_calla`
- **title:** The Ruins — Carry the Confirmation
- **giver:** `leader_voss_dren`
- **world:** `lattice-crucible`
- **difficulty:** intermediate
- **summary:** Voss wants you to carry confirmation to Calla Bren. The pact lives or dies on this exchange.
- **tags:** `lattice-crucible`, `lattice_side`
- **source:** `content/quests/sub-worlds/lattice-crucible/voss-pact.json`

### 102. The Rebel Camp — Earn Calla's Trust

- **id:** `ruins_calla_01_camp`
- **title:** The Rebel Camp — Earn Calla's Trust
- **giver:** `rebel_calla_bren`
- **world:** `sovereign-ruins`
- **difficulty:** intermediate
- **summary:** Calla Bren leads the rebellion. Earn an audience by completing a small message run for her.
- **tags:** `sovereign-ruins`, `ruins_side`
- **source:** `content/quests/sub-worlds/sovereign-ruins/calla-rebellion.json`

### 103. The War Tent — The Fourth Uprising

- **id:** `ruins_calla_02_plan`
- **title:** The War Tent — The Fourth Uprising
- **giver:** `rebel_calla_bren`
- **world:** `sovereign-ruins`
- **difficulty:** intermediate
- **summary:** Calla shows you the map for the fourth uprising. She wants three things done before dawn.
- **tags:** `sovereign-ruins`, `ruins_side`
- **source:** `content/quests/sub-worlds/sovereign-ruins/calla-rebellion.json`

### 104. Dawn — The Uprising Begins

- **id:** `ruins_calla_03_dawn`
- **title:** Dawn — The Uprising Begins
- **giver:** `rebel_calla_bren`
- **world:** `sovereign-ruins`
- **difficulty:** intermediate
- **summary:** Be at the rebel camp at dawn. The fourth uprising begins with the city watching.
- **tags:** `sovereign-ruins`, `ruins_side`
- **source:** `content/quests/sub-worlds/sovereign-ruins/calla-rebellion.json`

### 105. The Refused Circle — Find the Refused-Mother

- **id:** `ruins_silv_01_circle`
- **title:** The Refused Circle — Find the Refused-Mother
- **giver:** `elder_silv_marn`
- **world:** `sovereign-ruins`
- **difficulty:** intermediate
- **summary:** Silv Marn refused everything four decades ago. She knows how to undo a compound refusal. Find her at the refused circle at noon.
- **tags:** `sovereign-ruins`, `ruins_high`
- **source:** `content/quests/sub-worlds/sovereign-ruins/silv-marn-dome.json`

### 106. The Refused Circle — Learn the Undoing

- **id:** `ruins_silv_02_teach`
- **title:** The Refused Circle — Learn the Undoing
- **giver:** `elder_silv_marn`
- **world:** `sovereign-ruins`
- **difficulty:** intermediate
- **summary:** Silv will teach you the undoing if you can compose a strength-6 refusal in her presence.
- **tags:** `sovereign-ruins`, `ruins_high`
- **source:** `content/quests/sub-worlds/sovereign-ruins/silv-marn-dome.json`

### 107. The Hub Dome — Stabilise the Field

- **id:** `ruins_silv_03_dome`
- **title:** The Hub Dome — Stabilise the Field
- **giver:** `elder_silv_marn`
- **world:** `sovereign-ruins`
- **difficulty:** intermediate
- **summary:** The hub Refusal Field is thinning. Carry Silv's undoing to the dome and stabilise the field.
- **tags:** `sovereign-ruins`, `ruins_high`
- **source:** `content/quests/sub-worlds/sovereign-ruins/silv-marn-dome.json`

### 108. The Ruined Court — Audience with the Archon

- **id:** `ruins_thanis_01_audience`
- **title:** The Ruined Court — Audience with the Archon
- **giver:** `archon_thanis`
- **world:** `sovereign-ruins`
- **difficulty:** intermediate
- **summary:** Archon Thanis accepts gifts of one kind: glyphs. Bring a fragment of the cross-world glyph you've composed.
- **tags:** `sovereign-ruins`, `ruins_main`
- **source:** `content/quests/sub-worlds/sovereign-ruins/thanis-glyph.json`

### 109. The Ruined Court — A Half-Layer Further

- **id:** `ruins_thanis_02_layer`
- **title:** The Ruined Court — A Half-Layer Further
- **giver:** `archon_thanis`
- **world:** `sovereign-ruins`
- **difficulty:** intermediate
- **summary:** Thanis gives you a fragment half a layer further along the same glyph. Carry it back to Nesha.
- **tags:** `sovereign-ruins`, `ruins_main`
- **source:** `content/quests/sub-worlds/sovereign-ruins/thanis-glyph.json`

### 110. The Refusal Keep — Compose the Composite

- **id:** `ruins_thanis_03_compose`
- **title:** The Refusal Keep — Compose the Composite
- **giver:** `oracle_nesha_keep`
- **world:** `sovereign-ruins`
- **difficulty:** intermediate
- **summary:** Nesha and Thanis's fragments compose to a strength-6 glyph. Mint it at the altar.
- **tags:** `sovereign-ruins`, `ruins_main`
- **source:** `content/quests/sub-worlds/sovereign-ruins/thanis-glyph.json`

### 111. Silas's Garden — The Apprentice's Name

- **id:** `superhero_hex_01_silas`
- **title:** Silas's Garden — The Apprentice's Name
- **giver:** `mentor_old_silas`
- **world:** `superhero`
- **difficulty:** intermediate
- **summary:** Old Silas tells you what Champion does not yet know. Iron Hex is Avery — Silas's best student. The redemption is yours to broker.
- **tags:** `superhero`, `superhero_main`
- **source:** `content/quests/sub-worlds/superhero/iron-hex-redemption.json`

### 112. The Skyline — Champion's Conditions

- **id:** `superhero_hex_02_kor`
- **title:** The Skyline — Champion's Conditions
- **giver:** `champion_kor_blackstar`
- **world:** `superhero`
- **difficulty:** intermediate
- **summary:** Champion will meet Iron Hex. Neutral ground, no mask, no suit. Rooftop above the noodle shop on 7th, midnight any Wednesday. Arrange it.
- **tags:** `superhero`, `superhero_main`
- **source:** `content/quests/sub-worlds/superhero/iron-hex-redemption.json`

### 113. The Rooftop — Midnight

- **id:** `superhero_hex_03_meeting`
- **title:** The Rooftop — Midnight
- **giver:** `—`
- **world:** `superhero`
- **difficulty:** intermediate
- **summary:** Be there when they meet. The city's future hangs on whether either one of them puts a hand out first.
- **tags:** `superhero`, `superhero_main`
- **source:** `content/quests/sub-worlds/superhero/iron-hex-redemption.json`

### 114. The News Office — A Story She Won't Publish

- **id:** `superhero_mira_01_warn`
- **title:** The News Office — A Story She Won't Publish
- **giver:** `reporter_mira_vance`
- **world:** `superhero`
- **difficulty:** intermediate
- **summary:** Mira Vance is building a profile on Champion's identity. Tell her not to publish. She'll listen if you can give her a reason.
- **tags:** `superhero`, `superhero_side`
- **source:** `content/quests/sub-worlds/superhero/mira-discretion.json`

### 115. The News Office — Trade Intel

- **id:** `superhero_mira_02_intel`
- **title:** The News Office — Trade Intel
- **giver:** `reporter_mira_vance`
- **world:** `superhero`
- **difficulty:** intermediate
- **summary:** Mira will sit on the Champion story for intel of equal weight. Tell her something that's both true and runnable.
- **tags:** `superhero`, `superhero_side`
- **source:** `content/quests/sub-worlds/superhero/mira-discretion.json`

### 116. The Front Page — Tomorrow Morning

- **id:** `superhero_mira_03_published`
- **title:** The Front Page — Tomorrow Morning
- **giver:** `—`
- **world:** `superhero`
- **difficulty:** intermediate
- **summary:** Whatever you traded, Mira will publish it tomorrow. Watch the city react.
- **tags:** `superhero`, `superhero_side`
- **source:** `content/quests/sub-worlds/superhero/mira-discretion.json`

### 117. The Skyline — Tell Champion About His Sifu

- **id:** `superhero_sifu_01_tell`
- **title:** The Skyline — Tell Champion About His Sifu
- **giver:** `champion_kor_blackstar`
- **world:** `superhero`
- **difficulty:** intermediate
- **summary:** His Sifu is alive in the hub. Champion does not know. Tell him.
- **tags:** `superhero`, `superhero_high`
- **source:** `content/quests/sub-worlds/superhero/sifu-revelation.json`

### 118. Cross-World — Take Him to His Sifu

- **id:** `superhero_sifu_02_carry`
- **title:** Cross-World — Take Him to His Sifu
- **giver:** `champion_kor_blackstar`
- **world:** `superhero`
- **difficulty:** intermediate
- **summary:** Champion will travel to the hub with you. Take him to Taro's pit at morning hours.
- **tags:** `superhero`, `superhero_high`
- **source:** `content/quests/sub-worlds/superhero/sifu-revelation.json`

### 119. The Pit — A Gift

- **id:** `superhero_sifu_03_gift`
- **title:** The Pit — A Gift
- **giver:** `champion_kor_blackstar`
- **world:** `superhero`
- **difficulty:** intermediate
- **summary:** Champion teaches you one move from the Sifu's hand. You will carry it.
- **tags:** `superhero`, `superhero_high`
- **source:** `content/quests/sub-worlds/superhero/sifu-revelation.json`

### 120. The Handshake Revelation

- **id:** `the_handshake_revelation`
- **title:** The Handshake Revelation
- **giver:** `archivist_maren`
- **world:** `concordia-hub`
- **difficulty:** master
- **summary:** Maren keeps a private archive in the Concordia hub. She has noticed that Vela of the Sovereign Ruins — who hasn't been seen leaving in over a hundred years — appears in archive entries from worlds she could not have walked to. The Lost Parcel that vanished between Concordia and the Ruins last month …
- **tags:** `domain:cross_world_arc`
- **source:** `content/quests/the-handshake-revelation.json`

---

## Design notes

1. Hub quests must remain soft-power (no combat completion conditions on `concordia-hub` ground).
2. Cross-world travel copy should read as moving from one Refusal to the next (LORE_BIBLE §5).
3. Do not resolve the Eighth Refusal secret text in player-facing quest prose.
4. Do not put "Concord admits he loves her" in quest VO.
5. Seed markdown for pillar content lives under `server/content/scenes/` until JSON port.
6. Consolidation / Voss / Kane threads (`consolidation-stake`, sealed-record, main-arc) are the meta-antagonist spine — keep ambiguous names sealed.

## Related content seeds (not yet in content/quests JSON)

| id | title | giver | world | notes |
|---|---|---|---|---|
| `speak_the_refusal_that_is_the_hub` | Speak the Refusal That Is the Hub | `concordia_first_breath` | concordia-hub | `server/content/scenes/three-pillar-quest.md` |
| `scene_love_triangle_court` | Love Triangle at the Unburned Court | — | concordia-hub | dialogue scene; 3 branches |

