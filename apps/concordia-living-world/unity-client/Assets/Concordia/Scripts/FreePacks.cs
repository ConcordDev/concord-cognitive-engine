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

        public static void Reindex()
        {
            _indexed = false;
            _meshes = null;
            Index();
        }

        public static void Index()
        {
#if UNITY_EDITOR
            if (_indexed) return;
            _meshes = new Dictionary<string, string>(4096);
            foreach (var guid in AssetDatabase.FindAssets("t:GameObject", SearchFolders()))
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
            Debug.Log("Concordia FreePacks indexed " + _meshes.Count + " meshes (" + StoreStemCount() + " from imported packs)");
#endif
        }

        /// <summary>
        /// Kenney lives under Concordia/Models. My Assets imports usually land as
        /// Assets/Store/… or Assets/<Pack Name>/ — the old fixed folder list
        /// never saw those, so DressVocab kept Kenney even after a real import.
        /// </summary>
        static string[] SearchFolders()
        {
            var list = new List<string>
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
            try
            {
                var assets = Application.dataPath;
                if (Directory.Exists(assets))
                {
                    foreach (var dir in Directory.GetDirectories(assets))
                    {
                        var name = Path.GetFileName(dir);
                        if (IsReservedTop(name)) continue;
                        var assetPath = "Assets/" + name;
                        if (!list.Contains(assetPath)) list.Add(assetPath);
                    }
                }
            }
            catch { }
            return list.ToArray();
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

        static bool IsReservedTop(string name)
        {
            if (string.IsNullOrEmpty(name)) return true;
            switch (name)
            {
                case "Concordia":
                case "Editor":
                case "Settings":
                case "Plugins":
                case "Scenes":
                case "Scripts":
                case "Screenshots":
                case "StreamingAssets":
                    return true;
                default:
                    return false;
            }
        }

        static bool IsStorePath(string path)
        {
            if (string.IsNullOrEmpty(path)) return false;
            var p = path.Replace("\\", "/");
            if (p.Contains("/Store/") || p.Contains("/AssetStore/") || p.Contains("/FreeAssets/"))
                return true;
            if (!p.StartsWith("Assets/")) return false;
            var rest = p.Length > 7 ? p.Substring(7) : "";
            var slash = rest.IndexOf('/');
            var top = slash >= 0 ? rest.Substring(0, slash) : rest;
            return !IsReservedTop(top);
        }

        static bool SkipFuzzy(string stem)
        {
            if (string.IsNullOrEmpty(stem)) return true;
            return stem.Contains("lod2") || stem.Contains("lod3") || stem.Contains("lod4")
                || stem.Contains("collision") || stem.Contains("collider") || stem.StartsWith("col_")
                || stem.Contains("demo") || stem.Contains("screenshot");
        }

        static bool StemHasNeedle(string stem, string needle)
        {
            if (string.IsNullOrEmpty(stem) || string.IsNullOrEmpty(needle)) return false;
            var s = stem.ToLowerInvariant();
            var n = needle.ToLowerInvariant();
            if (s == n) return true;
            var want = n.Replace(" ", "").Replace("_", "").Replace("-", "").Replace(".", "");
            if (want.Length < 3) return false;
            var compact = s.Replace(" ", "").Replace("_", "").Replace("-", "").Replace(".", "");
            if (want.Length >= 4 && compact.Contains(want)) return true;
            var parts = s.Split(new[] { '_', '-', ' ', '.' }, System.StringSplitOptions.RemoveEmptyEntries);
            foreach (var p in parts)
                if (p == n || p == want || (want.Length >= 4 && p.StartsWith(want)))
                    return true;
            return false;
        }

        /// <summary>
        /// First imported-pack stem whose filename tokens match a culture needle
        /// (SM_Bld_House_01 matches House). Kenney paths are ignored here.
        /// </summary>
        public static string FirstStoreStemContaining(string[] needles)
        {
            if (needles == null || needles.Length == 0) return null;
            Index();
#if UNITY_EDITOR
            if (_meshes == null) return null;
            string best = null;
            foreach (var kv in _meshes)
            {
                if (!IsStorePath(kv.Value)) continue;
                if (SkipFuzzy(kv.Key)) continue;
                foreach (var n in needles)
                {
                    if (!StemHasNeedle(kv.Key, n)) continue;
                    if (best == null || kv.Key.Length < best.Length) best = kv.Key;
                }
            }
            return best;
#else
            return null;
#endif
        }

        public static int StoreStemCount()
        {
            Index();
#if UNITY_EDITOR
            if (_meshes == null) return 0;
            int n = 0;
            foreach (var kv in _meshes)
                if (IsStorePath(kv.Value)) n++;
            return n;
#else
            return 0;
#endif
        }

        public static string[] ImportedPackFolders()
        {
            var found = new List<string>();
            try
            {
                var assets = Application.dataPath;
                if (!Directory.Exists(assets)) return System.Array.Empty<string>();
                foreach (var dir in Directory.GetDirectories(assets))
                {
                    var name = Path.GetFileName(dir);
                    if (IsReservedTop(name)) continue;
                    var hasMesh = Directory.GetFiles(dir, "*.prefab", SearchOption.AllDirectories).Length > 0
                               || Directory.GetFiles(dir, "*.fbx", SearchOption.AllDirectories).Length > 0
                               || Directory.GetFiles(dir, "*.glb", SearchOption.AllDirectories).Length > 0;
                    if (!hasMesh) continue;
                    found.Add("Assets/" + name);
                }
            }
            catch { }
            found.Sort();
            return found.ToArray();
        }

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

        /// <summary>
        /// True only when an imported My Asset folder owns the stem.
        /// Kenney / HubKit hits do not count — store first, Kenney last.
        /// </summary>
        public static bool HasStoreStem(string stem)
        {
            if (string.IsNullOrEmpty(stem)) return false;
            Index();
#if UNITY_EDITOR
            if (_meshes == null) return false;
            var key = HubKit.Alias(stem);
            if (_meshes.TryGetValue(key, out var path) && IsStorePath(path)) return true;
            if (_meshes.TryGetValue(stem.ToLowerInvariant(), out path) && IsStorePath(path)) return true;
#endif
            return false;
        }

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

        public static string PathForStem(string stem)
        {
            if (string.IsNullOrEmpty(stem)) return null;
            Index();
#if UNITY_EDITOR
            if (_meshes == null) return null;
            var key = HubKit.Alias(stem).ToLowerInvariant();
            if (_meshes.TryGetValue(key, out var path)) return path;
            var raw = stem.ToLowerInvariant();
            if (_meshes.TryGetValue(raw, out path)) return path;
#endif
            return null;
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
            // Named furniture/trees always use the human-scale table. Callers
            // that pass 2.2f carts or 1.6f desks were the leftover mismatch.
            if (byHeight)
            {
                var hh = HumanHeight(stem);
                if (hh > 0.01f) maxDim = hh;
            }
            if (maxDim > 0.01f)
            {
                if (byHeight) FitHeight(go, maxDim);
                else FitMax(go, maxDim);
            }
            SitOrHang(go, pos, stem);
            PaintIfBlank(go, PathForStem(stem));
            var kind = stem.ToLowerInvariant();
            if (IsTree(kind)) TrunkCollider(go);
            else if (WantsSolid(kind, maxDim)) MakeWalkable(go);
            else StripColliders(go);
            return go;
        }

        static bool IsTree(string s) =>
            s.Contains("tree") || s.Contains("palm") || s.Contains("pine") || s.Contains("fir");

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
                || s.Contains("coffin") || s.Contains("dumpster") || s.Contains("stove")
                || s.Contains("wagon") || s.Contains("well"))
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

        /// <summary>
        /// Flags hang from a pole. Sit's negative dy buried Kenney banners at y=-1
        /// when bounds were tall at the pivot. Cloth only lifts, never drops.
        /// </summary>
        static void SitOrHang(GameObject go, Vector3 pos, string stem)
        {
            if (IsClothName(stem) || IsClothName(go ? go.name : null))
            {
                go.transform.position = pos;
                var b = Encapsulate(go);
                if (b.min.y < pos.y)
                    go.transform.position += Vector3.up * (pos.y - b.min.y);
                return;
            }
            Sit(go, pos);
        }

        public static void FitMax(GameObject go, float want)
        {
            var b = Encapsulate(go);
            var m = Mathf.Max(b.size.x, Mathf.Max(b.size.y, b.size.z));
            if (m < 0.001f) return;
            go.transform.localScale *= want / m;
        }

        /// <summary>Human-scale height for Kenney/store stems. 0 = caller keeps its number.</summary>
        public static float HumanHeight(string stem)
        {
            if (string.IsNullOrEmpty(stem)) return 0f;
            var s = stem.ToLowerInvariant();
            if (s.Contains("grass")) return 0.40f;
            if (s.Contains("flower") || s.Contains("plant")) return 0.28f;
            if (s.Contains("chair")) return 0.88f;
            if (s.Contains("sofa") || s.Contains("lounge")) return 0.82f;
            if (s.Contains("table") || s.Contains("desk")) return 0.76f;
            if (s.Contains("crate") || s.Contains("barrel") || s.Contains("chest")) return 0.68f;
            if (s.Contains("cart") || s.Contains("wagon")) return 1.35f;
            if (s.Contains("bookcase") || s.Contains("shelf")) return 2.15f;
            if (s.Contains("column") || s.Contains("pillar")) return 3.2f;
            if (s.Contains("lantern") || s.Contains("lamp")) return 1.15f;
            if (s.Contains("tree") || s.Contains("palm") || s.Contains("pine")) return 7.6f;
            if (s.Contains("sword") || s.Contains("weapon")) return 1.05f;
            return 0f;
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
        /// Steal albedo from glTF <c>baseColorTexture</c> (no underscore), else
        /// colormap.png / {stem}.png next to the source GLB.
        /// </summary>
        public static void PaintIfBlank(GameObject go) => PaintIfBlank(go, null);

        public static bool IsClothName(string s)
        {
            if (string.IsNullOrEmpty(s)) return false;
            var n = s.ToLowerInvariant();
            return n.Contains("flag") || n.Contains("banner");
        }

        static Color ClothDye(string name)
        {
            unchecked
            {
                int h = 23;
                if (!string.IsNullOrEmpty(name))
                    for (int i = 0; i < name.Length; i++) h = h * 31 + name[i];
                var dyes = new[]
                {
                    new Color(0.62f, 0.16f, 0.14f),
                    new Color(0.18f, 0.28f, 0.48f),
                    new Color(0.70f, 0.52f, 0.20f),
                    new Color(0.76f, 0.70f, 0.54f),
                    new Color(0.22f, 0.38f, 0.24f),
                    new Color(0.40f, 0.14f, 0.26f)
                };
                return dyes[Mathf.Abs(h) % dyes.Length];
            }
        }

        /// <summary>
        /// Kenney city atlas on a flag UV is one solid texel. Dye cloth, never atlas.
        /// </summary>
        public static void DyeCloth(GameObject go, Color c)
        {
            if (!go) return;
            var m = HubLook.Lit(c, 0.06f, 0.62f);
            foreach (var r in go.GetComponentsInChildren<Renderer>(true))
            {
                if (!r) continue;
                var slots = r.sharedMaterials;
                if (slots == null || slots.Length == 0)
                {
                    r.sharedMaterial = m;
                    continue;
                }
                var next = new Material[slots.Length];
                for (int i = 0; i < slots.Length; i++) next[i] = m;
                r.sharedMaterials = next;
            }
        }

        public static void PaintIfBlank(GameObject go, string sourcePath)
        {
            if (!go) return;
            if (string.IsNullOrEmpty(sourcePath)) sourcePath = PathForStem(go.name);
            if (IsClothName(go.name) || IsClothName(sourcePath))
            {
                DyeCloth(go, ClothDye(go.name));
                return;
            }
            foreach (var r in go.GetComponentsInChildren<Renderer>(true))
            {
                if (!r) continue;
                var slots = r.sharedMaterials;
                if (slots == null || slots.Length == 0) continue;
                var next = new Material[slots.Length];
                bool any = false;
                for (int s = 0; s < slots.Length; s++)
                {
                    var src = slots[s];
                    var tex = HubLook.FirstAlbedo(src);
#if UNITY_EDITOR
                    if (HubLook.IsBlankAlbedo(tex))
                    {
                        var path = sourcePath;
                        if (string.IsNullOrEmpty(path))
                            path = AssetDatabase.GetAssetPath(go);
                        if (string.IsNullOrEmpty(path))
                        {
                            var prefab = PrefabUtility.GetCorrespondingObjectFromSource(go);
                            if (prefab) path = AssetDatabase.GetAssetPath(prefab);
                        }
                        tex = ColormapNear(path, go.name);
                    }
#endif
                    if (HubLook.IsBlankAlbedo(tex))
                    {
                        next[s] = src;
                        continue;
                    }
                    var col = HubLook.FirstColor(src, Color.white);
                    if (!string.IsNullOrEmpty(go.name)
                        && go.name.IndexOf("road", System.StringComparison.OrdinalIgnoreCase) >= 0)
                        col = Color.Lerp(col, new Color(0.46f, 0.36f, 0.24f), 0.62f);
                    var m = HubLook.Lit(col, 0.04f, 0.28f);
                    if (m.HasProperty("_BaseMap")) m.SetTexture("_BaseMap", tex);
                    if (m.HasProperty("_MainTex")) m.SetTexture("_MainTex", tex);
                    var nrm = HubLook.FirstNormal(src);
                    if (nrm)
                    {
                        if (m.HasProperty("_BumpMap")) m.SetTexture("_BumpMap", nrm);
                        m.EnableKeyword("_NORMALMAP");
                    }
                    next[s] = m;
                    any = true;
                }
                if (any) r.sharedMaterials = next;
            }
        }

#if UNITY_EDITOR
        static Texture2D ColormapNear(string path, string stem)
        {
            if (string.IsNullOrEmpty(path)) return null;
            if (IsClothName(path) || IsClothName(stem)) return null;
            var dir = Path.GetDirectoryName(path)?.Replace("\\", "/");
            var file = Path.GetFileNameWithoutExtension(path);
            if (string.IsNullOrEmpty(stem)) stem = file;
            for (int up = 0; up < 4 && !string.IsNullOrEmpty(dir); up++)
            {
                var hit = AssetDatabase.LoadAssetAtPath<Texture2D>(dir + "/" + stem + ".png")
                       ?? AssetDatabase.LoadAssetAtPath<Texture2D>(dir + "/" + file + ".png")
                       ?? AssetDatabase.LoadAssetAtPath<Texture2D>(dir + "/colormap.png")
                       ?? AssetDatabase.LoadAssetAtPath<Texture2D>(dir + "/Textures/colormap.png")
                       ?? AssetDatabase.LoadAssetAtPath<Texture2D>(dir + "/colormap_2.png")
                       ?? AssetDatabase.LoadAssetAtPath<Texture2D>(dir + "/dungeon_texture.png")
                       ?? AssetDatabase.LoadAssetAtPath<Texture2D>(dir + "/Textures/dungeon_texture.png");
                if (hit) return hit;
                var parent = Path.GetDirectoryName(dir)?.Replace("\\", "/");
                if (parent == dir) break;
                dir = parent;
            }
            return null;
        }
#endif

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
                    if (!string.IsNullOrEmpty(n) && FreePacks.HasStoreStem(n)) return n;
            var fuzzy = FreePacks.FirstStoreStemContaining(prefer);
            if (!string.IsNullOrEmpty(fuzzy)) return fuzzy;
            return kenney;
        }

        public static string House(WorldId id)
        {
            var c = Culture(id);
            if (c == "grid") return FirstStem(new[] { "Room_Big_Part_01", "Wall_Simple_01", "house.002" }, "building-skyscraper-a");
            if (c == "ash") return FirstStem(new[] { "tower_destroyed", "house.003", "house.002" }, "crypt-a");
            if (c == "street") return FirstStem(new[] { "house.002", "House.001", "house.003" }, "building-type-h");
            if (c == "court") return FirstStem(new[] { "tower", "house.002" }, "building-type-a");
            return FirstStem(new[] { "house.002", "House.001", "house.003", "House" }, "tent_detailedOpen");
        }

        public static string Tower(WorldId id)
        {
            if (Culture(id) == "ash") return FirstStem(new[] { "tower_destroyed", "tower" }, "tower-square-base");
            if (Culture(id) == "grid") return FirstStem(new[] { "tower", "tower_small", "Wall_Simple_01" }, "watertower");
            return FirstStem(new[] { "tower", "tower_small", "tower_enter" }, "watchtower");
        }

        public static string Wall(WorldId id) =>
            Culture(id) == "grid"
                ? FirstStem(new[] { "Wall_Simple_01", "stone_wall" }, "skyscraper-small-a")
                : FirstStem(new[] { "stone_wall", "wood_wall", "Wall_Simple_01" }, "wall");

        public static string Tree(WorldId id)
        {
            var c = Culture(id);
            if (c == "grid") return FirstStem(new[] { "LowPoly - FirTree A", "tree_1" }, "tree-baobab");
            if (c == "ash") return FirstStem(new[] { "half_tree", "tree" }, "tree-dead");
            return FirstStem(new[] { "tree_1", "tree", "LowPoly - FirTree A" }, "tree_oak");
        }

        public static string Grass(WorldId id) =>
            FirstStem(new[] { "grass01", "LowPoly - Grass A", "Grass_01" }, "grass");

        public static string Prop(WorldId id)
        {
            var c = Culture(id);
            if (c == "grid") return FirstStem(new[] { "crate", "barrel" }, "barrel");
            if (c == "street") return FirstStem(new[] { "crate", "barrel", "wagon" }, "crate");
            return FirstStem(new[] { "barrel", "crate", "wagon", "well" }, "barrel");
        }

        public static string Column(WorldId id) =>
            FirstStem(new[] { "stone_column" }, "column");

        public static string Cart() => FirstStem(new[] { "wagon" }, "cart");
        public static string Crate() => FirstStem(new[] { "crate", "barrel" }, "crate");
        public static string Table() => FirstStem(new[] { "table" }, "table");
        public static string Chair() => FirstStem(new[] { "chair" }, "chair");
        public static string Chest() => FirstStem(new[] { "chest" }, "chest");
        public static string Dummy() => FirstStem(new[] { "HumanDummy_M White", "Human_BasicMotionsDummy_M" }, "character-skeleton");
        public static string Bird() => FirstStem(new[] { "lb_sparrow", "lb_robin", "lb_cardinal" }, "");
        public static string Rock() => FirstStem(new[] { "LowPoly - Rock A", "LowPoly - Rock B" }, "rock_smallA");

        /// <summary>
        /// Owned MYFG stems when they exist. Spear / staff / wand / dagger / mace
        /// have no pack mesh — Kenney stays the honest fallback.
        /// </summary>
        public static string Weapon(string kind)
        {
            if (string.IsNullOrEmpty(kind)) return kind;
            var k = kind.ToLowerInvariant();
            if (k.Contains("greatsword") || k.Contains("th_sword"))
                return FirstStem(new[] { "TH_Sword03" }, "weapon-greatsword");
            if (k.Contains("shortsword") || k == "sword" || k == "weapon-sword" || k.Contains("sword01"))
                return FirstStem(new[] { "Sword01" }, k.Contains("weapon") ? k : "weapon-shortsword");
            if (k.Contains("axe")) return FirstStem(new[] { "Axe01", "Axe04" }, "weapon-axe");
            if (k.Contains("shield")) return FirstStem(new[] { "Shield03" }, "shield-rectangle");
            if (k.Contains("bow")) return FirstStem(new[] { "Bow02" }, "weapon-bow");
            if (k.Contains("spear") || k.Contains("lance")) return FirstStem(new[] { "Spear" }, "weapon-spear");
            if (k.Contains("staff")) return FirstStem(new[] { "Staff" }, "staff");
            if (k.Contains("wand")) return FirstStem(new[] { "Wand" }, "wand");
            if (k.Contains("dagger") || k.Contains("knife")) return FirstStem(new[] { "Dagger" }, "dagger");
            if (k.Contains("mace") || k.Contains("club")) return FirstStem(new[] { "Mace" }, "mace");
            return kind;
        }

        /// <summary>Furniture / weapon aliases so tavern/forge/streets pick store stems.</summary>
        public static string Resolve(string stem)
        {
            if (string.IsNullOrEmpty(stem)) return stem;
            var s = stem.ToLowerInvariant();
            if (s.Contains("weapon") || s == "sword" || s == "greatsword" || s == "shortsword"
                || s == "spear" || s == "staff" || s == "dagger" || s == "mace" || s == "wand"
                || s.Contains("shield") || s == "axe" || s == "bow")
                return Weapon(stem);
            if (s == "crate" || s == "market_crate") return Crate();
            if (s == "cart") return Cart();
            if (s == "table") return Table();
            if (s == "chair") return Chair();
            if (s == "chest") return Chest();
            if (s == "barrel" || s == "market_barrel") return FirstStem(new[] { "barrel" }, stem);
            if (s == "column" || s == "column-large") return Column(WorldId.Hub);
            if (s == "wall") return Wall(WorldId.Hub);
            return stem;
        }

        public static string SkyMat(WorldId id)
        {
            bool day = id == WorldId.Hub || id == WorldId.Tunya;
            bool sunset = id == WorldId.Frontier || id == WorldId.Superhero || id == WorldId.Fantasy;
            var store = day
                ? new[]
                {
                    "Assets/BOXOPHOBIC/Skybox Cubemap Extended/Demo/Materials/Skybox Cubemap Extended Day.mat",
                    "Assets/Skybox/Materials/Skybox_Daytime.mat"
                }
                : sunset
                    ? new[]
                    {
                        "Assets/Skybox/Materials/Skybox_Sunset.mat",
                        "Assets/BOXOPHOBIC/Skybox Cubemap Extended/Demo/Materials/Skybox Cubemap Extended Blend.mat"
                    }
                    : new[]
                    {
                        "Assets/BOXOPHOBIC/Skybox Cubemap Extended/Demo/Materials/Skybox Cubemap Extended Night.mat"
                    };
            foreach (var p in store)
                if (FreePacks.Load<Material>(p) != null) return p;
            return day ? "Assets/Skyboxes/SkyDay.mat"
                : sunset ? "Assets/Skyboxes/SkySunset.mat"
                : "Assets/Skyboxes/SkyNight.mat";
        }

        public static string WeatherPath(string kind)
        {
            var paths = kind == "rain"
                ? new[]
                {
                    "Assets/RainMaker/Prefab/RainPrefab.prefab",
                    "Assets/GabrielAguiarProductions/FreeQuickEffectsVol1/Prefabs/vfx_Rain_01.prefab",
                    "Assets/VFX/VFX_Rain.prefab"
                }
                : kind == "fireflies"
                    ? new[] { "Assets/VFX/VFX_Fireflies.prefab" }
                    : new[] { "Assets/VFX/VFX_Snow.prefab" };
            foreach (var p in paths)
                if (FreePacks.Load<GameObject>(p) != null) return p;
            return paths[paths.Length - 1];
        }

        public static void PlaceWeather(string kind, Transform root, Vector3 pos)
        {
            var stem = kind == "rain" ? FirstStem(new[] { "RainPrefab", "vfx_Rain_01", "RainEffect" }, "")
                : kind == "fireflies" ? FirstStem(new[] { "FireFlies" }, "")
                : FirstStem(new[] { "SnowEffect" }, "");
            if (!string.IsNullOrEmpty(stem) && FreePacks.HasStem(stem))
            {
                FreePacks.Spawn(stem, root, pos, 0, 0);
                return;
            }
            FreePacks.Prefab(WeatherPath(kind), root, pos);
        }

        public static string Residual(WorldId id)
        {
            var c = Culture(id);
            if (c == "court") return "unpaved Court — no house ring";
            if (c == "grove" && id == WorldId.Frontier) return "no palm pack — Kenney palm fallback; embassy is road only";
            if (c == "grove") return "no wheat/hedge pack — Kenney crops/hedge fallback";
            if (c == "ash") return "no crypt/gravestone pack — Kenney fallback";
            if (c == "street") return "no dumpster pack — Kenney dumpster fallback";
            if (c == "grid") return "no sci-fi lab / Kyle — modular rooms then Kenney skyline";
            return "no crystal pack — Kenney crystal fallback";
        }

        /// <summary>
        /// Ten building stems. Store names first; Kenney kit names stay the fallback
        /// so a missing pack never blanks a town. Hub never calls this (Court is unpaved).
        /// </summary>
        public static string[] Kit(WorldId id)
        {
            var house = House(id);
            var tower = Tower(id);
            var wall = Wall(id);
            var col = Column(id);
            var cart = Cart();
            return id switch
            {
                WorldId.Ruins => new[] { house, FirstStem(new[] { "tower_destroyed" }, "crypt-small"), col, house, FirstStem(new[] { "Altar" }, "altar-stone"), FirstStem(new[] { "Gravestone" }, "gravestone"), house, tower, col, house },
                WorldId.Tunya => new[] { house, house, Tree(id), house, FirstStem(new[] { "Crops", "Wheat" }, "crops_cornStageD"), house, house, Tree(id), house, FirstStem(new[] { "Crops" }, "crops_cornStageD") },
                WorldId.Fantasy => new[] { house, tower, FirstStem(new[] { "Hedge", "hedge-large" }, "hedge-large"), house, FirstStem(new[] { "Statue" }, "statue"), tower, house, FirstStem(new[] { "Hedge" }, "hedge-large"), house, tower },
                WorldId.Crime => new[] { house, house, FirstStem(new[] { "Warehouse" }, "building-d"), house, FirstStem(new[] { "Dumpster" }, "dumpster"), house, house, house, FirstStem(new[] { "Dumpster" }, "dumpster"), house },
                WorldId.Cyber => new[] { house, FirstStem(new[] { "Room_Big_Part_01", "Wall_Simple_01" }, "corridor_end"), wall, col, FirstStem(new[] { "Floor_01" }, "detail-overhang-wide"), house, wall, house, col, house },
                WorldId.Frontier => new[] { house, cart, FirstStem(new[] { "Palm", "palm-straight" }, "palm-straight"), house, Prop(id), cart, house, FirstStem(new[] { "Palm" }, "palm-straight"), house, house },
                WorldId.Superhero => new[] { house, house, FirstStem(new[] { "building-skyscraper-b" }, "building-skyscraper-b"), house, wall, house, FirstStem(new[] { "building-skyscraper-d" }, "building-skyscraper-d"), house, wall, house },
                WorldId.Sere => new[] { house, house, FirstStem(new[] { "building-skyscraper-e" }, "building-skyscraper-e"), house, FirstStem(new[] { "Dumpster" }, "dumpster"), house, house, house, FirstStem(new[] { "Dumpster" }, "dumpster"), house },
                _ => new[] { FirstStem(new[] { "Crystal" }, "detail-crystal-large"), tower, col, FirstStem(new[] { "tower_destroyed" }, "crypt-small"), tower, FirstStem(new[] { "Crystal" }, "detail-crystal-large"), tower, col, house, tower }
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
            sb.AppendLine("MY ASSETS vs THIS PROJECT");
            sb.AppendLine("Package Manager My Assets is the account catalog. Listed != imported.");
            sb.AppendLine("Download + Import into this project (Assets/Store/ or Assets/<Pack Name>/).");
            sb.AppendLine("indexed=" + FreePacks.IndexedStems().Length + " store=" + FreePacks.StoreStemCount());
            var imported = FreePacks.ImportedPackFolders();
            if (imported.Length == 0)
                sb.AppendLine("  imported  (none — Kenney fallback is live)");
            else
                foreach (var folder in imported)
                    sb.AppendLine("  imported  " + folder);
            foreach (var p in Curated)
                sb.AppendLine("  " + p.id + "  " + p.role + "  " + (FolderPresent(p.needles) ? "PRESENT" : "pending (Kenney fallback)"));
            sb.AppendLine("House(Tunya)=" + House(WorldId.Tunya) + " culture=" + Culture(WorldId.Tunya));
            sb.AppendLine("House(Cyber)=" + House(WorldId.Cyber) + " culture=" + Culture(WorldId.Cyber));
            sb.AppendLine("House(Fantasy)=" + House(WorldId.Fantasy) + " culture=" + Culture(WorldId.Fantasy));
            sb.AppendLine("Tree(Tunya)=" + Tree(WorldId.Tunya));
            sb.AppendLine("Weapon(sword)=" + Weapon("sword") + " Weapon(greatsword)=" + Weapon("greatsword") + " Weapon(spear)=" + Weapon("spear"));
            sb.AppendLine("Dummy=" + Dummy());
            sb.AppendLine("PlayableRooms hero=" + PlayableRooms(0) + " other=" + PlayableRooms(1));
            sb.AppendLine("FakeWindows cities 1-3=" + WantsFakeWindows(2) + " city4=" + WantsFakeWindows(4));
            sb.AppendLine("WORLD NEED vs HAVE");
            foreach (var id in new[]
            {
                WorldId.Hub, WorldId.Tunya, WorldId.Fantasy, WorldId.Frontier, WorldId.Ruins,
                WorldId.Crime, WorldId.Sere, WorldId.Cyber, WorldId.Superhero, WorldId.Crucible
            })
            {
                sb.AppendLine("  " + id
                    + "  culture=" + Culture(id)
                    + " house=" + House(id)
                    + " tree=" + Tree(id)
                    + " tower=" + Tower(id)
                    + " wall=" + Wall(id)
                    + " prop=" + Prop(id)
                    + "  " + Residual(id));
            }
            return sb.ToString();
        }

        public struct PackHint
        {
            public string id;
            public string role;
            public string[] needles;
        }

        /// <summary>
        /// Owned My Assets only — not a wishlist. Needles match folder names
        /// under Assets/ after import. Village / Distant Lands / Kyle packs
        /// are not on this account.
        /// </summary>
        public static readonly PackHint[] Curated =
        {
            new PackHint { id = "87811", role = "fantasy props / houses / towers", needles = new[] { "Mega Fantasy Props" } },
            new PackHint { id = "85732", role = "modular walls / rooms", needles = new[] { "Barking_Dog" } },
            new PackHint { id = "35361", role = "forest trees / grass", needles = new[] { "Fantasy Forest Environment" } },
            new PackHint { id = "107400", role = "skybox + lowpoly fir", needles = new[] { "BOXOPHOBIC" } },
            new PackHint { id = "154271", role = "human locomotion clips", needles = new[] { "Kevin Iglesias", "Human Basic Motions" } },
            new PackHint { id = "178395", role = "human dummy meshes", needles = new[] { "Human Character Dummy", "Kevin Iglesias" } },
            new PackHint { id = "65284", role = "RPG mecanim clips", needles = new[] { "ExplosiveLLC" } },
            new PackHint { id = "127325", role = "particle fx", needles = new[] { "UnityTechnologies", "Particle Pack" } },
            new PackHint { id = "304424", role = "quick combat vfx", needles = new[] { "GabrielAguiar" } },
            new PackHint { id = "15649", role = "living birds", needles = new[] { "living birds" } },
            new PackHint { id = "987", role = "roads (EasyRoads)", needles = new[] { "EasyRoads3D" } },
            new PackHint { id = "4387", role = "water (SUIMONO) — imported, not the live water path", needles = new[] { "SUIMONO" } },
            new PackHint { id = "14360", role = "weapon meshes", needles = new[] { "MYFG-Weapon" } },
            new PackHint { id = "267961", role = "controller reference — do not replace Concordia", needles = new[] { "Starter Assets" } },
            new PackHint { id = "279431", role = "big oak (re-download if truncated)", needles = new[] { "Big Oak", "Objective Environment" } },
            new PackHint { id = "269772", role = "demo city (re-download if truncated; do not vendor)", needles = new[] { "Demo City", "Versatile Studio" } },
            new PackHint { id = "155776", role = "sound fx (re-download if truncated)", needles = new[] { "Sound Effects" } }
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
