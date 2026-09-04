using System.Collections.Generic;
using System.IO;
using UnityEngine;
#if UNITY_EDITOR
using UnityEditor;
#endif

namespace Concordia
{
    /// <summary>
    /// Resolves Kenney CC0 + KayKit hub-kit meshes by filename.
    /// Editor: AssetDatabase (kitchen kenney-free) then the committed HubKit.
    /// Player / WebGL: HubKit only (StreamingAssets + glTFast). Never Editor-only.
    /// </summary>
    public static class FreePacks
    {
        static Dictionary<string, string> _meshes;
        static bool _indexed;

        public static void Index()
        {
#if UNITY_EDITOR
            if (_indexed) return;
            _meshes = new Dictionary<string, string>(4096);
            var folders = new[]
            {
                "Assets/Concordia/Models",
                "Assets/Prefabs",
                "Assets/SourceFiles",
                "Assets/VFX",
                "Assets/Audio",
                "Assets/Store",
                "Assets/AssetStore",
                "Assets/FreeAssets"
            };
            foreach (var guid in AssetDatabase.FindAssets("t:GameObject", folders))
            {
                var path = AssetDatabase.GUIDToAssetPath(guid);
                var stem = Path.GetFileNameWithoutExtension(path).ToLowerInvariant();
                if (stem.EndsWith(".prefab")) stem = stem.Replace(".prefab", "");
                if (!_meshes.ContainsKey(stem))
                    _meshes[stem] = path;
                else if (IsStorePath(path))
                    _meshes[stem] = path;
                else if (path.Contains("kenney-free") && !IsStorePath(_meshes[stem]))
                    _meshes[stem] = path;
            }
            _indexed = true;
            Debug.Log("Concordia FreePacks indexed " + _meshes.Count + " meshes");
#endif
        }

        public static GameObject Mesh(string stem)
        {
            if (string.IsNullOrEmpty(stem)) return null;
            var key = HubKit.Alias(stem);
            Index();
#if UNITY_EDITOR
            if (TryLoadIndexed(key, storeOnly: true, out var store)) return store;
#endif
            if (HubKit.TryGet(key, out var kit) && kit) return kit;
#if UNITY_EDITOR
            if (TryLoadIndexed(key, storeOnly: false, out var indexed)) return indexed;
            if (TryLoadIndexed(stem.ToLowerInvariant(), storeOnly: false, out var raw)) return raw;
#endif
            return null;
        }

        static bool IsStorePath(string path) =>
            path.Contains("/Store/") || path.Contains("/AssetStore/") || path.Contains("/FreeAssets/");

#if UNITY_EDITOR
        static bool TryLoadIndexed(string key, bool storeOnly, out GameObject go)
        {
            go = null;
            if (_meshes == null || !_meshes.TryGetValue(key, out var path)) return false;
            if (storeOnly && !IsStorePath(path)) return false;
            go = AssetDatabase.LoadAssetAtPath<GameObject>(path);
            return go;
        }
#endif

        public static bool HasStem(string stem) => Mesh(stem) != null;

        public static string[] IndexedStems()
        {
            Index();
#if UNITY_EDITOR
            if (_meshes == null) return System.Array.Empty<string>();
            var keys = new string[_meshes.Count];
            _meshes.Keys.CopyTo(keys, 0);
            return keys;
#else
            return System.Array.Empty<string>();
#endif
        }

        public static T Load<T>(string path) where T : Object
        {
#if UNITY_EDITOR
            return AssetDatabase.LoadAssetAtPath<T>(path);
#else
            return null;
#endif
        }

        public static GameObject Spawn(string stem, Transform parent, Vector3 pos, float yawDeg = 0, float maxDim = 0, bool required = false, bool byHeight = true)
        {
            var prefab = Mesh(stem);
            GameObject go;
            if (prefab)
            {
                go = Object.Instantiate(prefab, parent);
                go.name = stem;
                go.SetActive(true);
            }
            else
            {
                if (!required) return null;
                go = GameObject.CreatePrimitive(PrimitiveType.Cube);
                go.name = "Missing_" + stem;
                go.transform.SetParent(parent, false);
                go.transform.localScale = Vector3.one * 0.35f;
            }
            go.transform.rotation = Quaternion.Euler(0, yawDeg, 0);
            if (maxDim > 0.01f)
            {
                if (byHeight) FitHeight(go, maxDim);
                else FitMax(go, maxDim);
            }
            Sit(go, pos);
            PaintIfBlank(go);
            var kind = stem.ToLowerInvariant();
            if (IsTree(kind)) TrunkCollider(go);
            else if (WantsSolid(kind, maxDim)) MakeWalkable(go);
            else StripColliders(go);
            return go;
        }

        static bool IsTree(string s) =>
            s.Contains("tree") || s.Contains("palm") || s.Contains("pine");

        static bool WantsSolid(string s, float maxDim)
        {
            if (s.Contains("grass") || s.Contains("flower") || s.Contains("plant")
                || s.Contains("flag") || s.Contains("banner") || s.Contains("lantern")
                || s.Contains("lamp") || s.Contains("fountain") || s.Contains("parasol")
                || s.Contains("hedge") || s.Contains("weapon") || s.Contains("sword")
                || s.Contains("trophy") || s.Contains("apple") || s.Contains("bread")
                || s.Contains("cheese") || s.Contains("burger") || s.Contains("books")
                || s.Contains("crops") || s.StartsWith("detail-") || s.Contains("character-")
                || s.Contains("astronaut") || s.Contains("enemy") || s.Contains("statue"))
                return false;
            if (s.Contains("building") || s.Contains("wall") || s.Contains("tower")
                || s.Contains("crypt") || s.Contains("house") || s.Contains("road")
                || s.Contains("stairs") || s.Contains("column") || s.Contains("tent")
                || s.Contains("room") || s.Contains("crate") || s.Contains("table")
                || s.Contains("barrel") || s.Contains("cart") || s.Contains("desk")
                || s.Contains("bookcase") || s.Contains("sofa") || s.Contains("chair")
                || s.Contains("coffin") || s.Contains("dumpster") || s.Contains("stove"))
                return true;
            return maxDim >= 2.4f;
        }

        public static void StripColliders(GameObject go)
        {
            if (!go) return;
            foreach (var old in go.GetComponentsInChildren<Collider>())
                if (old) Object.Destroy(old);
        }

        /// <summary>Thin trunk so canopy foliage is not a 10m invisible box.</summary>
        public static void TrunkCollider(GameObject go)
        {
            if (!go) return;
            StripColliders(go);
            var cap = go.AddComponent<CapsuleCollider>();
            cap.radius = 0.32f;
            cap.height = 2.6f;
            cap.center = Vector3.up * 1.3f;
        }

        /// <summary>
        /// Local-space box on the object itself. World-AABB WalkColliders on
        /// rotated Kenney meshes were the invisible walls across the plaza.
        /// </summary>
        public static void MakeWalkable(GameObject go)
        {
            if (!go) return;
            if (go.GetComponentInChildren<SkinnedMeshRenderer>()) return;
            StripColliders(go);
            var rends = go.GetComponentsInChildren<Renderer>();
            if (rends.Length == 0) return;
            bool any = false;
            var local = new Bounds(Vector3.zero, Vector3.zero);
            foreach (var r in rends)
            {
                if (!r || !r.enabled) continue;
                var b = r.localBounds;
                var c = b.center;
                var e = b.extents;
                for (int i = 0; i < 8; i++)
                {
                    var corner = c + new Vector3(
                        (i & 1) == 0 ? -e.x : e.x,
                        (i & 2) == 0 ? -e.y : e.y,
                        (i & 4) == 0 ? -e.z : e.z);
                    var lp = go.transform.InverseTransformPoint(r.transform.TransformPoint(corner));
                    if (!any) { local = new Bounds(lp, Vector3.zero); any = true; }
                    else local.Encapsulate(lp);
                }
            }
            if (!any || local.size.y < 0.12f) return;
            var box = go.AddComponent<BoxCollider>();
            box.center = local.center;
            box.size = local.size;
        }

        public static void FlattenDisc(GameObject cylinder)
        {
            if (!cylinder) return;
            var cap = cylinder.GetComponent<Collider>();
            if (cap) Object.Destroy(cap);
            var box = cylinder.AddComponent<BoxCollider>();
            box.center = Vector3.zero;
            box.size = new Vector3(1f, 2f, 1f);
        }

        public static void Sit(GameObject go, Vector3 pos)
        {
            go.transform.position = pos;
            var rends = go.GetComponentsInChildren<Renderer>();
            if (rends.Length == 0) return;
            var b = rends[0].bounds;
            for (int i = 1; i < rends.Length; i++) b.Encapsulate(rends[i].bounds);
            go.transform.position += Vector3.up * (pos.y - b.min.y);
        }

        public static void FitMax(GameObject go, float want)
        {
            var b = Encapsulate(go);
            var m = Mathf.Max(b.size.x, Mathf.Max(b.size.y, b.size.z));
            if (m < 0.001f) return;
            go.transform.localScale *= want / m;
        }

        public static void FitHeight(GameObject go, float wantY)
        {
            var b = Encapsulate(go);
            if (b.size.y < 0.001f) return;
            go.transform.localScale *= wantY / b.size.y;
        }

        static Bounds Encapsulate(GameObject go)
        {
            var rends = go.GetComponentsInChildren<Renderer>();
            if (rends.Length == 0) return new Bounds(go.transform.position, Vector3.one * 0.01f);
            var b = rends[0].bounds;
            for (int i = 1; i < rends.Length; i++) b.Encapsulate(rends[i].bounds);
            return b;
        }

        public static void ApplyMat(GameObject go, string matPath)
        {
            var mat = Load<Material>(matPath);
            if (!mat) return;
            foreach (var r in go.GetComponentsInChildren<Renderer>())
                r.sharedMaterial = mat;
        }

        public static void Sky(string matPath)
        {
            var mat = Load<Material>(matPath);
            if (mat) RenderSettings.skybox = mat;
            DynamicGI.UpdateEnvironment();
        }

        public static GameObject Prefab(string path, Transform parent, Vector3 pos, float yawDeg = 0)
        {
            var p = Load<GameObject>(path);
            if (!p) return null;
            var go = Object.Instantiate(p, parent);
            go.transform.position = pos;
            go.transform.rotation = Quaternion.Euler(0, yawDeg, 0);
            return go;
        }

        /// <summary>
        /// Kenney GLBs often land white because URP never got the colormap.
        /// Steal albedo from the mesh's own material, else the pack colormap.
        /// </summary>
        public static void PaintIfBlank(GameObject go)
        {
            if (!go) return;
            foreach (var r in go.GetComponentsInChildren<Renderer>(true))
            {
                if (!r) continue;
                var src = r.sharedMaterial;
                Texture tex = null;
                if (src)
                {
                    if (src.HasProperty("_BaseMap")) tex = src.GetTexture("_BaseMap");
                    if (!tex && src.HasProperty("_MainTex")) tex = src.GetTexture("_MainTex");
                    if (!tex && src.HasProperty("_baseColorTexture")) tex = src.GetTexture("_baseColorTexture");
                }
#if UNITY_EDITOR
                if (!tex)
                {
                    var path = AssetDatabase.GetAssetPath(go);
                    if (string.IsNullOrEmpty(path))
                    {
                        var prefab = PrefabUtility.GetCorrespondingObjectFromSource(go);
                        if (prefab) path = AssetDatabase.GetAssetPath(prefab);
                    }
                    if (!string.IsNullOrEmpty(path))
                    {
                        var dir = Path.GetDirectoryName(path)?.Replace("\\", "/");
                        for (int up = 0; up < 4 && !string.IsNullOrEmpty(dir) && !tex; up++)
                        {
                            tex = AssetDatabase.LoadAssetAtPath<Texture2D>(dir + "/colormap.png")
                                  ?? AssetDatabase.LoadAssetAtPath<Texture2D>(dir + "/Textures/colormap.png")
                                  ?? AssetDatabase.LoadAssetAtPath<Texture2D>(dir + "/dungeon_texture.png")
                                  ?? AssetDatabase.LoadAssetAtPath<Texture2D>(dir + "/Textures/dungeon_texture.png");
                            var parent = Path.GetDirectoryName(dir)?.Replace("\\", "/");
                            if (parent == dir) break;
                            dir = parent;
                        }
                    }
                }
#endif
                if (!tex) continue;
                var m = HubLook.Lit(Color.white, 0.04f, 0.28f);
                if (m.HasProperty("_BaseMap")) m.SetTexture("_BaseMap", tex);
                if (m.HasProperty("_MainTex")) m.SetTexture("_MainTex", tex);
                r.sharedMaterial = m;
            }
        }

        public static void EnsureCollider(GameObject go, float height = 1.8f)
        {
            if (go.GetComponentInChildren<Collider>()) return;
            var cap = go.AddComponent<CapsuleCollider>();
            cap.height = height;
            cap.radius = 0.28f;
            cap.center = Vector3.up * (height * 0.5f);
        }
    }

    /// <summary>
    /// Culture → mesh vocabulary. Packs are raw material, never a dependency.
    /// Culture keys come from WorldId (court/grove/ash/street/grid/drift).
    /// First present Store stem wins; Kenney is always the last fallback.
    /// </summary>
    public static class DressVocab
    {
        public static string Culture(WorldId id)
        {
            if (id == WorldId.Hub) return "court";
            if (id == WorldId.Tunya || id == WorldId.Fantasy || id == WorldId.Frontier) return "grove";
            if (id == WorldId.Ruins) return "ash";
            if (id == WorldId.Crime || id == WorldId.Sere) return "street";
            if (id == WorldId.Cyber || id == WorldId.Superhero) return "grid";
            if (id == WorldId.Crucible) return "drift";
            return "grove";
        }

        public static string FirstStem(string[] prefer, string kenney)
        {
            if (prefer != null)
                foreach (var n in prefer)
                    if (!string.IsNullOrEmpty(n) && FreePacks.HasStem(n)) return n;
            return kenney;
        }

        public static string House(WorldId id)
        {
            var c = Culture(id);
            if (c == "grid") return FirstStem(new[] { "Lab_Module", "SciFi_Wall", "console" }, "building-skyscraper-a");
            if (c == "ash") return FirstStem(new[] { "Ruin", "Castle", "Keep" }, "crypt-a");
            if (c == "street") return FirstStem(new[] { "Shop", "Tavern", "House_01" }, "building-type-h");
            if (c == "court") return FirstStem(new[] { "building-type-a" }, "building-type-a");
            if (id == WorldId.Frontier) return FirstStem(new[] { "Hut", "Cottage", "House" }, "tent_detailedOpen");
            if (id == WorldId.Fantasy) return FirstStem(new[] { "House", "Cottage", "Manor" }, "building-small-b");
            return FirstStem(new[] { "House", "Cottage", "Hut", "House_01" }, "tent_detailedOpen");
        }

        public static string Tower(WorldId id)
        {
            if (Culture(id) == "grid") return FirstStem(new[] { "Antenna", "Lab_Tower" }, "watertower");
            return FirstStem(new[] { "Tower", "Keep", "Gatehouse", "watchtower" }, "watchtower");
        }

        public static string Wall(WorldId id) =>
            FirstStem(new[] { "Fort_Wall", "Wall_01", "Palissade", "wall" }, "wall");

        public static string Tree(WorldId id)
        {
            var c = Culture(id);
            if (c == "grid") return FirstStem(new[] { "Antenna", "console" }, "tree-baobab");
            if (c == "ash") return FirstStem(new[] { "DeadTree", "Stump", "tree-dead" }, "tree-dead");
            return FirstStem(new[] { "Pine", "Oak", "Tree_01", "tree-oak", "tree_oak" }, "tree_oak");
        }

        public static string Grass(WorldId id) =>
            FirstStem(new[] { "Grass_01", "Plant", "Fern", "grass_large", "grass" }, "grass");

        public static string Prop(WorldId id)
        {
            var c = Culture(id);
            if (c == "grid") return FirstStem(new[] { "Crate_Metal", "Console" }, "barrel");
            if (c == "street") return FirstStem(new[] { "Crate", "Barrel", "Cart" }, "crate");
            return FirstStem(new[] { "Barrel", "Well", "Cart", "barrel" }, "barrel");
        }

        /// <summary>
        /// Ten building stems. Store names first; Kenney kit names stay the fallback
        /// so a missing pack never blanks a town. Hub never calls this (Court is unpaved).
        /// </summary>
        public static string[] Kit(WorldId id)
        {
            var house = House(id);
            var tower = Tower(id);
            return id switch
            {
                WorldId.Ruins => new[] { house, FirstStem(new[] { "Crypt", "Ruin" }, "crypt-small"), FirstStem(new[] { "Column" }, "column-large"), FirstStem(new[] { "Keep" }, "crypt-large"), FirstStem(new[] { "Altar" }, "altar-stone"), FirstStem(new[] { "Gravestone" }, "gravestone"), house, tower, FirstStem(new[] { "Column" }, "column-large"), house },
                WorldId.Tunya => new[] { house, FirstStem(new[] { "Hut", "Cottage" }, "tent_smallOpen"), Tree(id), FirstStem(new[] { "House_01", "Cottage" }, "building-small-a"), FirstStem(new[] { "Crops", "Wheat" }, "crops_cornStageD"), house, FirstStem(new[] { "Hut" }, "tent_detailedOpen"), Tree(id), house, FirstStem(new[] { "Crops" }, "crops_cornStageD") },
                WorldId.Fantasy => new[] { house, tower, FirstStem(new[] { "Hedge", "hedge-large" }, "hedge-large"), FirstStem(new[] { "House_02", "Cottage" }, "building-small-c"), FirstStem(new[] { "Statue" }, "statue"), tower, house, FirstStem(new[] { "Hedge" }, "hedge-large"), house, tower },
                WorldId.Crime => new[] { house, FirstStem(new[] { "Shop", "Tavern" }, "building-type-c"), FirstStem(new[] { "Warehouse" }, "building-d"), FirstStem(new[] { "House_01" }, "building-small-d"), FirstStem(new[] { "Dumpster" }, "dumpster"), house, FirstStem(new[] { "Shop" }, "building-type-c"), house, FirstStem(new[] { "Dumpster" }, "dumpster"), house },
                WorldId.Cyber => new[] { house, FirstStem(new[] { "Lab_Module", "corridor_end" }, "corridor_end"), FirstStem(new[] { "SciFi_Wall" }, "building-skyscraper-c"), FirstStem(new[] { "Antenna" }, "detail-overhang-wide"), FirstStem(new[] { "Column" }, "column"), house, FirstStem(new[] { "Lab_Module" }, "corridor_end"), house, FirstStem(new[] { "Console" }, "column"), house },
                WorldId.Frontier => new[] { house, FirstStem(new[] { "Cart", "Wagon" }, "cart"), FirstStem(new[] { "Palm", "palm-straight" }, "palm-straight"), FirstStem(new[] { "Hut" }, "tent_smallOpen"), Prop(id), FirstStem(new[] { "Cart" }, "cart"), house, FirstStem(new[] { "Palm" }, "palm-straight"), house, FirstStem(new[] { "Hut" }, "tent_smallOpen") },
                WorldId.Superhero => new[] { house, FirstStem(new[] { "building-type-a" }, "building-type-a"), FirstStem(new[] { "building-skyscraper-b" }, "building-skyscraper-b"), FirstStem(new[] { "building-small-d" }, "building-small-d"), FirstStem(new[] { "building-type-a" }, "building-type-a"), house, FirstStem(new[] { "building-skyscraper-d" }, "building-skyscraper-d"), house, FirstStem(new[] { "building-type-a" }, "building-type-a"), house },
                WorldId.Sere => new[] { house, FirstStem(new[] { "Warehouse" }, "building-type-h"), FirstStem(new[] { "building-skyscraper-e" }, "building-skyscraper-e"), FirstStem(new[] { "House_01" }, "building-small-c"), FirstStem(new[] { "Dumpster" }, "dumpster"), house, FirstStem(new[] { "Shop" }, "building-d"), house, FirstStem(new[] { "Dumpster" }, "dumpster"), house },
                _ => new[] { FirstStem(new[] { "Crystal" }, "detail-crystal-large"), tower, FirstStem(new[] { "Column" }, "column-large"), FirstStem(new[] { "Crypt" }, "crypt-small"), FirstStem(new[] { "Tower" }, "tower-hexagon-base"), FirstStem(new[] { "Crystal" }, "detail-crystal-large"), tower, FirstStem(new[] { "Column" }, "column-large"), house, tower }
            };
        }

        /// <summary>
        /// 100 buildings → 70 exterior / 20 fake windows / 10 playable interiors.
        /// Hero city (index 0) keeps four playable rooms. Cities 1–3 get fake windows.
        /// The rest stay facade-only so Tunya's 17 towns do not hitch.
        /// </summary>
        public static int PlayableRooms(int cityIndex) => cityIndex == 0 ? 4 : 0;
        public static bool WantsFakeWindows(int cityIndex) => cityIndex >= 1 && cityIndex <= 3;

        public static string Audit()
        {
            var sb = new System.Text.StringBuilder();
            sb.AppendLine("CONCORDIA VISUAL FOUNDATION");
            sb.AppendLine("packs are raw material — Kenney is fallback, never the destination");
            sb.AppendLine("culture keys from WorldId: court grove ash street grid drift");
            sb.AppendLine("do not invent place names; no example kingdoms in plaques");
            foreach (var p in Curated)
                sb.AppendLine("  " + p.id + "  " + p.role + "  " + (FolderPresent(p.needles) ? "PRESENT" : "pending (Kenney fallback)"));
            sb.AppendLine("House(Tunya)=" + House(WorldId.Tunya) + " culture=" + Culture(WorldId.Tunya));
            sb.AppendLine("House(Cyber)=" + House(WorldId.Cyber) + " culture=" + Culture(WorldId.Cyber));
            sb.AppendLine("House(Fantasy)=" + House(WorldId.Fantasy) + " culture=" + Culture(WorldId.Fantasy));
            sb.AppendLine("Tree(Tunya)=" + Tree(WorldId.Tunya));
            sb.AppendLine("PlayableRooms hero=" + PlayableRooms(0) + " other=" + PlayableRooms(1));
            sb.AppendLine("FakeWindows cities 1-3=" + WantsFakeWindows(2) + " city4=" + WantsFakeWindows(4));
            return sb.ToString();
        }

        public struct PackHint
        {
            public string id;
            public string role;
            public string[] needles;
        }

        public static readonly PackHint[] Curated =
        {
            new PackHint { id = "167010", role = "medieval town", needles = new[] { "slavic", "medieval environment" } },
            new PackHint { id = "fantasy-town-demo", role = "hero settlement (do not vendor 1.8GB)", needles = new[] { "fantasy town", "medieval fantasy town" } },
            new PackHint { id = "fortification", role = "walls / holds", needles = new[] { "fortification", "medieval fort" } },
            new PackHint { id = "urp-trees", role = "trees", needles = new[] { "urp tree", "tree models" } },
            new PackHint { id = "point-grass", role = "grass coverage", needles = new[] { "point grass", "pointgrass" } },
            new PackHint { id = "lowpoly-veg", role = "bulk flora", needles = new[] { "low poly trees", "vegetation" } },
            new PackHint { id = "mountain", role = "wilderness", needles = new[] { "stylized fantasy environment", "mountain" } },
            new PackHint { id = "melee-anims", role = "combat clips", needles = new[] { "melee animation", "human melee", "human basic motions" } },
            new PackHint { id = "distant-lands", role = "npc archetypes", needles = new[] { "distant lands" } },
            new PackHint { id = "scifi-lab", role = "grid interiors", needles = new[] { "sci-fi lab", "scifi lab" } },
            new PackHint { id = "robot-kyle", role = "grid / industrial npc", needles = new[] { "robot kyle", "robotkyle" } },
            new PackHint { id = "fake-interiors", role = "window density", needles = new[] { "fake interior", "fakeinteriors" } },
            new PackHint { id = "mapmagic2", role = "terrain gen", needles = new[] { "mapmagic" } },
            new PackHint { id = "particle-pack", role = "fx", needles = new[] { "particle pack" } },
            new PackHint { id = "starter-thirdperson", role = "reference only — do not replace Concordia controller", needles = new[] { "starter assets", "thirdperson" } }
        };

        public static bool FolderPresent(string[] needles)
        {
            if (needles == null) return false;
            try
            {
                var assets = Application.dataPath;
                var roots = new[]
                {
                    Path.Combine(assets, "Store"),
                    Path.Combine(assets, "AssetStore"),
                    Path.Combine(assets, "FreeAssets"),
                    assets
                };
                foreach (var root in roots)
                {
                    if (!Directory.Exists(root)) continue;
                    foreach (var dir in Directory.GetDirectories(root))
                    {
                        var name = Path.GetFileName(dir);
                        foreach (var n in needles)
                            if (!string.IsNullOrEmpty(n) && name.IndexOf(n, System.StringComparison.OrdinalIgnoreCase) >= 0)
                                return true;
                    }
                }
                foreach (var stem in FreePacks.IndexedStems())
                    foreach (var n in needles)
                        if (!string.IsNullOrEmpty(n) && stem.IndexOf(n.Replace(" ", ""), System.StringComparison.OrdinalIgnoreCase) >= 0)
                            return true;
            }
            catch { }
            return false;
        }
    }
}
