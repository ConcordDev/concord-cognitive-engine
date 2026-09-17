---
description: Concordia cinematic visual-fidelity pass. Use when dressing Hub/road, lighting, atmosphere, characters, animation, camera, VFX, or HUD — or when asked to make Unity look like the high-fidelity reference.
when-to-use: Visual polish, Poly Haven bind, CX/Grok cast, lighting, fog, camera, combat presentation, HUD themes, Aura bind-now, "make it look good," reference screenshot, cinematic, fidelity.
argument-hint: "[shot id or pillar]"
---

# Visual Fidelity & Cinematic Runtime

You are on Concordia's **cinematic** pass. The reference image is a visual-quality **benchmark**, not loose inspiration. Do not optimize for acceptable game graphics.

Full spec: `apps/concordia-living-world/bible/CINEMATIC.md` (repo). Follow it even if you cannot open the file — the law below is the same contract.

## Law

- Maximize fidelity for the **active profile**: LeanPlay (≤16GB, 2k, thinned), Desktop (2k library, full budgets), WebGL (HubKit only — Poly Haven 13GB is not in the browser).
- Poly Haven on disk is `_2k.jpg`. Do not claim 4K/8K unless that map is actually imported.
- A model is incomplete until materials, scale, lighting, animation, interaction, grounding, camera, and environment integration are correct **in Play**.
- `Unity build succeeded` is meaningless here. Close only on the named shots.
- Do not accept asset presence as completion. Indexed ≠ bound ≠ in the shot.
- Do not start a second look stack. Extend `HubLook`, `ChaseCamera`, `CombatFeel`, `WorldVisualDirector`, `ModularPerson`, `CxDress`.
- Combat presentation reads `ActionRunner` / `HitResolver`. Do not revive `GameplayCore.CombatDefenseEvaluator` as the grammar.
- Do not replace Rocketbox with primitives. Do not re-do the reverted Quaternius Humanoid swap.
- LeanPlay thinning is allowed. Frozen Time.time is not. Fake volumetric fog is not.

## Pillars to audit in Play

1. Environment fidelity (PBR 2k, seated dressing, no soup)
2. Lighting (sun + sky + volume actually shading normals)
3. Atmospheric depth (foreground → mid → haze → sky)
4. Character fidelity (cast belongs in the light; no mannequin)
5. Animation as cinema (ActionRunner phases, not clip teleports)
6. Cinematic camera (player-controlled, punch from real hits)
7. VFX keyed to gameplay state
8. World motion while idle
9. Physical response → persistent consequence
10. Court parchment / Steel metal HUD

## Shot gate (must report from Play)

- SHOT 01 — Court: plaza, player standing, sun shading, Court HUD
- SHOT 02 — Character: full body, gripped weapon, feet planted
- SHOT 03 — Combat: parry/dodge → HitResolver → reaction → camera → VFX
- SHOT 04 — Sprint: run gait + camera + moving world
- SHOT 05 — Road: Sundering dressing + people + threat + atmosphere
- SHOT 06 — Weather: same place, different hour/weather
- SHOT 07 — Interior: playable room, lighting transition (not fake windows)
- SHOT 08 — NPC: named person doing a daily activity
- SHOT 09 — Mount: ride loop, or honest not-wired
- SHOT 10 — Consequence: kill/hail the world keeps

Menu dump: Concordia → Visual Fidelity → Dump Shot Gate.

Bind FreePacks/Poly Haven as `AURA_BIND_NOW.md` says, then **keep going until the shot holds**. Binding is step one, not the finish.
