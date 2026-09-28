# Feel — lighting

Grades for `WorldVisualDirector` and the SoftEnter first second. Identity hexes live on the style boards. This file is the time of day and the handoff.

## Global day

Key from the sun color on `Canon.Get(world).sun`. Fill is the ground color, dim. Shadows are colored, not neutral gray. One practical may already be on if the world is the Grid, the Coast at dusk, or Sere's furnace. Other worlds keep practicals for night.

HDRI intent is named per style board. The director picks that HDRI. It does not average two worlds during a march. Marches use the Hub approach grade until the disc edge, then the destination grade over the SoftEnter blend.

## Global night

Practicals only, high contrast, short range. The practical's family is the style board's emissive. A second family is a reflection. Moon is a cool fill at low intensity except on the Frontier, where the moon is allowed to be the key because the road is the point.

## Flower Law plaza

Day: warm `#ffe6c0` key, limestone bounce, crisp shadow, lanterns unlit or barely warm. The flower, when a blade dies, is a local orange practical on the weapon for under a second, then gone. The plaza does not bloom the whole frame.

Night: lanterns at bracket height, pools on cobble, the urn readable, the ring drums as silhouettes. No cyan. Fog stays beyond the wall.

Arena sand, day or night: the same Court sun, plus a harder top light so bodies read. Steel highlights are allowed in this 8 m. The rest of the plaza does not inherit that hardness.

## Steel rings

Outside 42 m on the Hub, and on every spoke: the world's own grade. Crown Roads at night use a sparse practical from the destination (a lantern becomes a relay lamp becomes a sodium head as the impostor takes over). The blend is distance, not a rainbow.

## SoftEnter grades

The first frame matches the style board's postcard. Lighting numbers are intent, not a baked LUT file.

| Arrival | Key | Practical already on | Fog |
| --- | --- | --- | --- |
| Hub plaza | warm court | lantern if night | light, wall-ward |
| Hub Pinewood | dusk gold | none | pine |
| Sundering | canopy green bounce | none | fold mist if near water |
| Tunya terrace | warm sun | none; solar tile is matte | pollen veil |
| Tunya Nil | dim canopy | one lichen | heavy, wet |
| Tunya Aekon | blue-white | warm door | ice air |
| Ruins | dull ash sun | one hall amber if night | ash always |
| Iron Coast | rainy low | sodium if dusk or night | avenue |
| Grid | dim magenta sky | one cyan tube | haze |
| Frontier | high sun | relay lamp only at night | dust at the ankle |
| Dawn | low gold, unfinished | windows | light avenue |
| Crucible | split warm and teal | the seam | seam-local |
| Sere | smog gold | furnace eye | midground smog |

## Marches and the ocean

Inner Veil water takes a cooler fill than the Crown Road beside it. Exodus water is darker and browner than the Veil. Sere's smog starts on the near shore, not halfway across the strait, so the Coast's rain and Sere's smog stay two weathers with a visible seam on the water.

## Reduced motion and honesty

No animated fake-sunset loop that pretends time passed. If `WorldClock` says day, the grade is day. A drift sky on the Crucible may hold two temperatures because that is the world's weather, and it still comes from the clock's drift state rather than a decorative cycle.
