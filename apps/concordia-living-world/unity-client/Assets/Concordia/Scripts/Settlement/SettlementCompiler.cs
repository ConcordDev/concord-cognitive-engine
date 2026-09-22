using System.Collections.Generic;
using System.Threading.Tasks;
using UnityEngine;

namespace Concordia.Settlement
{
    /// <summary>
    /// One kernel building, as `scene:data` already sends it. The server has been shipping
    /// every one of these fields (scene-export.js) and ConcordClient.ApplyScene was reading
    /// position and scale and discarding the rest.
    /// </summary>
    public struct KernelBuilding
    {
        public string Id, Type, Name, Material, Purpose, DistrictId;
        public Vector3 Position;
        public float RotationY, Width, Depth, Height;
        public int Floors;
        public string State;
    }

    /// <summary>
    /// Turns a settlement into streets, plots, buildings and places.
    ///
    /// This is the consumer WorldGeography never had. Its SettlementDef/PlaceDef spine has
    /// existed the whole time — carrying type, population, faction, districts and services —
    /// and its entire visual output was one point light per settlement
    /// (WorldVisualDirector.BuildSettlementLanterns). Geometry came from a parallel path that
    /// never read any of it: a hardcoded 10-element Vector3[] reused for every city in every
    /// world.
    ///
    /// Kernel rows win where they exist. Where they do not, the authored districts drive a
    /// deterministic plan. Where neither exists, nothing is built — a settlement with no
    /// districts and no kernel rows gets no invented town.
    /// </summary>
    public static class SettlementCompiler
    {
        public sealed class Stats
        {
            public int Buildings, Plots, Streets, Places, KernelRows;
            public override string ToString() =>
                $"buildings={Buildings} plots={Plots} streets={Streets} places={Places} kernel={KernelRows}";
        }

        /// <summary>
        /// Kit + materials for a culture, loaded once and reused by both the full district
        /// compile and single-building kernel placement.
        /// </summary>
        public readonly struct Look
        {
            public readonly ModuleKit Kit;
            public readonly Material WallMat, RoofMat;
            public readonly RoofKind Roof;
            public readonly float Pitch;
            public Look(ModuleKit kit, Material wallMat, Material roofMat, RoofKind roof, float pitch)
            { Kit = kit; WallMat = wallMat; RoofMat = roofMat; Roof = roof; Pitch = pitch; }
            public bool Ready => Kit != null && Kit.Ready;
        }

        public static async Task<Look> EnsureLook(WorldId world)
        {
            var culture = DressVocab.Culture(world);
            var kitStem = KitFor(culture);
            var kit = await ModuleKit.Load(kitStem);
            var roof = RoofFor(culture);
            var pitch = roof == RoofKind.Flat ? 0f : (culture == "grove" ? 42f : 32f);
            var roofMat = HubLook.Pbr(RoofMesher.MaterialStem(roof, culture),
                                      new Color(0.72f, 0.70f, 0.68f), 0.02f, 0.18f, 3f);
            var wallMat = HubLook.Pbr(WallStemFor(culture), new Color(0.78f, 0.76f, 0.72f), 0.02f, 0.2f, 2f);
            return new Look(kit, wallMat, roofMat, roof, pitch);
        }

        /// <summary>
        /// Place ONE building — the kernel's `scene:data` sends buildings individually,
        /// not as a settlement snapshot, and rebuilding a whole district per node would be
        /// both wrong (each call is one row, not a full town) and wasteful. `parent` should
        /// be a stable per-world holder (see WorldBuilder.PlaceKernelBuilding) so repeated
        /// calls accumulate rather than re-import the kit each time — ModuleKit.Load caches
        /// by stem, so only the first building in a session actually pays the glb import.
        /// Returns false (never a cube) when the kit genuinely isn't available — the caller
        /// decides whether to fall back.
        /// </summary>
        /// <summary>
        /// LeanPlay / staged realize: pave district street skeleton only (no facades yet).
        /// Yields every few segments so the editor stays alive.
        /// </summary>
        public static async Task<int> CompileRoadsOnly(Transform parent, WorldId world, SettlementDef def,
                                                       System.Func<Vector2, bool> keepOut = null)
        {
            if (!parent || def == null) return 0;
            var culture = DressVocab.Culture(world);
            var root = parent.Find("SettlementRoads_" + def.id.value);
            if (!root)
            {
                var go = new GameObject("SettlementRoads_" + def.id.value);
                go.transform.SetParent(parent, false);
                go.transform.localPosition = new Vector3(def.localPosition.x, 0f, def.localPosition.y);
                root = go.transform;
            }
            var districts = def.districts ?? System.Array.Empty<string>();
            var density = Mathf.Max(8, def.populationBaseline);
            var extent = Mathf.Clamp(18f + density * 0.22f, 22f, 78f);
            var paved = 0;
            var sinceYield = 0;
            for (int i = 0; i < districts.Length; i++)
            {
                var districtId = districts[i];
                if (string.IsNullOrEmpty(districtId)) continue;
                Vector2 origin;
                float bearing;
                float planExtent = extent / Mathf.Max(1f, Mathf.Sqrt(districts.Length));
                if (TryHubDistrictOrigin(world, def, districtId, extent, out origin, out bearing, out var hubExtent))
                    planExtent = hubExtent;
                else
                {
                    var ang = Det.Unit(Det.Hash(def.id.value, districtId)) * Mathf.PI * 2f;
                    var ring = districts.Length == 1 ? 0f : extent * 0.72f;
                    origin = def.localPosition + new Vector2(Mathf.Cos(ang) * ring, Mathf.Sin(ang) * ring);
                    bearing = Mathf.Atan2(origin.x - def.localPosition.x, origin.y - def.localPosition.y) * Mathf.Rad2Deg;
                }
                var plan = PlotPlanner.Plan(def.id.value, districtId, origin,
                                            planExtent,
                                            bearing, density, keepOut);
                foreach (var s in plan.Streets)
                {
                    Pave(root, s, culture);
                    paved++;
                    if (++sinceYield >= 4) { sinceYield = 0; await Task.Yield(); if (!root) return paved; }
                }
            }
            Debug.Log("[Concordia] Settlement: CompileRoadsOnly paved=" + paved + " for " + def.name);
            return paved;
        }

        /// <summary>
        /// LeanPlay Hub streetscape — STREET → LOT → BUILDING without ModuleKit Emit.
        /// Reuses PlotPlanner streets+plots, paves ribbons, stamps lot pads, emits
        /// lightweight extruded shells (DressBuilding street kit). Cap per district
        /// keeps 16GB Play alive. Prefer this over CompileRoadsOnly for Hub heart.
        /// </summary>
        public sealed class StreetscapeStats
        {
            public int Streets, Lots, Buildings, Districts;
            public bool Ok => Buildings > 0 && Lots > 0 && Streets > 0;
            public override string ToString() =>
                $"streets={Streets} lots={Lots} buildings={Buildings} districts={Districts}";
        }

        const int LeanBuildingsPerDistrict = 10;

        public static async Task<StreetscapeStats> CompileStreetscapeLean(
            Transform parent, WorldId world, SettlementDef def,
            System.Func<Vector2, bool> keepOut = null)
        {
            var stats = new StreetscapeStats();
            if (!parent || def == null) return stats;

            var culture = DressVocab.Culture(world);
            var rootName = "SettlementStreetscape_" + def.id.value;
            var existing = parent.Find(rootName);
            if (existing) Object.Destroy(existing.gameObject);

            var rootGo = new GameObject(rootName);
            var root = rootGo.transform;
            root.SetParent(parent, false);
            root.localPosition = new Vector3(def.localPosition.x, 0f, def.localPosition.y);

            var wallMat = HubLook.Pbr(WallStemFor(culture), new Color(0.78f, 0.76f, 0.72f), 0.02f, 0.2f, 2f);
            var roofMat = HubLook.Pbr(RoofMesher.MaterialStem(RoofFor(culture), culture),
                                      new Color(0.42f, 0.38f, 0.36f), 0.02f, 0.18f, 3f);
            var lotMat = HubLook.Pbr("packed_earth", new Color(0.48f, 0.44f, 0.38f), 0.04f, 0.22f, 6f);

            var districts = def.districts ?? System.Array.Empty<string>();
            var density = Mathf.Min(DensityFor(def), 28);
            var extent = ExtentFor(def, density);
            var sinceYield = 0;

            for (int i = 0; i < districts.Length; i++)
            {
                var districtId = districts[i];
                if (string.IsNullOrEmpty(districtId)) continue;
                if (world == WorldId.Hub && !IsHubHeartDistrict(districtId)) continue;

                Vector2 origin;
                float bearing;
                float planExtent = extent / Mathf.Max(1f, Mathf.Sqrt(Mathf.Max(1, districts.Length)));
                if (TryHubDistrictOrigin(world, def, districtId, extent, out origin, out bearing, out var hubExtent))
                    planExtent = hubExtent;
                else
                {
                    var ang = Det.Unit(Det.Hash(def.id.value, districtId)) * Mathf.PI * 2f;
                    var ring = districts.Length == 1 ? 0f : extent * 0.72f;
                    origin = def.localPosition + new Vector2(Mathf.Cos(ang) * ring, Mathf.Sin(ang) * ring);
                    bearing = Mathf.Atan2(origin.x - def.localPosition.x, origin.y - def.localPosition.y) * Mathf.Rad2Deg;
                }

                var plan = PlotPlanner.Plan(def.id.value, districtId, origin,
                                            planExtent, bearing, density, keepOut);
                if (plan.Streets.Count == 0 && plan.Plots.Count == 0) continue;

                var distGo = new GameObject("District_" + districtId);
                var dist = distGo.transform;
                dist.SetParent(root, false);

                var streetsHold = new GameObject("Streets").transform;
                streetsHold.SetParent(dist, false);
                foreach (var s in plan.Streets)
                {
                    Pave(streetsHold, s, culture);
                    stats.Streets++;
                    if (++sinceYield >= 3) { sinceYield = 0; await Task.Yield(); if (!root) return stats; }
                }

                var lotsHold = new GameObject("Lots").transform;
                lotsHold.SetParent(dist, false);
                var buildsHold = new GameObject("Buildings").transform;
                buildsHold.SetParent(dist, false);

                int placed = 0;
                for (int p = 0; p < plan.Plots.Count && placed < LeanBuildingsPerDistrict; p++)
                {
                    var plot = plan.Plots[p];
                    plot.Purpose = PurposeFor(def, districtId, plot.Seed);
                    plot.DistrictId = districtId;

                    // Lot footprint pad (readable parcel under / beside the shell).
                    var lot = new GameObject("Lot_" + districtId + "_" + placed).transform;
                    lot.SetParent(lotsHold, false);
                    lot.position = new Vector3(plot.Centre.x, 0f, plot.Centre.y);
                    lot.rotation = Quaternion.Euler(0f, plot.Yaw, 0f);
                    float padW = Mathf.Max(PlotPlanner.BayMeters, plot.Frontage);
                    float padD = Mathf.Max(PlotPlanner.BayMeters, plot.Depth);
                    HubLook.PrimSurface(lot, PrimitiveType.Cube, new Vector3(0f, 0.03f, 0f),
                        new Vector3(padW, 0.06f, padD), lotMat, "LotPad", false);
                    stats.Lots++;

                    var go = EmitLeanShell(buildsHold, plot, wallMat, roofMat);
                    if (go)
                    {
                        DressBuilding(go, world);
                        stats.Buildings++;
                        placed++;
                    }
                    if (++sinceYield >= 2) { sinceYield = 0; await Task.Yield(); if (!root) return stats; }
                }

                if (placed > 0 || plan.Streets.Count > 0)
                    stats.Districts++;
            }

            Debug.Log("[Concordia] Settlement: CompileStreetscapeLean " + stats + " for " + def.name);
            if (!stats.Ok && root)
            {
                // Don't leave an empty STREET-only streetscape root when falling back to roads.
                Object.Destroy(root.gameObject);
            }
            return stats;
        }

        /// <summary>
        /// SLICE 4 — Crown Road spokes from Warden ring (Canon.Gates) toward Hub approach
        /// stubs. LeanPlay-capped length/segments; reuses CourtRoadDeck / sidewalk / curb.
        /// Does not invent kingdoms or fill Vinewood between spokes.
        /// </summary>
        public sealed class CrownRoadStats
        {
            public int Spokes, Segments;
            public bool Ok => Spokes >= 2 && Segments > 0;
            public override string ToString() => $"spokes={Spokes} segments={Segments}";
        }

        const float CrownSpokeMaxLen = 42f;
        const int CrownMaxSegmentsPerSpoke = 2;
        const float CrownSegTargetLen = 22f;
        const float CrownRoadWidth = 4.4f;
        const float CrownStopShortOfLandmark = 7.5f;

        public static async Task<CrownRoadStats> CompileCrownRoadsLean(
            Transform parent, WorldId world, SettlementDef def)
        {
            var stats = new CrownRoadStats();
            if (!parent || def == null || world != WorldId.Hub) return stats;

            var culture = DressVocab.Culture(world);
            var rootName = "SettlementCrownRoads_" + def.id.value;
            var existing = parent.Find(rootName);
            if (existing) Object.Destroy(existing.gameObject);

            var rootGo = new GameObject(rootName);
            var root = rootGo.transform;
            root.SetParent(parent, false);
            root.localPosition = Vector3.zero;

            var sinceYield = 0;
            foreach (var city in CityAtlas.For(WorldId.Hub))
            {
                if (city == null) continue;
                if (!string.Equals(city.status, "stub", System.StringComparison.OrdinalIgnoreCase))
                    continue;
                if (string.IsNullOrEmpty(city.id)) continue;

                var target = new Vector2(city.x, city.z);
                if (target.sqrMagnitude < 1f) continue;

                // Start just outside the Warden ring along the radial toward the stub
                // (nearest Canon.Gate bearing when within 40°, else pure radial).
                var radial = target.normalized;
                float targetAng = Mathf.Atan2(radial.y, radial.x);
                float bestGateAng = targetAng;
                float bestDelta = 999f;
                foreach (var g in Canon.Gates)
                {
                    float d = Mathf.Abs(Mathf.DeltaAngle(g.angle * Mathf.Rad2Deg, targetAng * Mathf.Rad2Deg));
                    if (d < bestDelta) { bestDelta = d; bestGateAng = g.angle; }
                }
                float startAng = bestDelta <= 40f ? bestGateAng : targetAng;
                var start = new Vector2(Mathf.Cos(startAng), Mathf.Sin(startAng))
                            * (Canon.RingRadius + 1.2f);

                var toTarget = target - start;
                float fullLen = toTarget.magnitude;
                if (fullLen < 4f) continue;
                var dir = toTarget / fullLen;
                // Stop short of the approach landmark mass so the ribbon reads into it.
                float paveLen = Mathf.Min(fullLen - CrownStopShortOfLandmark, CrownSpokeMaxLen);
                if (paveLen < 4f) continue;
                var end = start + dir * paveLen;

                var spokeHold = new GameObject("CrownRoad_" + city.id).transform;
                spokeHold.SetParent(root, false);

                int segs = Mathf.Clamp(Mathf.CeilToInt(paveLen / CrownSegTargetLen), 1, CrownMaxSegmentsPerSpoke);
                for (int s = 0; s < segs; s++)
                {
                    float t0 = (float)s / segs;
                    float t1 = (float)(s + 1) / segs;
                    var a = Vector2.Lerp(start, end, t0);
                    var b = Vector2.Lerp(start, end, t1);
                    var seg = new StreetSeg { A = a, B = b, Width = CrownRoadWidth, Arterial = true };
                    Pave(spokeHold, seg, culture, "CrownRoad_" + city.id + "_s" + s);
                    stats.Segments++;
                    if (++sinceYield >= 2)
                    {
                        sinceYield = 0;
                        await Task.Yield();
                        if (!root) return stats;
                    }
                }
                stats.Spokes++;
            }

            Debug.Log("[Concordia] Settlement: CompileCrownRoadsLean " + stats + " for " + def.name);
            if (!stats.Ok && root)
                Object.Destroy(root.gameObject);
            return stats;
        }

        /// <summary>
        /// Medium-ring approach landmark — one lean shell (+ optional annex). Not full streetscape.
        /// </summary>
        public static int EmitApproachLandmark(Transform hold, WorldId world, string cityId)
        {
            if (!hold) return 0;
            var culture = DressVocab.Culture(world);
            var wallMat = HubLook.Pbr(WallStemFor(culture), new Color(0.74f, 0.72f, 0.68f), 0.02f, 0.2f, 2f);
            var roofMat = HubLook.Pbr(RoofMesher.MaterialStem(RoofFor(culture), culture),
                                      new Color(0.40f, 0.36f, 0.32f), 0.02f, 0.18f, 3f);

            string purpose = "house";
            int storeys = 2;
            float frontage = 8.5f;
            float depth = 7.5f;
            int maxBuildings = 1;
            var key = (cityId ?? "").ToLowerInvariant();
            if (key.Contains("tavern") || key.Contains("refusals"))
            {
                purpose = "market";
                frontage = 10.5f;
                depth = 8.5f;
                maxBuildings = 2;
            }
            else if (key.Contains("spire") || key.Contains("broken"))
            {
                purpose = "watch";
                storeys = 3;
                frontage = 5.8f;
                depth = 5.8f;
            }
            else if (key.Contains("grove"))
            {
                purpose = "farm";
                frontage = 7.5f;
                depth = 8.0f;
            }
            else if (key.Contains("pinewood") || key.Contains("crossing"))
            {
                purpose = "market";
                frontage = 9.0f;
                depth = 7.2f;
            }

            // Face Court (origin) — hold already faces inward; landmark sits slightly north of plaque.
            var plot = new Plot
            {
                Centre = new Vector2(hold.position.x, hold.position.z) + new Vector2(hold.forward.x, hold.forward.z) * 1.2f,
                Yaw = hold.eulerAngles.y,
                Frontage = frontage,
                Depth = depth,
                Storeys = storeys,
                Purpose = purpose,
                Seed = Det.Hash(cityId ?? "approach", purpose),
                DistrictId = cityId ?? "approach"
            };

            var go = EmitLeanShell(hold, plot, wallMat, roofMat);
            int n = 0;
            if (go)
            {
                go.name = "ApproachLandmark_" + (cityId ?? "site");
                DressBuilding(go, world);
                // Single lantern pair is enough for medium ring — trim extra if LeanPlay.
                n = 1;
            }

            if (maxBuildings >= 2)
            {
                var annex = new Plot
                {
                    Centre = plot.Centre + new Vector2(hold.right.x, hold.right.z) * 7.2f,
                    Yaw = hold.eulerAngles.y + 12f,
                    Frontage = 4.8f,
                    Depth = 4.5f,
                    Storeys = 1,
                    Purpose = "house",
                    Seed = Det.Hash(cityId ?? "approach", "annex"),
                    DistrictId = cityId ?? "approach"
                };
                var annexGo = EmitLeanShell(hold, annex, wallMat, roofMat);
                if (annexGo)
                {
                    annexGo.name = "ApproachLandmarkAnnex_" + (cityId ?? "site");
                    DressBuilding(annexGo, world);
                    n++;
                }
            }

            // Minimal dress at the approach mouth — lantern + civic sign (not full street kit).
            HubLook.Lantern(hold, hold.TransformPoint(new Vector3(-2.4f, 0.02f, -1.2f)));
            CxDress.CivicSign(hold, hold.TransformPoint(new Vector3(2.2f, 0f, -0.6f)), world);
            return n;
        }

        static bool IsHubHeartDistrict(string districtId)
        {
            var key = (districtId ?? "").ToLowerInvariant().Replace('-', '_');
            return key == "council_chamber" || key == "archive_quarter"
                || key == "market_district" || key == "warden_ring_wall";
        }

        /// <summary>
        /// Cheap readable mass — extruded wall body + roof slab. No ModuleKit Instantiate storm.
        /// Optionally nests a FreePacks house stem when present (court culture often has Forge).
        /// </summary>
        static GameObject EmitLeanShell(Transform parent, Plot plot, Material wallMat, Material roofMat)
        {
            if (!parent) return null;
            var purpose = string.IsNullOrEmpty(plot.Purpose) ? "house" : plot.Purpose;
            var hold = new GameObject("LeanBuilding_" + purpose).transform;
            hold.SetParent(parent, false);
            hold.position = new Vector3(plot.Centre.x, 0f, plot.Centre.y);
            hold.rotation = Quaternion.Euler(0f, plot.Yaw, 0f);

            int storeys = Mathf.Clamp(plot.Storeys > 0 ? plot.Storeys : 2, 1, 3);
            float h = storeys * 2.65f;
            float w = Mathf.Clamp(plot.Frontage * 0.82f, 4.2f, 11f);
            float d = Mathf.Clamp(plot.Depth * 0.72f, 4.5f, 12f);

            HubLook.PrimSurface(hold, PrimitiveType.Cube, new Vector3(0f, h * 0.5f, 0f),
                new Vector3(w, h, d), wallMat, "ShellBody", true);
            HubLook.PrimSurface(hold, PrimitiveType.Cube, new Vector3(0f, h + 0.28f, 0f),
                new Vector3(w * 1.06f, 0.55f, d * 1.06f), roofMat, "ShellRoof", false);

            // Door recess on the street face — mass reads as a building, not a grey slab.
            var doorMat = HubLook.Pbr("wood_cabinet_worn_long", new Color(0.28f, 0.20f, 0.14f), 0.04f, 0.35f, 2f);
            HubLook.PrimSurface(hold, PrimitiveType.Cube, new Vector3(0f, 1.05f, d * 0.5f + 0.06f),
                new Vector3(1.15f, 2.1f, 0.18f), doorMat, "ShellDoor", false);
            // Window strip (mid storey) — cheap facade signal without ModuleKit.
            var winMat = HubLook.Pbr("glass_window", new Color(0.35f, 0.42f, 0.48f), 0.02f, 0.55f, 1.5f);
            HubLook.PrimSurface(hold, PrimitiveType.Cube, new Vector3(-w * 0.28f, h * 0.62f, d * 0.5f + 0.05f),
                new Vector3(0.9f, 0.85f, 0.12f), winMat, "ShellWin_L", false);
            HubLook.PrimSurface(hold, PrimitiveType.Cube, new Vector3(w * 0.28f, h * 0.62f, d * 0.5f + 0.05f),
                new Vector3(0.9f, 0.85f, 0.12f), winMat, "ShellWin_R", false);

            if (!string.IsNullOrEmpty(plot.Purpose))
            {
                var place = hold.gameObject.AddComponent<BuildingPlace>();
                place.plan = PlanNameFor(plot.Purpose);
                var fwd = hold.forward;
                place.door = hold.position + fwd * (d * 0.5f + 0.6f);
            }
            return hold.gameObject;
        }

        public static void DressBuilding(GameObject building, WorldId world)
        {
            if (!building || building.transform.Find("StreetDress")) return;
            var hold = new GameObject("StreetDress").transform;
            hold.SetParent(building.transform, false);
            var at = building.transform.position;
            var yaw = building.transform.eulerAngles.y;
            var right = building.transform.right;
            var forward = building.transform.forward;
            // Lean dress: readable street kit only — paired lanterns + sign + one prop + one crate.
            // Dropped extra lanterns/table/chair/chest/world dumps (fps cost, little read).
            HubLook.Lantern(hold, at + right * -1.6f + Vector3.up * 0.02f);
            HubLook.Lantern(hold, at + right * 1.6f + forward * 0.35f + Vector3.up * 0.02f);
            CxDress.CivicSign(hold, at + forward * 0.85f, world);
            var prop = DressVocab.Prop(world);
            if (!string.IsNullOrEmpty(prop))
                FreePacks.Spawn(prop, hold, hold.TransformPoint(new Vector3(1.35f, 0f, 0.8f)), yaw + 25f, 0.9f, false, false);
            FreePacks.Spawn(DressVocab.Crate(), hold, hold.TransformPoint(new Vector3(-1.5f, 0f, 1.0f)), yaw + 12f, 0.85f, false, false);
        }

        public static async Task<GameObject> CompileOne(Transform parent, WorldId world, KernelBuilding kb)
        {
            if (!parent) return null;
            if (!string.IsNullOrEmpty(kb.State) && kb.State == "collapsed") return null;
            var look = await EnsureLook(world);
            if (!look.Ready) return null;
            // Give Play a frame after kit load before the Emit Instantiate storm.
            await Task.Yield();
            if (!parent) return null;

            var plot = new Plot
            {
                Centre = new Vector2(kb.Position.x, kb.Position.z),
                Yaw = kb.RotationY,
                Frontage = Mathf.Max(PlotPlanner.BayMeters, kb.Width),
                Depth = Mathf.Max(PlotPlanner.BayMeters, kb.Depth),
                Storeys = Mathf.Clamp(kb.Floors > 0 ? kb.Floors : 2, 1, 8),
                DistrictId = string.IsNullOrEmpty(kb.DistrictId) ? kb.Type : kb.DistrictId,
                Purpose = string.IsNullOrEmpty(kb.Purpose) ? kb.Type : kb.Purpose,
                Seed = Det.Hash(kb.Id)
            };
            Emit(parent, plot, look.Kit, look.WallMat, look.RoofMat, look.Roof, look.Pitch, kb.Name, out var go);
            await Task.Yield();
            if (go)
            {
                DressBuilding(go, world);
                Debug.Log("[Concordia] Settlement: CompileOne ok '" + (kb.Name ?? kb.Id) + "'");
            }
            return go;
        }

        /// <summary>
        /// Compile one settlement under `parent`. Awaits kit import before composing — the
        /// lazy HubKit path would otherwise miss on frame one and silently emit nothing.
        /// </summary>
        public static async Task<Stats> Compile(Transform parent, WorldId world,
                                                SettlementDef def,
                                                IList<KernelBuilding> kernel = null,
                                                System.Func<Vector2, bool> keepOut = null)
        {
            var stats = new Stats();
            if (!parent || def == null) return stats;

            var culture = DressVocab.Culture(world);
            var look = await EnsureLook(world);
            if (!look.Ready)
            {
                Debug.LogWarning("Concordia Settlement: kit unavailable for '" + world
                                 + "' — '" + def.name + "' keeps its existing dressing rather than a greybox town.");
                return stats;
            }
            var kit = look.Kit;
            var roof = look.Roof;
            var pitch = look.Pitch;
            var roofMat = look.RoofMat;
            var wallMat = look.WallMat;

            var root = new GameObject("Settlement_" + def.id.value).transform;
            root.SetParent(parent, false);
            root.localPosition = new Vector3(def.localPosition.x, 0f, def.localPosition.y);

            // Each building is ~100+ Object.Instantiate calls (four wall runs of base/dado/
            // storey/cornice/crown courses, plus inserts, plus four corner quoins). A
            // settlement can have dozens of buildings, and CityTown fires off ONE Compile
            // per city — with several cities per world all doing this in the same tick once
            // their (shared, cached) kit is warm, the combined synchronous burst pegged the
            // main thread hard enough that even the editor's own tooling bridge stopped
            // getting scheduled time. Yielding periodically spreads the work back across
            // frames — still "fast," just no longer one uninterruptible spike.
            const int YieldEveryBuildings = 3;
            int sinceYield = 0;

            // ---- kernel rows first: these are real places with a real history ------------
            if (kernel != null)
            {
                foreach (var kb in kernel)
                {
                    if (!string.IsNullOrEmpty(kb.State) && kb.State == "collapsed") continue;
                    var plot = new Plot
                    {
                        Centre = new Vector2(kb.Position.x, kb.Position.z),
                        Yaw = kb.RotationY,
                        Frontage = Mathf.Max(PlotPlanner.BayMeters, kb.Width),
                        Depth = Mathf.Max(PlotPlanner.BayMeters, kb.Depth),
                        Storeys = Mathf.Clamp(kb.Floors > 0 ? kb.Floors : 2, 1, 8),
                        DistrictId = string.IsNullOrEmpty(kb.DistrictId) ? def.type : kb.DistrictId,
                        Purpose = string.IsNullOrEmpty(kb.Purpose) ? kb.Type : kb.Purpose,
                        Seed = Det.Hash(kb.Id)
                    };
                    if (Emit(root, plot, kit, wallMat, roofMat, roof, pitch, kb.Name, out _)) stats.Buildings++;
                    stats.KernelRows++;
                    if (++sinceYield >= YieldEveryBuildings) { sinceYield = 0; await Task.Yield(); if (!root) return stats; }
                }
            }

            // ---- authored districts fill the rest ----------------------------------------
            var districts = def.districts ?? System.Array.Empty<string>();
            var density = DensityFor(def);
            var extent = ExtentFor(def, density);

            for (int i = 0; i < districts.Length; i++)
            {
                var districtId = districts[i];
                if (string.IsNullOrEmpty(districtId)) continue;

                Vector2 origin;
                float bearing;
                float planExtent = extent / Mathf.Max(1f, Mathf.Sqrt(districts.Length));
                if (TryHubDistrictOrigin(world, def, districtId, extent, out origin, out bearing, out var hubExtent))
                    planExtent = hubExtent;
                else
                {
                    // Districts ring the settlement centre, deterministically, at a radius that
                    // clears the core. PlaceDef already does exactly this for its own markers.
                    var ang = Det.Unit(Det.Hash(def.id.value, districtId)) * Mathf.PI * 2f;
                    var ring = districts.Length == 1 ? 0f : extent * 0.72f;
                    origin = def.localPosition + new Vector2(Mathf.Cos(ang) * ring, Mathf.Sin(ang) * ring);
                    bearing = Mathf.Atan2(origin.x - def.localPosition.x, origin.y - def.localPosition.y) * Mathf.Rad2Deg;
                }

                var plan = PlotPlanner.Plan(def.id.value, districtId, origin,
                                            planExtent,
                                            bearing, density, keepOut);

                foreach (var p in plan.Plots)
                {
                    var plot = p;
                    plot.Purpose = PurposeFor(def, districtId, plot.Seed);
                    if (Emit(root, plot, kit, wallMat, roofMat, roof, pitch, null, out _)) stats.Buildings++;
                    stats.Plots++;
                    if (++sinceYield >= YieldEveryBuildings) { sinceYield = 0; await Task.Yield(); if (!root) return stats; }
                }
                foreach (var s in plan.Streets) { Pave(root, s, culture); stats.Streets++; }
            }

            stats.Places = root.GetComponentsInChildren<BuildingPlace>(true).Length;
            return stats;
        }

        static bool Emit(Transform root, Plot plot, ModuleKit kit, Material wallMat, Material roofMat,
                         RoofKind roof, float pitch, string name, out GameObject built)
        {
            built = null;
            var go = FacadeComposer.Build(root, plot, kit, wallMat, roofMat, roof, pitch);
            if (!go) return false;
            built = go;
            if (!string.IsNullOrEmpty(name)) go.name = name;

            // Stamp the building so NpcLife's schedule can actually route to it. Without this
            // the kernel's buildings stay invisible to the routine layer, which is exactly
            // why PlaceKernelBuilding's houses were scenery nobody ever walked into.
            if (!string.IsNullOrEmpty(plot.Purpose))
            {
                var place = go.AddComponent<BuildingPlace>();
                place.plan = PlanNameFor(plot.Purpose);
                var fwd = Quaternion.Euler(0f, plot.Yaw, 0f) * Vector3.forward;
                place.door = go.transform.position + fwd * (plot.Depth * 0.5f + 0.6f);
            }
            return true;
        }

        /// <summary>
        /// Map a kernel `building_type` / district tag onto the plan vocabulary NpcLife
        /// already searches for (`WorkplaceFor`/`PlanFor` look up market / archive / tower,
        /// and `EveningDest` looks up tavern). Anything unrecognised stays a house.
        /// </summary>
        static string PlanNameFor(string purpose)
        {
            switch ((purpose ?? "").ToLowerInvariant())
            {
                case "inn":
                case "tavern": return "tavern";
                case "market":
                case "shop":
                case "warehouse": return "market";
                case "archive":
                case "embassy":
                case "temple": return "archive";
                case "tower":
                case "watch": return "tower";
                case "forge":
                case "mine":
                case "farm":
                case "dock": return "market";
                default: return "house";
            }
        }

        static string PurposeFor(SettlementDef def, string districtId, int seed)
        {
            var district = (districtId ?? "").ToLowerInvariant();
            if (district.Contains("council") || district.Contains("chamber")) return "embassy";
            if (district.Contains("forge") || district.Contains("volcanic")) return "forge";
            if (district.Contains("market") || district.Contains("dock") || district.Contains("warehouse")
                || district.Contains("salt") || district.Contains("roadhouse")) return "market";
            if (district.Contains("farm") || district.Contains("field") || district.Contains("grove")
                || district.Contains("veil")) return "farm";
            if (district.Contains("archive") || district.Contains("temple") || district.Contains("crypt")) return "archive";
            if (district.Contains("watch") || district.Contains("tower") || district.Contains("ward")
                || district.Contains("spire")) return "watch";
            if (district.Contains("arid") || district.Contains("capital")) return "market";
            // A settlement's authored services are the honest source for what it contains.
            var services = def.services;
            if (services != null && services.Length > 0 && (seed % 4) == 0)
                return services[Mathf.Abs(seed / 4) % services.Length];
            return "house";
        }

        /// <summary>
        /// Atlas § Hub — named district bearings around the Unburned Court (not hash soup).
        /// Council near civic heart; Market SE/E; Archive S; Warden on ring-wall.
        /// </summary>
        static bool TryHubDistrictOrigin(WorldId world, SettlementDef def, string districtId,
                                         float extent, out Vector2 origin, out float bearing, out float planExtent)
        {
            origin = default;
            bearing = 0f;
            planExtent = extent * 0.45f;
            if (world != WorldId.Hub || def == null) return false;
            if (!string.Equals(def.legacyCityId, "hub", System.StringComparison.OrdinalIgnoreCase)
                && (def.type ?? "") != "court")
                return false;
            var key = (districtId ?? "").ToLowerInvariant().Replace('-', '_');
            float ang;
            float ring;
            switch (key)
            {
                case "council_chamber":
                    // Civic heart — outside Court 40m keep-out (was 22m → zero plots).
                    ang = Mathf.PI * 0.5f;
                    ring = 48f;
                    planExtent = 18f;
                    break;
                case "market_district":
                    // SE / E of Court — Salt Route head / Market Well band.
                    ang = -Mathf.PI * 0.18f;
                    ring = 52f;
                    planExtent = 24f;
                    break;
                case "archive_quarter":
                    // South — Purge-scarred Scholars' Guild band.
                    ang = -Mathf.PI * 0.5f;
                    ring = 50f;
                    planExtent = 22f;
                    break;
                case "warden_ring_wall":
                    // Perimeter gatehouse band on Crown Road spokes (RingRadius ≈ 34).
                    // Push past Court keep-out so LeanPlay lots survive.
                    ang = Mathf.PI * 0.12f;
                    ring = Mathf.Max(Canon.RingRadius, 46f);
                    planExtent = 18f;
                    break;
                default:
                    return false;
            }
            origin = def.localPosition + new Vector2(Mathf.Cos(ang) * ring, Mathf.Sin(ang) * ring);
            bearing = Mathf.Atan2(origin.x - def.localPosition.x, origin.y - def.localPosition.y) * Mathf.Rad2Deg;
            return true;
        }

        static int DensityFor(SettlementDef def)
        {
            var pop = Mathf.Max(8, def != null ? def.populationBaseline : 40);
            var type = (def?.type ?? "").ToLowerInvariant();
            var mult = type switch
            {
                "capital" => 1.35f,
                "borough" => 1.25f,
                "town" => 1.15f,
                "port" => 1.1f,
                "court" => 0.85f,
                "village" => 0.65f,
                "archive" => 0.8f,
                _ => 1f
            };
            var dens = Mathf.Clamp(Mathf.RoundToInt(pop * mult), 8, 220);
            // LeanPlay Hub: keep district plans thin so CompileRoadsOnly stays frame-friendly.
            if (def != null && def.world == WorldId.Hub && ConcordiaHost.LeanPlay)
                dens = Mathf.Min(dens, 36);
            return dens;
        }

        static float ExtentFor(SettlementDef def, int density)
        {
            var type = (def?.type ?? "").ToLowerInvariant();
            var lo = type == "village" ? 14f : 18f;
            var hi = type == "capital" || type == "borough" ? 92f : 78f;
            return Mathf.Clamp(lo + density * 0.22f, lo, hi);
        }

        static string KitFor(string culture)
        {
            switch (culture)
            {
                case "street":
                case "grid": return ModuleKit.Factory;      // 192 modules, industrial/urban
                default: return ModuleKit.Apartments;       // 147 modules, the general case
            }
        }

        static RoofKind RoofFor(string culture)
        {
            switch (culture)
            {
                case "grove": return RoofKind.Gable;        // thatch/tile villages
                case "ash": return RoofKind.Gable;
                case "court": return RoofKind.Hip;
                default: return RoofKind.Flat;              // street/grid/drift sit behind parapets
            }
        }

        /// Fallback wall material, only used where a kit module imported with a blank albedo.
        static string WallStemFor(string culture)
        {
            switch (culture)
            {
                case "grove": return "plastered_wall";
                case "ash": return "old_stone_wall";
                case "street": return "brick_wall_006";
                case "grid": return "concrete_wall_008";
                case "drift": return "rough_plaster_03";
                default: return "brick_wall_003";
            }
        }

        static void Pave(Transform root, StreetSeg s, string culture, string bandName = null)
        {
            var delta = s.B - s.A;
            var len = delta.magnitude;
            if (len < 0.5f) return;
            var mid = (s.A + s.B) * 0.5f;
            var yaw = Mathf.Atan2(delta.x, delta.y) * Mathf.Rad2Deg;
            var at = new Vector3(mid.x, 0f, mid.y);
            var rot = Quaternion.Euler(0f, yaw, 0f);
            float roadW = Mathf.Max(3.6f, s.Width * 1.15f);

            // SLICE 2b — continuous asphalt band + sidewalk + readable curb step.
            // PrimSurface (not Prim): avoids PropModels dressing "Street"→tree.
            var band = new GameObject(string.IsNullOrEmpty(bandName) ? "StreetBand" : bandName).transform;
            band.SetParent(root, false);
            band.position = at;
            band.rotation = rot;

            var roadStem = culture == "grove" ? "packed_earth" : "wet_asphalt";
            var roadMat = HubLook.Pbr(roadStem, new Color(0.22f, 0.22f, 0.24f), 0.02f, 0.14f, 5.5f);
            var walkMat = HubLook.Pbr("concrete_floor", new Color(0.55f, 0.53f, 0.50f), 0.02f, 0.22f, 4.5f);
            var curbMat = HubLook.Pbr("stone_tiles", new Color(0.42f, 0.40f, 0.38f), 0.04f, 0.18f, 3.2f);

            // Court* names survive EnsureCourtPlateCleanup (bare Cube prims get disabled).
            var road = HubLook.PrimSurface(band, PrimitiveType.Cube, new Vector3(0f, 0.04f, 0f),
                new Vector3(roadW, 0.08f, len), roadMat, "CourtRoadDeck", true);
            if (!road) return;

            float walkW = ConcordiaHost.LeanPlay ? 1.55f : 1.85f;
            float curbH = 0.32f;
            float curbT = 0.22f;
            float walkY = 0.22f;
            float edge = roadW * 0.5f + walkW * 0.5f + 0.08f;

            HubLook.PrimSurface(band, PrimitiveType.Cube, new Vector3(-edge, walkY, 0f),
                new Vector3(walkW, 0.10f, len), walkMat, "CourtSidewalk_L", true);
            HubLook.PrimSurface(band, PrimitiveType.Cube, new Vector3(edge, walkY, 0f),
                new Vector3(walkW, 0.10f, len), walkMat, "CourtSidewalk_R", true);

            float curbX = roadW * 0.5f + 0.10f;
            HubLook.PrimSurface(band, PrimitiveType.Cube, new Vector3(-curbX, curbH * 0.5f, 0f),
                new Vector3(curbT, curbH, len), curbMat, "CourtCurb_L", true);
            HubLook.PrimSurface(band, PrimitiveType.Cube, new Vector3(curbX, curbH * 0.5f, 0f),
                new Vector3(curbT, curbH, len), curbMat, "CourtCurb_R", true);

            if (len > 10f)
            {
                var puddle = HubLook.WetStone("patterned_cobblestone_02", 8f);
                if (puddle && puddle.HasProperty("_Smoothness")) puddle.SetFloat("_Smoothness", 0.82f);
                if (puddle && puddle.HasProperty("_BaseColor"))
                    puddle.SetColor("_BaseColor", new Color(0.07f, 0.16f, 0.18f));
                HubLook.PrimSurface(band, PrimitiveType.Cylinder, new Vector3(0f, 0.07f, len * 0.18f),
                    new Vector3(1.3f, 0.03f, 1.0f), puddle, "CourtRoadPuddle", false);
            }
            // PASS3: do NOT spawn FreePacks rock_smallA as CourtCurbRock — reads as orange pyramids
            // in far-field stills. Plaza grit uses Lit CourtRockChunk / CourtPebble only.
        }
    }
}
