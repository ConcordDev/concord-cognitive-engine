# SLICE 7 REWORK — Native wilderness outside cities — proof

**Date:** 2026-09-20  
**Status:** **PARTIAL** (not Dutch-showable PASS yet)  
**Constraint:** LeanPlay true · no commit/push · MCP unity-client  
**Stills:** `~/.zuko/remaining-work/SLICE7-STILL-wild-outside-city-2026-09-20.png`  
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`~/.zuko/remaining-work/SLICE7-STILL-wildlife-or-treeline-2026-09-20.png`

---

## Verdict

Pass 1 mega-pad / null-mesh “sphere forest” path is **gone**. Real canopy meshes + wildlife data≠GO seed outside metro. Stills still fail Dutch visual bar (flat ground read, some tree silhouettes odd, wildlife often white/low-poly birds, approach landmark weak in frame) → **PARTIAL**.

---

## What shipped

| Item | Detail |
|---|---|
| Kill Pass-1 pads | No `HubWildPad_*` mega carpets. `HubWilderness.Ensure(force)` rebuilds clean. |
| Geography | Wild band `WildInnerM=98` → `WildOuterM=168` (past approach stubs ~68–80m). Metro only thin paths + sparse verge. |
| Trees | Prefer `Concordia_Real_*` then **reject null LOD**; live stems = `jacaranda_tree_1k` / Nature `tree_fat*` / `tree_oak`. Measured **68 trees**, radius **~103–153m**, `sitOk=68 floating=0`. |
| Clusters | Inter-spoke clusters + **spoke belts** past each approach (`HubWildCluster_belt_*`). |
| Wildlife | `WildernessWildlife` — seed=12, remat ≤3 live, log `WildernessWildlife seed=N live=M`. Tick from `WorldStreamManager`. |
| Blue void | Soften/recreate matte `ContinentGround`; Slice-7 stills suspend `FarPad`/`FarMass` (Cyber blue tiles). |
| Hierarchy | Root `Megaworld/HubWilderness` — **not** under `SettlementStreetscape_*` / `District_*`. |

### Files
- `Assets/Concordia/Scripts/HubWilderness.cs` — full rework  
- `Assets/Concordia/Scripts/WildernessWildlife.cs` — new  
- `Assets/Concordia/Scripts/WorldStreamManager.cs` — tick wildlife  
- `Assets/Concordia/Scripts/CourtGroundDress.cs` — still capture + FarPad suspend  

### Runtime log (sample)
```
HubWilderness Ensure wedges=4 clusters=12 trees=68 verge=7 grass=42 paths=12 faunaSeed=12
WildernessWildlife seed=12 live=0..3
CaptureHubWildernessStills … parent=Megaworld underStreet=False faunaLive=3
```

---

## Acceptance checklist

| # | Criterion | Result |
|---|---|---|
| a | Still looking out past approach into real trees | **PARTIAL** — real meshes present; landmark framing weak; ground reads as flat green sheet |
| b | Treeline or readable animal | **PARTIAL** — trees yes; animals often white bird impostors, not fox-class readable |
| c | No cyan void / orange rock_smallA / grey sphere forest | **PARTIAL** — grey spheres gone; flat green/teal ground + occasional reflective seams remain |
| d | Hierarchy outside city districts | **PASS** — `Megaworld/HubWilderness` |

---

## What’s left (next pass)

1. **Tree upright silhouette** — some still frames still read as sideways canopy (prefab/import vs camera); pin stem to `tree_oak`/`tree_fat_darkh` only and bake Sit proof in still frustum.  
2. **Ground** — replace flat `ContinentGround` read with denser Nature grass/fern scatter in wild band (no teal cubes). Kill leftover `HubWildGround_*` if any.  
3. **Wildlife readability** — force fox/wolf remat in still B with painted materials; birds only as far impostors.  
4. **Still A composition** — keep `ApproachLandmark_pinewood` mass in frame with city behind; wilderness canopy dominant ahead.  
5. **Concordia_Real_Oak/ForestTree/ForestGrass** — indexed but **null mesh LODs**; need mesh repair before they can lead.

---

## Out of scope (honored)

Interiors (8+), foreign `RequestFull`, LeanPlay=false, Vinewood slabs, inventing kingdoms.
