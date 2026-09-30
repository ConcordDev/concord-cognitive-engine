# SLICE 2b — Ground dress (Court + Hub approaches) — proof

**Date:** 2026-09-20  
**Verdict:** **DONE** (LeanPlay-thin; engraved atlas still MISSING per Asset Bible)  
**Unity:** MCP `unity-client` · LeanPlay **true** · no commit

## Goal

Dress Slice 1–2 underfoot: wet/engraved-feel stone, puddles, grit/rocks/weeds, walkable road strips with sidewalks + curbs, land-tinted hills — not flat cyan debug discs + bare mud plane.

## What shipped

| Target | Status | Evidence |
|---|---|---|
| Court plaza wet + micro-relief | **SHIPPED** | `CourtGroundDress` relief slabs + grit stamps; `CourtPlazaWetDisc` on `Concordia_Master_WetCourtStone` |
| Puddles | **SHIPPED** | 10× `CourtPuddle_*` using `Concordia_Master_WaterPuddle` (+ road low-spot puddles on long segments) |
| Scatter rocks / grit / weeds / debris | **SHIPPED** (LeanPlay density) | 18 rocks, 16 grit, 12 weeds, 4 debris crates — all `Court*`-named (spares plate cleanup) |
| Roads + sidewalks + curbs | **SHIPPED** | `SettlementCompiler.Pave` → `StreetBand` + `Sidewalk_L/R` + `Curb_L/R`; `DressExistingRoadBands` upgrades bare LeanPlay streets |
| Soften horizon / cyan vista | **SHIPPED** | `CourtWalkableHorizon` earth/grass mats; `SoftenCyanVistaMarkers` retints cyan impostors in Court vista |
| Stills | **SHIPPED** | `~/.zuko/remaining-work/SLICE2B-STILL-plaza-ground-*.png`, `on-road-*.png` |
| Engraved atlas mesh | **OPEN** | Asset Bible: engraved atlas **MISSING** — PH cobble + WetCourtStone master used honestly |

## Live Play counts (2026-09-20, post-Ensure)

```
lean=True
puddles=10 rocks=18 relief=14 grit=16 weeds=12
bands=40 sidewalks=64 curbs=64
disc=True discMat=Concordia_Master_WetCourtStone(Clone)
hillMat=PH_aerial_grass_rock
```

(`bands` can inflate if Ensure re-runs DressExisting on already-banded roots mid-session — first-boot path is one band per street.)

## Code

- `Assets/Concordia/Scripts/CourtGroundDress.cs` (new) — relief, puddles, grit/scatter, wet plaza disc, cyan softener, road-band upgrade, amplify
- `Assets/Concordia/Scripts/Settlement/SettlementCompiler.cs` — `Pave` → road + sidewalk + curb + optional road puddle/curb rock
- `Assets/Concordia/Scripts/CourtWalkableHorizon.cs` — grass/earth mats; re-dress on Ensure; land-tint mask
- `Assets/Concordia/Scripts/HubLook.cs` — wire `CourtGroundDress.Ensure` after puddles; `pebble_grit` alias
- `Assets/Concordia/Scripts/HubPlaza.cs` / `RealmFill.cs` — Ensure after floor / after CompileRoadsOnly

## Stills

- `~/.zuko/remaining-work/SLICE2B-STILL-plaza-ground-2026-09-20.png`
- `~/.zuko/remaining-work/SLICE2B-STILL-plaza-ground-close-2026-09-20.png`
- `~/.zuko/remaining-work/SLICE2B-STILL-on-road-2026-09-20.png`
- `~/.zuko/remaining-work/SLICE2B-STILL-on-road-curb-2026-09-20.png`
- Counts: `~/.zuko/remaining-work/SLICE2B-STILL-COUNTS.txt`

## Honest leftovers (not blocking DONE)

1. **Engraved Court atlas / displacement mesh** — still MISSING; WetCourtStone + PH cobble + relief discs are the LeanPlay stand-in.
2. **Some LeanPlay orange pyramid / marker prims** still survive plate cleanup in vista shots (not identity scatter).
3. **Scatter density** is LeanPlay-capped (not full Vinewood clutter); weeds/rocks readable in hierarchy, subtler in fog stills.
4. **Outside-wall landmarks** (Pinewood / Spire / Grove / Tavern) = **Slice 3**, not this pass.

## Stop

Next slice = **3 — outside wall landmarks**. No commit/push.
