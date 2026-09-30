// leanplay-forest-stamp 1789767851.141953
using UnityEngine;
using Concordia.GameplayCore.GoldenSlice;
using Concordia.Settlement;

namespace Concordia
{
    public class WorldBuilder : MonoBehaviour
    {
        public Transform root;
        public ConcordiaPlayer player;
        public bool HubStageComplete { get; private set; }

        /// <summary>
        /// The real per-world chunk root, as BuildChunk actually names it
        /// ("Chunk_&lt;world&gt;" under Megaworld — never "World"). PresentSkillPylons,
        /// ClearKernelLive and PlaceKernelBuilding used to call GameObject.Find("World"),
        /// which no object in the scene has ever been named; all three silently no-oped.
        /// </summary>
        public static Transform ChunkRootPublic(WorldId world) => ChunkRoot(world);

        public static Transform ChunkRoot(WorldId world)
        {
            var go = GameObject.Find("Chunk_" + world);
            return go ? go.transform : null;
        }

        static readonly string[] ForestTrees =
        {
            "tree_1"
        };
        static readonly string[] Flowers =
        {
            "grass01"
        };
        static readonly string[] Houses =
        {
            "building-type-a", "building-type-b", "building-type-c", "building-type-d",
            "building-type-e", "building-type-h", "building-type-k", "building-type-n",
            "building-small-a", "building-small-b", "building-small-c", "building-small-d"
        };
        static readonly string[] Shops =
        {
            "building-a", "building-c", "building-e", "building-g",
            "building-skyscraper-a", "building-skyscraper-c"
        };

        /// <summary>
        /// Boot only. Purges Megaworld then ContinentStream.Boot.
        /// Travel must never call this — it wiped the Hub Ring.
        /// </summary>
        public void Build(WorldId world)
        {
            HubStageComplete = false;
            PurgeWorldRoots();
            PurgeNamed("Megaworld");
            CityAtlas.Invalidate();
            FreePacks.Reindex();
            WorldStreamManager.Ensure(gameObject);
            var stream = ContinentStream.Bind(this);
            stream.Boot(world);
            HubLook.UpgradeStandardMaterials();
            try
            {
                System.IO.File.WriteAllText("/tmp/concordia-atlas.txt",
                    System.DateTime.Now.ToString("o") + " world=" + world
                    + " travel=" + ContinentStream.TravelMode + "\n" + CityAtlas.Dump());
            }
            catch { }
        }

        /// <summary>
        /// Build one civilization at local origin. ContinentStream then parks
        /// the chunk at MegaworldMap.Present(id). Do not purge other chunks.
        /// </summary>
        public Transform BuildChunk(WorldId world, Transform continent)
        {
            ModularPerson.CastingWorld = world;
            var holder = new GameObject("Chunk_" + world).transform;
            holder.SetParent(continent, false);
            holder.position = Vector3.zero;
            root = holder;
            var w = Canon.Get(world);
            if (world == WorldId.Hub) BuildHub();
            else
            {
                BuildGround(w);
                DressAudio(w);
                BuildRealm(w);
            }
            GeographyRuntime.BuildLocalSamples(holder, world);
            WorldVisualDirector.BuildChunk(holder, world);
            SpawnFauna(w);
            return holder;
        }

public System.Collections.IEnumerator BuildChunkStaged(WorldId world, Transform continent, System.Action<Transform> onComplete)
        {
            ModularPerson.CastingWorld = world;
            var holder = new GameObject("Chunk_" + world).transform;
            holder.SetParent(continent, false);
            holder.position = Vector3.zero;
            root = holder;
            var w = Canon.Get(world);

            // Hub readiness is a hard streaming contract. Commit the physical Court
            // immediately after BuildHubStaged; visual fidelity, fauna, and authored
            // detail continue in a separate coroutine and cannot strand BuildFull.
            if (world == WorldId.Hub)
            {
                yield return BuildHubStaged();
                onComplete?.Invoke(holder);
                StartCoroutine(FinishChunkPresentationStaged(holder, world, w));
                yield break;
            }

            // Presentation is allowed to degrade, but it must never strand the
            // streaming authority in Building. A single imported prop, authored
            // NPC, or visual pass exception must not prevent the chunk commit.
            try { BuildGround(w); }
            catch (System.Exception ex) { Debug.LogException(ex); }
            yield return null;
            try { DressAudio(w); }
            catch (System.Exception ex) { Debug.LogException(ex); }
            yield return null;
            yield return BuildRealmStaged(w);

            try { GeographyRuntime.BuildLocalSamples(holder, world); }
            catch (System.Exception ex) { Debug.LogException(ex); }
            yield return null;
            yield return WorldVisualDirector.BuildChunkStaged(holder, world);
            yield return null;
            try { SpawnFauna(w); }
            catch (System.Exception ex) { Debug.LogException(ex); }
            yield return null;
            onComplete?.Invoke(holder);
        }

System.Collections.IEnumerator FinishChunkPresentationStaged(Transform holder, WorldId world, WorldDef w)
        {
            if (!holder) yield break;
            try { GeographyRuntime.BuildLocalSamples(holder, world); }
            catch (System.Exception ex) { Debug.LogException(ex); }
            yield return null;

            System.Collections.IEnumerator visual = null;
            try { visual = WorldVisualDirector.BuildChunkStaged(holder, world); }
            catch (System.Exception ex) { Debug.LogException(ex); }
            if (visual != null) yield return visual;
            yield return null;

            try { SpawnFauna(w); }
            catch (System.Exception ex) { Debug.LogException(ex); }
            yield return null;
        }



        /// <summary>
        /// L0 far geography at MegaworldMap.Present — terrain pad + a few silhouette
        /// masses only. No NPCs, no streetscape, no BuildChunk. LeanPlay budget:
        /// tens of meshes max (pad + hills + ≤5 FreePacks stems).
        /// </summary>
        public Transform BuildImpostor(WorldId world, Transform continent)
        {
            var w = Canon.Get(world);
            var profile = WorldVisualProfileCatalog.For(world);
            var holder = new GameObject("FarGeography_" + world).transform;
            holder.SetParent(continent, false);
            holder.position = Vector3.zero;
            WorldVisualProfileCatalog.Stamp(holder, world);

            int meshBudget = 0;
            const int MeshCap = 14;

            // Ground pad — land mass readable at RingMeters (~220).
            meshBudget += PlaceFarPad(holder, world, profile);

            // Cheap terrain hills (Lit prims — geography, not debug markers).
            meshBudget += PlaceFarHills(holder, world, profile, MeshCap - meshBudget);

            // 2–5 silhouette masses from profile L0 stems + DressVocab fallbacks.
            meshBudget += PlaceFarSilhouettes(holder, world, profile, MeshCap - meshBudget);

            // Optional tiny name — Dutch must read geography without it.
            var label = new GameObject("Name").AddComponent<TextMesh>();
            label.transform.SetParent(holder, false);
            label.transform.localPosition = new Vector3(0f, FarMassHeight(world) + 8f, 0f);
            label.text = string.IsNullOrEmpty(w.title) ? world.ToString() : w.title;
            label.fontSize = 28;
            label.characterSize = 0.09f;
            label.anchor = TextAnchor.MiddleCenter;
            label.alignment = TextAlignment.Center;
            var ink = Color.Lerp(profile.atmosphereTint, Color.white, 0.55f);
            ink.a = 0.55f;
            label.color = ink;
            HubLook.DressTextMesh(label);

            holder.name = "FarGeography_" + world;
            return holder;
        }

        static float FarPadScale(WorldId world) => world switch
        {
            WorldId.Cyber or WorldId.Superhero => 18f,   // ~180m — readable at ring + mid-spoke
            WorldId.Frontier or WorldId.Tunya => 20f,
            WorldId.Crucible => 16f,
            WorldId.Sere => 18f,
            _ => 17f
        };

        static float FarMassHeight(WorldId world) => world switch
        {
            WorldId.Cyber or WorldId.Superhero => 56f,
            WorldId.Fantasy or WorldId.Crucible => 42f,
            WorldId.Ruins => 32f,
            WorldId.Sere or WorldId.Crime => 36f,
            WorldId.Frontier => 26f,
            WorldId.Tunya => 30f,
            _ => 28f
        };

        static int PlaceFarPad(Transform holder, WorldId world, WorldVisualProfileSpec profile)
        {
            var pad = GameObject.CreatePrimitive(PrimitiveType.Plane);
            pad.name = "FarPad";
            pad.transform.SetParent(holder, false);
            pad.transform.localPosition = new Vector3(0f, 0.15f, 0f);
            pad.transform.localScale = Vector3.one * FarPadScale(world);
            var col = pad.GetComponent<Collider>();
            if (col) Object.Destroy(col);
            var stem = world switch
            {
                WorldId.Ruins => "ash_soil",
                WorldId.Tunya => "grove_moss",
                WorldId.Crime => "wet_asphalt",
                WorldId.Cyber => "neon_grid",
                WorldId.Frontier => "packed_earth",
                WorldId.Superhero => "concrete_floor",
                WorldId.Crucible => "metal_plate",
                WorldId.Fantasy => "stone_tiles",
                WorldId.Sere => "wet_asphalt",
                _ => "packed_earth"
            };
            var mat = HubLook.Pbr(stem, profile.groundTint, 0.04f, 0.18f, 14f)
                      ?? HubLook.Lit(profile.groundTint, 0.04f, 0.18f);
            var rend = pad.GetComponent<Renderer>();
            if (rend && mat) rend.sharedMaterial = mat;
            return 1;
        }

        static int PlaceFarHills(Transform holder, WorldId world, WorldVisualProfileSpec profile, int budget)
        {
            if (budget <= 0) return 0;
            // Skyline worlds lean on buildings; still place 1 low ridge for land.
            int want = world switch
            {
                WorldId.Cyber or WorldId.Superhero => 1,
                WorldId.Frontier or WorldId.Tunya or WorldId.Fantasy => 2,
                WorldId.Crucible => 2,
                _ => 2
            };
            want = Mathf.Min(want, budget);
            var earth = HubLook.Lit(Color.Lerp(profile.groundTint, profile.atmosphereTint, 0.22f), 0.03f, 0.14f);
            int n = 0;
            for (int i = 0; i < want; i++)
            {
                float ang = (i * 2.15f) + FarSeed(world) * 0.017f;
                float rad = 18f + (i % 2) * 14f;
                var hill = GameObject.CreatePrimitive(PrimitiveType.Capsule);
                hill.name = "FarHill_" + i;
                hill.transform.SetParent(holder, false);
                float h = world switch
                {
                    WorldId.Fantasy => 22f + i * 8f,
                    WorldId.Crucible => 18f + i * 10f,
                    WorldId.Tunya => 14f + i * 6f,
                    WorldId.Frontier => 12f + i * 5f,
                    WorldId.Ruins => 16f + i * 5f,
                    _ => 10f + i * 4f
                };
                float w = 22f + i * 8f;
                hill.transform.localScale = new Vector3(w, h * 0.5f, w * 0.7f);
                hill.transform.localPosition = new Vector3(Mathf.Cos(ang) * rad, h * 0.22f, Mathf.Sin(ang) * rad - 6f);
                var col = hill.GetComponent<Collider>();
                if (col) Object.Destroy(col);
                var rend = hill.GetComponent<Renderer>();
                if (rend && earth) rend.sharedMaterial = earth;
                n++;
            }
            return n;
        }

        static int PlaceFarSilhouettes(Transform holder, WorldId world, WorldVisualProfileSpec profile, int budget)
        {
            if (budget <= 0) return 0;
            var stems = FarSilhouetteStems(world, profile);
            int want = Mathf.Clamp(stems.Length, 2, Mathf.Min(5, budget));
            float yaw0 = FarSeed(world) * 0.31f;
            int n = 0;
            for (int i = 0; i < want; i++)
            {
                var stem = stems[i % stems.Length];
                if (string.IsNullOrEmpty(stem)) continue;
                float ang = yaw0 + i * 1.1f;
                float rad = 4f + (i % 3) * 9f;
                var local = new Vector3(Mathf.Cos(ang) * rad, 0f, Mathf.Sin(ang) * rad + (i == 0 ? 2f : -2f));
                float dim = FarSilhouetteDim(world, i);
                // FreePacks.Sit expects WORLD position (HubPlaza uses TransformPoint).
                // Passing local offsets parked skyline at Hub origin — still B saw empty Present.
                var worldPos = holder.TransformPoint(local);
                // Trees destroy themselves when canopy > 18 after FitMax — use prim for grove mass.
                bool treeStem = !string.IsNullOrEmpty(stem) && (
                    stem.IndexOf("tree", System.StringComparison.OrdinalIgnoreCase) >= 0
                    || stem.IndexOf("palm", System.StringComparison.OrdinalIgnoreCase) >= 0
                    || stem.IndexOf("pine", System.StringComparison.OrdinalIgnoreCase) >= 0
                    || stem.IndexOf("fir", System.StringComparison.OrdinalIgnoreCase) >= 0
                    || stem.IndexOf("crops", System.StringComparison.OrdinalIgnoreCase) >= 0);
                GameObject go = null;
                if (!treeStem)
                {
                    // Cap FitMax so store meshes stay; far readable but under tree-kill band.
                    float packDim = Mathf.Min(dim, world is WorldId.Cyber or WorldId.Superhero ? 36f : 22f);
                    go = FreePacks.Spawn(stem, holder, worldPos, ang * Mathf.Rad2Deg, packDim, false, false);
                    // Some store heroes land with zero/tiny bounds at FitMax — useless at ring.
                    if (go)
                    {
                        var b = new Bounds();
                        bool any = false;
                        foreach (var r in go.GetComponentsInChildren<Renderer>(true))
                        {
                            if (!r) continue;
                            if (!any) { b = r.bounds; any = true; }
                            else b.Encapsulate(r.bounds);
                        }
                        float span = any ? Mathf.Max(b.size.x, Mathf.Max(b.size.y, b.size.z)) : 0f;
                        if (span < 2.5f)
                        {
                            Object.Destroy(go);
                            go = null;
                        }
                    }
                }
                if (!go)
                {
                    // Honest fallback mass — shape family differs by world so Tunya ≠ Cyber.
                    go = FarFallbackMass(holder, world, profile, i, local, ang, dim);
                }
                else
                {
                    go.name = "FarSilhouette_" + i + "_" + stem;
                    FreePacks.StripColliders(go);
                    // Retint cyan-prone FreePacks so ring vista isn't neon debug.
                    RetintFarSilhouette(go, world, profile, i);
                }
                n++;
            }
            return n;
        }

        /// <summary>Distinct Lit prim silhouettes when FreePacks stem is missing.</summary>
        static GameObject FarFallbackMass(Transform holder, WorldId world, WorldVisualProfileSpec profile, int i, Vector3 pos, float ang, float dim)
        {
            PrimitiveType prim = world switch
            {
                WorldId.Cyber or WorldId.Superhero => PrimitiveType.Cube,
                WorldId.Tunya or WorldId.Frontier => (i % 2 == 0 ? PrimitiveType.Capsule : PrimitiveType.Cylinder),
                WorldId.Fantasy => (i == 0 ? PrimitiveType.Cylinder : PrimitiveType.Cube),
                WorldId.Crucible => PrimitiveType.Capsule,
                WorldId.Ruins => PrimitiveType.Cylinder,
                _ => PrimitiveType.Cube
            };
            var go = GameObject.CreatePrimitive(prim);
            go.name = "FarMass_" + i;
            go.transform.SetParent(holder, false);
            float h, footprint;
            if (world == WorldId.Cyber || world == WorldId.Superhero)
            {
                h = dim * (0.7f + (i % 4) * 0.22f);
                footprint = dim * (0.18f + (i % 3) * 0.06f);
            }
            else if (world == WorldId.Tunya || world == WorldId.Frontier)
            {
                h = dim * (0.45f + (i % 3) * 0.12f);
                footprint = dim * (0.28f + (i % 2) * 0.1f);
            }
            else if (world == WorldId.Fantasy)
            {
                h = dim * (0.85f + (i == 0 ? 0.35f : 0.1f));
                footprint = dim * (i == 0 ? 0.22f : 0.32f);
            }
            else
            {
                h = dim * (0.55f + (i % 3) * 0.18f);
                footprint = dim * 0.35f;
            }
            go.transform.localScale = new Vector3(footprint, h * (prim == PrimitiveType.Capsule ? 0.5f : 1f), footprint * 0.85f);
            go.transform.localPosition = pos + Vector3.up * (h * 0.5f);
            go.transform.localRotation = Quaternion.Euler(0f, ang * Mathf.Rad2Deg, 0f);
            var col = go.GetComponent<Collider>();
            if (col) Object.Destroy(col);
            Color tint = world switch
            {
                WorldId.Cyber => Color.Lerp(profile.groundTint, new Color(0.22f, 0.20f, 0.38f), 0.55f),
                WorldId.Superhero => Color.Lerp(profile.groundTint, new Color(0.36f, 0.40f, 0.52f), 0.5f),
                WorldId.Tunya => Color.Lerp(profile.groundTint, new Color(0.18f, 0.38f, 0.16f), 0.45f),
                WorldId.Frontier => Color.Lerp(profile.groundTint, new Color(0.62f, 0.44f, 0.22f), 0.4f),
                WorldId.Fantasy => Color.Lerp(profile.groundTint, new Color(0.32f, 0.42f, 0.24f), 0.4f),
                WorldId.Ruins => Color.Lerp(profile.groundTint, new Color(0.48f, 0.42f, 0.34f), 0.35f),
                WorldId.Crime or WorldId.Sere => Color.Lerp(profile.groundTint, new Color(0.22f, 0.20f, 0.20f), 0.4f),
                _ => Color.Lerp(profile.groundTint, profile.atmosphereTint, 0.35f + i * 0.08f)
            };
            var mat = HubLook.Lit(tint, world == WorldId.Cyber || world == WorldId.Superhero ? 0.14f : 0.05f,
                world == WorldId.Cyber || world == WorldId.Superhero ? 0.32f : 0.16f);
            var rend = go.GetComponent<Renderer>();
            if (rend && mat) rend.sharedMaterial = mat;
            return go;
        }

        static void RetintFarSilhouette(GameObject go, WorldId world, WorldVisualProfileSpec profile, int i)
        {
            if (!go) return;
            // Urban skyline keeps cooler tint; grove/frontier stay earthy.
            Color tint = world switch
            {
                // Avoid cyan (debug look) — cool slate/violet for Cyber, not neon.
                WorldId.Cyber => Color.Lerp(profile.groundTint, new Color(0.26f, 0.18f, 0.42f), 0.5f),
                WorldId.Superhero => Color.Lerp(profile.groundTint, new Color(0.38f, 0.44f, 0.58f), 0.42f),
                WorldId.Crime or WorldId.Sere => Color.Lerp(profile.groundTint, new Color(0.28f, 0.24f, 0.22f), 0.35f),
                WorldId.Tunya => Color.Lerp(profile.groundTint, new Color(0.22f, 0.40f, 0.18f), 0.3f),
                WorldId.Fantasy => Color.Lerp(profile.groundTint, new Color(0.38f, 0.48f, 0.28f), 0.3f),
                _ => Color.Lerp(profile.groundTint, profile.atmosphereTint, 0.2f + i * 0.05f)
            };
            var mat = HubLook.Lit(tint, world is WorldId.Cyber or WorldId.Superhero ? 0.12f : 0.05f,
                world is WorldId.Cyber or WorldId.Superhero ? 0.35f : 0.18f);
            if (!mat) return;
            foreach (var r in go.GetComponentsInChildren<Renderer>(true))
            {
                if (!r) continue;
                r.sharedMaterial = mat;
            }
        }

        static float FarSilhouetteDim(WorldId world, int i)
        {
            float baseH = FarMassHeight(world);
            return baseH * (0.55f + (i % 4) * 0.14f);
        }

        static int FarSeed(WorldId world) => unchecked((int)world) * 97 + 13;

        static string[] FarSilhouetteStems(WorldId world, WorldVisualProfileSpec profile)
        {
            // Prefer profile L0 biome stems; DressVocab fills gaps. Distinct families:
            // Cyber/Superhero = skyline, Tunya/Frontier = land+trees, Fantasy = tower/forest,
            // Ruins/Crucible = stone/cliff, Crime/Sere = industrial lowrise.
            var fromProfile = profile != null && profile.biomeStems != null
                ? profile.biomeStems
                : System.Array.Empty<string>();
            var house = DressVocab.House(world);
            var tower = DressVocab.Tower(world);
            var tree = DressVocab.Tree(world);
            var wall = DressVocab.Wall(world);
            switch (world)
            {
                case WorldId.Cyber:
                    return PreferStems(fromProfile, new[] { "building-skyscraper-a", "building-type-a", tower, house, "detail-overhang-wide" });
                case WorldId.Superhero:
                    return PreferStems(fromProfile, new[] { "building-skyscraper-a", "building-type-a", tower, house, wall });
                case WorldId.Tunya:
                    return PreferStems(fromProfile, new[] { tree, "tree_1", house, "bridge_wood", "crops_cornStageD" });
                case WorldId.Frontier:
                    return PreferStems(fromProfile, new[] { "palm-detailed-bend", "palm-straight", house, tree, wall });
                case WorldId.Fantasy:
                    return PreferStems(fromProfile, new[] { "tower-square-base", tower, tree, "hedge-large", house });
                case WorldId.Ruins:
                    return PreferStems(fromProfile, new[] { "column-large", "crypt-small", "cliff_large_stone", wall, house });
                case WorldId.Crucible:
                    return PreferStems(fromProfile, new[] { "detail-crystal-large", "tower-hexagon-mid", "cliff_stone", "rocks-large", tower });
                case WorldId.Crime:
                    return PreferStems(fromProfile, new[] { house, wall, tower, "detail-awning", "building-type-h" });
                case WorldId.Sere:
                    return PreferStems(fromProfile, new[] { "building-type-h", house, wall, tower, "cliff_large_rock" });
                default:
                    return PreferStems(fromProfile, new[] { house, tower, wall, tree });
            }
        }

        static string[] PreferStems(string[] preferred, string[] fallback)
        {
            var list = new System.Collections.Generic.List<string>(6);
            void AddIfReal(string s)
            {
                if (string.IsNullOrEmpty(s)) return;
                if (list.Contains(s)) return;
                if (FreePacks.HasStoreStem(s) || FreePacks.HasStem(s))
                    list.Add(s);
            }
            void AddAny(string s)
            {
                if (string.IsNullOrEmpty(s)) return;
                if (list.Contains(s)) return;
                list.Add(s);
            }
            if (preferred != null)
                for (int i = 0; i < preferred.Length; i++) AddIfReal(preferred[i]);
            if (fallback != null)
                for (int i = 0; i < fallback.Length; i++) AddIfReal(fallback[i]);
            // DressVocab house/tower often resolve to real Store stems — prefer those.
            if (list.Count < 2 && fallback != null)
                for (int i = 0; i < fallback.Length; i++) AddAny(fallback[i]);
            if (list.Count == 0) { AddAny("building-type-a"); AddAny("tower-square-base"); }
            while (list.Count < 2) list.Add(list[0]);
            if (list.Count > 5) list.RemoveRange(5, list.Count - 5);
            return list.ToArray();
        }

        public void DressChunkSky(WorldId id)
        {
            var prev = root;
            var chunk = ContinentStream.Live ? ContinentStream.Live.ChunkOf(id) : null;
            if (chunk) root = chunk;
            DressSky(Canon.Get(id));
            if (prev) root = prev;
        }

        static void PurgeWorldRoots()
        {
            PurgeNamed("World");
        }

        static void PurgeNamed(string name)
        {
            var found = Object.FindObjectsByType<Transform>(FindObjectsInactive.Include, FindObjectsSortMode.None);
            for (int i = 0; i < found.Length; i++)
            {
                var t = found[i];
                if (!t || t.parent != null) continue;
                if (t.name != name) continue;
                Object.DestroyImmediate(t.gameObject);
            }
        }

        void BuildGround(WorldDef w)
        {
            var g = GameObject.CreatePrimitive(PrimitiveType.Plane);
            g.name = "Ground";
            g.transform.SetParent(root, false);
            g.transform.localScale = Vector3.one * 24;

            // The Hub used to return early here and rely solely on HubPlaza's granite tiles, so
            // any gap between tiles showed flat void — the single largest untextured area on
            // screen. It now gets a real ground plane too, dropped just under the tiles so it
            // reads as the courtyard floor beneath them rather than z-fighting with them.
            if (w.id == WorldId.Hub)
                g.transform.localPosition = new Vector3(0f, -0.04f, 0f);
            var pbrStem = w.id switch
            {
                WorldId.Ruins => "ash_soil",
                WorldId.Tunya => "grove_moss",
                WorldId.Crime => "wet_asphalt",
                WorldId.Cyber => "neon_grid",
                WorldId.Frontier => "packed_earth",
                WorldId.Superhero => "concrete_floor",
                WorldId.Crucible => "metal_plate",
                WorldId.Fantasy => "stone_tiles",
                WorldId.Sere => "wet_asphalt",
                WorldId.Hub => "cobblestone_square",
                _ => "stone_tiles"
            };
            var pbr = w.id == WorldId.Hub
                ? HubLook.WetStone("cobblestone_square", 5.5f)
                : HubLook.Pbr(pbrStem, w.ground, 0.04f, 0.16f, 18f);
            var gr0 = g.GetComponent<Renderer>();
            if (gr0) gr0.sharedMaterial = pbr;
        }

        void DressSky(WorldDef w)
        {
            if (!HubLook.ApplySky(w.id))
                FreePacks.Sky(DressVocab.SkyMat(w.id));
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.ExponentialSquared;
            RenderSettings.fogDensity = w.id switch
            {
                WorldId.Hub => ContinentStream.Live ? 0.022f : 0.032f,
                WorldId.Crime => 0.018f,
                WorldId.Ruins => 0.016f,
                WorldId.Cyber => 0.014f,
                WorldId.Frontier => 0.007f,
                WorldId.Sere => 0.02f,
                _ => 0.011f
            };
            RenderSettings.fogColor = w.id switch
            {
                WorldId.Hub => new Color(0.22f, 0.42f, 0.44f),
                WorldId.Fantasy => new Color(0.62f, 0.28f, 0.18f),
                WorldId.Cyber => new Color(0.18f, 0.06f, 0.28f),
                WorldId.Crime => new Color(0.12f, 0.08f, 0.10f),
                WorldId.Frontier => new Color(0.78f, 0.62f, 0.38f),
                WorldId.Tunya => new Color(0.42f, 0.52f, 0.28f),
                WorldId.Superhero => new Color(0.72f, 0.42f, 0.28f),
                WorldId.Ruins => new Color(0.32f, 0.28f, 0.24f),
                WorldId.Sere => new Color(0.22f, 0.16f, 0.10f),
                _ => new Color(0.08f, 0.28f, 0.28f)
            };
            DynamicGI.UpdateEnvironment();
            WorldClock.NoteFogBase();
            HubLook.LiveFog(RenderSettings.fogDensity);
            // Hub fireflies are identity ambience, not weather. Rain/ash/snow
            // follow WorldClock.Weather from Enter/Tick (see ApplyWeatherVisuals).
            if (w.id == WorldId.Hub)
                DressVocab.PlaceWeather("fireflies", root, new Vector3(0, 2.2f, 0));
        }

        void DressAudio(WorldDef w)
        {
            var music = w.id == WorldId.Hub
                ? "Assets/Audio/Background_Music_Ethereal.prefab"
                : w.id == WorldId.Crime || w.id == WorldId.Cyber
                    ? "Assets/Audio/Background_Music_Suspenseful.prefab"
                    : w.id == WorldId.Superhero
                        ? "Assets/Audio/Background_Music_Action.prefab"
                        : "Assets/Audio/Background_Ambient_Wind.prefab";
            FreePacks.Prefab(music, root, Vector3.zero);
            if (w.id == WorldId.Hub || w.id == WorldId.Cyber)
                FreePacks.Prefab("Assets/Audio/Background_Ambient_Sci-Fi.prefab", root, Vector3.zero);
        }

        void BuildHub()
        {
            HubPlaza.Build(root);
            WorldHeroCatalog.ValidateHubCourt(root);
            var wdef = Canon.Hub;
            ConcordiaHUD.Announce(wdef.title, wdef.refusal);

            DressArena();

            foreach (var gate in Canon.Gates)
            {
                var p = new Vector3(Mathf.Cos(gate.angle) * Canon.RingRadius, 0, Mathf.Sin(gate.angle) * Canon.RingRadius);
                var yaw = -gate.angle * Mathf.Rad2Deg;
                DressEmbassy(gate, p, yaw);
            }

            if (!ConcordiaHost.LeanPlay)
            {
                DressGuests();
                DressPillars();
            }
            // Court plaza stays empty like the reference still — polo walkers
            // were LeanPlay density, not cinematic density.
            DressLore();
            // Hub metro streets/buildings — was authored but never invoked (Court island only).
            // LeanPlay: still dress a thinner ring so Hub reads as a city, not empty ring.
            DressCityRing();
            if (!ConcordiaHost.LeanPlay)
                DressForest();
            if (!ConcordiaHost.LeanPlay)
            {
                RealmFill.Populate(root, WorldId.Hub, false); // people only via PeopleStaged
                {
                    var host = ContinentStream.Live;
                    if (host) host.StartCoroutine(RealmFill.PeopleStaged(root, WorldId.Hub));
                    else
                    {
                        var runner = root.gameObject.GetComponent<StreamSeedRunner>()
                            ?? root.gameObject.AddComponent<StreamSeedRunner>();
                        runner.StartCoroutine(RealmFill.PeopleStaged(root, WorldId.Hub));
                    }
                }
                StoreDress.Hub(root);
            }

            // The arena remains an authored combat space; never populate it with a
            // visible training dummy or primitive stand-in.
            Beacon(root, Canon.Spawn, 8f, "first_cycle_glade", "hub_court", "the_unburned_court");
            Beacon(root, Canon.Arena, 8f, "training_hollow", "arena");
            var east = new Vector3(Mathf.Cos(0f) * Canon.RingRadius, 0f, Mathf.Sin(0f) * Canon.RingRadius);
            Beacon(root, east, 7f, "east_gate");
        }

System.Collections.IEnumerator BuildHubStaged()
        {
            // Full Court readiness is a streaming contract. Commit the physical
            // Court as soon as its frame-budgeted plaza exists; guest, pillar,
            // lore, city-ring, forest, and crowd dressing continue independently
            // so one authored character cannot hold BuildFull in Building forever.
            MarkStage("staged hub phase=plaza");
            yield return HubPlaza.BuildStaged(root);
            try { WorldHeroCatalog.ValidateHubCourt(root); }
            catch (System.Exception ex) { Debug.LogException(ex); }
            yield return null;

            HubStageComplete = true;
            MarkStage("staged hub phase=bind_ready");
            Debug.Log("[Concordia] Hub staged bind-ready");
            StartCoroutine(DressHubPostReadyStaged());
        }

System.Collections.IEnumerator DressHubPostReadyStaged()
        {
            var wdef = Canon.Hub;
            try { ConcordiaHUD.Announce(wdef.title, wdef.refusal); }
            catch (System.Exception ex) { Debug.LogException(ex); }
            MarkStage("staged hub phase=arena");
            TimedStep("DressArena", DressArena);
            yield return null;

            if (Canon.Gates != null)
            {
                foreach (var gate in Canon.Gates)
                {
                    try
                    {
                        var gp = new Vector3(Mathf.Cos(gate.angle) * Canon.RingRadius, 0, Mathf.Sin(gate.angle) * Canon.RingRadius);
                        var yaw = -gate.angle * Mathf.Rad2Deg;
                        TimedStep("DressEmbassy " + gate.world, () => DressEmbassy(gate, gp, yaw));
                    }
                    catch (System.Exception ex) { Debug.LogException(ex); }
                    yield return null;
                }
            }

            MarkStage("staged hub phase=guests");
            yield return DressGuestsStaged();
            yield return DressPillarsStaged();
            MarkStage("staged hub phase=guests_done");

            MarkStage("staged hub phase=lore");
            TimedStep("DressLore", DressLore);
            yield return null;
            MarkStage("staged hub phase=city_ring");
            TimedStep("DressCityRing", DressCityRing);
            yield return null;
            MarkStage("staged hub phase=forest");
            yield return DressForestStaged();

            MarkStage("staged hub phase=realmfill");
            Debug.Log("[Concordia] LeanPlay: RealmFill.Populate + StoreDress.Hub staged");
            // Staged: one-frame Populate held the frame 3.4 s (editor) and froze WebGL.
            yield return RealmFill.PopulateStaged(root, WorldId.Hub);
            TimedStep("StoreDress.Hub", () => StoreDress.Hub(root));
            yield return null;
            yield return RealmFill.PeopleStaged(root, WorldId.Hub);
            MarkStage("staged hub phase=crowd");
            yield return DressCrowdStaged();
            MarkStage("staged hub phase=realmfill_done");

            try
            {
                Beacon(root, Canon.Spawn, 8f, "first_cycle_glade", "hub_court", "the_unburned_court");
                Beacon(root, Canon.Arena, 8f, "training_hollow", "arena");
                var east = new Vector3(Mathf.Cos(0f) * Canon.RingRadius, 0f, Mathf.Sin(0f) * Canon.RingRadius);
                Beacon(root, east, 7f, "east_gate");
            }
            catch (System.Exception ex) { Debug.LogException(ex); }
            yield return null;
        }


        /// Runs one synchronous Hub-dressing step and logs it when it holds the
        /// frame for more than 30 ms: each step runs inside a coroutine frame,
        /// so a long one is a visible stall (seconds on WebGL). Exceptions are
        /// logged, never thrown, as before.
        static void TimedStep(string name, System.Action step)
        {
            var sw = System.Diagnostics.Stopwatch.StartNew();
            try { step(); }
            catch (System.Exception ex) { Debug.LogException(ex); }
            sw.Stop();
            if (sw.ElapsedMilliseconds > 30)
                Debug.Log($"[HubStageCost] {name} held the frame {sw.ElapsedMilliseconds} ms");
        }

        System.Collections.IEnumerator DressGuestsStaged()
        {
            if (Canon.HubGuests == null) yield break;
            Debug.Log("[Concordia] staged Hub guests begin count=" + Canon.HubGuests.Length);
            foreach (var n in Canon.HubGuests)
            {
                if (n == null) { yield return null; continue; }
                MarkStage("staged hub phase=guest " + n.id);
                try { SpawnGuest(n); }
                catch (System.Exception ex)
                {
                    Debug.LogWarning("[Concordia] guest skipped id=" + n.id + ": " + ex.Message);
                }
                yield return null;
            }
            Debug.Log("[Concordia] staged Hub guests done");
        }

        System.Collections.IEnumerator DressPillarsStaged()
        {
            if (Canon.Pillars == null) yield break;
            Debug.Log("[Concordia] staged Hub pillars begin count=" + Canon.Pillars.Length);
            foreach (var n in Canon.Pillars)
            {
                if (n == null) { yield return null; continue; }
                try { SpawnPillar(n); }
                catch (System.Exception ex)
                {
                    Debug.LogWarning("[Concordia] pillar skipped id=" + n.id + ": " + ex.Message);
                }
                yield return null;
            }
            Debug.Log("[Concordia] staged Hub pillars done");
        }


        static void Beacon(Transform root, Vector3 pos, float radius, params string[] tokens)
        {
            var go = new GameObject("Beacon_" + tokens[0]);
            go.transform.SetParent(root, false);
            go.transform.position = pos;
            var b = go.AddComponent<QuestBeacon>();
            b.tokens = tokens;
            b.radius = radius;
        }

        System.Collections.IEnumerator DressCrowdStaged()
        {
            Debug.Log("[Concordia] LeanPlay: DressCrowdStaged begin");
            int walkers = ConcordiaHost.CrowdWalkers;
            int stalls = ConcordiaHost.CrowdStalls;
            int sitters = ConcordiaHost.CrowdSit;
            for (int i = 0; i < walkers; i++)
            {
                var a = i / (float)Mathf.Max(1, walkers) * Mathf.PI * 2f + 0.4f;
                var rad = 21f + (i % 5) * 2.4f;
                var p = new Vector3(Mathf.Cos(a) * rad, 0f, Mathf.Sin(a) * rad);
                if ((p - Canon.Spawn).sqrMagnitude < 16f) { yield return null; continue; }
                if (Canon.OnSunderingLane(p)) { yield return null; continue; }
                if (Canon.InArena(p)) { yield return null; continue; }
                var look = Appearance.Random(1100 + i * 17);
                look.displayName = i % 7 == 0 ? "Petitioner" : i % 5 == 0 ? "Merchant" : "Citizen";
                look.outfit = i % 6;
                var go = ModularPerson.SpawnNpc(root, p, a * Mathf.Rad2Deg, look, true, 8f + (i % 4));
                var life = go.AddComponent<NpcLife>();
                life.job = i % 9 == 0 ? NpcLife.Job.Sweep : NpcLife.Job.Wander;
                TagCrowd(go, "crowd-walk-" + i, look.displayName, "court");
                yield return null;
            }
            for (int i = 0; i < stalls && i < Canon.Gates.Length; i++)
            {
                var g = Canon.Gates[i];
                var dir = new Vector3(Mathf.Cos(g.angle), 0f, Mathf.Sin(g.angle));
                var side = Vector3.Cross(Vector3.up, dir).normalized;
                var p = dir * 26f + side * 5.2f;
                if (Canon.OnSunderingLane(p)) p += side * 3.4f;
                var look = Appearance.Random(2200 + i * 31);
                look.outfit = i % 6;
                var go = ModularPerson.SpawnNpc(root, p, -g.angle * Mathf.Rad2Deg + 180f, look, false);
                go.AddComponent<NpcLife>().job = NpcLife.Job.Stall;
                TagCrowd(go, "crowd-stall-" + i, look.displayName ?? "Merchant", g.shortName);
                yield return null;
            }
            for (int i = 0; i < sitters; i++)
            {
                float a = i / (float)Mathf.Max(1, sitters) * Mathf.PI * 2f + 0.55f;
                var p = new Vector3(Mathf.Cos(a) * 19.4f, 0f, Mathf.Sin(a) * 19.4f);
                if (Canon.InArena(p)) { yield return null; continue; }
                var bench = FreePacks.Spawn(DressVocab.Table(), root, p, -a * Mathf.Rad2Deg, 0.55f, required: false);
                if (!bench)
                    HubLook.Prim(root, PrimitiveType.Cube, p + Vector3.up * 0.28f, new Vector3(1.4f, 0.22f, 0.45f),
                        HubLook.Lit(new Color(0.35f, 0.2f, 0.1f), 0.1f, 0.25f), "Bench" + i);
                var look = Appearance.Random(3300 + i * 13);
                var go = ModularPerson.SpawnNpc(root, p + new Vector3(0f, 0f, 0.1f), -a * Mathf.Rad2Deg, look, false);
                go.AddComponent<NpcLife>().job = NpcLife.Job.Sit;
                TagCrowd(go, "crowd-sit-" + i, look.displayName ?? "Citizen", "bench");
                yield return null;
            }
            Debug.Log("[Concordia] LeanPlay: DressCrowdStaged done walkers=" + walkers + " stalls=" + stalls + " sit=" + sitters);
        }

        void DressCrowd()
        {
            // Court stays open. Walkers live on the ring between court and gates.
            // LeanPlay (≤16GB Mac) thins ModularPerson storm so Editor holds Play.
            int walkers = ConcordiaHost.CrowdWalkers;
            int stalls = ConcordiaHost.CrowdStalls;
            int sitters = ConcordiaHost.CrowdSit;
            if (ConcordiaHost.LeanPlay)
                Debug.Log("[Concordia] LeanPlay crowd walkers=" + walkers + " stalls=" + stalls + " sit=" + sitters);
            for (int i = 0; i < walkers; i++)
            {
                var a = i / (float)Mathf.Max(1, walkers) * Mathf.PI * 2f + 0.4f;
                var rad = 21f + (i % 5) * 2.4f;
                var p = new Vector3(Mathf.Cos(a) * rad, 0f, Mathf.Sin(a) * rad);
                if ((p - Canon.Spawn).sqrMagnitude < 16f) continue;
                if (Canon.OnSunderingLane(p)) continue;
                if (Canon.InArena(p)) continue;
                var look = Appearance.Random(1100 + i * 17);
                look.displayName = i % 7 == 0 ? "Petitioner" : i % 5 == 0 ? "Merchant" : "Citizen";
                look.outfit = i % 6;
                var go = ModularPerson.SpawnNpc(root, p, a * Mathf.Rad2Deg, look, true, 8f + (i % 4));
                var life = go.AddComponent<NpcLife>();
                life.job = i % 9 == 0 ? NpcLife.Job.Sweep : NpcLife.Job.Wander;
                TagCrowd(go, "crowd-walk-" + i, look.displayName, "court");
            }
            for (int i = 0; i < stalls && i < Canon.Gates.Length; i++)
            {
                var g = Canon.Gates[i];
                var dir = new Vector3(Mathf.Cos(g.angle), 0f, Mathf.Sin(g.angle));
                var side = Vector3.Cross(Vector3.up, dir).normalized;
                var p = dir * 26f + side * 5.2f;
                if (Canon.OnSunderingLane(p)) p += side * 3.4f;
                var look = Appearance.Random(2200 + i * 31);
                look.outfit = i % 6;
                var go = ModularPerson.SpawnNpc(root, p, -g.angle * Mathf.Rad2Deg + 180f, look, false);
                go.AddComponent<NpcLife>().job = NpcLife.Job.Stall;
                TagCrowd(go, "crowd-stall-" + i, look.displayName ?? "Merchant", g.shortName);
            }
            for (int i = 0; i < sitters; i++)
            {
                float a = i / (float)Mathf.Max(1, sitters) * Mathf.PI * 2f + 0.55f;
                var p = new Vector3(Mathf.Cos(a) * 19.4f, 0f, Mathf.Sin(a) * 19.4f);
                if (Canon.InArena(p)) continue;
                var bench = FreePacks.Spawn(DressVocab.Table(), root, p, -a * Mathf.Rad2Deg, 0.55f, required: false);
                if (!bench)
                    HubLook.Prim(root, PrimitiveType.Cube, p + Vector3.up * 0.28f, new Vector3(1.4f, 0.22f, 0.45f),
                        HubLook.Lit(new Color(0.35f, 0.2f, 0.1f), 0.1f, 0.25f), "Bench" + i);
                var look = Appearance.Random(3300 + i * 13);
                var go = ModularPerson.SpawnNpc(root, p + new Vector3(0f, 0f, 0.1f), -a * Mathf.Rad2Deg, look, false);
                go.AddComponent<NpcLife>().job = NpcLife.Job.Sit;
                TagCrowd(go, "crowd-sit-" + i, look.displayName ?? "Citizen", "bench");
            }
        }

        static void TagCrowd(GameObject go, string id, string name, string title)
        {
            if (!go || go.GetComponent<GuestNpc>()) return;
            var guest = go.AddComponent<GuestNpc>();
            guest.def = new GuestDef
            {
                id = id,
                name = string.IsNullOrEmpty(name) ? "Citizen" : name,
                title = string.IsNullOrEmpty(title) ? "unlabeled" : title,
                line = "They keep their own hours. Not an authored citizen."
            };
        }

        void DressArena()
        {
            var c = Canon.Arena;
            var col = DressVocab.Column(WorldId.Hub);
            var sword = DressVocab.Weapon("sword");
            var tower = DressVocab.Tower(WorldId.Hub);
            var tree = DressVocab.Tree(WorldId.Hub);
            var rock = DressVocab.Rock();
            for (int i = 0; i < 12; i++)
            {
                var a = (i / 12f) * Mathf.PI * 2;
                if (i % 2 == 0)
                {
                    var pillar = FreePacks.Spawn(col, root, c + new Vector3(Mathf.Cos(a) * 9.4f, 0, Mathf.Sin(a) * 9.4f),
                        -a * Mathf.Rad2Deg, 4.8f, required: false);
                    HubLook.StoneDress(pillar);
                }
                if (i % 2 == 0)
                    HubLook.Lantern(root, c + new Vector3(Mathf.Cos(a) * 10.2f, 0, Mathf.Sin(a) * 10.2f));
            }
            FreePacks.Spawn(DressVocab.FirstStem(new[] { "Statue" }, "statue"), root, c + new Vector3(6, 0, 6), 40, 2.2f, required: false);
            FreePacks.Spawn(sword, root, c + new Vector3(-5.4f, 0, 5), 90, 1.2f, required: false);
            FreePacks.Spawn(DressVocab.Prop(WorldId.Hub), root, c + new Vector3(-5.1f, 0, 5.6f), 20, 0.9f, required: false);
            FreePacks.Spawn(DressVocab.Well(), root, c + new Vector3(5.2f, 0, -4.4f), 0, 1.5f, required: false);
            FreePacks.Spawn(tower, root, c + new Vector3(10, 0, 0), 0, 4.5f, required: false);
            FreePacks.Spawn(tower, root, c + new Vector3(-10, 0, 0), 0, 4.5f, required: false);
            FreePacks.Spawn(tree, root, c + new Vector3(12.4f, 0, 8.2f), 18, 8.5f, required: false);
            FreePacks.Spawn(tree, root, c + new Vector3(-11.8f, 0, 9.1f), -30, 7.8f, required: false);
            FreePacks.Spawn(rock, root, c + new Vector3(8.6f, 0, -7.2f), 12, 1.2f, required: false);
            FreePacks.Spawn(rock, root, c + new Vector3(-7.4f, 0, -8.1f), -22, 1.0f, required: false);
            PresentSkillPylons();
        }

        /// <summary>
        /// Combat pylons around the training dummy — one per catalog group,
        /// labeled from skills.mastery when Concord has answered. Walk up and
        /// press E, or open K for the full 67. Empty until the lattice binds.
        /// </summary>
        public static void PresentSkillPylons()
        {
            var world = ChunkRoot(WorldId.Hub);
            if (!world) return;
            var old = world.Find("SkillRing");
            if (old) Object.DestroyImmediate(old.gameObject);
            var hold = new GameObject("SkillRing").transform;
            hold.SetParent(world, false);
            var c = Canon.Arena;
            var groups = SkillLattice.Groups.Count > 0
                ? SkillLattice.Groups
                : new System.Collections.Generic.List<string> { "combat", "athletic", "craft", "arts", "social", "scholar", "side" };
            var col = DressVocab.Column(WorldId.Hub);
            for (int i = 0; i < groups.Count; i++)
            {
                var a = (i / (float)groups.Count) * Mathf.PI * 2f + 0.18f;
                var pos = c + new Vector3(Mathf.Cos(a) * 5.6f, 0f, Mathf.Sin(a) * 5.6f);
                var go = FreePacks.Spawn(col, hold, pos, -a * Mathf.Rad2Deg, 2.4f, required: false);
                if (!go)
                {
                    go = HubLook.Prim(hold, PrimitiveType.Cylinder, pos + Vector3.up * 1.1f,
                        new Vector3(0.38f, 2.2f, 0.38f), HubLook.Lit(new Color(0.42f, 0.32f, 0.22f), 0.15f, 0.3f),
                        "Pylon_" + groups[i]);
                }
                var pylon = go.GetComponent<SkillPylon>() ?? go.AddComponent<SkillPylon>();
                pylon.group = groups[i];
                pylon.skillType = SkillLattice.FirstInGroup(groups[i]);
                var label = new GameObject("Name").AddComponent<TextMesh>();
                label.transform.SetParent(go.transform, false);
                label.transform.localPosition = new Vector3(0f, 2.15f, 0f);
                label.text = groups[i];
                label.fontSize = 28;
                label.characterSize = 0.018f;
                label.anchor = TextAnchor.MiddleCenter;
                label.alignment = TextAlignment.Center;
                label.color = new Color(1f, 0.93f, 0.78f);
                HubLook.DressTextMesh(label);
                FreePacks.EnsureCollider(go, 2.2f);
            }
        }

        void DressEmbassy(GateDef gate, Vector3 p, float yaw)
        {
            var outDir = p.normalized;
            var outPos = p + outDir * 16f;
            var side = Vector3.Cross(Vector3.up, outDir);
            GameObject shell = null;
            switch (gate.world)
            {
                case WorldId.Ruins:
                    shell = FreePacks.Spawn(DressVocab.House(WorldId.Ruins), root, outPos, yaw, 5.5f);
                    FreePacks.Spawn(DressVocab.Column(WorldId.Ruins), root, outPos + side * 3.4f, yaw, 2.4f, required: false);
                    break;
                case WorldId.Tunya:
                    shell = FreePacks.Spawn(DressVocab.House(WorldId.Tunya), root, outPos, yaw, 4.2f);
                    FreePacks.Spawn(DressVocab.FirstStem(new[] { "Crops", "Wheat" }, "crops_wheatStageB"), root, outPos + side * 3.2f, yaw, 1.2f);
                    FreePacks.Spawn(DressVocab.Grass(WorldId.Tunya), root, outPos + side * 4.4f, yaw + 15f, 1.2f, required: false);
                    break;
                case WorldId.Fantasy:
                    FreePacks.SpawnStore(DressVocab.Tree(WorldId.Fantasy), root, outPos + side * 2.8f, yaw, 8f, required: false, byHeight: false);
                    FreePacks.SpawnStore(DressVocab.Tree(WorldId.Fantasy), root, outPos - side * 3.1f, yaw + 40f, 8f, required: false, byHeight: false);
                    shell = FreePacks.Spawn(DressVocab.Tower(WorldId.Fantasy), root, outPos, yaw, 7.2f, required: false);
                    break;
                case WorldId.Crime:
                    FreePacks.Spawn(DressVocab.Cart(), root, outPos, yaw + 20f, 2.2f);
                    FreePacks.Spawn(DressVocab.Crate(), root, outPos + side * 2.2f, yaw, 0.9f);
                    FreePacks.Spawn(DressVocab.Prop(WorldId.Crime), root, outPos - side * 1.8f, yaw, 0.8f);
                    FreePacks.Spawn(DressVocab.Crate(), root, outPos + outDir * 1.6f, 15f, 0.9f, required: false);
                    break;
                case WorldId.Cyber:
                    FreePacks.Spawn(DressVocab.Column(WorldId.Cyber), root, outPos + side * 2.4f, yaw, 3.2f);
                    FreePacks.Spawn(DressVocab.Column(WorldId.Cyber), root, outPos - side * 2.4f, yaw, 3.2f);
                    HubLook.Lantern(root, outPos);
                    shell = FreePacks.Spawn(DressVocab.House(WorldId.Cyber), root, outPos + outDir * 1.2f, yaw, 6.4f, required: false);
                    break;
                case WorldId.Frontier:
                    for (int i = 0; i < 5; i++)
                    {
                        var rp = p + outDir * (6f + i * 4.2f);
                        FreePacks.Spawn("road-straight", root, rp, yaw + 90f, 5.5f, required: false, byHeight: false);
                    }
                    PlaceStone(outPos + side * 2.6f, "No embassy",
                        "The frontier keeps no seat. The road is their door. To claim a fixed house here would be to accept a dome.");
                    return;
                case WorldId.Superhero:
                    shell = FreePacks.Spawn(DressVocab.Tower(WorldId.Superhero), root, outPos, yaw, 8.5f);
                    break;
                case WorldId.Crucible:
                    FreePacks.Spawn(DressVocab.Rock(), root, outPos + side * 2.1f, yaw, 1.2f, required: false);
                    FreePacks.Spawn(DressVocab.Rock(), root, outPos - side * 1.6f, yaw, 1.0f, required: false);
                    FreePacks.Spawn(DressVocab.Column(WorldId.Crucible), root, outPos, yaw, 3.2f, required: false);
                    break;
            }
            if (shell)
            {
                HubLook.StoneDress(shell);
                KeepRingClear(shell, p);
            }
        }

        /// <summary>
        /// Embassy FreePacks are set-dressing. HubPlaza owns the Link mouth.
        /// Solid house/tower AABBs that reach the ring made the portal look
        /// missing — the trigger was there, the walk was not.
        /// </summary>
        static void KeepRingClear(GameObject shell, Vector3 ringPos)
        {
            if (!shell) return;
            foreach (var col in shell.GetComponentsInChildren<Collider>())
            {
                if (!col || col.isTrigger) continue;
                // Bounds.ClosestPoint is safe for imported non-convex MeshColliders;
                // Collider.ClosestPoint throws on those assets.
                var hit = col.bounds.ClosestPoint(ringPos);
                if ((hit - ringPos).sqrMagnitude < 25f)
                    Object.Destroy(col);
            }
        }

        void DressTavern(Vector3 p)
        {
            FreePacks.Spawn(DressVocab.Table(), root, p + new Vector3(3.2f, 0, 2), 20, 1.4f);
            FreePacks.Spawn(DressVocab.Chair(), root, p + new Vector3(2.4f, 0, 2.4f), 40, 0.9f);
            FreePacks.Spawn(DressVocab.Chair(), root, p + new Vector3(3.8f, 0, 1.5f), 200, 0.9f);
            FreePacks.Spawn("loungeSofa", root, p + new Vector3(4.6f, 0, 0.4f), 90, 1.6f);
            FreePacks.Spawn("lampRoundFloor", root, p + new Vector3(5.2f, 0, 2.2f), 0, 1.4f);
            CookStation.Stamp(FreePacks.Spawn("kitchenStove", root, p + new Vector3(-2.4f, 0, 2.2f), 0, 1.2f));
            FreePacks.Spawn(DressVocab.Prop(WorldId.Hub), root, p + new Vector3(2.0f, 0, -1.5f), 0, 0.8f);
            FreePacks.Spawn("burger-cheese", root, p + new Vector3(3.2f, 0.9f, 2), 0, 0.25f);
        }

        void DressForge(Vector3 p)
        {
            FreePacks.Spawn("campfire_stones", root, p + new Vector3(3, 0, 2), 0, 1.6f);
            FreePacks.Spawn("campfire_logs", root, p + new Vector3(3, 0, 2), 0, 1.2f);
            FreePacks.Spawn(DressVocab.Prop(WorldId.Hub), root, p + new Vector3(-2, 0, 2), 90, 1.1f, required: false);
            FreePacks.Spawn(DressVocab.Weapon("sword"), root, p + new Vector3(2, 0, -1), 0, 1.1f);
        }

        void DressArchive(Vector3 p)
        {
            FreePacks.Spawn("bookcaseOpen", root, p + new Vector3(3, 0, 1), 90, 2.2f);
            FreePacks.Spawn("bookcaseClosed", root, p + new Vector3(3.6f, 0, -1), 90, 2.2f);
            FreePacks.Spawn("desk", root, p + new Vector3(-2, 0, 2), 0, 1.6f);
            FreePacks.Spawn("chairDesk", root, p + new Vector3(-2, 0, 1.2f), 0, 0.9f);
            FreePacks.Spawn("books", root, p + new Vector3(-1.5f, 0.9f, 2), 0, 0.4f);
        }

        void DressMarket(Vector3 p)
        {
            FreePacks.Spawn(DressVocab.Crate(), root, p + new Vector3(3, 0, 1), 0, 0.9f);
            FreePacks.Spawn(DressVocab.Prop(WorldId.Hub), root, p + new Vector3(2.2f, 0, 2), 0, 0.9f);
            FreePacks.Spawn(DressVocab.Crate(), root, p + new Vector3(4, 0, 0), 15, 0.9f);
            FreePacks.Spawn("detail-parasol-a", root, p + new Vector3(3.5f, 0, 2.5f), 0, 2.8f);
            FreePacks.Spawn("apple", root, p + new Vector3(3, 0.7f, 1), 0, 0.2f);
            FreePacks.Spawn("bread", root, p + new Vector3(3.4f, 0.7f, 1.2f), 0, 0.25f);
            FreePacks.Spawn("cheese-cut", root, p + new Vector3(2.6f, 0.7f, 1.4f), 0, 0.2f);
            FreePacks.Spawn(DressVocab.Cart(), root, p + new Vector3(-3, 0, 2), 40, 2.2f);
        }

        void DressRoads()
        {
            for (int i = 0; i < 8; i++)
            {
                var a = (i / 8f) * Mathf.PI * 2 + 0.4f;
                var r = 24f;
                FreePacks.Spawn("road-straight", root,
                    new Vector3(Mathf.Cos(a) * r, 0, Mathf.Sin(a) * r),
                    -a * Mathf.Rad2Deg + 90, 6.5f);
            }
            FreePacks.Spawn("road-straight-lightposts", root, new Vector3(14, 0, 4), 90, 6.5f);
        }

        void DressCityRing()
        {
            // When Hub CityAtlas districts drive SettlementCompiler / CityTown, skip the
            // anonymous FreePack house soup — named district bands own the metro mass.
            var hubCities = CityAtlas.For(WorldId.Hub);
            if (hubCities != null && hubCities.Length > 0)
            {
                Debug.Log("[Concordia] DressCityRing skipped — Hub CityAtlas districts=" +
                          string.Join(",", hubCities[0].districts ?? System.Array.Empty<string>()));
                DressRoads();
                return;
            }
            // Vinewood-density Hub metro around Court — FreePack/EvoCatalog only (no Prim megablocks).
            // Rings sit outside Court (~40–120m); HubMetroKm=40 is the soft world field, not spawn radius.
            DressRoads();
            for (int ring = 0; ring < 4; ring++)
            {
                int count = 18 + ring * 8;
                float baseRad = 48f + ring * 22f;
                for (int i = 0; i < count; i++)
                {
                    var a = (i / (float)count) * Mathf.PI * 2 + ring * 0.17f;
                    // Keep north Court approach clear-ish
                    if (ring == 0 && Mathf.Sin(a) > 0.55f && Mathf.Abs(Mathf.Cos(a)) < 0.78f) continue;
                    var rad = baseRad + (i % 5) * 2.4f;
                    var pos = new Vector3(Mathf.Cos(a) * rad, 0f, Mathf.Sin(a) * rad);
                    var yaw = Mathf.Atan2(-Mathf.Cos(a), -Mathf.Sin(a)) * Mathf.Rad2Deg;
                    // Varied heights: towers, midrise, houses — Vinewood silhouette
                    int roll = (i + ring * 3) % 7;
                    if (roll == 0)
                        FreePacks.Spawn(DressVocab.Tower(WorldId.Hub), root, pos, yaw, 11f + ring, required: false, byHeight: true);
                    else if (roll == 1 || roll == 2)
                        FreePacks.Spawn(DressVocab.House(WorldId.Hub), root, pos, yaw, 7.5f + (i % 3), required: false, byHeight: true);
                    else
                        FreePacks.Spawn(DressVocab.House(WorldId.Hub), root, pos, yaw, 5.5f + (ring % 3), required: false, byHeight: true);
                    // Street lamps / signs along curb (lived-in clutter)
                    if (i % 3 == 0)
                        FreePacks.Spawn("road-straight-lightposts", root, pos + new Vector3(Mathf.Cos(a) * 3.2f, 0f, Mathf.Sin(a) * 3.2f), yaw, 4.5f, required: false);
                }
            }
            // Landmarks / unique mass
            EvoCatalog.Spawn(EvoCatalog.SmallA, root, new Vector3(52, 0, 18), Quaternion.Euler(0, 70, 0), 1f);
            EvoCatalog.Spawn(EvoCatalog.Garage, root, new Vector3(48, 0, -12), Quaternion.Euler(0, 90, 0), 1f);
            EvoCatalog.Spawn(EvoCatalog.SmallA, root, new Vector3(-58, 0, 24), Quaternion.Euler(0, -40, 0), 1.1f);
            EvoCatalog.Spawn(EvoCatalog.Garage, root, new Vector3(72, 0, -36), Quaternion.Euler(0, 15, 0), 1f);
        }

        void DressForest()
        {
            for (int i = 0; i < 40; i++)
            {
                var a = (i / 40f) * Mathf.PI * 2 + 0.51f;
                if (Mathf.Sin(a) > 0.62f) continue;
                var rad = 28 + (i % 4) * 3.4f;
                var stem = ForestTrees[i % ForestTrees.Length];
                FreePacks.SpawnStore(stem, root,
                    new Vector3(Mathf.Cos(a) * rad, 0, Mathf.Sin(a) * rad), i * 17f, 8f, required: false, byHeight: false);
                if (i % 3 == 0)
                    FreePacks.SpawnStore(Flowers[0], root,
                        new Vector3(Mathf.Cos(a + 0.08f) * (rad - 2), 0, Mathf.Sin(a + 0.08f) * (rad - 2)), 0, 1.2f, required: false);
            }
        }

        System.Collections.IEnumerator DressForestStaged()
        {
            Debug.Log("[Concordia] LeanPlay: DressForestStaged begin");
            int placed = 0;
            for (int i = 0; i < 40; i++)
            {
                var a = (i / 40f) * Mathf.PI * 2 + 0.51f;
                if (Mathf.Sin(a) > 0.62f) continue;
                var rad = 28 + (i % 4) * 3.4f;
                var stem = ForestTrees[i % ForestTrees.Length];
                FreePacks.SpawnStore(stem, root,
                    new Vector3(Mathf.Cos(a) * rad, 0, Mathf.Sin(a) * rad), i * 17f, 8f, required: false, byHeight: false);
                if (i % 3 == 0)
                    FreePacks.SpawnStore(Flowers[0], root,
                        new Vector3(Mathf.Cos(a + 0.08f) * (rad - 2), 0, Mathf.Sin(a + 0.08f) * (rad - 2)), 0, 1.2f, required: false);
                placed++;
                // One FreePack family per frame — trees are heavy Instantiates.
                yield return null;
            }
            Debug.Log("[Concordia] LeanPlay: DressForestStaged done placed=" + placed + " v2");
        }

        void DressCliffs()
        {
            for (int i = 0; i < 16; i++)
            {
                var a = (i / 16f) * Mathf.PI * 2 + 0.1f;
                var rad = 52f;
                var stem = i % 2 == 0 ? "cliff_large_rock" : "rocks-large";
                FreePacks.Spawn(stem, root,
                    new Vector3(Mathf.Cos(a) * rad, 0, Mathf.Sin(a) * rad), a * Mathf.Rad2Deg, 6f);
            }
        }

        void DressGuests()
        {
            foreach (var n in Canon.HubGuests)
                SpawnGuest(n);
        }

        void SpawnGuest(GuestDef n)
        {
            var look = Appearance.Random(n.id.GetHashCode());
            look.displayName = n.name;
            look.height = Mathf.Clamp(n.height / 1.8f, 0.88f, 1.14f);
            string weapon = null, off = null;
            var job = NpcLife.Job.Wander;
            switch (n.id)
            {
                case "warden": weapon = "spear"; off = "shield-rectangle"; job = NpcLife.Job.Watch; look.outfit = 1; look.attitude = 2; break;
                case "lamplighter": weapon = "staff"; job = NpcLife.Job.Sweep; look.outfit = 0; look.attitude = 3; break;
                case "elias": weapon = "dagger"; look.outfit = 5; look.attitude = 1; break;
                case "vesper": weapon = "staff"; look.outfit = 0; look.attitude = 3; break;
                case "seraphine": weapon = "dagger"; look.outfit = 4; look.attitude = 2; break;
                case "jax": weapon = "shortsword"; look.outfit = 5; look.attitude = 1; break;
                case "mama": weapon = "mace"; job = NpcLife.Job.Stall; look.outfit = 4; look.attitude = 3; break;
                case "zero": weapon = "wand"; look.outfit = 2; look.attitude = 0; break;
                case "nyx": weapon = "dagger"; look.outfit = 2; look.attitude = 1; break;
                case "thorne": weapon = "greatsword"; look.outfit = 1; look.attitude = 2; look.height = 1.12f; break;
                case "lyra": weapon = "staff"; look.outfit = 0; look.attitude = 0; break;
                case "asbir": weapon = "staff"; job = NpcLife.Job.Watch; look.outfit = 0; look.attitude = 0; break;
                case "brackish": job = NpcLife.Job.Wander; look.outfit = 5; look.attitude = 1; look.height = 0.9f; break;
                case "oldseam": job = NpcLife.Job.Sweep; look.outfit = 1; look.attitude = 3; break;
            }
            var wander = false;
            var pos = new Vector3(n.x, 0f, n.z);
            if (pos.sqrMagnitude < 22f * 22f)
            {
                var dir = pos.sqrMagnitude > 0.4f ? pos.normalized : Vector3.right;
                pos = dir * 26f;
            }
            var go = ModularPerson.SpawnNpc(root, pos, 180f, look, wander, n.id == "warden" ? 5f : 10f);
            go.name = n.name;
            if (!string.IsNullOrEmpty(weapon)) CharacterGear.Attach(go, DressVocab.Weapon(weapon), true, 0.95f);
            if (!string.IsNullOrEmpty(off)) CharacterGear.Attach(go, off, false, 0.7f);
            var guest = go.AddComponent<GuestNpc>();
            guest.def = n;
            guest.personId = n.id;
            var life = go.GetComponent<NpcLife>() ?? go.AddComponent<NpcLife>();
            life.job = job;
        }

        void DressPillars()
        {
            foreach (var n in Canon.Pillars)
                SpawnPillar(n);
        }

        void SpawnPillar(GuestDef n)
        {
            var look = new Appearance
            {
                displayName = n.name,
                height = Mathf.Clamp(n.height / 1.8f, 0.95f, 1.16f),
                width = 1f,
                shoulders = n.id == "sovereign" ? 1.18f : 1f,
                chest = 1f,
                hips = 1f,
                head = 1f,
                jaw = n.id == "sovereign" ? 1.12f : 1f
            };
            float yaw;
            if (n.id == "concordia")
            {
                look.skin = 0.34f;
                look.hairHue = 0.07f;
                look.hairSat = 0.55f;
                look.hairVal = 0.12f;
                look.outfit = 0;
                look.attitude = 3;
                look.hairStyle = 4;
                yaw = 0f;
            }
            else if (n.id == "concord")
            {
                look.skin = 0.86f;
                look.hairHue = 0.58f;
                look.hairSat = 0.08f;
                look.hairVal = 0.22f;
                look.outfit = 1;
                look.attitude = 0;
                look.hairStyle = 0;
                yaw = 180f;
            }
            else
            {
                look.skin = 0.26f;
                look.hairHue = 0.04f;
                look.hairSat = 0.35f;
                look.hairVal = 0.08f;
                look.outfit = 5;
                look.attitude = 1;
                look.hairStyle = 1;
                yaw = 90f;
            }
            var pos = new Vector3(n.x, 0f, n.z);
            if (pos.sqrMagnitude < 22f * 22f)
            {
                var dir = pos.sqrMagnitude > 0.4f ? pos.normalized : Vector3.forward;
                pos = dir * 26f;
            }
            var go = ModularPerson.SpawnNpc(root, pos, yaw, look, false);
            go.name = n.name;
            var guest = go.AddComponent<GuestNpc>();
            guest.def = n;
            guest.personId = n.id;
            var life = go.GetComponent<NpcLife>() ?? go.AddComponent<NpcLife>();
            life.job = NpcLife.Job.Watch;
            life.pinned = true;
        }

        void DressGrove()
        {
            var oak = DressVocab.Tree(WorldId.Tunya);
            var grass = DressVocab.Grass(WorldId.Tunya);
            for (int i = 0; i < 18; i++)
            {
                var a = (i / 18f) * Mathf.PI * 1.1f + 3.4f;
                var rad = 36 + (i % 4) * 3.2f;
                var h = 9f + (i % 5) * 1.4f;
                FreePacks.Spawn(oak, root,
                    new Vector3(Mathf.Cos(a) * rad, 0, Mathf.Sin(a) * rad), i * 21f, h);
            }
            for (int i = 0; i < 40; i++)
            {
                var a = (i / 40f) * Mathf.PI * 2;
                if (a > 1.1f && a < 2.1f) continue;
                var rad = 14.5f + (i % 5) * 1.7f;
                FreePacks.Spawn(grass, root,
                    new Vector3(Mathf.Cos(a) * rad, 0, Mathf.Sin(a) * rad), i * 40f, 0.55f);
            }
        }

        static void MarkStage(string stage)
        {
            try
            {
                System.IO.File.WriteAllText(
                    System.IO.Path.Combine(Application.dataPath, "Concordia/Generated/runtime-stage.txt"),
                    System.DateTime.UtcNow.ToString("o") + " " + stage);
            }
            catch { }
            Debug.Log("[Concordia] " + stage);
        }

void BuildRealm(WorldDef w)
        {
            ReturnPortal(w);
            var lore = WorldBook.Lore(w.id);
            var stone = MakeBox("Waystone", new Vector3(2.2f, 0, 1.4f), new Vector3(0.7f, 2.1f, 0.7f), w.sun);
            var ls = stone.AddComponent<LoreStone>();
            ls.title = string.IsNullOrEmpty(lore.world_name) ? w.title : lore.world_name;
            var desc = string.IsNullOrEmpty(lore.world_description) ? w.law : lore.world_description;
            ls.text = desc + "\n\n" + w.law + " Live steel is allowed here. Flower-law is the Unburned Court only.";

            ModularPerson.CastingWorld = w.id;
            WorldKit.Build(root, w);
            if (w.id == WorldId.Fantasy)
                DressSunderingArrival();
            RealmFill.Populate(root, w.id, false); // people only via PeopleStaged
            {
                var host = ContinentStream.Live;
                if (host) host.StartCoroutine(RealmFill.PeopleStaged(root, w.id));
                else
                {
                    var runner = root.gameObject.GetComponent<StreamSeedRunner>()
                        ?? root.gameObject.AddComponent<StreamSeedRunner>();
                    runner.StartCoroutine(RealmFill.PeopleStaged(root, w.id));
                }
            }
            GoldenSliceRuntime.Present(w, root);
            StoreDress.Realm(root, w);
            // Gym dummy stays in the Hub Arena. A Present that greets you with
            // HumanDummy_M White is not a city — 2026-09-14 kill smelled like kit.
            RoadWorld.PlaceArrivalFight(root, w);
        }

System.Collections.IEnumerator BuildRealmStaged(WorldDef w)
        {
            ReturnPortal(w);
            var lore = WorldBook.Lore(w.id);
            var stone = MakeBox("Waystone", new Vector3(2.2f, 0, 1.4f), new Vector3(0.7f, 2.1f, 0.7f), w.sun);
            var ls = stone.AddComponent<LoreStone>();
            ls.title = string.IsNullOrEmpty(lore.world_name) ? w.title : lore.world_name;
            var desc = string.IsNullOrEmpty(lore.world_description) ? w.law : lore.world_description;
            ls.text = desc + "\n\n" + w.law + " Live steel is allowed here. Flower-law is the Unburned Court only.";
            yield return null;

            MarkStage("staged realm " + w.id + " phase=worldkit");
            ModularPerson.CastingWorld = w.id;
            WorldKit.Build(root, w);
            yield return null;
            MarkStage("staged realm " + w.id + " phase=worldkit_done");
            if (w.id == WorldId.Fantasy)
            {
                DressSunderingArrival();
                yield return null;
            }
            MarkStage("staged realm " + w.id + " phase=realmfill");
            RealmFill.Populate(root, w.id, false);
            yield return null;
            yield return RealmFill.PeopleStaged(root, w.id);
            MarkStage("staged realm " + w.id + " phase=realmfill_done");
            MarkStage("staged realm " + w.id + " phase=goldenslice");
            GoldenSliceRuntime.Present(w, root);
            yield return null;
            MarkStage("staged realm " + w.id + " phase=goldenslice_done");
            StoreDress.Realm(root, w);
            yield return null;
            MarkStage("staged realm " + w.id + " phase=storedress_done");
            RoadWorld.PlaceArrivalFight(root, w);
            yield return null;
            MarkStage("staged realm " + w.id + " phase=arrivalfight_done");
        }


        void ReturnPortal(WorldDef w)
        {
            var p = new Vector3(0f, 0f, -12f);
            var hold = new GameObject("Gate_HUB").transform;
            hold.SetParent(root, false);
            hold.position = p;
            hold.rotation = Quaternion.LookRotation(Vector3.forward);
            var bronze = HubLook.Lit(new Color(0.55f, 0.32f, 0.14f), 0.7f, 0.45f);
            var gold = HubLook.Lit(new Color(0.78f, 0.58f, 0.22f), 0.85f, 0.7f);
            HubLook.Prim(hold, PrimitiveType.Cube, new Vector3(-3.2f, 5f, 0f), new Vector3(1.2f, 10f, 1.6f), bronze, "PillarL");
            HubLook.Prim(hold, PrimitiveType.Cube, new Vector3(3.2f, 5f, 0f), new Vector3(1.2f, 10f, 1.6f), bronze, "PillarR");
            HubLook.Prim(hold, PrimitiveType.Cube, new Vector3(0f, 10.2f, 0f), new Vector3(8f, 1.4f, 1.8f), gold, "Lintel");
            var portal = HubLook.Prim(hold, PrimitiveType.Cylinder, Vector3.zero, new Vector3(5.2f, 0.12f, 8.5f), HubLook.Emit(Canon.Hex("d8c8a8"), 3.2f), "Portal", false);
            portal.transform.localPosition = new Vector3(0f, 4.6f, 0.15f);
            portal.transform.localRotation = Quaternion.Euler(90f, 0f, 0f);
            var label = new GameObject("Name").AddComponent<TextMesh>();
            label.transform.SetParent(hold, false);
            label.transform.localPosition = new Vector3(0f, 11.4f, 0.2f);
            label.text = "THE HUB";
            label.fontSize = 28;
            label.characterSize = 0.032f;
            label.anchor = TextAnchor.MiddleCenter;
            label.alignment = TextAlignment.Center;
            label.color = Color.white;
            HubLook.DressTextMesh(label);
            var go = hold.gameObject;
            go.AddComponent<WorldGate>().def = new GateDef
            {
                world = WorldId.Hub,
                name = "The Unburned Court",
                shortName = "HUB",
                refusal = "You cannot own the heart.",
                theNo = "Walk it.",
                color = Canon.Hex("d8c8a8")
            };
            var box = go.AddComponent<BoxCollider>();
            box.center = new Vector3(0f, 2f, 0f);
            box.size = new Vector3(6.4f, 5f, 2.2f);
            box.isTrigger = true;
        }

        void DressLore()
        {
            PlaceStone(new Vector3(4.8f, 0f, -3.2f), "The Ground She Made Hers",
                "Dig far enough beneath any district and you reach the same thing: Concordia, listening. The hub is not built on her. It is built of her.");
            PlaceStone(new Vector3(-5.1f, 0f, -2.4f), "The Ring of Doors",
                "Eight gates around the old battlefield, left unpaved. They still call it the Unburned Court, though nothing there ever burned.");
            PlaceStone(new Vector3(0.4f, 0f, 6.6f), "The Night Someone Tried",
                "They held the Court four hours. Then the ground spoke in flowers. No one died. You cannot own the heart.");
            PlaceStone(new Vector3(8.2f, 0f, 2.1f), "Flower-law",
                "No live steel in the Court. Blades die as flowers — except in the Arena sand, where the Warden keeps poise, not luck.");
            PlaceStone(new Vector3(-7.4f, 0f, 3.2f), "The Ninth",
                "Lyra will not teach a ninth Refusal. It is not spoken. It is stood upon. I refuse to let my own refusal win.");
            DressSereWaystone();
        }

        void DressSereWaystone()
        {
            // Not a ninth Refusal door. Sere is extra-canonical satire —
            // the First Launch Cradle from the authored Concord Link anchor.
            var p = new Vector3(14.2f, 0f, -18.4f);
            PlaceStone(p, "The First Launch Cradle",
                "The scorched gantry-field the seven arks left from. Cold for generations. Sere is not on the Ring. No Refusal ever held there.");
            var go = new GameObject("Waystone_Sere");
            go.transform.SetParent(root, false);
            go.transform.position = p + Vector3.up * 0.2f;
            go.AddComponent<WorldGate>().def = new GateDef
            {
                world = WorldId.Sere,
                name = "The First Launch Cradle",
                shortName = "SERE",
                refusal = "No Refusal ever held here.",
                theNo = "The seven arks left from this soil.",
                color = Canon.Hex("8a7a3a")
            };
            var box = go.AddComponent<BoxCollider>();
            box.center = new Vector3(0f, 1.2f, 0f);
            box.size = new Vector3(2.8f, 2.4f, 2.2f);
            box.isTrigger = true;
        }

        void PlaceStone(Vector3 pos, string title, string text)
        {
            var mat = HubLook.WetStone("cobblestone_square", 2.2f);
            var plinth = HubLook.Prim(root, PrimitiveType.Cube, pos + Vector3.up * 0.45f, new Vector3(0.85f, 0.9f, 0.22f),
                mat, "Lore_" + title.Replace(" ", ""));
            var lore = plinth.AddComponent<LoreStone>();
            lore.title = title;
            lore.text = text;
            HubLook.Prim(root, PrimitiveType.Cube, pos + Vector3.up * 0.08f, new Vector3(1.1f, 0.12f, 0.4f),
                mat, "LoreBase_" + title.Replace(" ", ""), false);
        }

        void SpawnFauna(WorldDef w)
        {
            if (w.id == WorldId.Hub)
            {
                var bird = DressVocab.Bird();
                if (string.IsNullOrEmpty(bird)) return;
                for (int i = 0; i < 8; i++)
                {
                    var go = CreatureCompiler.Compile(root, new CreatureCard
                    {
                        id = "hub-flock-" + i,
                        speciesId = bird,
                        topology = "winged_biped",
                        generation = 0,
                        fly = true,
                        lifestyle = "omnivore",
                    }, Vector3.zero, w);
                    if (!go) break;
                    var orbit = go.GetComponent<FlockOrbit>() ?? go.AddComponent<FlockOrbit>();
                    orbit.radius = 10f + (i % 5) * 3.2f;
                    orbit.height = 6.5f + (i % 4) * 1.4f;
                }
                return;
            }
            if (w.fauna == null) return;
            int n = 0;
            for (int i = 0; i < w.fauna.Length && n < 6; i++)
            {
                var kind = w.fauna[i];
                if (string.IsNullOrEmpty(kind)) continue;
                var a = n / 6f * Mathf.PI * 2f;
                var p = new Vector3(Mathf.Cos(a) * 18f, 0f, Mathf.Sin(a) * 18f);
                var go = CreatureCompiler.FromKind(root, kind, p, w);
                if (go) n++;
            }
            DressGroveBirds(w);
        }

        void DressGroveBirds(WorldDef w)
        {
            var bird = DressVocab.Bird();
            if (string.IsNullOrEmpty(bird)) return;
            for (int i = 0; i < 3; i++)
            {
                float a = i / 3f * Mathf.PI * 2f + 0.3f;
                var p = new Vector3(Mathf.Cos(a) * 9f, 0f, Mathf.Sin(a) * 9f);
                CreatureCompiler.Compile(root, new CreatureCard
                {
                    id = w.id + "-grove-bird-" + i,
                    speciesId = bird,
                    topology = "winged_biped",
                    generation = 0,
                    fly = true,
                }, p, w);
            }
        }

        void PlaceLandmark(string path, Vector3 pos, float height, string plan)
        {
            var go = EvoCatalog.Spawn(path, root, pos, Quaternion.identity, 1f, height);
            BuildingInterior.Open(go, plan, pos);
        }

        GameObject MakeBox(string name, Vector3 pos, Vector3 size, Color c)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
            go.name = name;
            go.transform.SetParent(root, false);
            go.transform.position = pos + Vector3.up * (size.y * 0.5f);
            go.transform.localScale = size;
            Tint(go, c);
            return go;
        }

        GameObject MakeCapsule(string name, Vector3 pos, float h, Color c)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Capsule);
            go.name = name;
            go.transform.SetParent(root, false);
            go.transform.position = pos + Vector3.up * (h * 0.5f);
            go.transform.localScale = new Vector3(0.45f, h * 0.5f, 0.45f);
            Tint(go, c);
            return go;
        }

        static void Tint(GameObject go, Color c)
        {
            var r = go.GetComponent<Renderer>();
            if (!r) return;
            r.sharedMaterial = HubLook.Lit(c, 0.04f, 0.22f);
        }

        static void TintFallback(GameObject go, Color c)
        {
            var r = go.GetComponent<Renderer>();
            if (!r || r.sharedMaterial == null) Tint(go, c);
        }

        /// <summary>
        /// Live kernel buildings from scene:data. Local Kenney dressing stays;
        /// this overlay is which buildings exist right now, not how the hub looks.
        /// </summary>
        public static void ClearKernelLive(WorldId world)
        {
            var chunk = ChunkRoot(world);
            if (!chunk) return;
            var old = chunk.Find("KernelLive");
            if (old) Object.DestroyImmediate(old.gameObject);
        }

        /// <summary>
        /// One building from scene:data's `world_buildings` rows. Routes through the real
        /// modular compiler (Settlement.SettlementCompiler) so a kernel-authored forge or
        /// market gets actual facade geometry keyed to its own building_type, not one Kenney
        /// house scaled to whatever size happened to arrive. Falls back to that same generic
        /// house only when the kit genuinely isn't ready yet — never to nothing, since the
        /// old behavior (a visible building, just an honest one) is still better than an
        /// empty gap while the compiler's async import is in flight.
        /// </summary>
        public static void PlaceKernelBuilding(WorldId world, string id, string type, string name,
                                               string material, Vector3 pos, float yawRad, Vector3 scale,
                                               string state, int floors, string purpose, string districtId)
        {
            var chunk = ChunkRoot(world);
            if (!chunk) return;
            var holder = chunk.Find("KernelLive");
            if (!holder)
            {
                var goHolder = new GameObject("KernelLive");
                goHolder.transform.SetParent(chunk, false);
                holder = goHolder.transform;
            }

            var kb = new KernelBuilding
            {
                Id = id, Type = type, Name = name, Material = material,
                Position = pos, RotationY = yawRad * Mathf.Rad2Deg,
                Width = scale.x, Depth = scale.z, Height = scale.y,
                Floors = floors, State = state, Purpose = purpose, DistrictId = districtId
            };
            var label = string.IsNullOrEmpty(id) ? "KernelBuilding" : "KernelBuilding_" + id;
            _ = PlaceKernelBuildingAsync(holder, world, kb, label);
        }

        /// <summary>LeanPlay staged path: light impostor (no SettlementCompiler — that froze Play at cap 24).</summary>
        public static System.Threading.Tasks.Task PlaceKernelBuildingTask(WorldId world, string id, string type, string name,
                                               string material, Vector3 pos, float yawRad, Vector3 scale,
                                               string state, int floors, string purpose, string districtId)
        {
            var chunk = ChunkRoot(world);
            if (!chunk) return System.Threading.Tasks.Task.CompletedTask;
            var holder = chunk.Find("KernelLive");
            if (!holder)
            {
                var goHolder = new GameObject("KernelLive");
                goHolder.transform.SetParent(chunk, false);
                holder = goHolder.transform;
            }
            var label = string.IsNullOrEmpty(id) ? "KernelBuilding" : "KernelBuilding_" + id;
            // LeanPlay: real SettlementCompiler.CompileOne (staged by ApplyScene) — no cube stubs.
            var kb = new KernelBuilding
            {
                Id = id, Type = type, Name = name, Material = material,
                Position = pos, RotationY = yawRad * Mathf.Rad2Deg,
                Width = scale.x, Depth = scale.z, Height = scale.y,
                Floors = floors, State = state, Purpose = purpose, DistrictId = districtId
            };
            return PlaceKernelBuildingAsync(holder, world, kb, label);
        }

        static Material _leanStubMat;

        static Material LeanStubMat()
        {
            if (_leanStubMat) return _leanStubMat;
            var sh = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard") ?? Shader.Find("Diffuse");
            _leanStubMat = sh ? new Material(sh) { color = new Color(0.42f, 0.40f, 0.38f) } : null;
            return _leanStubMat;
        }

        static void PlaceKernelBuildingLeanStub(Transform holder, string label, Vector3 pos, float yawRad, Vector3 scale, string type)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
            go.name = label;
            go.transform.SetParent(holder, false);
            var sx = Mathf.Max(0.8f, Mathf.Abs(scale.x) > 0.01f ? scale.x : 2.4f);
            var sy = Mathf.Max(0.8f, Mathf.Abs(scale.y) > 0.01f ? scale.y : 2.2f);
            var sz = Mathf.Max(0.8f, Mathf.Abs(scale.z) > 0.01f ? scale.z : 2.4f);
            go.transform.localScale = new Vector3(sx, sy, sz);
            go.transform.position = pos + Vector3.up * (sy * 0.5f);
            go.transform.rotation = Quaternion.Euler(0f, yawRad * Mathf.Rad2Deg, 0f);
            var rend = go.GetComponent<Renderer>();
            if (rend && LeanStubMat())
                rend.sharedMaterial = LeanStubMat();
            // Drop collider — CreatePrimitive collider + dense Court was expensive.
            var col = go.GetComponent<Collider>();
            if (col) Object.Destroy(col);
        }

        static async System.Threading.Tasks.Task PlaceKernelBuildingAsync(Transform holder, WorldId world, KernelBuilding kb, string label)
        {
            try
            {
                var go = await SettlementCompiler.CompileOne(holder, world, kb);
                if (go) { go.name = label; return; }
            }
            catch (System.Exception e)
            {
                Debug.LogWarning("Concordia WorldBuilder: kernel building compile failed for '" + label + "': " + e.Message);
            }
            // Honest fallback: the modular kit wasn't ready (or the row is malformed) —
            // still show SOMETHING at the kernel's real position rather than a gap.
            if (!holder) return;
            var maxDim = Mathf.Max(kb.Width, Mathf.Max(kb.Height, kb.Depth));
            if (maxDim < 1.6f) maxDim = 3.2f;
            var stem = DressVocab.House(world == WorldId.Hub ? WorldId.Hub : world);
            var fallback = FreePacks.Spawn(stem, holder, kb.Position, kb.RotationY, maxDim);
            if (fallback) fallback.name = label;
        }
    

void DressSunderingArrival()
        {
            var arrival = new GameObject("SunderingArrival").transform;
            arrival.SetParent(root, false);

            var pathMat = HubLook.Pbr("stone_tiles", new Color(0.20f, 0.32f, 0.20f), 0.02f, 0.22f, 8f);
            var start = new Vector3(0f, 0.06f, -7f);
            var end = new Vector3(4f, 0.06f, 8f);
            var dir = end - start;
            dir.y = 0f;
            var count = Mathf.Max(3, Mathf.CeilToInt(dir.magnitude / 4.2f));
            var yaw = Quaternion.LookRotation(dir.normalized).eulerAngles.y;

            for (int i = 0; i < count; i++)
            {
                var t = (i + 0.5f) / count;
                var p = Vector3.Lerp(start, end, t);
                var tile = FreePacks.Spawn("road-straight", arrival, p, yaw, 4.2f, false, false)
                           ?? FreePacks.Spawn("road-straight-half", arrival, p, yaw, 4.2f, false, false);
                if (!tile)
                    HubLook.Prim(arrival, PrimitiveType.Cube, p, new Vector3(2.2f, 0.08f, 2.8f), pathMat,
                        "SunderingPath_" + i, false);
            }

            FreePacks.Spawn("tower-square-base", arrival, new Vector3(-3.4f, 0f, -5.8f), 0f, 5.2f, false);
            FreePacks.Spawn("tower-square-base", arrival, new Vector3(3.4f, 0f, -5.8f), 180f, 5.2f, false);
            FreePacks.Spawn("banner-red", arrival, new Vector3(-3.4f, 3.8f, -5.8f), 0f, 2.8f, false);
            FreePacks.Spawn("banner-red", arrival, new Vector3(3.4f, 3.8f, -5.8f), 180f, 2.8f, false);
            FreePacks.Spawn("campfire_stones", arrival, new Vector3(-5.2f, 0f, 2.2f), 0f, 1.25f, false);
            HubLook.Point(arrival, "SunderingEntryLight", new Vector3(0f, 3.4f, -6.4f), new Color(0.82f, 1f, 0.42f), 1.5f, 12f, true);
            HubLook.Point(arrival, "SunderingEncounterLight", new Vector3(4f, 2.6f, 8f), new Color(1f, 0.28f, 0.12f), 1.25f, 10f, false);

            PlaceStone(new Vector3(1.8f, 0f, -1.6f), "The Sundering Road",
                "Past the Court, steel is live. The road does not promise that the thing ahead will wait for you.");
            Beacon(root, new Vector3(4f, 0f, 8f), 8f, "sundering", "first_fight", "live_steel");
        }
}
}
