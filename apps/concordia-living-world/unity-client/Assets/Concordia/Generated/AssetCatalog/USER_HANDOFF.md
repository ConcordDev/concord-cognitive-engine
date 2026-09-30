# User handoff — Full Asset Mission

## Pipeline (three stages)

1. **Grok (this mission)** authors TEXT/JSON asset specs + `aura_prompt` rows. Merges into `~/.zuko/native-bible/aura/PROMPTS_INDEX.json`. Writes catalogs under `~/.zuko/asset-catalog/` including **animation** clip matrices (first-class even before mesh anim exists).
2. **Organic gen pod** renders concepts / meshes from prompt rows. Follow `ORGANIC_FEED_ORDER.md` and `~/.zuko/lookfeel/PIPELINE_FEED.md`. Do not use creature `conceptPrompt()` wrapper on env/arch/flora/prop rows.
3. **Aura** binds, retargets, and places in the Unity client (`Assets/Concordia/...`). See `AURA_BIND_NOTES.md`.

## What you run later
- Organic: concept-only first, explicit triangle budgets, seeds 2–3 per id.
- Aura: bind SoftEnter heroes + new props/NPCs; Mixamo/retarget from `animations/ANIM_MASTER.md`.
- Advance next Grok slice: `~/.zuko/asset-catalog/advance_asset_slice.sh` (tmux `grok-assets`).

## What not to do
- Do not expect this Grok mission to emit meshes or PNGs.
- Do not kill Concord, Claude RC, or interactive Grok TUI.
- Do not wipe `~/.grok/downloads`.
