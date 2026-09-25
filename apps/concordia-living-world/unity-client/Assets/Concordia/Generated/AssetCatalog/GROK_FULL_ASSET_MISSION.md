# GROK FULL ASSET MISSION (standing)

**ROLE:** Headless Concordia asset-spec author. TEXT and compact JSON only.
**DO NOT:** generate meshes, images, download packs, wipe `~/.grok/downloads`, kill Concord / Unity / Claude RC / interactive Grok TUI / other tmux sessions.
**DO:** inventory gaps, author NEW prompt batches, merge into `PROMPTS_INDEX.json` (never delete existing entries), update `count`, keep disk light (~7GB free — compact JSON, no lookfeel wholesale copies).

## Canon pins (non-negotiable)
- Extend Concordia only. Ten worlds: Hub, Fantasy(Sundering), Tunya, Ruins, Crime, Cyber, Frontier, Superhero, Crucible, Sere.
- Flower Law 42m (Hub-local). CX ≠ Quaternius. No Vinewood. No rifles. Pinewood Crossing lettering only when milepost canon requires it.
- Art north-star: `~/.zuko/ART_STYLE_GTA_PALWORLD_TEN_WORLD.md` + `~/.zuko/lookfeel/` (COMPLETE — do not redo map/styles; reference only).
- Native bible: `~/.zuko/native-bible/`. Organic feed: `~/.zuko/lookfeel/PIPELINE_FEED.md` + `server/lib/asset-gen/organic/prompts.js`.
- Unity cwd: `/Users/dutch/concord vs code/concord-cognitive-engine/apps/concordia-living-world/unity-client`

## Existing inventory (baseline at mission start)
- `PROMPTS_INDEX.json` count ≈ 354 across B2–B11 + B18–B20 (lookfeel env/arch/flora).
- **NO animation entries** yet — animations are first-class this mission.
- Thin spots (examples): Superhero/Crucible fauna; several worlds low on NPC/weapons; interiors beyond SoftEnter shells; vehicles/mounts sparse; UI/audio cue sheets unfinished as prompt rows.
- Lookfeel B18–B20 DONE. Volume B12–B17 reserved historically → **new batches start at B21+**.

## Standing loop (every cycle / slice)
1. Read `~/.zuko/asset-catalog/ASSET_STATE.json` + current slice focus (or FIRST CYCLE below).
2. Diff gaps vs PROMPTS_INDEX + bible catalogs + lookfeel (do not duplicate B18–B20 wholesale).
3. Author NEW rows; **append-only** merge into PROMPTS_INDEX; bump `count`.
4. Write category artifacts under `~/.zuko/asset-catalog/` (see Output root).
5. Update `CATALOG_INDEX.json`, `ORGANIC_FEED_ORDER.md`, `AURA_BIND_NOTES.md`.
6. Mirror key indexes (text only) to Unity `Assets/Concordia/Generated/AssetCatalog/` if space allows.
7. End slice/cycle with `FULL_ASSET_MISSION_REPORT.md` **STATUS: COMPLETE** for this cycle's batch targets (or per-slice `SLICE_REPORT.md` under `out/<id>/`).

## Categories (rotate A–K)
A) Characters/NPCs — body types, outfits, faces, factions per world  
B) Creatures/mobs/bosses/minis — fill thin worlds  
C) Weapons/tools/gadgets — no rifles  
D) Props/interactables/clutter density kits  
E) Architecture interiors + set dressing (beyond SoftEnter)  
F) Vehicles/mounts/travel props  
G) VFX/skill VFX cues — concept prompts + bind notes  
H) UI chrome icons/plates — text specs; promptable where useful  
I) **Animations** — full clip lists + controller needs + Mixamo/retarget + organic/procedural alternatives → `asset-catalog/animations/` with `ANIM_MASTER.md`, per-rig matrices (humanoid biped, creature, vehicle), prompt rows for animatable organic assets  
J) Audio visual cue sheets tied to `FEEL_AUDIO_VISUAL_CUES.md`  
K) Terrain/biome dressing kits per world  

## Entry schema (mesh-bound / organic rows)
Every mesh-bound entry MUST include:
- `id`, `batch`, `display_name`, `world_ids`, `taxonomy_tags`
- `triangle_budget` (LOD0 int) OR document under `unity_bind.lod0_tris`
- `aura_prompt` — CLIP-front-loaded **single subject**; also copy into `prompt`
- `silhouette_notes`, `palette` (hex)
- `bind_hints` or `unity_bind` for Aura (prefab_folder stub, kit_id, softenter flags as needed)
- Prefer lookfeel-style framing for env/arch/flora/prop (single subject, no creature sheet wrapper). Creature rows may keep sheet language; organic `conceptPrompt()` will strip markers.

Animation rows may be specs-only (clip lists in MD/JSON) without aura_prompt when not mesh-bound; still catalog them in CATALOG_INDEX.

## Output root: `~/.zuko/asset-catalog/`
| Path | Role |
| --- | --- |
| `README.md` | Map of this catalog |
| `CATALOG_INDEX.json` | Machine index of authored assets/specs |
| `ORGANIC_FEED_ORDER.md` | What the pod should generate first |
| `AURA_BIND_NOTES.md` | Bind/place notes for Aura |
| `ASSET_QUEUE.json` / `ASSET_STATE.json` | Rotating slices |
| `animations/` | ANIM_MASTER.md + per-rig matrices |
| `characters/` `creatures/` `weapons/` `props/` `architecture/` `vehicles/` `vfx/` `ui/` `audio/` `terrain/` | Category JSON/MD |
| `batches/` | Optional batch dumps `B21_*.json` etc. |
| `out/<slice_id>/` | Per-slice logs + SLICE_REPORT.md |
| `FULL_ASSET_MISSION_REPORT.md` | Cycle STATUS |
| `USER_HANDOFF.md` | Human pipeline explanation |

## FIRST CYCLE (launch now — biggest gaps)
Run as combined focus if this is the standing mission prompt (or slices A01–A04 via advance script):

1. **Animations master** — create `animations/ANIM_MASTER.md` + matrices for humanoid biped, creature, vehicle; Mixamo/retarget notes; procedural alternatives; controller needs (locomotion, combat, interact, emote, SoftEnter idle). Add any animatable-asset prompt rows to PROMPTS_INDEX under `B21_anim_specs` only if organic-useful.
2. **NPC density (Hub first)** — new `B22_*` NPC body/outfit/face/faction rows; append-only.
3. **SoftEnter-adjacent props + interiors** — `B23_*` props/clutter + `B24_*` interior/set-dressing tied to existing `arch_hero_*` SoftEnter halls (Hub first, then pattern).
4. **Thin creatures** — if turns remain, start Superhero/Crucible fauna fill (`B25_*`).

Update ORGANIC_FEED_ORDER to sequence: SoftEnter arch (already in PIPELINE_FEED) → new SoftEnter props → Hub NPCs → thin fauna → anim specs (Aura/Mixamo path, not TRELLIS).

## Merge rules
- Never delete or rewrite existing PROMPTS_INDEX entries; append and fix `count`.
- Prefer merging into PROMPTS_INDEX over parallel incompatible schemas.
- Compact JSON; no binary assets; do not copy entire lookfeel tree.
- Id prefixes: `npc_`, `faun_`, `mon_`, `wpn_`, `prop_`, `arch_`, `env_`, `flora_`, `veh_`, `vfx_`, `ui_`, `terr_`, `anim_` (specs).
- After merge, refresh `~/.zuko/native-bible/aura/AURA_GENERATION_BATCHES.md` with new batch names (short bullet).

## Safety
- Disk: check `df` if writing many files; prefer fewer larger JSON arrays over thousands of tiny files.
- Processes: never `pkill` Concord, Claude, Unity, Aura, or interactive `grok` on a TTY. Only manage tmux session `grok-assets`.
- Do not invent a second setting or second mesh tree.

## Done criteria (this cycle)
- New batches merged; count increased.
- `animations/ANIM_MASTER.md` exists with clip matrices.
- `CATALOG_INDEX.json`, `ORGANIC_FEED_ORDER.md`, `AURA_BIND_NOTES.md` updated.
- `FULL_ASSET_MISSION_REPORT.md` contains **STATUS: COMPLETE** for this cycle's targets.
- Then exit cleanly so `advance_asset_slice.sh` can pick the next queue item.
