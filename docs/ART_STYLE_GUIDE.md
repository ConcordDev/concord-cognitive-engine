# Concordia Art Style Guide — coherence > fidelity

**The thesis (locked).** Photoreal invites comparison to $200M productions; a stylized
look *sets its own standard* — as long as everything shares one visual language. Hades
chose pen-and-ink partly because it was *faster to produce*. We pick a style whose
production is fast, not just whose result is pretty. The load-bearing discipline: **every
asset shares the same outline weight, ramp-band count, saturation philosophy, and
grounded↔cartoon dial.** The reference is **BotW lighting + Palworld creature forms** —
the *same rules* across all 9 worlds, a *different palette* per world.

This is not a vibe; it's a small set of constants every render pass reads, so styling
never drifts per-component. The source of truth is
`concord-frontend/lib/world-lens/concordia-theme.ts`:

## The shared rules (`ART_STYLE`)
| Constant | Value | Rule |
|---|---|---|
| `OUTLINE_WIDTH_M` | `0.018` | One outline thickness for **everything** — characters, props, buildings, creatures. Never per-asset. |
| `RAMP_BANDS` | `3` | Every toon ramp is sampled at exactly 3 steps (shadow / mid / light). No 2-band here and 5-band there. |
| `GROUNDED_DIAL` | `0.45` | 0 = flat cartoon, 1 = grounded PBR. We sit at BotW's ~0.45 — readable forms, soft real-ish light. |
| `OUTLINE_DARKEN` | `0.35` | Outline = shadow-band × this. Shared so silhouettes read alike across worlds. |

## Per-world variation = palette + saturation ONLY
The *rules* never change between worlds; the **palette** (`toonGradient` per theme) and
the **saturation** (`WORLD_SATURATION`) do. That's how 9 worlds read as 9 moods without
becoming 9 art styles:

| World | Saturation | Mood |
|---|---|---|
| cyber | 1.35 | neon, electric, pushed past natural |
| superhero | 1.25 | bold, primary, comic-bright |
| lattice-crucible | 1.15 | charged, otherworldly |
| fantasy | 1.12 | lush, storybook (Concordia's vacation world — life-magic undiluted) |
| tunya | 1.05 | warm, lived-in frontier |
| concordia-hub | 1.0 | neutral baseline |
| concord-link-frontier | 0.95 | dusty, in-between |
| sovereign-ruins | 0.80 | bleached, time-worn |
| crime | 0.62 | noir, desaturated, rain-slick |

## Rules for new assets / render work
1. **Read the constants** — outline passes use `ART_STYLE.OUTLINE_WIDTH_M`; toon materials
   sample `RAMP_BANDS` from the world's `toonGradient`; albedo/light scales by
   `saturationForWorld(worldId)`. Never hardcode an outline width or band count in a component.
2. **Differ by palette, not by technique.** A new world = a new `toonGradient` + a
   `WORLD_SATURATION` entry. It does **not** get its own shader, outline style, or band count.
3. **Forms follow Palworld, lighting follows BotW.** Creatures + props read as friendly,
   chunky, silhouette-first; lighting is soft, warm-keyed, rim-lit (rim light fakes
   subsurface — see cel-shade).
4. **The grounded dial is global.** If a world feels too cartoon or too real, move
   `GROUNDED_DIAL`, not one material — so the whole game moves together.

## Why this gates the render work
Cel-shade-on-avatars and edge-outlines (Track 2) read these constants. Shipping them
*before* the constants exist would bake per-component choices that then have to be
un-baked. The guide + constants come first; the passes consume them.
