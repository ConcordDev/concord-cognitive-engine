# Aura generation batches

Text prompts only. Do not download packs. Do not emit more than about twenty hero sheets in a single sitting, and only under `~/.zuko/native-bible/concepts/` if a human asks for pixels. Default output of this bible is the prompt, not the image.

Every id has a prompt in `PROMPTS_INDEX.json` (`prompt`, `batch`, `palette`, `silhouette_notes`). Paste the style prefix, then the row prompt, then the silhouette line.

## Style prefix (every batch)

Stylized realism PBR, not cel-shade. GTA surface wear: scratches, peel, stain, soot, or dust as appropriate. Palworld readability: one bold mass, saturated practical light, one emissive accent at most. Visible bevels. Albedo without baked lighting. Pure-black silhouette must read at 100m. Concordia native. No generic fantasy pack costume. No Quaternius body. Humanoids are CX proportions with a Concordia face.

## Order

Work in this order so later batches have a verb, a skeleton, and a kit to sit in.

### B0 — Contact sheet, no characters

One page of silhouettes only, black on warm gray: quad wolf, quad hound, quad stag, quad horse, winged griffin, winged harpy, serpent, eel, drone disc, sentinel, wraith bell, construct. Label with topology. This is the rig plan for CreatureCompiler.

### B1 — Hub guests before fauna

Eighteen plates from `npcs/HUB_GUESTS_REDESIGN.md`. Turnaround plus plaza idle. Court limestone background. Gale second frame on Arena sand with steel. Do these before any crowd kit so the CX face stays the standard.

### B2 — Hub ring fauna

`faun_court_pigeon`, `faun_lantern_moth`, `faun_court_cat`, `faun_saltroad_hare`, `faun_pinewood_stag`, plus `prop_pine_milepost` lettered **Pinewood Crossing**.

### B3 — Spoke fauna

Remaining `faun_*`. Generate subspecies (ash wolf, dust wolf, dock hound, marked hound) as material callouts on the B0 skeleton, not as new animals. Sealie prompt must say "not a flamingo".

### B4 — Monsters

All `mon_*` except bosses. One turnaround, one attack windup, one pure silhouette. Windup must differ from idle.

### B5 — Bosses

One hero sheet each, with the law in the caption:

- Held Curse — offer pose, crest lowered
- The Unfinished — ask pose, mask
- The Census — magenta ring lit, one number missing
- The Un-Ender — gap facing camera
- The Compound Mark — furnace eye, tile skirt

### B6 — Hybrids

After the primary exists so the donor reads as a graft. Caption must include primary, secondary, hook. Reject the render if a third animal appears.

### B7 — NPC roles

`npc_role_*` on the CX body. One prop each from the wardrobe block. Then a crowd strip of five roles in one Court street to test silhouette separation: labor, merchant, warden, scholar, urchin.

### B8 — Weapons

Orthographic on a 1m grid, plus one in-hand on CX. Flower and steel are two states of `wpn_1h_court_flower`. No rifles.

### B9 — Kits, gray first

For each `arch_kit_*`, a graybox footprint diagram (4m grid, door, stair) before a beauty frame. Beauty frame second: one hall, one facade, one traversal anchor. Then the three `arch_ix_*` joints as a single image each, ground continuous across the seam.

### B10 — Props

Clutter families by kit, six per sheet, not one render per crate. Hero props (`prop_notebook`, `prop_rose_pin`, `prop_mercy_circlet`) get their own small sheet.

### B11 — Skill cues

Prefer the existing Gabriel Aguiar prefab named on the skill (`VfxCue.existing_prefab`). Only paint a new cue when the row's aura prompt cannot be that prefab: flower quench, number-break, unclosed seam, ash page, pollen stance. Those five are the VFX concepts worth a sheet.

## Paste template

```
[style prefix]

ID: {id}
NAME: {display_name}
WORLD: {world_ids}
PALETTE: {palette}

{prompt}

SILHOUETTE: {silhouette_notes}

OUTPUT: turnaround + hero pose. No text in the image except mileposts that the prompt names.
```

## Volume content batches (B12–B17)

B10 and B11 above are already props and skill cues. Do not renumber them. These batches are prompts for the content volume in `../volume/`. Text only. Default is still no pixels. Gameplay bind order is `../volume/AURA_BIND_ORDER.md`, not this list.

Style prefix from the top of this file still applies. Humanoids stay CX. No Quaternius. No rifle. Pinewood Crossing is lettered only on the milepost. Flower Law: a court blade is a flower inside 42m.

### B12 — Quest boards, not characters

Six board plaques, one sheet: Hub urn notice, Sundering fold offer, Tunya fruit-not-tree, Grid missing number, Frontier "the road is our door", Sere furnace-eye window. Wood, slate, or chalk. One line of lettering each, the `board_line` from the quest or raid, nothing else.

### B13 — Remembrance tokens

Orthographic, 1m grid, the remembrance item ids in `volume/VENDORS_AND_ITEMS.json` (`item_rem_*`). Crest shard with the gold closed. Mask unworn. Dark digit token. Cooled furnace eye. They must read at arm's length as objects, not as UI icons.

### B14 — Companion wardrobe callouts

No new faces. On the existing CX guest or role, one prop each: Brackish's loaf, Gale's flower on sand versus flower in the plaza (two states, same weapon), Thorne's inward-folded blade, Nyx's blank slate, Esha's small seed jar, Kel's sealed satchel. Caption the banter flag, do not render the sentence in the image.

### B15 — Vendor stalls

One stall each, graybox then wear: Vesper's scale, Gale's rack, grove basket, Bell's wet crate, runners' junction, wagonwright hitch, Mark desk with a worse price chalked for `marked` standing. Stock is the item ids, not a generic potion row.

### B16 — Density clutter sheets

Per the budgets in `volume/DENSITY_TABLES.json`. Six props a sheet. Hub lanterns and one urn. Tunya baskets. Crime crates and sodium lamps. Cyber coils. Ruins cairns. Sere pipe runs. Silhouette inset at 100m for one fauna from that world on the same sheet. Sealie sheet must say "not a flamingo".

### B17 — Tack and vehicles, honest gaps

Horse tack on `faun_wagon_horse`, wagon pin, lead rope, wind-wagon cloth sail, grid dolly, wharf hand cart. No rider in the saddle. No steering-wheel hero. Caption: lead, hitch, or push. The Held Curse is not in this batch.

## Stop conditions

- Disk under 4GB free: stop after the current sheet.
- A render that only reads in color: reject and strengthen the silhouette line.
- A human face that is not the Concordia CX face: reject.
- A creature that merged more than two donors: reject.


## Look and feel batches (B18–B20)

B12–B17 above remain the volume-content sheets. Do not renumber them. The megaworld look pack lives in `~/.zuko/lookfeel/` and adds three concept batches. These prompts are already single-subject 3D concepts. Feed `aura_prompt` verbatim. Do not prepend the creature framing from the organic auto-wrapper. See `lookfeel/PIPELINE_FEED.md`.

### B18 — Environment landmarks and kits

`B18_lookfeel_env`. Landmarks, street modules, ruin fragments, docks, neon that is cloth and tube, the Sere waystone. One subject. Three-quarter view. Quiet backdrop.

### B19 — Hero architecture

`B19_lookfeel_arch`. One kit piece at a time, keyed to `arch_kit_*` and `arch_ix_*`. Orthographic language is a single elevation, not a turnaround sheet. Snap stays 4 m.

### B20 — Biome flora

`B20_lookfeel_flora`. One plant. The tree is the subject. Tunya fruit stays on the tree. Grid flora is a weed or a moss pad.

First ten architecture heroes, then the matching landmarks, then one plant per world. Concept only, then approve, then mesh. Order and triangle budgets: `lookfeel/PIPELINE_FEED.md`.

## Asset-catalog batches (B21–B24)

- **B21_anim_specs** — three skinned organic cards only (flower sprig, hall banner, hanging awning). Clip matrices live in `asset-catalog/animations/`, not as TRELLIS prompts. Pistol clips stay unbound.
- **B22_npc_hub** — Hub body, outfit, CX face, and faction rows beyond B7. CX body, Concordia face.
- **B23_props_softenter** — clutter beside `arch_hero_hub_council_hall`. Unlettered. No live steel.
- **B24_arch_interior** — Hub interior modules on `arch_kit_hub_court`. Spoke pattern is a stub, not more heroes.

Feed `aura_prompt` verbatim. Explicit `triangle_budget`. Do not prepend the creature sheet wrapper.
