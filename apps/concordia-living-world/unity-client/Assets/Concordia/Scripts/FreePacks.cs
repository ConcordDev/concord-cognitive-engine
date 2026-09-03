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
                "Assets/Audio"
            };
            foreach (var guid in AssetDatabase.FindAssets("t:GameObject", folders))
            {
                var path = AssetDatabase.GUIDToAssetPath(guid);
                var stem = Path.GetFileNameWithoutExtension(path).ToLowerInvariant();
                if (stem.EndsWith(".prefab")) stem = stem.Replace(".prefab", "");
                if (!_meshes.ContainsKey(stem) || path.Contains("kenney-free"))
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
            if (HubKit.TryGet(key, out var kit) && kit) return kit;
            Index();
#if UNITY_EDITOR
            if (_meshes != null && _meshes.TryGetValue(key, out var path))
                return AssetDatabase.LoadAssetAtPath<GameObject>(path);
            if (_meshes != null && _meshes.TryGetValue(stem.ToLowerInvariant(), out var raw))
                return AssetDatabase.LoadAssetAtPath<GameObject>(raw);
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
                        if (!string.IsNullOrEmpty(dir))
                        {
                            tex = AssetDatabase.LoadAssetAtPath<Texture2D>(dir + "/colormap.png")
                                  ?? AssetDatabase.LoadAssetAtPath<Texture2D>(dir + "/Textures/colormap.png")
                                  ?? AssetDatabase.LoadAssetAtPath<Texture2D>(dir + "/dungeon_texture.png");
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
}
