# H — Meshy pilot batch (B2 Hub-ring fauna)

Generated: 2026-09-23 02:14 EDT
Credits before: 1010 · after: 860 · spent: 150

| id | status | tris budget | glb size | dest |
|---|---|---:|---:|---|
| faun_court_pigeon | OK | 6000 | 6.02 MB | `Assets/Concordia/Models/Meshy/fauna/faun_court_pigeon.glb` |
| faun_lantern_moth | OK | 5000 | 7.89 MB | `Assets/Concordia/Models/Meshy/fauna/faun_lantern_moth.glb` |
| faun_court_cat | OK | 9000 | 5.74 MB | `Assets/Concordia/Models/Meshy/fauna/faun_court_cat.glb` |
| faun_saltroad_hare | OK | 6000 | 7.63 MB | `Assets/Concordia/Models/Meshy/fauna/faun_saltroad_hare.glb` |
| faun_pinewood_stag | OK | 12000 | 8.74 MB | `Assets/Concordia/Models/Meshy/fauna/faun_pinewood_stag.glb` |

## Notes
- Source prompts: `~/.zuko/native-bible/aura/PROMPTS_INDEX.json` (B2_hub_ring_fauna batch), adapted from 2D-sheet composition to single-object 3D prompts (dropped 'orthographic turnaround / silhouette inset' sheet language, kept creature description + style + silhouette notes).
- Generated via Meshy text-to-3d preview -> refine (enable_pbr) -> GLB download.
- NOT YET DONE (per H7 / CINEMATIC.md bar): import scale/pivot/forward-axis fix, URP Lit material assignment, rig (Meshy auto-rig quality unverified on non-humanoid topology per bible B0 rig plan), grounding, in-Play screenshot next to a CX character for scale, LOD/impostor pass. These are presence-only assets until that pass runs.
- Unity has not been told to re-import; run `refresh_unity` (or focus the Editor) to pick up the new GLBs.
