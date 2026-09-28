# Pipeline feed — how organic consumes this pack

Concept images stay on the pod. This pack is the prompt catalog. Do not batch-render from a laptop, and do not download texture dumps.

## What to read

1. `~/.zuko/lookfeel/PIPELINE_FEED.md` (this file).
2. `prompts/ENV_PROMPTS.json`, `prompts/ARCH_HERO_PROMPTS.json`, `prompts/FLORA_PROMPTS.json`.
3. The same rows appended to `~/.zuko/native-bible/aura/PROMPTS_INDEX.json` under batches `B18_lookfeel_env`, `B19_lookfeel_arch`, `B20_lookfeel_flora`.
4. Style and geography only when a concept's backdrop or scale is unclear. The `aura_prompt` is already the render string.

## How a row becomes a concept

Each entry has `aura_prompt` and a copy in `prompt`. The first sentence is the silhouette constraint, inside CLIP's 77-token window if the string is sent as-is. The rest is for T5.

Send `aura_prompt` **verbatim** as the concept prompt (`prompt` for CLIP's front, `prompt_2` for the full T5 string, which the gen server already splits).

Do **not** pass these ids through `conceptPrompt()` in `server/lib/asset-gen/organic/prompts.js` as it stands. That function assumes a creature sheet: it prepends "Single full-body creature…", and `budgetFor()` classifies unknown tags as fauna at 10k triangles. These rows are buildings, landmarks, and plants. A second framing block pushes the constraint out of CLIP and calls a lock a creature.

There is no sheet marker `PBR albedo without baked light.` in these prompts, on purpose, so a stray sheet-strip cannot delete the first sentence.

## Budgets until prompts.js grows a branch

Pass an explicit LOD0 budget. Do not take the fauna default.

| Family | LOD0 triangles | Notes |
| --- | --- | --- |
| `env_` landmark, softenter | 20000 | one mass |
| `env_` street or terrain module | 8000 | repeatable |
| `arch_hero_` | 15000 | one kit piece, 4 m snap in the bind stub |
| `flora_` tree | 12000 | one plant |
| `flora_` shrub, grass, moss | 4000 | one clump |

`unity_bind.prefab_folder` is a stub under `Assets/Concordia/Generated/LookFeel/Concepts/<id>/`. The organic runner's current output root is `Assets/Concordia/Models/Generated`. Keep provenance there if that is the live registry, and copy or point the manifest. Do not invent a second mesh tree by hand.

`unity_bind.kit_id` on architecture rows is the native-bible kit (`arch_kit_*` or `arch_ix_*`). Bind the hero onto that kit. Do not create a parallel kit id.

## Batch order

Concept only (`stopAfter: "concept"`). Approve against the style board's 100 m checklist before any TRELLIS call.

1. **B19 architecture, one piece per world, the SoftEnter hero.**  
   `arch_hero_hub_council_hall`, `arch_hero_sunder_shrine_hall`, `arch_hero_tunya_terrace_hall`, `arch_hero_ruins_catalogue_hall`, `arch_hero_crime_tenement_bay`, `arch_hero_cyber_bridge_hall`, `arch_hero_frontier_cabin_hall`, `arch_hero_dawn_spire_hall`, `arch_hero_crucible_lattice_hall`, `arch_hero_sere_tally_hall`.
2. **B18 the matching landmarks.**  
   `env_hub_flower_law_urn`, `env_hub_pinewood_milepost`, `env_sunder_titan_pillar`, `env_tunya_nil_root`, `env_ruins_unfinished_arch`, `env_crime_sodium_lamp`, `env_cyber_census_plinth`, `env_frontier_walker_cairn`, `env_dawn_roof_pad`, `env_crucible_seam_rock`, `env_sere_waystone`, `env_sere_furnace_stack`.
3. **B20 one flora mass per world,** the 100 m tree or clump: court linden, thorn oak, terrace fruit tree, ash cypress, wharf plane, service-well weed, dust cottonwood, dawn park plane, seam lichen, furnace scrub.
4. Then the rest of B19, then the rest of B18, then the rest of B20. Blends (`arch_hero_ix_*`, `env_ix_*`) after both parent worlds have one approved concept, so the joint can be judged.

Seeds: two or three per id, same as the creature review. Reject a render that only reads in color, that grows a person, that adds a second subject, or that lettered anything other than Pinewood Crossing.

## Id lists, machine-readable

The JSON `entries[].id` arrays are the lists. Counts at authoring: 70 `env_`, 36 `arch_`, 33 `flora_`. World filter is `world_ids`. SoftEnter flags are `unity_bind.softenter_landmark`.

## What not to generate from this pack

- No creatures. Those ids already live in B0–B6 and are feeding the pipeline.
- No CX faces. B1 owns the guests.
- No rifles, no ridden horses, no Quaternius bodies.
- No full-city matte paintings. One subject per image.
- No pixels checked into git from this authoring pass.

## Director bind, after a concept exists

`WorldVisualDirector` can resolve `styles/STYLE_INDEX.json` for palette and `MAP_MASTER.json` `softenter_landmarks` for the first prop on arrival. `WorldGeography` is unchanged. Design-intent kilometres are not local claim radii. If a binder needs a spawned transform, use the Hub canon metres that are already in code, or leave the spoke landmark at the continent Present until a designer places it.
