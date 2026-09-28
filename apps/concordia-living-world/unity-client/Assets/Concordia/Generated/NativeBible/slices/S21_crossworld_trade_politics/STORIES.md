# Stories — how the Hub holds nine destinations

The Court is one disk. Everything that can be conquered has already been refused by the ground inside 42 m. What remains, past Year 38's four hours of flowers, is mediation: a rate, a walk, and a few joints where two kits share a floor that has not been built yet.

There are two different nines, and they are easy to weld by accident.

The nine destinations are the eight gates in `Canon.Gates` plus Sere. Cyber at angle 0, then Ruins, the Sundering, Tunya, the Frontier, Crime, the Permanent Dawn, the Crucible, and Sere set off the ring at Crime's angle plus 0.35 rad. The present ring is 220 m. Sere's present is (−125.27, −269.29). `HasLinkGate` is false there.

The other nine is the ninth Refusal. Lore `hub_the_ninth_refusal` says it is not spoken. It is stood upon. To enter by any gate and put down a single coin in a market that belongs to no world is to refuse to let one's own refusal win. Lyra has not taught it because it cannot be taught. That nine is the Hub itself. It is not a ninth plaque, and it is not Sere.

A third count sits in the founding and is left alone. `hub_concordant_oath` records seven sub-worlds sharing an archive and a dome. `hub_seven_spokes_founding` is an inn, neutral through three faction wars. Seven is the oath. Eight is the ring. Nine destinations are the ring plus the waystone. None of those sentences is edited into the others.

## The Hub face

`HubPlaza` places each gate at `(cos(angle) * 34, 0, sin(angle) * 34)`. Every center is inside Flower Law. Embassy courtesy, blackmail dressed as etiquette, a data spine, a laundered reputation, a grove visited at night: all of that politics, already walked in S02, happens where a blade becomes a flower.

`GatePost.Ensure` writes one face while `WorldClock.World` is Hub. Tariff 0.05. Inspection 1. Owner string `Concordant Watch`. The same three lines on Cyber, on the Crucible, and on the Frontier, whose lore says the walkers keep no embassy and the other seven find that insulting or enviable. The absence of an embassy does not zero the rate. The plaque at angle π is the whole staff, as S02 already filed, and the staff still posts the ring tariff.

When the clock has become the spoke, the same component writes a different owner: the display name of `WorldBook.Factions` index 0. That is the Zero Collective on the Grid, the Three Archivists in the Ruins, the Wildwood Circle in the Sundering, the Sanguire of Sandrun on Tunya, the Couriers' Guild on the Frontier, the Ghost Network on the Coast, the Enforcers' Movement at the Dawn, the Witnesses in the Crucible. Those names are file order. They are not a second embassy invented for this slice. The Couriers' Guild on a far face is not the embassy the Frontier refused to build.

Two guards stand at a Hub-clock gate because `ConcordiaHost.GateGuards` is 2. The code names them `a guard`. Their line is that they keep their own hours and are not an authored citizen. Wing Chun, Karate, Capoeira, Muay Thai, and the sword stay `Canon.PickFight` for the world underfoot when a later facet stands a person. This one stands nobody new. Firearm coverage remains zero. A checkpoint does not grow a rifle to look like a border.

## Three instruments, one number

Trade wants a single story. The code has three writers, and today they happen to print the same number.

The gate rate is `CrossRing.RingTariff`, 0.05, on every non-waystone post.

The border rate is written in `WorldGeography.AddRoute`. Eight neighbors around the ring, plus one route from Crime to Sere. If a country in world A lists a `disputed_border` string that equals a `country_id` in world B, the border would be status `disputed`, tariff 0.12, and it would ask for a crossing writ. Authored country files were checked across every world pair. No dispute string matches another world's country id. All nine borders are `open` at 0.05. The 0.12 branch is live code and dormant data. This slice does not invent a dispute to wake it.

The caravan writer is a third hand. `Arrive` sets `paid = value * RingTariff` and appends a row to `tariffsCsv`. It does not read `BorderDef.tariffRate`. If a later authoring pass ever makes a border 0.12, the ledger would still record 0.05 until that function is changed. This facet does not change it, and it does not dispatch a caravan. The staples it would carry are already named: lanterns, remnants, harvest, ward, invoices, census, road, mercy, drift, marks.

Hub has no `countries.json` and no route in `BuildBordersAndRoutes`. Leaving the Court for a Present writes the journey line — "You left Hub for The Frontier." — and does not record a border crossing, because `RouteBetween` from Hub is empty. The mediation out of the heart is the gate post and the walk. The mediation between spokes is the border struct. They are not the same chalk mark.

## SoftEnter

`ContinentStream.SoftEnter` is the politics of arrival. It sets the actor's world and the kit, then the clock. A walk that changes world stores the previous kill line and puts it back after `Enter`, so a death summary is not replaced by "You came home from …". A journey line is written only when no kill line is already the last event. `kind` defaults to `walk`. `link_gate` skips the refusal announcement. A walk announces `title` and `refusal`. People within 14 m notice. On a return to the Hub, if a last event exists, the player hears that they still talk about it.

`ReceiveHere` asks a prior question. Inside the 42 m disk, `InHubCourt` keeps the next world as Hub. Outside it, `CountryAt` decides. A Present claims you when you are within 68 m of it. Otherwise a route claims you when you are within `width + 8` m of its polyline, 12.2 m on these roads, and the halfway parameter hands you to world B. Otherwise the legacy lookup returns Hub until you are inside some arrive disk.

So the Frontier lip is three different facts at once. At (−42.00, 0.00) you are still inside the disk. One and a half metres further, at (−43.50, 0.00), the radius is 43.5, steel is live, `Toward` reads Frontier from the bearing, and the clock is still Hub. The arrive disk along that ray begins near radius 152 m, where the present at (−220, 0) comes inside 68 m. Between the lip and that disk the compass has named a spoke, the law has released the flower, and the clock has not moved. That gap is the mediation. It is not a loading line, and it is not yet the Frontier's own ground. S13 and S14 keep the continent. This errand stops on the gap.

## Blends

`INTERSECTIONS.md` names three glue places. They are short runs of modules, rare kits, not worlds. Shared rules: one ground material, weathering that crosses farther than faction paint, pipes that become fiber, door clear 1.2 × 2.2 m, snap 4 m, corridor at least 2.4 m. The bible forbids a fourth blend until these three have a graybox on the 4 m grid. They do not have placed transforms. This slice does not supply the graybox.

Their parent pairs are not the ring pairs, except in part.

Uncounted Wharf joins Cyber and Crime. Those gates are not neighbors. Cyber's borders are Ruins and the Crucible. Crime's borders are the Frontier and the Dawn. The wharf is a kit note: wet asphalt from the Coast, fiber pulled through a Coast pipe, neon cloth gone soot-stained, sodium still winning the rain. `hyb_billdrone` is the hybrid whose `world_ids` are exactly those two parents. S09 fields one inside `enc_rotor_saddle`. S11 keeps the Cyber cap at 0. The kit sentence that the drone is allowed is not a new spawn, and Flower Law does not follow anyone to a floor that has no coordinate.

Held Crown Stair joins the Sundering and the Permanent Dawn, also not neighbors. Granite flight, Dawn marble as a crown, gold leaf worn through to the same stone the chrome is chipped back to. The named beat is a place where a ward and an Aegis can stand and neither law wins. Using the curse to take a final blow fails both. S03 and S15 keep the creatures and the bosses of those worlds. The stair is not dropped onto either present to host a conversation between them.

Unclosed Foundry drives Crucible quartz through Crime brass, with Frontier salvage welcome as scrap, and stops the arch short of closing. Frontier and Crime are neighbors. Their border is real, at (−187.78, −77.78), tariff 0.05, status open, controlling id `frontier_couriers_guild`. The Crucible is not a member of that pair. Standing on the border is not standing in the foundry. Completing a Coast recipe must not be soft-locked by the Crucible's rule that a thing stays open, and that rule cannot be enforced by a kit that has no bay yet. S17 keeps the foundry beasts for when a transform exists. S18 keeps the Crucible's politics. This errand reads the border and leaves the bay unbuilt.

Taxonomy says hybrids spawn on the borders named in their `world_ids`, never as a random mash in the plaza. The ring midpoints are not those named borders. No hybrid is moved onto a midpoint to decorate a tariff.

## What the embassies already are

S02 walked Elias, Seraphine, Jax, Mama, Nyx, and Concord. Volume already has the cook, the fight, the claim, Pinewood, the urn, Brackish, the notebooks, the lamplighter, and Nesha. The Voss genealogy stays sealed. The Frontier embassy stays unbuilt. Speaker Mira's vote stays unforced. This slice uses the plaques as boards and does not give those guests a second errand.

Mama still crosses realities by never sleeping in the same world twice. That sentence is lore. It is not a new caravan, and it does not retune S10. Jax's contracts from all eight stay his line. They do not become a tariff table.

## Quest backstories

### One rate

The market that belongs to no world still has a number on the door. Someone will eventually try to write the Zero Collective's name on the Hub face of the Grid gate, or to zero the Frontier plaque because the walkers refuse a building. The errand is the refusal of that edit. Three plaques, one rate, one owner string, inspection 1. The coin in the lore is the act of using the market. This quest pays no coin, because a payout would be a second instrument.

### Steel before the spoke

The lip is where visitors think they have arrived. They have left the mercy and they have not entered the civilization. Steel works. The refusal has not been announced, because `SoftEnter` has not run. No border row is filed, because Hub is not an endpoint of any route. If a kill line is already the last event, it stays. If the player takes a `link_gate` and the last event becomes a journey line, the errand has missed the gap it was built to stand in. The Frontier present at 220 m remains S13 and S14.

### The open border

Spoke to spoke is where a `BorderDef` is the ground. Frontier to Crime is the pair that also parents part of the Unclosed Foundry, which is why it is the one midpoint worth the walk. The halfway point is outside both arrive disks, so the route can speak. World B at the exact half is Crime. The controlling id is the Couriers' Guild's id, which is file order, not an embassy. The foundry kit is not placed to give the quartz a vote. The 0.12 rate is not chalked on a border the country files do not dispute. Guard-role strings stay strings.

### No ninth plaque

Sere's bearing crosses the law at (−17.71, −38.08), between the Crime lip and the Dawn lip, 0.35 rad past Crime and 0.435 rad short of the Dawn. There is no center at 34 m on that ray. Cutting one would turn the waystone into a spoke and would confuse it with the ninth Refusal, which is the ground the walker is already standing on whenever they are inside the disk. The waystone's zeroes — tariff, inspection, owner — belong to a `GatePost` whose destination is Sere. `Canon.Gates` has no such destination. Building a gate to host the zeroes would invent the plaque this errand exists to leave uncut. Inside Sere, `q_s19_empty_tariff` already reads the blank post. This errand does not enter that continent and does not write an owner onto it.

The Crime–Sere geometric midpoint (−140.41, −212.43) sits inside both arrive disks. The resolver returns Crime. A quest that stood there and called it the waystone would be lying about `CountryAt`. It is recorded so a later binder does not "correct" the empty lip by marching to that point.
