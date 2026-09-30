using System.Collections.Generic;
using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// SLICE 7 REWORK — Native wilderness OUTSIDE Hub metro / approach landmarks.
    /// Geography: Court keep-out → metro (light verge only) → true wild band
    /// past Pinewood / Broken Spire / Upper Grove / Three Refusals toward Present ring.
    /// No mega FarPad / Lit slabs. Trees are real store/Nature meshes (null-mesh
    /// Concordia_Real_* rejected). Wildlife via WildernessWildlife data≠GO.
    /// </summary>
    public static class HubWilderness
    {
        public const string RootName = "HubWilderness";
        /// <summary>Court keep-out — matches RealmFill Hub streetscape gate.</summary>
        public const float KeepOutM = 40f;
        /// <summary>Past approach stubs (~68–80m). Inside = verge only, NOT wilderness fill.</summary>
        public const float MetroOuterM = 92f;
        /// <summary>True wilderness starts here — beyond approach landmark masses.</summary>
        public const float WildInnerM = 98f;
        /// <summary>Outer wild band toward Canon Ring / Present (~220m).</summary>
        public const float WildOuterM = 168f;

        /// <summary>
        /// Concordia_Real_* are indexed but ship null LOD meshes — try then reject.
        /// island_tree_* include rocky island bases that read as floating slabs in stills —
        /// prefer jacaranda / Kenney Nature trees for upright trunk+canopy without pad.
        /// </summary>
        static readonly string[] TreePrefer =
        {
            "Concordia_Real_ForestTree", "Concordia_Real_Oak",
            "jacaranda_tree_1k", "tree_fat_darkh", "tree_detailed_dark", "tree_oak", "tree_fat",
            "island_tree_02_1k", "island_tree_03_1k"
        };

        static readonly string[] GrassPrefer =
        {
            "Concordia_Real_ForestGrass", "fern_02_1k",
            "grass_leafsLarge", "grass_large", "grass_leafs", "grass"
        };

        public sealed class Stats
        {
            public int Trees, Grass, PathSegs, Clusters, VergeTrees, FaunaSeed;
            public int Wedges;
            public bool Ok => Trees >= 24 && Clusters >= 4 && Wedges >= 3;
            public override string ToString() =>
                $"wedges={Wedges} clusters={Clusters} trees={Trees} verge={VergeTrees}"
                + $" grass={Grass} paths={PathSegs} faunaSeed={FaunaSeed}";
        }

        /// <summary>Idempotent ensure. Pass force=true to destroy + rebuild (stills / fixups).</summary>
        public static Stats Ensure(Transform continent, bool force = false)
        {
            var stats = new Stats();
            if (!continent) return stats;

            var existing = continent.Find(RootName);
            if (existing && force)
            {
#if UNITY_EDITOR
                Object.DestroyImmediate(existing.gameObject);
#else
                Object.Destroy(existing.gameObject);
#endif
                existing = null;
                WildernessWildlife.Clear();
            }
            if (existing)
            {
                SoftenContinentGround();
                stats.Wedges = 4;
                stats.Trees = CountPrefixed(existing, "HubWildTree_");
                stats.VergeTrees = CountPrefixed(existing, "HubWildVerge_");
                stats.Grass = CountPrefixed(existing, "HubWildGrass_");
                stats.PathSegs = CountPrefixed(existing, "HubWildPath_");
                stats.Clusters = CountPrefixed(existing, "HubWildCluster_");
                stats.FaunaSeed = WildernessWildlife.SeedCount;
                return stats;
            }

            var hold = new GameObject(RootName).transform;
            hold.SetParent(continent, false);
            hold.localPosition = Vector3.zero;

            SoftenContinentGround();
            StripGreySphereHills(WildOuterM + 8f);
            // Kill any leftover HubWildGround_* teal patches from earlier rework attempts.
            foreach (var t in Object.FindObjectsByType<Transform>(FindObjectsInactive.Include))
            {
                if (t && t.name != null && t.name.StartsWith("HubWildGround_", System.StringComparison.Ordinal))
                {
                    if (Application.isPlaying) Object.Destroy(t.gameObject);
                    else Object.DestroyImmediate(t.gameObject);
                }
            }

            var earth = HubLook.Lit(new Color(0.48f, 0.38f, 0.26f), 0.03f, 0.16f)
                        ?? HubLook.Pbr("packed_earth", new Color(0.44f, 0.36f, 0.26f), 0.04f, 0.40f, 10f);
            var salt = HubLook.Lit(new Color(0.55f, 0.48f, 0.36f), 0.03f, 0.15f) ?? earth;
            var ash = HubLook.Lit(new Color(0.40f, 0.36f, 0.32f), 0.04f, 0.14f) ?? earth;

            var spokes = CollectSpokeAngles();
            if (spokes.Length < 2)
            {
                Debug.LogWarning("[Concordia] HubWilderness: fewer than 2 Hub stubs — skip wild band");
                Debug.Log("[Concordia] HubWilderness Ensure " + stats + (force ? " (force)" : ""));
                return stats;
            }

            stats.Wedges = spokes.Length;
            var faunaSites = new List<Vector3>(48);

            // Thin dirt/path ribbons along spokes (metro + out past approaches) — NOT mega pads.
            foreach (var s in spokes)
            {
                var theme = ThemeForSpoke(s.id);
                PlacePathRibbon(hold, s.ang, theme, earth, salt, ash, stats);
                PlaceSparseVerge(hold, s.ang, theme, stats);
                // Spoke wild belt PAST the approach landmark — so looking out the Crown Road
                // sees real canopy, not empty corridor into a Present FarPad.
                PlaceSpokeWildBelt(hold, s, theme, stats, faunaSites);
            }

            // True wilderness: clusters BEYOND approach landmarks (inter-spoke wedges).
            for (int i = 0; i < spokes.Length; i++)
            {
                var a = spokes[i];
                var b = spokes[(i + 1) % spokes.Length];
                float mid = MidAngle(a.ang, b.ang);
                float span = AngleSpan(a.ang, b.ang);
                if (span < 18f * Mathf.Deg2Rad) continue;
                var theme = ThemeForWedge(a.id, b.id, mid);
                PlaceWildCluster(hold, mid, span, theme, stats, faunaSites);
                // Second cluster offset toward spoke A for canopy depth.
                float mid2 = MidAngle(a.ang, mid);
                PlaceWildCluster(hold, mid2, span * 0.55f, ThemeForSpoke(a.id), stats, faunaSites);
            }

            stats.FaunaSeed = WildernessWildlife.Seed(faunaSites);
            Debug.Log("[Concordia] HubWilderness Ensure " + stats
                      + " wild=[" + WildInnerM + "," + WildOuterM + "]"
                      + (force ? " (force)" : ""));
            Debug.Log("[Concordia] WildernessWildlife seed=" + WildernessWildlife.SeedCount
                      + " live=" + WildernessWildlife.LiveCount);
            return stats;
        }

        struct Spoke
        {
            public string id;
            public float ang;
            public Vector2 pos;
            public float radius;
        }

        enum WildTheme : byte
        {
            Plains, Forest, SaltRoad, WreckScar, Roadhouse
        }

        static Spoke[] CollectSpokeAngles()
        {
            var list = new List<Spoke>(4);
            foreach (var city in CityAtlas.For(WorldId.Hub))
            {
                if (city == null) continue;
                if (!string.Equals(city.status, "stub", System.StringComparison.OrdinalIgnoreCase))
                    continue;
                if (string.IsNullOrEmpty(city.id)) continue;
                var pos = new Vector2(city.x, city.z);
                if (pos.sqrMagnitude < 1f) continue;
                list.Add(new Spoke
                {
                    id = city.id,
                    ang = Mathf.Atan2(pos.y, pos.x),
                    pos = pos,
                    radius = pos.magnitude
                });
            }
            list.Sort((u, v) => u.ang.CompareTo(v.ang));
            return list.ToArray();
        }

        static float MidAngle(float a, float b)
        {
            float span = AngleSpan(a, b);
            return Mathf.Repeat(a + span * 0.5f + Mathf.PI, Mathf.PI * 2f) - Mathf.PI;
        }

        static float AngleSpan(float a, float b)
        {
            float d = b - a;
            while (d < 0f) d += Mathf.PI * 2f;
            while (d >= Mathf.PI * 2f) d -= Mathf.PI * 2f;
            return d;
        }

        static WildTheme ThemeForSpoke(string id)
        {
            var k = (id ?? "").ToLowerInvariant();
            if (k.Contains("grove")) return WildTheme.Forest;
            if (k.Contains("pinewood") || k.Contains("crossing")) return WildTheme.SaltRoad;
            if (k.Contains("spire") || k.Contains("broken")) return WildTheme.WreckScar;
            if (k.Contains("tavern") || k.Contains("refusals")) return WildTheme.Roadhouse;
            return WildTheme.Plains;
        }

        static WildTheme ThemeForWedge(string idA, string idB, float midAng)
        {
            var ta = ThemeForSpoke(idA);
            var tb = ThemeForSpoke(idB);
            if (ta == WildTheme.Forest || tb == WildTheme.Forest) return WildTheme.Forest;
            if (ta == WildTheme.WreckScar || tb == WildTheme.WreckScar) return WildTheme.WreckScar;
            if (ta == WildTheme.SaltRoad || tb == WildTheme.SaltRoad) return WildTheme.SaltRoad;
            if (ta == WildTheme.Roadhouse || tb == WildTheme.Roadhouse) return WildTheme.Roadhouse;
            float deg = midAng * Mathf.Rad2Deg;
            if (deg > 50f && deg < 120f) return WildTheme.WreckScar;
            if (deg > 120f || deg < -150f) return WildTheme.Forest;
            if (deg > -50f && deg < 30f) return WildTheme.SaltRoad;
            if (deg < -50f && deg > -150f) return WildTheme.Roadhouse;
            return WildTheme.Plains;
        }

        /// <summary>
        /// Light verge trees inside metro (outside Court, before approach outer).
        /// Sparse only — not wilderness fill, not mega pads.
        /// </summary>
        static void PlaceSparseVerge(Transform hold, float ang, WildTheme theme, Stats stats)
        {
            int n = ConcordiaHost.LeanPlay ? 2 : 3;
            for (int i = 0; i < n; i++)
            {
                float t = (i + 0.55f) / n;
                float dist = Mathf.Lerp(KeepOutM + 8f, MetroOuterM - 6f, t);
                float side = ((i % 2 == 0) ? 1f : -1f) * (5.5f + (i % 3) * 1.2f);
                var sideDir = new Vector3(-Mathf.Sin(ang), 0f, Mathf.Cos(ang));
                var at = new Vector3(Mathf.Cos(ang) * dist, 0f, Mathf.Sin(ang) * dist) + sideDir * side;
                if (Canon.BlocksSunderingWalk(at, 2.5f)) continue;
                if (NearCrownRoad(at, 3.5f)) continue;
                float h = 5.5f + (i % 2) * 0.8f;
                var go = SpawnNativeTree(hold, at, i * 29f, h);
                if (!go) continue;
                go.name = "HubWildVerge_" + ThemeTag(theme) + "_" + stats.VergeTrees;
                stats.VergeTrees++;
            }
        }

        /// <summary>
        /// Trees past a named approach stub along its Crown Road bearing — fills the
        /// "look out past Pinewood" corridor that otherwise reads as blue FarPad void.
        /// </summary>
        static void PlaceSpokeWildBelt(Transform hold, Spoke spoke, WildTheme theme,
            Stats stats, List<Vector3> faunaSites)
        {
            var cluster = new GameObject("HubWildCluster_belt_" + ThemeTag(theme) + "_" + stats.Clusters).transform;
            cluster.SetParent(hold, false);
            stats.Clusters++;

            float start = Mathf.Max(WildInnerM, spoke.radius + 14f);
            float end = WildOuterM - 6f;
            if (end <= start + 8f) return;

            int treeBudget = ConcordiaHost.LeanPlay ? 6 : 9;
            int grassBudget = ConcordiaHost.LeanPlay ? 3 : 5;
            var side = new Vector3(-Mathf.Sin(spoke.ang), 0f, Mathf.Cos(spoke.ang));

            for (int i = 0; i < treeBudget; i++)
            {
                float t = (i + 0.3f) / Mathf.Max(1, treeBudget);
                float dist = Mathf.Lerp(start, end, t);
                float sideOff = ((i % 2 == 0) ? 1f : -1f) * (4.5f + (i % 4) * 2.1f);
                sideOff += ((i * 0.37f) % 1f - 0.5f) * 2.5f;
                var at = new Vector3(Mathf.Cos(spoke.ang) * dist, 0f, Mathf.Sin(spoke.ang) * dist)
                         + side * sideOff;
                if (Canon.BlocksSunderingWalk(at, 3f)) continue;
                float h = theme == WildTheme.Forest
                    ? (7.4f + (i % 3) * 0.9f)
                    : (6.6f + (i % 3) * 0.75f);
                var go = SpawnNativeTree(cluster, at, i * 33f + spoke.id.GetHashCode() * 0.01f, h);
                if (!go) continue;
                go.name = "HubWildTree_belt_" + ThemeTag(theme) + "_" + stats.Trees;
                stats.Trees++;
                faunaSites.Add(at);
            }

            for (int i = 0; i < grassBudget; i++)
            {
                float t = (i + 0.45f) / Mathf.Max(1, grassBudget);
                float dist = Mathf.Lerp(start + 4f, end - 8f, t);
                float sideOff = ((i % 2 == 0) ? 1f : -1f) * (3.2f + i * 1.4f);
                var at = new Vector3(Mathf.Cos(spoke.ang) * dist, 0f, Mathf.Sin(spoke.ang) * dist)
                         + side * sideOff;
                if (Canon.BlocksSunderingWalk(at, 1.5f)) continue;
                var go = SpawnNativeGrass(cluster, at, i * 19f);
                if (!go) continue;
                go.name = "HubWildGrass_belt_" + ThemeTag(theme) + "_" + stats.Grass;
                stats.Grass++;
            }
        }

        static void PlaceWildCluster(Transform hold, float midAng, float span,
            WildTheme theme, Stats stats, List<Vector3> faunaSites)
        {
            var cluster = new GameObject("HubWildCluster_" + ThemeTag(theme) + "_" + stats.Clusters).transform;
            cluster.SetParent(hold, false);
            stats.Clusters++;

            int treeBudget = theme == WildTheme.Forest
                ? (ConcordiaHost.LeanPlay ? 7 : 10)
                : (ConcordiaHost.LeanPlay ? 5 : 7);
            int grassBudget = ConcordiaHost.LeanPlay ? 4 : 6;

            // Two radial rings in the wild band.
            for (int i = 0; i < treeBudget; i++)
            {
                float t = (i + 0.35f) / Mathf.Max(1, treeBudget);
                float dist = Mathf.Lerp(WildInnerM + 2f, WildOuterM - 10f, t);
                // Spacing variety — avoid parade-line spacing.
                float angOff = ((i * 0.618034f) % 1f - 0.5f) * span * 0.55f;
                angOff += ((i * 0.31f) % 1f - 0.5f) * 0.12f;
                float ang = midAng + angOff;
                var at = new Vector3(Mathf.Cos(ang) * dist, 0f, Mathf.Sin(ang) * dist);
                if (Canon.BlocksSunderingWalk(at, 3f)) continue;
                if (NearCrownRoad(at, 5f)) continue;
                // Keep clear of approach stub masses (~68–80m already outside WildInner).
                float h = theme == WildTheme.Forest
                    ? (7.2f + (i % 4) * 0.85f)
                    : (6.4f + (i % 3) * 0.7f);
                var go = SpawnNativeTree(cluster, at, i * 41f + stats.Trees * 13f, h);
                if (!go) continue;
                go.name = "HubWildTree_" + ThemeTag(theme) + "_" + stats.Trees;
                stats.Trees++;
                faunaSites.Add(at);
            }

            for (int i = 0; i < grassBudget; i++)
            {
                float t = (i + 0.4f) / Mathf.Max(1, grassBudget);
                float dist = Mathf.Lerp(WildInnerM + 4f, WildOuterM - 16f, t);
                float angOff = ((i * 0.47f) % 1f - 0.5f) * span * 0.4f;
                float ang = midAng + angOff;
                var at = new Vector3(Mathf.Cos(ang) * dist, 0f, Mathf.Sin(ang) * dist);
                if (Canon.BlocksSunderingWalk(at, 1.5f)) continue;
                if (NearCrownRoad(at, 4f)) continue;
                var go = SpawnNativeGrass(cluster, at, i * 23f);
                if (!go) continue;
                go.name = "HubWildGrass_" + ThemeTag(theme) + "_" + stats.Grass;
                stats.Grass++;
            }
        }

        static GameObject SpawnNativeTree(Transform parent, Vector3 at, float yawDeg, float height)
        {
            for (int i = 0; i < TreePrefer.Length; i++)
            {
                var stem = TreePrefer[i];
                GameObject go = null;
                if (FreePacks.HasStoreStem(stem))
                    go = FreePacks.SpawnStore(stem, parent, at, yawDeg, 0f, required: false, byHeight: false);
                if (!go && FreePacks.HasStem(stem))
                    go = FreePacks.Spawn(stem, parent, at, yawDeg, 0f, required: false);
                if (!go) continue;
                if (!HasRenderableMesh(go))
                {
                    // Concordia_Real_* null-LOD junk — reject, try next stem.
                    if (Application.isPlaying) Object.Destroy(go);
                    else Object.DestroyImmediate(go);
                    continue;
                }
                // Force upright world Y — some Nature FBX import with tilted roots.
                go.transform.rotation = Quaternion.Euler(0f, yawDeg, 0f);
                go.transform.localScale = Vector3.one;
                FreePacks.FitHeight(go, height);
                go.transform.rotation = Quaternion.Euler(0f, yawDeg, 0f);
                FreePacks.Sit(go, at);
                // Soft canopy cap without a second FitMax pass that can re-float Sit.
                var b = default(Bounds);
                bool any = false;
                foreach (var r in go.GetComponentsInChildren<Renderer>(true))
                {
                    if (!r || !r.enabled) continue;
                    if (!any) { b = r.bounds; any = true; }
                    else b.Encapsulate(r.bounds);
                }
                if (any && b.size.y > 18f)
                {
                    float s = 16f / b.size.y;
                    go.transform.localScale *= s;
                    go.transform.rotation = Quaternion.Euler(0f, yawDeg, 0f);
                    FreePacks.Sit(go, at);
                }
                return go;
            }
            return null;
        }

        static GameObject SpawnNativeGrass(Transform parent, Vector3 at, float yawDeg)
        {
            for (int i = 0; i < GrassPrefer.Length; i++)
            {
                var stem = GrassPrefer[i];
                GameObject go = null;
                float h = FreePacks.HumanHeight(stem);
                if (h < 0.05f) h = stem.Contains("fern") ? 0.55f : 0.45f;
                if (FreePacks.HasStoreStem(stem))
                    go = FreePacks.SpawnStore(stem, parent, at, yawDeg, h, required: false, byHeight: true);
                if (!go && FreePacks.HasStem(stem))
                    go = FreePacks.Spawn(stem, parent, at, yawDeg, h, required: false);
                if (!go) continue;
                if (!HasRenderableMesh(go))
                {
                    if (Application.isPlaying) Object.Destroy(go);
                    else Object.DestroyImmediate(go);
                    continue;
                }
                FreePacks.Sit(go, at);
                return go;
            }
            return null;
        }

        static bool HasRenderableMesh(GameObject go)
        {
            if (!go) return false;
            foreach (var mf in go.GetComponentsInChildren<MeshFilter>(true))
            {
                if (mf && mf.sharedMesh && mf.sharedMesh.vertexCount > 0)
                    return true;
            }
            foreach (var sm in go.GetComponentsInChildren<SkinnedMeshRenderer>(true))
            {
                if (sm && sm.sharedMesh && sm.sharedMesh.vertexCount > 0)
                    return true;
            }
            return false;
        }

        static void PlacePathRibbon(Transform hold, float ang, WildTheme theme,
            Material earth, Material salt, Material ash, Stats stats)
        {
            var mat = theme switch
            {
                WildTheme.SaltRoad => salt,
                WildTheme.WreckScar => ash,
                _ => earth
            };
            // Thin path only — starts after Court, runs past approaches into wild.
            float start = KeepOutM + 4f;
            float end = Mathf.Min(WildInnerM + 18f, 118f);
            int segs = ConcordiaHost.LeanPlay ? 3 : 4;
            var side = new Vector3(-Mathf.Sin(ang), 0f, Mathf.Cos(ang));
            float sideOff = theme == WildTheme.SaltRoad ? 7.5f : 6.2f;
            for (int s = 0; s < segs; s++)
            {
                float t0 = (float)s / segs;
                float t1 = (float)(s + 1) / segs;
                float d0 = Mathf.Lerp(start, end, t0);
                float d1 = Mathf.Lerp(start, end, t1);
                float mid = (d0 + d1) * 0.5f;
                float len = Mathf.Max(4f, d1 - d0);
                var at = new Vector3(Mathf.Cos(ang) * mid, 0.05f, Mathf.Sin(ang) * mid) + side * sideOff;
                if (Canon.BlocksSunderingWalk(at, 2.5f)) continue;
                // Path segment is a thin ribbon (~2.2m wide) — NOT a district slab.
                PlaceThinPath(hold, "HubWildPath_" + ThemeTag(theme) + "_" + stats.PathSegs,
                    at, new Vector3(2.2f, 0.05f, len * 0.92f), ang * Mathf.Rad2Deg, mat);
                stats.PathSegs++;
            }
        }

        static void PlaceThinPath(Transform hold, string name, Vector3 at, Vector3 scale, float yawDeg, Material mat)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
            go.name = name;
            go.transform.SetParent(hold, false);
            go.transform.position = at;
            go.transform.localScale = scale;
            go.transform.rotation = Quaternion.Euler(0f, yawDeg, 0f);
            Object.Destroy(go.GetComponent<Collider>());
            var box = go.AddComponent<BoxCollider>();
            box.size = Vector3.one;
            var rr = go.GetComponent<Renderer>();
            if (rr && mat) rr.sharedMaterial = mat;
        }

        static string ThemeTag(WildTheme t) => t switch
        {
            WildTheme.Forest => "grove",
            WildTheme.SaltRoad => "salt",
            WildTheme.WreckScar => "spire",
            WildTheme.Roadhouse => "tavern",
            _ => "plains"
        };

        static bool NearCrownRoad(Vector3 world, float thresh)
        {
            float t2 = thresh * thresh;
            foreach (var t in Object.FindObjectsByType<Transform>(FindObjectsSortMode.None))
            {
                if (!t || !t.gameObject.activeInHierarchy) continue;
                var n = t.name ?? "";
                if (!n.StartsWith("CrownRoad_", System.StringComparison.Ordinal)) continue;
                if (t.childCount == 0 && t.GetComponent<Renderer>() == null) continue;
                var p = t.position;
                var d = new Vector2(world.x - p.x, world.z - p.z);
                if (d.sqrMagnitude < t2) return true;
            }
            return false;
        }

        /// <summary>
        /// Small matte ground patches in the wild band only — fills sky holes without a
        /// district-scale FarPad disc over Court/metro.
        /// </summary>
        static void EnsureWildGroundPlane(Transform hold)
        {
            if (!hold) return;
            var earth = HubLook.Lit(new Color(0.32f, 0.40f, 0.24f), 0.01f, 0.06f)
                        ?? HubLook.Pbr("packed_earth", new Color(0.34f, 0.38f, 0.26f), 0.03f, 0.18f, 18f);
            int patches = ConcordiaHost.LeanPlay ? 10 : 14;
            for (int i = 0; i < patches; i++)
            {
                float a = (i / (float)patches) * Mathf.PI * 2f + 0.11f;
                float dist = Mathf.Lerp(WildInnerM + 6f, WildOuterM - 12f, 0.45f + (i % 3) * 0.18f);
                var at = new Vector3(Mathf.Cos(a) * dist, -0.01f, Mathf.Sin(a) * dist);
                if (Canon.BlocksSunderingWalk(at, 8f)) continue;
                // ~22m patch — closes void between tree clusters, not a metro carpet.
                float w = 20f + (i % 3) * 4f;
                var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
                go.name = "HubWildGround_" + i;
                go.transform.SetParent(hold, false);
                go.transform.position = at;
                go.transform.localScale = new Vector3(w, 0.04f, w);
                go.transform.rotation = Quaternion.Euler(0f, a * Mathf.Rad2Deg, 0f);
                Object.Destroy(go.GetComponent<Collider>());
                var box = go.AddComponent<BoxCollider>();
                box.size = Vector3.one;
                var rr = go.GetComponent<Renderer>();
                if (rr && earth) rr.sharedMaterial = earth;
            }
        }

        /// <summary>
        /// ContinentGround Plane often reads as reflective sky-blue under Hub lighting,
        /// or is missing entirely after plate cleanup — then hiding FarPads exposes void.
        /// Ensure a matte earth ground exists covering Court→wild band (not a district FarPad).
        /// </summary>
        static void SoftenContinentGround()
        {
            Transform cg = null;
            foreach (var t in Object.FindObjectsByType<Transform>(FindObjectsSortMode.None))
            {
                if (t && t.name == "ContinentGround") { cg = t; break; }
            }
            var earth = HubLook.Lit(new Color(0.34f, 0.42f, 0.26f), 0.015f, 0.08f)
                        ?? HubLook.Pbr("packed_earth", new Color(0.36f, 0.40f, 0.28f), 0.04f, 0.22f, 20f);
            if (!cg)
            {
                var mega = GameObject.Find("Megaworld");
                var parent = mega ? mega.transform : null;
                var go = GameObject.CreatePrimitive(PrimitiveType.Plane);
                go.name = "ContinentGround";
                if (parent) go.transform.SetParent(parent, false);
                // Unity Plane = 10m; scale 24 → 240m covers WildOuter (168) + Present approach.
                go.transform.localScale = new Vector3(24f, 1f, 24f);
                go.transform.position = Vector3.zero;
                Object.Destroy(go.GetComponent<Collider>());
                var box = go.AddComponent<BoxCollider>();
                box.size = new Vector3(10f, 0.05f, 10f);
                cg = go.transform;
                Debug.Log("[Concordia] HubWilderness recreated ContinentGround (was missing)");
            }
            var rr = cg.GetComponent<Renderer>();
            if (rr && earth)
            {
                rr.sharedMaterial = earth;
                rr.enabled = true;
                if (!cg.gameObject.activeSelf) cg.gameObject.SetActive(true);
            }
            // Also kill leftover HubWildPad_* mega slabs from Pass 1 if any linger.
            var wild = GameObject.Find(RootName);
            if (wild)
            {
                foreach (var t in wild.GetComponentsInChildren<Transform>(true))
                {
                    if (t && t.name != null && t.name.StartsWith("HubWildPad_", System.StringComparison.Ordinal))
                        t.gameObject.SetActive(false);
                }
            }
        }

        /// <summary>
        /// ContinentWilderness still plants Sphere/Cube Hill_* prims along gate roads —
        /// those read as grey-sphere "forests" in wilderness stills. Disable inside wild band.
        /// </summary>
        static void StripGreySphereHills(float maxR)
        {
            float r2 = maxR * maxR;
            var hold = GameObject.Find("ContinentWilderness");
            if (!hold) return;
            foreach (var t in hold.GetComponentsInChildren<Transform>(true))
            {
                if (!t) continue;
                var n = t.name ?? "";
                if (!n.StartsWith("Hill_", System.StringComparison.Ordinal)) continue;
                var p = t.position;
                if (p.x * p.x + p.z * p.z > r2) continue;
                // Only kill prim spheres/cubes — leave anything with real mesh children.
                var mf = t.GetComponent<MeshFilter>();
                if (!mf || !mf.sharedMesh) { t.gameObject.SetActive(false); continue; }
                var mn = mf.sharedMesh.name ?? "";
                if (mn.IndexOf("Sphere", System.StringComparison.OrdinalIgnoreCase) >= 0
                    || mn.IndexOf("Cube", System.StringComparison.OrdinalIgnoreCase) >= 0
                    || mn.IndexOf("Capsule", System.StringComparison.OrdinalIgnoreCase) >= 0)
                    t.gameObject.SetActive(false);
            }
        }

        static int CountPrefixed(Transform hold, string prefix)
        {
            int n = 0;
            foreach (var t in hold.GetComponentsInChildren<Transform>(true))
            {
                if (t && t.name != null && t.name.StartsWith(prefix, System.StringComparison.Ordinal))
                    n++;
            }
            return n;
        }

        public static bool IsHubWild(Transform t)
        {
            for (var p = t; p != null; p = p.parent)
            {
                var n = p.name ?? "";
                if (n == RootName || n.StartsWith("HubWild", System.StringComparison.Ordinal)
                    || n == "WildernessWildlifeHold")
                    return true;
            }
            return false;
        }

        /// <summary>Planar radius of approach stubs (for still framing / proof).</summary>
        public static float MaxApproachRadius()
        {
            float m = 0f;
            foreach (var s in CollectSpokeAngles())
                if (s.radius > m) m = s.radius;
            return m;
        }
    }
}
