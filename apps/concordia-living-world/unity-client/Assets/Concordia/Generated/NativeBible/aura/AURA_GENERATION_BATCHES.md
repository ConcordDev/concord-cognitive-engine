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

## Stop conditions

- Disk under 4GB free: stop after the current sheet.
- A render that only reads in color: reject and strengthen the silhouette line.
- A human face that is not the Concordia CX face: reject.
- A creature that merged more than two donors: reject.
