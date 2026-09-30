# SLICE REPORT — S02_hub_politics_culture_sidequests

STATUS: COMPLETE

World: Hub (Unburned Court). Facet: politics_quests. Design authority JSON and Markdown only. No meshes spawned, no faction files rewritten, no Library wipe, no pine re-download, no Unity process touched.

## Shipped

| File | Role |
| --- | --- |
| README.md | Index and pins |
| CATALOG.md | Seats, rings, gates, quests, presences |
| POLITICS.json | Primary: five seats, eight gates, ten side quests, two presences, one witness press, one flowering intrusion, one shoulder scuffle |
| STORIES.md | Politics essay, guest instruments, wharf, quest sense |
| AURA_BIND_NOTES.md | Bind order and refusals |
| SLICE_REPORT.md | This file |

Mirror: `Assets/Concordia/Generated/NativeBible/slices/S02_hub_politics_culture_sidequests/`.

## Counts

- Side quests: 10, each with a Canon HubGuest or Pillar giver and a backstory. Turn-in matches the giver. Maren files the three distances before Concord closes his own quest. She is not a second giver.
- Compact seats described: 5, matching `factions.json`. New faction ids: 0.
- Guest politics indexed: 15 HubGuests + 3 Pillars. Playable loops use 10 of them (Elias, Seraphine, Jax, Mama, Nyx, Concord, Vesper, Thorne, Lyra, Zero). Lamplighter, Gale, Asbir, Maren, Brackish, Old Seam, Concordia, and the Sovereign stay constraints on existing chains.
- Civic presences: 2 (Watch shoulder cap 6, stall merchants cap 4).
- Civic encounters: 1 (`enc_hub_count_fails`), cap 1, no health table.
- Witness press: 1 (`mob_hub_courtesy_press`), cap 5, no health table.
- Bosses: 0 inside Flower Law. Mini-bosses: 1 (`mb_hub_unsigned_courier`) on the Frontier shoulder at (−46, 0), hail-first, no loot.
- Fauna rows added: 0. S01 caps untouched.
- Uncounted Wharf: named, not instanced. No Hub coordinate invented.

## Law placement

All eight gate centers sit at 34 m, inside the 42 m disk, so embassy courtesy is Flower Law. The Crime spoke's lip is (−29.7, −29.7). The Grid officer flowers on the first step because the plaque is already inside the mercy. Arena steel stays Gale's disk. Watch steel stays on the 42–56 m shoulder. The unsigned courier stands at (−46, 0), where steel is live, and flowers only if pulled back inside the disk. Pinewood Crossing stays (62, −28).

## Honesty gaps

- lore.json's country-sized hub is not the 56 m instance. Quest objectives use Canon stands and spokes. "Two streets" is those two legs.
- `iron_wardens` and `merchant_collective` are lore tags. The row ids used here are `concordant_watch` and `bazaar_consortium`. Gale and Ren stay two people. Vesper and Velka stay two people.
- Shadow network, Crimson Court, Syndicate, Anti-Sovereign, Luminary, and Census Authority have no Hub faction row. They are not given one.
- Mira's silence, the sealed ancestor, Asbir's cavity, the Nesha gap, and the Impossible Print are named and left on their existing quests.
- The wharf's drones and `hyb_billdrone` are real on Cyber and Crime. This slice does not spawn them and does not pretend a visit happened.
- Districts in `cities.json` have no polygons. The Market Well is not given a fake wedge.
- Broken Spire, Upper Grove, and Three Refusals Tavern are listed as approaches and not stocked.
- Meshes stay stubs. A missing CX role spawns nothing.
- Concord's volume alias `concordia_first_breath` is not reused as a second pillar.

## Sources read

`Canon.cs` radii, gates, guests, pillars, `SteelLive`. `HubPlaza.PlaceGate`. `concordia-hub/lore.json`, `cities.json`, `factions.json`, `npcs.json`, and the hub quest set (Founding Day, sealed record, Nesha, Brackish, Impossible Print, first cycle). Native bible art direction, guest redesign, roles for warden, merchant, court labor, shadow courier, and census officer, `HYBRIDS.json` billdrone world ids, intersection and kit entries for Uncounted Wharf, volume Hub quests and vendor item ids, S01 ecology slice. No other world was authored. Depth pass kept the first six quest ids and added four.
