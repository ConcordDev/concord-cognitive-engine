# Global look rules

Shared floor for ten identities. The identities live in `styles/STYLE_<WorldId>.md`. This file is the floor they share with `~/.zuko/ART_STYLE_GTA_PALWORLD_TEN_WORLD.md`, `native-bible/00_ART_DIRECTION.md`, and `CONCORDIA_TEN_CONTINENT_VISUAL_BIBLE.md`.

## PBR floor

Every hero surface has albedo, roughness, metallic, normal, and ambient occlusion. Albedo has no baked lighting and sits a little more saturated than a photograph. Fine scratches, peel, soot, salt, and stains live in the albedo and the normal. They do not live as noisy micro-geometry on the silhouette.

Stylized realism. Not toon. Not cel. Not outline ink.

GTA is the surface truth and the human scale. Palworld is the readable mass, the saturated practical, and the single emissive accent. One accent per hero frame. A second family of light is a reflection or a distant sign, not a second key on the same prop.

## Bevels

Every jamb, quoin, pipe, and plate has a bevel wide enough to catch a specular at the chase camera. A perfectly sharp 90° edge is a failed bevel. Kit snap stays 4 m. Door clear stays 1.2 × 2.2 m. Corridor stays at least 2.4 m. Those numbers are the architecture kits, and look does not renegotiate them.

## Grit and clean

Grit is universal and local.

| WorldId | Where the dirt sits | What stays clean enough to read |
| --- | --- | --- |
| Hub | Joints, lantern soot, brass gall | Limestone planes, one flower |
| Fantasy | Rain, moss, gold worn through | Granite arris |
| Tunya | Soil, dye, soot on one face, salt | Timber planes, solar tile as a matte rectangle |
| Ruins | Ash, mineral stain | Limestone drums |
| Crime | Peel, rust, drip, rope | Brick bond still visible |
| Cyber | Soot, gasket, primer | Acrylic sheet as one rectangle |
| Frontier | Dust, sun bleach | Canvas patch edges |
| Superhero | Landing scuff, chipped chrome | Glass and composite planes |
| Crucible | Chip, grit in a seam | The seam itself, one line |
| Sere | Flood line, oil, repair | Brand tile stamp, furnace mouth |

Clean does not mean new. Clean means the big shape survives the dirt.

## Silhouette

At 100 m a pure black shape still names the thing: urn, pillar, stack, tenement, bridge bar, mast, fin, unclosed vault, furnace eye. If the name needs the color, the mesh has failed. Thin limbs are not the only hit surface. Pipes, legs, roots, and ribs are thick.

Humanoids are CX, Concordia face, plates and cloth on the named CX slots. A mask is allowed where the role already wears one. A Quaternius body is not a person.

## Lighting, day and night

Day: bright key, crisp colored shadows, bounce from the world's own ground color. Night and interiors: high-contrast practicals, one family. The practical is bolted to a prop (lantern, sodium head, neon tube, furnace mouth, relay lamp, dawn window, teal seam).

`FEEL_LIGHTING.md` is the grade per arrival. This file only forbids a second unmotivated key and a full-body glow.

## Camera readability

Chase camera and a 100 m impostor are both in the test. L0 is terrain and skyline (`ContinentStream` impostor). L3 is the hero mesh near the player. Concept prompts in this pack are L3 subjects on a quiet backdrop so TRELLIS gets one mass. The world dresses them later.

Do not put type in a concept render. Mileposts and bills weather the words out, except Pinewood Crossing, which is the one plank allowed to say its name.

## Layering

Foundation is the world's kit. An upper floor may show a faction retrofit that does not erase the foundation. The three blends in `architecture/INTERSECTIONS.md` share one floor across the joint. Weathering crosses the joint farther than paint does.

## Honesty

Missing meshes stay missing. A prompt is not a spawned prop. Firearm hero meshes stay out while firearm verb coverage is zero. Ride meshes do not include a rider while the ride controller is absent. Sealie is not a flamingo, and this pack does not redraw it. Flower Law is the Hub disk of 42 m.
