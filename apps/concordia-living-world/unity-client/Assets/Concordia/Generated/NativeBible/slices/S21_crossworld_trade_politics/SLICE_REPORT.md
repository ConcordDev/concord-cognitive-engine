# SLICE REPORT — S21_crossworld_trade_politics

STATUS: COMPLETE

World: Cross. Cross is not a `WorldId`. It is the Hub's mediation of nine destinations: eight `Canon.Gates` spokes and the Sere waystone. Facet: trade politics. Design authority JSON and Markdown only. No meshes spawned, no catalogs rewritten, no Library wipe, no pine re-download, no Unity or Concord process touched.

## Shipped

| File | Role |
| --- | --- |
| README.md | Index and pins |
| CATALOG.md | Destinations, borders, blends, four quests, combat ceiling |
| POLITICS.json | Primary: rates, SoftEnter, unplaced kits, four side quests |
| STORIES.md | Two nines, three tariff writers, the lip gap, blend parentage, quest backstories |
| AURA_BIND_NOTES.md | Four boards, zero spawn, SoftEnter fail rule |
| SLICE_REPORT.md | This file |

Mirror: `Assets/Concordia/Generated/NativeBible/slices/S21_crossworld_trade_politics/`.

## Counts

- Destinations tabulated: 9. Hub plaques used as boards: 4 (Cyber, Frontier, Crime, Crucible). The other four plaques keep their posts and receive no board.
- Borders tabulated: 9. One is an objective (`border/concord-link-frontier/crime`). `border/crime/sere` is recorded and not stood on.
- Blend kits cited: 3. Transforms added: 0.
- Side quests: 4. `q_s21_one_rate`, `q_s21_steel_before_the_spoke`, `q_s21_open_border`, `q_s21_no_ninth_plaque`.
- Rewards: xp only (40, 45, 55, 50). Coin 0. Items none. Skills none. Faction deltas none.
- New creatures, mini-bosses, bosses, guards, caravans: 0.
- Gate guard count left at `ConcordiaHost.GateGuards` 2.

## Law placement

The Hub face of every spoke gate is tariff 0.05, inspection 1, owner string `Concordant Watch`, while the clock is Hub. Far-face names follow `factions.json` index 0 and are not embassies. The Frontier still has no embassy. The ring rate still applies there.

Every authored cross-world `IsDisputed` check is empty, so all nine borders are `open` at 0.05. The 0.12 branch stays dormant. Caravan arrival still multiplies by `RingTariff` alone. This file does not reconcile that writer and does not dispatch a caravan.

Flower Law stays the 42 m disk. At (−43.50, 0.00) steel is live and the clock is still Hub until the Frontier arrive disk near radius 152. SoftEnter on a walk announces the refusal. `link_gate` does not. A kill line outranks a journey stamp. Hub has no route, so leaving the Court records no border crossing.

Sere's lip (−17.71, −38.08) has no plaque. The present stays (−125.27, −269.29) with `HasLinkGate` false. The ninth Refusal remains the Hub ground. Pinewood Crossing stays (62, −28).

## Geography checked

Gate centers are `34 * (cos θ, sin θ)` at the eight `Canon.Gates` angles. Lips are the same angles at 42 m. Presents are the same angles at 220 m. Sere's angle is `5π/4 + 0.35`. Ring midpoints sit at hub radius 203.25 m, half-chord 84.19 m, outside ArriveM 68. The Crime–Sere midpoint is half-chord 58.85 m, inside both arrive disks, and `CountryAt` returns Crime because Crime precedes Sere in `MegaworldMap.All`.

Blend parent pairs were checked against ring neighbors. Wharf and stair are not neighbor pairs. The foundry shares the Frontier–Crime neighbor pair and also names the Crucible, which is not on that border.

## Honesty gaps

- Cross is a slice label. There is no canon folder and no `WorldId` to bind. Notices bind to existing gate transforms and one existing border id.
- `q_s21_open_border` is a long walk to radius 203 m. The other three errands stay on the Court and the lip. The arrive disk at radius 152 is described and is not an objective.
- A binder that cannot read `LastTravelKind` or `LastEvent` can still complete `q_s21_steel_before_the_spoke` by position and clock. The kill-line rule is then unverified in play.
- Far-face owner names assume `factions.json` order is what `WorldBook.Factions` returns first, before `factions-extra`. That matches `Factions()` today.
- `border/crime/sere` is tariff 0.05 in the struct and unreachable as a Sere step under `CountryAt`. Both facts are filed. Neither is "fixed."
- Volume quests, S02's six guest errands, S19's empty tariff, and S20's boards are not retuned. Spoke ecology caps are not retuned.
- No live play session was run. This slice is text. Coordinates are derived from `Canon.Gates`, `MegaworldMap`, and `WorldGeography`, not from a placed scene probe.

## Sources read

`Canon.cs` WorldId, Gates, radii, PickFight, InHubCourt, SteelLive. `WorldGate.cs` GatePost. `WorldBook.cs` CrossRing tariff, caravan Arrive, Staple, Folder, Factions order. `WorldGeography.cs` borders, IsDisputed, CountryAt, TariffFor. `MegaworldMap.cs` Present, ArriveM, HasLinkGate, Toward. `ConcordiaHost.GateGuards`. Hub `lore.json` embassy era, ninth Refusal, seven-spoke oath and inn. First faction object in each spoke `factions.json`. Country `disputed_border` values checked for cross-world id matches: none. Native bible art direction, taxonomy, `INTERSECTIONS.md`, three `arch_ix_*` kits. Volume quest catalog counts left as they are. Prior slices S02, S09, S11, S13, S14, S17, S19, S20 for pins this facet must not move. S01 through S18 were not retuned.
