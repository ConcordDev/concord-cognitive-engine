using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using GLTFast;
using UnityEngine;
using UnityEngine.Networking;

namespace Concordia
{
    /// <summary>
    /// Runtime loader for the committed Unburned Court hub kit
    /// (StreamingAssets/HubKit). Player and WebGL have no AssetDatabase;
    /// this is how those builds get real Kenney/KayKit meshes instead of cubes.
    /// </summary>
    public static class HubKit
    {
        static readonly Dictionary<string, GameObject> Runtime = new Dictionary<string, GameObject>(64);
        static readonly Dictionary<string, string> Aliases = new Dictionary<string, string>(16);

        /// stem -> glb filename, populated from MANIFEST.json at EnsureLoaded. Presence here means
        /// "available to import"; presence in Runtime means "already imported".
        static readonly Dictionary<string, string> Index = new Dictionary<string, string>(1024);

        /// Stems with an import in flight, so a stem requested every frame is only imported once.
        static readonly HashSet<string> Loading = new HashSet<string>();

        /// stem -> lowercased module name -> that module's transform inside the imported
        /// template. Poly Haven's modular kits are ONE glb holding many named pieces
        /// (modular_urban_apartments_facade_1k = 147, modular_factory_facade_1k = 192,
        /// modular_fort_01_1k = 22) on a 3m grid. TryGet hands back the glb root, so
        /// without this index every one of those 361 architectural modules is unreachable
        /// and the world falls back to primitive cubes. Built once per import.
        static readonly Dictionary<string, Dictionary<string, Transform>> Modules =
            new Dictionary<string, Dictionary<string, Transform>>(8);
        // Keep the importer alive for the lifetime of its runtime template. GLTFast owns the
        // imported mesh resources through GltfImport; allowing the local import variable to be
        // collected can unload MeshFilter.sharedMesh after the first test/runtime pass, leaving
        // cached module nodes with zero Renderer.bounds on the next use.
        static readonly Dictionary<string, GltfImport> Imports =
            new Dictionary<string, GltfImport>(64);
        static Transform _cache;
        static bool _loaded;
        // Distinguishes a completed manifest read from a failed load. This matters in EditMode,
        // where a prior static load can fail before indexing (for example when an editor-only
        // DontDestroyOnLoad call is reached); EnsureLoaded must be able to retry that same
        // project-owned manifest instead of permanently treating the empty index as ready.
        static bool _manifestLoaded;
        static Task _inflight;

        public static bool Loaded => _loaded;

        public static string Alias(string stem)
        {
            if (string.IsNullOrEmpty(stem)) return stem;
            var key = stem.ToLowerInvariant();
            return Aliases.TryGetValue(key, out var mapped) ? mapped : key;
        }

        public static bool TryGet(string stem, out GameObject prefab)
        {
            prefab = null;
            var key = Alias(stem);
            if (Runtime.TryGetValue(key, out var go) && go) { prefab = go; return true; }

            // Not imported yet: start it, and report a miss for now. Callers already tolerate a
            // null (FreePacks.Mesh falls through to its other sources), and the next request for
            // this stem resolves once the import lands. This is what keeps startup off the
            // critical path — see the indexing note in LoadAll.
            RequestImport(key);
            return false;
        }

        /// Fire-and-forget import of a single indexed stem. Never awaited by callers, never blocks.
        static void RequestImport(string key)
        {
            if (string.IsNullOrEmpty(key)) return;
            if (Runtime.ContainsKey(key) || Loading.Contains(key)) return;
            if (!Index.TryGetValue(key, out var file) || string.IsNullOrEmpty(file)) return;

            Loading.Add(key);
            _ = ImportOne(key, file);
        }

        static async Task ImportOne(string key, string file)
        {
            try
            {
                var bytes = await ReadBytes(file);
                if (bytes != null && bytes.Length >= 4)
                    await InstantiateGlb(key, bytes, Url(file));
            }
            catch (Exception e)
            {
                Debug.LogWarning("Concordia HubKit: import failed for '" + key + "' (" + file + "): " + e.Message);
            }
            finally
            {
                Loading.Remove(key);
            }
        }

        /// <summary>
        /// Import a stem and WAIT for it. TryGet deliberately misses on first call and
        /// imports in the background, which is right for opportunistic dressing and wrong
        /// for a compiler: a facade that asked for a module on frame 1 would emit a cube
        /// and never revisit it. Call this before composing, then use TryGetModule.
        /// </summary>
        public static async Task<bool> Prewarm(string stem)
        {
            var key = Alias(stem);
            if (string.IsNullOrEmpty(key)) return false;
            if (Runtime.ContainsKey(key)) return true;
            if (!Index.TryGetValue(key, out var file) || string.IsNullOrEmpty(file)) return false;

            // Join an import already in flight rather than racing a second one in.
            while (Loading.Contains(key)) await Task.Yield();
            if (Runtime.ContainsKey(key)) return true;

            Loading.Add(key);
            await ImportOne(key, file);
            return Runtime.ContainsKey(key);
        }

        /// <summary>Module names available inside a kit stem. Empty until Prewarm resolves.</summary>
        public static string[] ModuleNames(string stem)
        {
            var key = Alias(stem);
            if (string.IsNullOrEmpty(key) || !Modules.TryGetValue(key, out var map) || map == null)
                return Array.Empty<string>();
            var names = new string[map.Count];
            map.Keys.CopyTo(names, 0);
            return names;
        }

        public static bool HasModule(string stem, string module) =>
            TryGetModuleTemplate(stem, module, out _);

        static bool TryGetModuleTemplate(string stem, string module, out Transform template)
        {
            template = null;
            var key = Alias(stem);
            if (string.IsNullOrEmpty(key) || string.IsNullOrEmpty(module)) return false;
            if (!Modules.TryGetValue(key, out var map) || map == null) return false;
            if (!map.TryGetValue(module.ToLowerInvariant(), out var t) || !t) return false;
            template = t;
            return true;
        }

        /// <summary>
        /// Place one module of a modular kit. Returns a holder transform the caller owns,
        /// or null when the module is absent (never a cube — the caller decides the fallback).
        ///
        /// Two traps live here, both measured off the glb: the kit authors laid the modules
        /// out in a showcase row, so each node carries a translation (e.g. [15,4,0]) that is
        /// a property of the SOURCE FILE, not of the module — it must be zeroed. And each
        /// node carries a Blender Z-up correction (rotation ≈ [-0.7071,0,0,0.7071]) plus
        /// scale 100, which must be PRESERVED or the piece lies on its face at 1cm. The
        /// caller's yaw therefore goes on the holder, never on the module itself.
        /// </summary>
        public static GameObject PlaceModule(string stem, string module, Transform parent,
                                             Vector3 worldPos, float yawDeg)
        {
            if (!TryGetModuleTemplate(stem, module, out var template)) return null;

            var holder = new GameObject(module);
            holder.transform.SetParent(parent, false);
            holder.transform.position = worldPos;
            holder.transform.rotation = Quaternion.Euler(0f, yawDeg, 0f);

            var go = UnityEngine.Object.Instantiate(template.gameObject, holder.transform);
            go.name = module;
            go.transform.localPosition = Vector3.zero;
            go.transform.localRotation = template.localRotation;
            go.transform.localScale = template.localScale;
            go.SetActive(true);
            foreach (var child in go.GetComponentsInChildren<Transform>(true))
                if (child) child.gameObject.SetActive(true);
            foreach (var renderer in go.GetComponentsInChildren<Renderer>(true))
                if (renderer) renderer.enabled = true;
            return holder;
        }

        /// <summary>
        /// Index every named, mesh-bearing node inside a freshly imported template.
        /// Names are the module contract and are unique within a kit.
        /// </summary>
        static void IndexModules(string key, Transform root)
        {
            if (!root) return;
            Dictionary<string, Transform> map = null;
            foreach (var t in root.GetComponentsInChildren<Transform>(true))
            {
                if (!t || t == root) continue;
                if (!t.GetComponent<MeshFilter>() && !t.GetComponent<SkinnedMeshRenderer>()) continue;
                var name = (t.name ?? "").ToLowerInvariant();
                if (name.Length == 0) continue;
                map ??= new Dictionary<string, Transform>(256);
                if (!map.ContainsKey(name)) map[name] = t;
            }
            if (map != null && map.Count > 0) Modules[key] = map;
        }

        public static void RegisterAlias(string from, string to)
        {
            if (string.IsNullOrEmpty(from) || string.IsNullOrEmpty(to)) return;
            Aliases[from.ToLowerInvariant()] = to.ToLowerInvariant();
        }

        public static Task EnsureLoaded()
        {
            if (_loaded && _manifestLoaded) return Task.CompletedTask;
            // A previous LoadAll can have completed after catching an import/setup exception.
            // Do not hand callers that completed failed attempt forever; allow a later test or
            // runtime request to retry the same manifest without requiring a domain reload.
            if (_inflight != null && !_inflight.IsCompleted) return _inflight;
            _inflight = LoadAll();
            return _inflight;
        }

        static async Task LoadAll()
        {
            try
            {
                SeedDefaultAliases();
                var json = await ReadText("MANIFEST.json");
                if (string.IsNullOrEmpty(json))
                {
                    Debug.LogWarning("Concordia HubKit: no StreamingAssets/HubKit/MANIFEST.json — greybox until the kit is synced.");
                    _manifestLoaded = true;
                    _loaded = true;
                    return;
                }
                var manifest = JsonUtility.FromJson<Manifest>(json);
                if (manifest?.aliases != null)
                    foreach (var a in manifest.aliases)
                        RegisterAlias(a.from, a.to);
                EnsureCache();
                if (manifest?.files == null)
                {
                    _manifestLoaded = true;
                    _loaded = true;
                    return;
                }

                // INDEX ONLY — do not import the meshes here.
                //
                // This loop used to `await InstantiateGlb(...)` for EVERY manifest entry at
                // startup, and ConcordiaGame blocks on `await HubKit.EnsureLoaded()`. That was
                // survivable at 52 hand-picked entries; once the kit was synced to 800 entries
                // (~4.7GB of glb) it stalled on the first import and never returned, so the whole
                // game init behind that await — including the Standard->URP material sweep — never
                // ran. Eagerly importing gigabytes at boot is wrong regardless of the stall: the
                // world only ever instantiates a small subset. Entries are now imported on first
                // use by TryGet, so startup cost is one small JSON parse.
                Index.Clear();
                foreach (var entry in manifest.files)
                {
                    if (entry == null || string.IsNullOrEmpty(entry.file) || string.IsNullOrEmpty(entry.stem)) continue;
                    Index[entry.stem.ToLowerInvariant()] = entry.file;
                }
                _manifestLoaded = true;
                Debug.Log("Concordia HubKit indexed " + Index.Count + " meshes (lazy; imported on first use)");
            }
            catch (Exception e)
            {
                // Keep the loader retryable. In particular, an EditMode-only setup failure must
                // not leave an empty Index behind while reporting Loaded=true to ModuleKit.
                _manifestLoaded = false;
                _loaded = false;
                Debug.LogWarning("Concordia HubKit load failed: " + e.Message);
            }
            if (_manifestLoaded) _loaded = true;
        }

        static void SeedDefaultAliases()
        {
            RegisterAlias("building-small-a", "building-type-a");
            RegisterAlias("building-small-b", "building-type-b");
            RegisterAlias("building-small-c", "building-type-c");
            RegisterAlias("building-small-d", "building-type-d");
            RegisterAlias("statue", "statue_head");
            RegisterAlias("weapon-rack", "coatRackStanding");
            RegisterAlias("trophy", "statue_obelisk");
            RegisterAlias("market_crate", "crate");
            RegisterAlias("market_barrel", "barrel");
            RegisterAlias("building-garage", "building-type-d");
            RegisterAlias("road-straight-lightposts", "road-straight");
            RegisterAlias("estoc", "antique_estoc_1k");
            RegisterAlias("antique_estoc", "antique_estoc_1k");
            RegisterAlias("katana", "antique_katana_01_1k");
            RegisterAlias("kite_shield", "kite_shield_1k");
            RegisterAlias("vikinghelmet", "vikinghelmet");
            RegisterAlias("large_iron_gate", "large_iron_gate_1k");
            RegisterAlias("iron_gate", "large_iron_gate_1k");
            RegisterAlias("stone_column", "statue_column");
            RegisterAlias("stone_column.001", "statue_column");
            RegisterAlias("flag-banner-long", "banner");
            RegisterAlias("banner-red", "banner");
            RegisterAlias("flag-banner-short", "banner");
        }

        static void EnsureCache()
        {
            if (_cache) return;
            var go = new GameObject("HubKitCache");

            // DontDestroyOnLoad is a Play Mode API. EditMode tests exercise the same real
            // GLTFast import path, but Unity throws when an editor-only GameObject is passed to
            // it; that exception used to abort LoadAll before the manifest was indexed. Keep the
            // cache hidden and unsaved in EditMode, and only promote it across scenes at runtime.
            if (Application.isPlaying)
                UnityEngine.Object.DontDestroyOnLoad(go);
            else
                go.hideFlags = HideFlags.HideAndDontSave;

            // Keep the hidden cache active so glTFast keeps imported mesh data bound in both
            // EditMode and PlayMode. Imported template renderers are disabled after indexing,
            // so the library remains invisible while placed instances can be enabled reliably.
            go.SetActive(true);
            _cache = go.transform;
        }

        static async Task InstantiateGlb(string stem, byte[] bytes, string sourceUrl)
        {
            var key = (stem ?? "").ToLowerInvariant();
            if (key.Length == 0 || Runtime.ContainsKey(key)) return;
            // glTFast creates a DontDestroyOnLoad-backed stable-framerate agent when no
            // defer agent is supplied. That is correct in Play Mode, but Unity rejects the
            // helper GameObject in EditMode; use glTFast's non-yielding agent for editor tests
            // while keeping the runtime frame-budgeted default unchanged.
            var import = Application.isPlaying
                ? new GltfImport()
                : new GltfImport(deferAgent: new UninterruptedDeferAgent());
            Uri sourceUri = null;
            if (!string.IsNullOrEmpty(sourceUrl) && Uri.TryCreate(sourceUrl, UriKind.Absolute, out var parsed))
                sourceUri = parsed;
            var ok = await import.Load(bytes, sourceUri);
            if (!ok) return;
            EnsureCache();
            var tmpl = new GameObject(key);
            tmpl.transform.SetParent(_cache, false);
            tmpl.SetActive(true);
            await import.InstantiateMainSceneAsync(tmpl.transform);
            // The editor glTFast path can defer mesh binding until the imported hierarchy has
            // lived through one player-loop turn. Yield once before disabling the template so
            // callers never receive an indexed node with a null MeshFilter/sharedMesh.
            await Task.Yield();

            // glTFast usually emits URP materials, but some import paths fall back to built-in
            // `Standard`, which URP cannot render — it draws magenta. This is the single upstream
            // point where every HubKit asset becomes a runtime prefab, so upgrading here covers
            // every consumer no matter which spawn path instantiates it. No-ops when the materials
            // are already URP.
            HubLook.UpgradeStandardOn(tmpl);

            // Index named sub-meshes while the hierarchy is in hand. Cheap for the ~790
            // single-mesh stems; load-bearing for the three modular kits.
            IndexModules(key, tmpl.transform);

            // Keep the imported hierarchy alive for the lifetime of the cache. GLTFast can
            // leave MeshFilter.sharedMesh unresolved when a whole template is deactivated;
            // disabling renderers instead preserves the mesh binding without drawing the hidden
            // source library.
            foreach (var renderer in tmpl.GetComponentsInChildren<Renderer>(true))
                if (renderer) renderer.enabled = false;
            tmpl.SetActive(true);
            Imports[key] = import;
            Runtime[key] = tmpl;
        }

        static string Url(string file)
        {
            var root = Application.streamingAssetsPath.TrimEnd('/', '\\');
            return root + "/HubKit/" + file;
        }

        static async Task<string> ReadText(string file)
        {
            var bytes = await ReadBytes(file);
            return bytes == null ? null : System.Text.Encoding.UTF8.GetString(bytes);
        }

        static async Task<byte[]> ReadBytes(string file)
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            var req = UnityWebRequest.Get(Url(file));
            var op = req.SendWebRequest();
            while (!op.isDone) await Task.Yield();
            if (req.result != UnityWebRequest.Result.Success)
            {
                req.Dispose();
                return null;
            }
            var data = req.downloadHandler.data;
            req.Dispose();
            return data;
#else
            var path = Url(file);
            if (!File.Exists(path)) return null;
            return File.ReadAllBytes(path);
#endif
        }

        [Serializable]
        class Manifest
        {
            public string id;
            public Entry[] files;
            public AliasRow[] aliases;
        }

        [Serializable]
        class Entry
        {
            public string stem;
            public string file;
            public string license;
            public string author;
        }

        [Serializable]
        class AliasRow
        {
            public string from;
            public string to;
        }
    }
}
