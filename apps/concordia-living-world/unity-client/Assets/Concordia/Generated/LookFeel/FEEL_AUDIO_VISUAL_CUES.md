# Feel — audio-visual cues

Cue specs. No audio files, no generated stingers. Shape and color are the contract. A later audio pass can hang a clip on the same id. If no clip exists, the visual still has to carry the tell.

Shared rule: one shape, one color family, under half a second for a telegraph, longer only for a law that the player must read.

## Spoils

A spoil is a thing on the ground, not a fountain.

| Id | Shape | Color | When |
| --- | --- | --- | --- |
| `cue_spoil_petal` | one petal, flat | `#c8721a` | a blade became a flower; the petal is the reminder, not loot |
| `cue_spoil_fruit` | three small masses max, on the tree they were already on | `#c8721a` | Tunya, fruit taken, tree uncut |
| `cue_spoil_ash` | a pinch of dust that settles | `#b89060` | Ruins catalogue, not a coin burst |
| `cue_spoil_bill` | a paper rectangle on the ground | `#c8a060` | Iron Coast, the bill arrived |
| `cue_spoil_digit` | a dark token, one missing corner | `#3dffa0` edge only | Grid, a number given up |
| `cue_spoil_rivet` | a short iron bar | `#4a3828` | Frontier, only after the slice's drop rule; do not spawn the Last Dome to justify it |
| `cue_spoil_tile` | a chipped square | `#8a3030` | Sere, a mark broken, not a gem |
| `cue_spoil_shard` | a fat chip, not a sparkle | `#c8b4ff` one frame, then stone | Crucible |
| `cue_spoil_crest` | a closed crest, gold worn | `#c8a060` | Sundering, the crest stays closed |

No rainbow loot beam. No rarity pillar.

## Gossip

Gossip is peripheral and ugly on purpose.

- Court: a warm murmur shape, a small ring of lantern light on a passerby, no subtitle unless a quest already has a line.
- Coast: a chalk tick on a wall, sodium, one stroke.
- Grid: a banner hem flickers once, cyan, the cloth does not change its word.
- Frontier: canvas snaps, a shape in the dust, no voice line required.
- Sere: the furnace eye shutters half a second. People look. The UI does not explain.
- Dawn: a window goes dark in one office. Mercy is someone not finishing a cheer.
- Tunya: pollen knocks loose, a few grains.
- Ruins: a stele line does not grow. The absence is the gossip.
- Crucible: a seam ticks and does not close.
- Sundering: a gold scar stays dull. The curse was not used.

## Threat telegraphs

The windup must differ from the idle. Color is the world's accent, shape is the attack's direction.

| Tell | Shape | Color family | Reads as |
| --- | --- | --- | --- |
| Melee commit | a thick wedge on the ground along the swing | world accent | get off the wedge |
| Grab or invoice | a ring on the ankles, broken | Coast sodium or Sere eye | step out before it closes |
| Count | a digit ring with a gap, on the Census plinth or a drone lens | cyan | the gap is the safe bearing |
| Dust | a low fan, ankle height | Frontier tan | lateral, not a jump |
| Fold | a line that closes inward on the attacker | Sundering gold | the curse is theirs if they use it |
| Mercy | a gold ring that stops short of the target | Dawn | the hit will not finish them |
| Unclosed | a teal crack that opens again | Crucible | the pattern resets |
| Ash | a vertical stop, a line that ends | Ruins amber | the ending fails |
| Harvest | a circle on the tree, not on the player | Tunya fruit | striking the tree is the mistake |
| Mark | a tile lighting under one foot | Sere `#8a3030` | move before the compound |

Aerial dives (canvas, griffin, harpy) use a shadow disc that grows. The disc is the tell. A scream is optional and not specified here as a file.

## UI coupling

Toasts use the chrome in `FEEL_UI_CHROME.md`. A threat tell is in the world, under the feet or on the prop. It is not a screen flash. A screen flash is reserved for the flower law transformation and for a furnace eye seen through a window, and even then it is a tint of the existing grade, not a white hit.

## What this pack does not cue

No gunshot language. No mount gallop loop. No musical stinger ids. Those wait on verbs and files the bible already marked absent.
