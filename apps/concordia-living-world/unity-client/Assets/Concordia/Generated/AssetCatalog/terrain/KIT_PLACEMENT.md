# B31 terrain kits — placement

Modules only. No heightmap. Parents in lookfeel B18 and B20 stay. See `PIPELINE_FEED.md`.

| Kit | Worlds | Where | Keep |
| --- | --- | --- | --- |
| `terr_kit_pinewood` | Hub | Outside the 56 m wall, around Pinewood Crossing (62, −28) | `flora_hub_pinewood_pine`, `env_hub_pinewood_milepost`, `env_hub_salt_verge` |
| `terr_kit_salt_road` | Hub, Fantasy | Hub salt road outside the wall; Sundering south track beside `env_sunder_salt_toll` | verge, salt grass, toll post, milepost |
| `terr_kit_ash_grove` | Fantasy | East march toward Ruins, off the salt track. Ash meets moss. Kits do not merge | thorn oak, fold willow, rune pine, Ruins ash cypress, fold lip |

Flower Law is the 42 m Hub disk. These kits sit outside it. The milepost is the only lettering. Stag caps stay as authored. The grove ash is an open pale crown. `flora_ruins_ash_cypress` is the narrow forum tree and stays on Ruins.

Rows: `HUB_FANTASY_TERRAIN_B31.json`. Batch `B31_terrain`.

## Cycle 2 fill (same kits)

Twelve more modules in `HUB_FANTASY_TERRAIN_B31_CYCLE2.json`. The first fifteen stay. Same places. Same parents. Snap stays 1 m.

| Kit | Add | Not |
| --- | --- | --- |
| `terr_kit_pinewood` | cone, resin bead, root arc, dead snag | sapling, needle mat, bark slab, stump cut face, 14 m pine, milepost |
| `terr_kit_salt_road` | hoof cup, salt ribbon, clod, board end | wheel chip, crust pan, salt grass, dust berm, verge log, milepost, toll bowl |
| `terr_kit_ash_grove` | ash key, bracket shelf, bole ring, root knuckle | leaf mat, ash whip, fallen log, grove ash trunk, moss lip, Ruins cypress |

The cone is not the Court seed cup. The snag has no needles. The board has no letters. The hoof cup has no horse. The bracket is not a creature. The bole ring is not a trunk. The knuckle is not a Crucible seam. Stag caps stay as authored. Flower Law stays the 42 m Hub disk.

## Urban kits (B31_terrain_urban)

Same rule. Street, alley, and roof modules. They do not replace B18 landmarks.

| Kit | Worlds | Where | Keep |
| --- | --- | --- | --- |
| `terr_kit_coast_street` | Crime | Sodium streets on the tenement rise. Not the bay interior, the warehouse apron, or the wharf | sodium lamp, fire escape, gutter mouth, posted bill, overpass pier, bollard, warehouse door, plane, gutter fern, dock reed |
| `terr_kit_grid_alley` | Cyber | Mid-rise alleys. Not the sky floor, the census plaza, the service corridor, or the Uncounted Wharf | alley drain, under hatch, neon banner, census plinth, sky-bridge segment, service corridor, glitch frame, well weed, roof moss |
| `terr_kit_dawn_roof` | Superhero | Roofs around the 8 m pad. The dirty square is low-rent only. Not the mercy plaza, the arterial pier, or Kane's fin | roof pad, mercy ring, arterial pier, Kane fin, clinic canopy, spandrel, launch lip, pad facade, park plane, roof olive |

The Coast tar square is not the Dawn marble circle. The alley paver is not the drain trench. The gravel arc is not a second launch pad. No neon on the Coast. No digit on the Grid. No flame on the vent cowl. No victory statue. SoftEnter first frame on the Coast stays the lamp, wet brick, and the bill. Named set `sky_bridge` stays unplaced. Flower Law stays the 42 m Hub disk.

Rows: `URBAN_TERRAIN_B31.json`. Batch `B31_terrain_urban`.
