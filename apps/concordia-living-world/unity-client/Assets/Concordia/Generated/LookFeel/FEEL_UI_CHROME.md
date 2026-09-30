# Feel — UI chrome

Two skins, one inventory. The skin follows the law underfoot, not the player's faction costume.

## Court parchment

Used while `Canon.InHubCourt` is true and the player is not standing in the arena's steel exception.

- Ground: warm paper `#f3e6d0` on a limestone scrim `#c4b49a`.
- Ink: `#3a3428`. Accent rule: `#c8721a`, the flower.
- Corners are worn, not torn for style. A brass pin, not a screw.
- Type is a serif for titles and a plain humanist for numbers. Numbers stay numbers. The Court does not hide a count behind a flourish.
- Quest boards on the Hub are wood or slate plaques. One line, the board line, the way volume batch B12 already asks. The urn notice is the Hub plaque.
- Toasts rise like a lantern: short, warm, then dim. A flowered blade toasts with the petal, then the steel's name in quiet type, so the player sees the law work.
- Memory: a pressed note, Asbir's method without showing his notebooks. Fact, then a gap. The UI does not fill the gap.

## Steel metal

Used on every spoke, on Sere, on the Hub outside 42 m, and inside the arena sand.

- Ground: oiled dark metal `#2a2622`, edge wear `#8a7a68`.
- Ink: `#efe6d4`. The world's accent (sodium, cyan, dawn gold, teal, furnace eye, ward gold, fruit, ash amber) is a 2 px rule, not a fill.
- Screws and a stamped plate. The plate carries the WorldId display name.
- Quest boards match the world: fold-offer slate on the Sundering, fruit-not-tree wood on Tunya, missing-number plate on the Grid, "the road is our door" on canvas on the Frontier, furnace-eye window frame on Sere, a posted bill on the Coast, a mercy card that does not say victory on the Dawn, an unclosed bracket on the Crucible, an unfinished line on Ruins.
- Toasts are a stamped plate that slides. Failures stay on the plate. They do not auto-dismiss into a green success.
- Gossip is a torn margin or a chalk line, never a chat bubble with a tail from a mobile UI kit.

## Shared behavior

- The skin crossfades on SoftEnter over about a third of a second, after the world accent is known. Reduced motion cuts to the cut.
- Keyboard shortcuts, when a lens or a combat prompt has them, show as small metal or brass chips. The Court chip is brass. The steel chip is stamped.
- No health bar replaces the world's own tell. A poise hit can tick the plate. It does not spawn a generic RPG frame around the screen.
- Empty states say what is missing: no mesh, no route, no quest. They do not invent a row of fake notices.
- The arena is parchment chrome with a sand-colored steel insert, so the exception is visible before the first swing.

## Per-world board color

| WorldId | Board | Rule color |
| --- | --- | --- |
| Hub | urn wood | `#c8721a` |
| Fantasy | fold slate | `#c8a060` |
| Tunya | terrace wood | `#c8721a` |
| Ruins | ash limestone | `#b89060` |
| Crime | posted bill | `#c8a060` |
| Cyber | missing-number plate | `#3dffa0` |
| Frontier | canvas | `#4a3828` |
| Superhero | mercy card | `#ffd0a0` |
| Crucible | unclosed bracket | `#20ffd0` |
| Sere | furnace frame | `#e07030` |
