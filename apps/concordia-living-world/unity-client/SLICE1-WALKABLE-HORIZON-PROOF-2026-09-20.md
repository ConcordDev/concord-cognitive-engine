# SLICE 1 — Walkable Court horizon — proof notes

**Date:** 2026-09-20  
**Canonical copy for Zuko:** also intended at `~/.zuko/remaining-work/SLICE1-WALKABLE-HORIZON-PROOF-2026-09-20.md` (agent sandbox blocked home writes — copy if missing).  
**Branch:** `cursor/visual-fidelity-aura-0bfa` (unity-client)  
**Constraint:** LeanPlay true (16GB Mac) · no commit/push · no LeanPlay=false  
**Out of scope (later slices):** full megaworld continents, SettlementCompiler Hub CityDef, trading/Dila

---

## 1) How Court Game horizon was composed (diagnosis)

| Layer | Source | Role |
|---|---|---|
| **Skybox** | `HubLook.TryHdrSky` → Poly Haven HDRIs (`kloofendal_48d_partly_cloudy_puresky_2k.hdr` day, fire/night variants) via `Skybox/Cubemap` | Painted mountains / horizon — **not walkable** |
| **Fog** | `HubLook.EnsureCourtAtmosphere` + `ApplyHour` teal exponential fog | Depth wash; was not enough alone to kill double-horizon |
| **Wilderness `Hill_*`** | `ContinentStream.BuildWildernessGate` | Decorative prims along gate roads — **stripped inside ~180m** by `HubLook.EnsureCourtPlateCleanup` (`n.StartsWith("Hill_")`) |
| **Ground** | `ContinentGround` (plane) + `CourtGround` | Walkable floor, but no rising near/mid silhouette matching the HDRI vista |

**Root issue:** From The Unburned Court, hills read as HDRI photo. Real `Hill_*` meshes near Court were disabled by plate cleanup. Walking north/out never met matching land.

---

## 2) What shipped (implementation)

### New
- `apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/CourtWalkableHorizon.cs`
  - Root `CourtWalkableHorizon` under `Megaworld`
  - `CourtApproachGround_*` continuous pads (collar + north runway + shoulders + mask pad)
  - `CourtWalkHill_Near_*` / `CourtWalkHill_Mid_*` **terraced** cylinders (rise ≤ ~0.34m / step so `CharacterController.stepOffset` can climb)
  - `CourtHorizonMask_*` fog-colored arc occluder behind mid hills (softens HDRI mountain band)
  - `SoftenSkyband()` — caps Hub HDRI `_Exposure`, tints toward fog, bumps fog density slightly
  - Spares Sundering +Z lane via `Canon.BlocksSunderingWalk`

### Wired
- `ContinentStream.BuildContinentStaged` — `CourtWalkableHorizon.Ensure` after `MakeGround`
- `ContinentStream.MakeGround` — `ContinentGround` scale **88** (was 72) so mask radius (~210m) stays on mesh
- `HubLook.EnsureCourtRig` — Ensure on `Megaworld` when present
- `HubLook.EnsureCourtPlateCleanup` — spare objects under `CourtWalkableHorizon`
- `HubLook.TryHdrSky` — Hub day exposure **0.56** (was 0.82) + SoftenSkyband on bind
- `HubLook.EnsureCourtAtmosphere` — fog floor ~0.027 + SoftenSkyband
- `Grounding` — `CourtWalk*` / `CourtApproach*` treated as named floors

---

## 3) How to verify in Play

1. Open unity-client on this branch. Keep **Force Lean** on if that is how LeanPlay=true is set on this Mac (do **not** Force Full / LeanPlay=false).
2. Enter Play → boot Hub / Unburned Court (wait for staged continent boot).
3. **Hierarchy check:** `Megaworld/CourtWalkableHorizon` exists with `CourtApproachGround_*`, `CourtWalkHill_Near_*`, `CourtWalkHill_Mid_*`, `CourtHorizonMask_*`.
4. **Still from Court (facing +Z / north / Sundering):** mesh hills should read in the near/mid band; far painted peaks should be softer / partly masked (not a crisp second mountain range).
5. **Walk test:** from spawn, walk **north (+Z)** onto approach pads, climb a near terrace, continue toward mid hills. Player must **not** void-drop (y collapse) or walk into empty skybox.
6. Optional console: confirm no spam from horizon build; `VisualFidelity.Dump()` still healthy (`sky=PH_HDR_…`, fog on).

### Pass criteria
- [ ] Hills visible from Court are partly/real mesh (`CourtWalkHill_*`), not HDRI-only
- [ ] North/out walk stays on colliders through near → mid
- [ ] Double-horizon reduced (mask + lower exposure + fog)
- [ ] LeanPlay unchanged (no Force Full)

---

## 4) Explicit non-goals (this slice)
- No Hub `CityDef` / SettlementCompiler districts
- No full continent heightfields
- No trading / Dila

Next slices: Zuko routine (`WORLD-SLICES-QUEUE.md`).
