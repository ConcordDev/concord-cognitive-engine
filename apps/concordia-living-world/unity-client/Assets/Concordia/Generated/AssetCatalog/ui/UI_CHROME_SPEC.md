# UI chrome spec (B29)

Tied to `~/.zuko/lookfeel/FEEL_UI_CHROME.md`. Lookfeel map and styles stay as written. This file is the asset contract: which pieces are small icon meshes, and which pieces are color only.

Two skins, one inventory. The skin follows the ground law, not the player's faction costume. Flower Law is the Hub disk of 42 m. The arena sand exception is about 8 m around Hub local (0, 18).

## Skins

Court parchment while `Canon.InHubCourt` is true and the player is not on arena sand.

- Panel fill `#f3e6d0`. Limestone scrim `#c4b49a`. Ink `#3a3428`. Accent rule `#c8721a`, 2 px, the flower.
- Corner widget: `ui_court_brass_pin`. Worn, not torn for style.
- Titles are a serif. Numbers are a plain humanist. Counts stay counts.
- Keyboard chip: `ui_court_brass_chip`. The shortcut is runtime type on a blank face.
- Toast: `ui_court_lantern_toast`. Short, warm, then dim. A flowered blade shows the petal, then the steel's name in quiet type.
- Memory: `ui_court_pressed_note`. Fact, then a gap. The gap stays empty.

Steel metal on every spoke, on Sere, on the Hub outside 42 m, and on arena sand.

- Panel fill `#2a2622`. Edge wear `#8a7a68`. Ink `#efe6d4`.
- The world accent is a 2 px rule, not a fill. Hexes are in the board table below.
- Corner widget: `ui_steel_screw`.
- Name plate: `ui_steel_blank_plate`. WorldId display name is runtime type. Albedo has no letters.
- Keyboard chip: `ui_steel_stamped_chip`.
- Toast: `ui_steel_slide_toast`. It slides. A failure stays on the plate.
- Gossip: `ui_gossip_torn_margin`. On the Iron Coast the world stroke stays `vfx_crime_chalk_tick`. No chat bubble and no tail.

## Shared behavior

- SoftEnter crossfades the skin over about a third of a second, after the world accent is known. Reduced motion cuts.
- `ui_arena_sand_insert` sits in the parchment skin on arena sand, so the exception is visible before the first swing.
- `ui_poise_tick_notch` ticks the active plate. No health bar. No generic frame around the screen.
- Empty states say what is missing, as type: "No mesh." "No route." "No quest." They do not invent notices.
- Board copy is one runtime line on the board icon. No line means the empty state.

## Plates that are not meshes

Do not generate a bitmap atlas, a 2k panel, or a nine-slice texture. Panel fill, scrim, ink, and the 2 px rule are UI colors from this file. Icon rows are the only Aura prompts. Each icon is a single small subject. Triangle budgets are the `triangle_budget` on the row (48–220).

## Plate stamp (runtime type)

| WorldId | Display name on `ui_steel_blank_plate` |
| --- | --- |
| Hub | Unburned Court |
| Fantasy | the Sundering |
| Tunya | Tunya |
| Ruins | Sovereign Ruins |
| Crime | Iron Coast |
| Cyber | the Grid |
| Frontier | Frontier |
| Superhero | the Permanent Dawn |
| Crucible | Crucible |
| Sere | Sere |

Hub inside the Court hides the steel plate and uses the urn tab.

## Board icons

These are HUD tokens. They do not replace world plaques. `prop_hub_se_notice_blank` stays the hall notice.

| WorldId | Id | Board | Rule |
| --- | --- | --- | --- |
| Hub | `ui_board_hub_urn_tab` | urn wood | `#c8721a` |
| Fantasy | `ui_board_fantasy_fold` | fold slate | `#c8a060` |
| Tunya | `ui_board_tunya_slat` | terrace wood | `#c8721a` |
| Ruins | `ui_board_ruins_chip` | ash limestone | `#b89060` |
| Crime | `ui_board_crime_bill` | posted bill | `#c8a060` |
| Cyber | `ui_board_cyber_hole` | missing-number plate | `#3dffa0` |
| Frontier | `ui_board_frontier_canvas` | canvas | `#4a3828` |
| Superhero | `ui_board_dawn_mercy` | mercy card | `#ffd0a0` |
| Crucible | `ui_board_crucible_bracket` | unclosed bracket | `#20ffd0` |
| Sere | `ui_board_sere_frame` | furnace frame | `#e07030` |

The Cyber hole has no digit. The Crucible bracket does not close. The Sere frame has an ember notch and no flame tongue. The Dawn card has no victory word. The Frontier canvas has no baked road line. The Tunya slat has no fruit.

## Rows

Batch `B29_ui`. Twenty-one prompts. Full entries: `ui/B29_CHROME.json` and `batches/B29_ui.json`.

## Cycle 2

Eight more tokens. The first twenty-one stay. Panel fill, scrim, ink, and the 2 px rule stay colors. No bitmap atlas.

| Id | Skin | Job |
| --- | --- | --- |
| `ui_court_slot_well` | Court, inside 42 m, off arena sand | open inventory well |
| `ui_steel_slot_well` | steel | the same well |
| `ui_court_count_face` | Court | blank face, count is type |
| `ui_steel_count_face` | steel | blank face, count is type |
| `ui_skin_seam` | either, crossfade only | brass cut against steel |
| `ui_steel_stay_tab` | steel, failure only | pins the slide toast |
| `ui_board_line_blank` | with the board token | one line of type |
| `ui_court_quiet_strip` | Court | steel name under the petal |

One inventory. The skin picks the well. The hole stays empty until a real item mesh is in it. A count is type on the closed face. No baked digit. The seam shows for about a third of a second after the world accent is known. Reduced motion does not spawn it. The stay tab is not a check and not a dismiss. The board line is blank. No line means the type "No quest." The quiet strip has no petal. The petal stays on `ui_court_lantern_toast`. Full entries: `ui/B29_CHROME_CYCLE2.json` and `batches/B29_ui_cycle2.json`.
