using System.Collections.Generic;
using UnityEngine;

namespace Concordia.Settlement
{
    /// <summary>
    /// Deterministic hashing for world layout.
    ///
    /// NOT string.GetHashCode: .NET randomises string hash seeds per process, so a city laid
    /// out with it would rebuild differently on every launch. Law 4 of the megaworld doc says
    /// regenerating the same town differently on each visit IS the bug. FNV-1a is stable
    /// across runs, platforms and Unity versions.
    /// </summary>
    public static class Det
    {
        public static int Hash(string s)
        {
            if (string.IsNullOrEmpty(s)) return 0;
            unchecked
            {
                uint h = 2166136261u;
                foreach (var c in s) { h ^= c; h *= 16777619u; }
                return (int)(h & 0x7FFFFFFF);
            }
        }

        public static int Hash(string a, int b) => Hash(a + "#" + b);
        public static int Hash(string a, string b) => Hash(a + "#" + b);

        /// Stable 0..1 from a hash, for ratios that must not drift between sessions.
        public static float Unit(int hash) => ((hash & 0xFFFF) / 65535f);
    }

    /// One buildable parcel with a street frontage.
    public struct Plot
    {
        public Vector2 Centre;      // local XZ, settlement space
        public float Yaw;           // degrees; the facade's outward normal faces the street
        public float Frontage;      // metres along the street
        public float Depth;         // metres back from the street
        public int Storeys;
        public string DistrictId;
        public string Purpose;      // kernel building_type where known, else the district tag
        public int Seed;            // stable per-plot; drives every module choice
    }

    public struct StreetSeg
    {
        public Vector2 A, B;
        public float Width;
        public bool Arterial;
    }

    /// <summary>
    /// Turns a settlement into streets and buildable plots.
    ///
    /// This is the tier that genuinely did not exist: before this, every city in every world
    /// used one hardcoded 10-element Vector3[] of building positions (RealmFill.cs:554), so
    /// population, wealth and faction changed nothing about the shape of a place.
    ///
    /// The layout is a block grid oriented to the settlement's approach bearing, which is
    /// what makes a street read as a street — parallel frontages facing each other across a
    /// carriageway, rather than props scattered on a disc. Blocks subdivide into plots along
    /// their street-facing edges; interiors stay empty (that is where yards and alleys go).
    ///
    /// Everything is seeded from stable ids, never Random, so the same world state rebuilds
    /// the same city.
    /// </summary>
    public static class PlotPlanner
    {
        public const float StreetWidth = 7.5f;
        public const float AlleyWidth = 4.0f;

        /// Plot frontages snap to the kit's 3m bay so facades tile without a remainder gap.
        public const float BayMeters = 3.0f;

        public sealed class Result
        {
            public readonly List<StreetSeg> Streets = new List<StreetSeg>(32);
            public readonly List<Plot> Plots = new List<Plot>(64);
        }

        /// <summary>
        /// Plan one district.
        /// `extent` is the half-size of the buildable square, metres.
        /// `keepOut` rejects a candidate plot centre (the Court disc, the Sundering walk, an
        /// existing landmark) — return true to refuse the parcel.
        /// </summary>
        public static Result Plan(string settlementId, string districtId, Vector2 origin,
                                  float extent, float bearingDeg, int density,
                                  System.Func<Vector2, bool> keepOut = null)
        {
            var res = new Result();
            if (extent < 12f) return res;

            var seed = Det.Hash(settlementId, districtId);

            // Denser settlements get smaller blocks — this is the single dial that makes a
            // capital read differently from a hamlet, and it comes from real population.
            var blockW = Mathf.Lerp(34f, 19f, Mathf.Clamp01(density / 100f));
            var blockD = Mathf.Lerp(26f, 15f, Mathf.Clamp01(density / 100f));

            var rot = Quaternion.Euler(0f, bearingDeg, 0f);
            var cols = Mathf.Max(1, Mathf.FloorToInt((extent * 2f) / (blockW + StreetWidth)));
            var rows = Mathf.Max(1, Mathf.FloorToInt((extent * 2f) / (blockD + StreetWidth)));

            var spanX = cols * blockW + (cols - 1) * StreetWidth;
            var spanZ = rows * blockD + (rows - 1) * StreetWidth;

            for (int cx = 0; cx < cols; cx++)
            for (int cz = 0; cz < rows; cz++)
            {
                var localX = -spanX * 0.5f + cx * (blockW + StreetWidth) + blockW * 0.5f;
                var localZ = -spanZ * 0.5f + cz * (blockD + StreetWidth) + blockD * 0.5f;
                var blockSeed = Det.Hash(settlementId + ":" + districtId + ":" + cx + "," + cz);

                // Leave a hole for a square wherever the grid would otherwise be relentless.
                // One in nine blocks, chosen deterministically — a town needs somewhere to
                // stand as much as it needs frontage.
                if ((blockSeed % 9) == 0 && cols > 1 && rows > 1) continue;

                var blockCentreWorld = origin + Planar(rot * new Vector3(localX, 0f, localZ));
                if (keepOut != null && keepOut(blockCentreWorld)) continue;

                EmitBlock(res, settlementId, districtId, blockCentreWorld, blockW, blockD,
                          bearingDeg, density, blockSeed, keepOut);
            }

            EmitStreets(res, origin, rot, spanX, spanZ, cols, rows, blockW, blockD);
            return res;
        }

        static Vector2 Planar(Vector3 v) => new Vector2(v.x, v.z);

        /// <summary>
        /// Subdivide a block's two long street-facing edges into plots. The short edges stay
        /// blank — corner returns are handled by the facade's own corner modules, and filling
        /// all four sides produces rings of back-to-back buildings with no yards.
        /// </summary>
        static void EmitBlock(Result res, string settlementId, string districtId, Vector2 centre,
                              float blockW, float blockD, float bearingDeg, int density, int blockSeed,
                              System.Func<Vector2, bool> keepOut)
        {
            var rot = Quaternion.Euler(0f, bearingDeg, 0f);
            var depth = Mathf.Min(blockD * 0.42f, 11f);

            for (int side = 0; side < 2; side++)
            {
                // side 0 faces -Z (its own street), side 1 faces +Z.
                var facingZ = side == 0 ? -1f : 1f;
                var edgeZ = facingZ * blockD * 0.5f;
                var yaw = bearingDeg + (side == 0 ? 180f : 0f);

                var used = 0f;
                var idx = 0;
                while (used < blockW - BayMeters * 0.5f)
                {
                    var plotSeed = Det.Hash(settlementId + ":" + districtId + ":" + blockSeed + ":" + side + ":" + idx);

                    // 2-5 bays of frontage, deterministic. Varying width along one street is
                    // most of what stops a row reading as one extruded box.
                    var bays = 2 + (plotSeed % 4);
                    var frontage = bays * BayMeters;
                    if (used + frontage > blockW) frontage = Mathf.Floor((blockW - used) / BayMeters) * BayMeters;
                    if (frontage < BayMeters) break;

                    var alongLocal = -blockW * 0.5f + used + frontage * 0.5f;
                    var localCentre = new Vector3(alongLocal, 0f, edgeZ - facingZ * depth * 0.5f);
                    var world = centre + Planar(rot * localCentre);

                    if (keepOut == null || !keepOut(world))
                    {
                        res.Plots.Add(new Plot
                        {
                            Centre = world,
                            Yaw = yaw,
                            Frontage = frontage,
                            Depth = depth,
                            Storeys = StoreysFor(density, plotSeed),
                            DistrictId = districtId,
                            Purpose = null,
                            Seed = plotSeed
                        });
                    }

                    used += frontage;
                    idx++;
                }
            }
        }

        /// <summary>
        /// Height from density, with a deterministic wobble. A skyline needs variance or the
        /// whole block reads as one mass; it also needs a floor, or the town has no presence
        /// on the horizon at all.
        /// </summary>
        static int StoreysFor(int density, int seed)
        {
            var baseline = Mathf.RoundToInt(Mathf.Lerp(2f, 5f, Mathf.Clamp01(density / 120f)));
            var wobble = (seed >> 3) % 3 - 1;          // -1, 0, +1
            return Mathf.Clamp(baseline + wobble, 1, 8);
        }

        static void EmitStreets(Result res, Vector2 origin, Quaternion rot, float spanX, float spanZ,
                                int cols, int rows, float blockW, float blockD)
        {
            // Carriageways run between block rows/columns, plus a bounding pair so the outer
            // frontages face a street rather than open ground.
            for (int cz = 0; cz <= rows; cz++)
            {
                var z = -spanZ * 0.5f + cz * (blockD + StreetWidth) - StreetWidth * 0.5f;
                if (cz == 0) z = -spanZ * 0.5f - StreetWidth * 0.5f;
                if (cz == rows) z = spanZ * 0.5f + StreetWidth * 0.5f;
                res.Streets.Add(new StreetSeg
                {
                    A = origin + Planar(rot * new Vector3(-spanX * 0.5f - StreetWidth, 0f, z)),
                    B = origin + Planar(rot * new Vector3(spanX * 0.5f + StreetWidth, 0f, z)),
                    Width = StreetWidth,
                    Arterial = cz == rows / 2
                });
            }
            for (int cx = 0; cx <= cols; cx++)
            {
                var x = -spanX * 0.5f + cx * (blockW + StreetWidth) - StreetWidth * 0.5f;
                if (cx == 0) x = -spanX * 0.5f - StreetWidth * 0.5f;
                if (cx == cols) x = spanX * 0.5f + StreetWidth * 0.5f;
                res.Streets.Add(new StreetSeg
                {
                    A = origin + Planar(rot * new Vector3(x, 0f, -spanZ * 0.5f - StreetWidth)),
                    B = origin + Planar(rot * new Vector3(x, 0f, spanZ * 0.5f + StreetWidth)),
                    Width = cx == cols / 2 ? StreetWidth : AlleyWidth,
                    Arterial = cx == cols / 2
                });
            }
        }
    }
}
