# Intersection blend zones

Three glue places. They are not extra worlds. Each is a short run of modules where two kits share a floor, a door standard, and a weathering pass. Rows also live in `KITS.json` as `arch_ix_*` with `reuse_tier: rare`.

Shared rules from the art guide:

- One ground material across the joint so the seam is not a loading line.
- Weathering crosses the joint (soot, rain, dust) farther than faction paint does.
- Utility crosses over: pipes become fiber, brass becomes quartz, granite becomes marble.
- Door clear stays 1.2 × 2.2m. Snap stays 4m. Corridor stays at least 2.4m.
- Traversal anchors from both parents remain grabbable.

## Uncounted Wharf

`arch_ix_grid_coast` — Cyber-Crime, "slums of tomorrow."

Iron Coast brick warehouses meet Grid acrylic and cable. The floor is wet asphalt from the Coast kit, continuous. Fiber from the Grid is pulled through Coast pipes (`glue_pipe_to_fiber`) so a climb reads as one pipe, cyan at one end and rust at the other. Neon banners are cloth and they are soot-stained; sodium lamps still win the color of the rain.

Named beat: a wharf edge where Census drones are legally not supposed to count, and do. `npc_role_grid_labor` and `npc_role_coast_labor` both spawn. `hyb_billdrone` is allowed. Flower Law does not.

Traversal: fire escape, pipe run, wharf lip.

Kitbash parents: `arch_kit_cyber_grid`, `arch_kit_crime_coast`.

## Held Crown Stair

`arch_ix_sunder_dawn` — Mythical-Superhero, "pantheon of champions."

A stair of Sundering granite, four modules, landing shared, crowned with Permanent Dawn marble and a chrome launch lip. Gold leaf from the Sundering is worn through to stone; chrome is chipped back to the same stone. The foundation silhouette at 100m is still a granite flight. The Dawn retrofit is the crown, not a reskin of every tread.

Named beat: the place a Sundering ward and an Aegis can stand without either law winning. `skill_steel_mercy` and `skill_steel_curse_fold` are both legal. Using the curse to take a final blow fails both laws.

Traversal: granite treads, marble lip, a Sundering chain used as a swing line beside a Dawn rail.

Kitbash parents: `arch_kit_fantasy_sunder`, `arch_kit_superhero_dawn`.

## Unclosed Foundry

`arch_ix_crucible_foundry` — Arcane-industrial, "tech-magic foundries."

Crime soot brick and brass, Frontier salvage welcome as scrap, Crucible quartz ribs driven through the walls and deliberately short of a closed arch. A clock face on the gantry is missing its last numeral. Steampunk lives here as instruments (clock, copper pipe, valve) and stops being a costume. Pipes become fiber halfway along a catwalk.

Named beat: GameplayCore forge plus spell basin in one bay. `skill_craft_forge` and `skill_craft_unend` share the room. Completing a recipe is optional; leaving it open is the Crucible law and must not soft-lock the Coast craft.

Traversal: brass catwalk, quartz rib (thick enough to grab), clock gantry.

Kitbash parents: `arch_kit_crucible_lattice`, `arch_kit_crime_coast`, `arch_kit_frontier_road`.

## What not to blend

- Do not drag Grid neon into the Hub plaza.
- Do not put Flower Law urns in Sere.
- Do not build a fourth blend until these three have a graybox loop that closes on the 4m grid.
