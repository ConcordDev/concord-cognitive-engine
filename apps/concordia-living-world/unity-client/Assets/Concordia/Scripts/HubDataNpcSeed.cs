using System.Collections.Generic;
using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// SLICE 5 — seed Hub heart districts as StreamNpcSim data rows (not ModularPerson up front).
    /// Homes sit near lean Lot_/LeanBuilding_ from CompileStreetscapeLean. Near-ring rematerialize
    /// via StreamNpcSim.Tick → TryRematerialize; leave Full range parks via StreamNpcPresence.
    /// </summary>
    public static class HubDataNpcSeed
    {
        public const int LeanSimCap = 32;
        public const int LeanFullBodyCap = 10;

        static readonly NpcLife.Job[] JobMix =
        {
            NpcLife.Job.Stall, NpcLife.Job.Wander, NpcLife.Job.Watch,
            NpcLife.Job.Sweep, NpcLife.Job.Sit, NpcLife.Job.Wander,
            NpcLife.Job.Stall, NpcLife.Job.Sweep
        };

        static readonly string[] DisplayNames =
        {
            "Stallkeeper", "Pedestrian", "Warden Watch", "Sweeper", "Bench Sitter",
            "Courier", "Vendor", "Street Sweeper", "Idle Citizen", "Gate Watch"
        };

        /// <summary>
        /// After CompileStreetscapeLean (+ crown roads). Idempotent on hub-* ids (Upsert).
        /// </summary>
        public static int SeedAfterStreetscape(WorldId world)
        {
            if (world != WorldId.Hub) return 0;
            if (!ConcordiaHost.LeanPlay) return 0;

            StreamNpcSim.LeanFullBodyCapOverride = LeanFullBodyCap;

            var homes = new List<(string prefix, Vector3 pos, float yaw)>(48);
            CollectDistrictHomes("market_district", "hub-mkt", 14, homes);
            CollectDistrictHomes("archive_quarter", "hub-arc", 12, homes);
            CollectDistrictHomes("council_chamber", "hub-cnc", 4, homes);
            CollectDistrictHomes("warden_ring_wall", "hub-wdn", 4, homes);

            if (homes.Count == 0)
                FallbackHomes(homes);

            int cap = Mathf.Min(LeanSimCap, Mathf.Max(12, homes.Count));
            int seeded = 0;
            for (int i = 0; i < homes.Count && seeded < cap; i++)
            {
                var h = homes[i];
                var id = h.prefix + "-" + (seeded + 1).ToString("00");
                var job = JobMix[seeded % JobMix.Length];
                var name = DisplayNames[seeded % DisplayNames.Length] + " " + (seeded + 1);
                var existed = StreamNpcSim.TryGet(id, out var prior);
                var rec = StreamNpcSim.Upsert(id, name, h.pos, h.yaw, job, world);
                // Idempotent re-seed: never orphan a live/husk body on CityTown re-entry.
                if (!existed || prior == null || !prior.Body)
                {
                    rec.Home = h.pos;
                    rec.Pos = h.pos;
                    rec.Band = StreamLodBand.Simulation;
                    rec.Body = null;
                }
                else
                {
                    rec.Home = h.pos;
                    // Keep Pos/Band/Body from the live streaming path.
                }
                seeded++;
            }

            int live = StreamNpcSim.CountLiveFullBodies();
            Debug.Log("[Concordia] LeanPlay: DataNpcSeed Hub sim=" + seeded
                      + " live=" + live + " capFull=" + LeanFullBodyCap
                      + " (market+archive+light council/warden)");
            return seeded;
        }

        static void CollectDistrictHomes(string districtId, string prefix, int max,
                                         List<(string prefix, Vector3 pos, float yaw)> homes)
        {
            var dist = FindDistrict(districtId);
            if (!dist) return;

            var lots = dist.Find("Lots");
            var builds = dist.Find("Buildings");
            var streets = dist.Find("Streets");
            int n = 0;

            if (lots)
            {
                foreach (Transform lot in lots)
                {
                    if (!lot || n >= max) break;
                    if (!lot.name.StartsWith("Lot_", System.StringComparison.Ordinal)) continue;
                    // Prefer the street side of the lot (toward district origin / Court), not behind the shell.
                    var towardStreet = -lot.forward;
                    var distOrigin = dist.position;
                    var toOrigin = distOrigin - lot.position;
                    toOrigin.y = 0f;
                    if (toOrigin.sqrMagnitude > 0.01f) towardStreet = toOrigin.normalized;
                    float yaw = Mathf.Atan2(towardStreet.x, towardStreet.z) * Mathf.Rad2Deg;
                    var pos = lot.position + towardStreet * 2.4f
                              + Vector3.Cross(Vector3.up, towardStreet).normalized * ((n % 3) - 1) * 1.1f;
                    pos.y = 0f;
                    homes.Add((prefix, pos, yaw));
                    n++;
                }
            }

            if (n < max && streets && streets.childCount > 0)
            {
                // Prefer standing ON the street ribbon — activity density for stills / near ring.
                foreach (Transform band in streets)
                {
                    if (!band || n >= max) break;
                    var side = band.right;
                    var pos = band.position + side * ((n % 2 == 0) ? 1.35f : -1.35f)
                              + band.forward * ((n % 5) - 2) * 1.6f;
                    pos.y = 0f;
                    homes.Add((prefix, pos, band.eulerAngles.y + (n % 2 == 0 ? 90f : -90f)));
                    n++;
                }
            }

            if (n < max && builds)
            {
                foreach (Transform b in builds)
                {
                    if (!b || n >= max) break;
                    if (!b.name.StartsWith("LeanBuilding_", System.StringComparison.Ordinal)) continue;
                    var toward = dist.position - b.position;
                    toward.y = 0f;
                    if (toward.sqrMagnitude < 0.01f) toward = -b.forward;
                    toward.Normalize();
                    var pos = b.position + toward * 3.2f
                              + Vector3.Cross(Vector3.up, toward).normalized * ((n % 3) - 1) * 1.2f;
                    pos.y = 0f;
                    homes.Add((prefix, pos, Mathf.Atan2(toward.x, toward.z) * Mathf.Rad2Deg));
                    n++;
                }
            }
        }

        static Transform FindDistrict(string districtId)
        {
            if (string.IsNullOrEmpty(districtId)) return null;
            var want = "District_" + districtId;
            foreach (var t in Object.FindObjectsByType<Transform>(FindObjectsInactive.Exclude))
            {
                if (!t || t.name != want) continue;
                var p = t.parent;
                while (p)
                {
                    if (p.name != null && p.name.StartsWith("SettlementStreetscape_", System.StringComparison.Ordinal))
                        return t;
                    p = p.parent;
                }
            }
            foreach (var t in Object.FindObjectsByType<Transform>(FindObjectsInactive.Exclude))
                if (t && t.name == want) return t;
            return null;
        }

        static void FallbackHomes(List<(string prefix, Vector3 pos, float yaw)> homes)
        {
            // Atlas bearings match SettlementCompiler.TryHubDistrictOrigin (ring ~50–52).
            SeedRing("hub-mkt", new Vector3(Mathf.Cos(-Mathf.PI * 0.18f) * 52f, 0f,
                Mathf.Sin(-Mathf.PI * 0.18f) * 52f), 10, homes);
            SeedRing("hub-arc", new Vector3(0f, 0f, -50f), 8, homes);
            SeedRing("hub-cnc", new Vector3(0f, 0f, 48f), 3, homes);
            SeedRing("hub-wdn", new Vector3(Mathf.Cos(Mathf.PI * 0.12f) * 46f, 0f,
                Mathf.Sin(Mathf.PI * 0.12f) * 46f), 3, homes);
            Debug.LogWarning("[Concordia] DataNpcSeed: no lean lots found — using district-origin fallbacks");
        }

        static void SeedRing(string prefix, Vector3 center, int count,
                             List<(string prefix, Vector3 pos, float yaw)> homes)
        {
            for (int i = 0; i < count; i++)
            {
                float a = i * 0.85f;
                var pos = center + new Vector3(Mathf.Cos(a) * 3.2f, 0f, Mathf.Sin(a) * 3.2f);
                homes.Add((prefix, pos, a * Mathf.Rad2Deg));
            }
        }
    }
}
