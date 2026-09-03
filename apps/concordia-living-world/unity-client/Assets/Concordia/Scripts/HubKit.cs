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
        static Transform _cache;
        static bool _loaded;
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
            if (Runtime.TryGetValue(Alias(stem), out var go) && go) { prefab = go; return true; }
            return false;
        }

        public static void RegisterAlias(string from, string to)
        {
            if (string.IsNullOrEmpty(from) || string.IsNullOrEmpty(to)) return;
            Aliases[from.ToLowerInvariant()] = to.ToLowerInvariant();
        }

        public static Task EnsureLoaded()
        {
            if (_loaded) return Task.CompletedTask;
            if (_inflight != null) return _inflight;
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
                    _loaded = true;
                    return;
                }
                foreach (var entry in manifest.files)
                {
                    if (entry == null || string.IsNullOrEmpty(entry.file)) continue;
                    var bytes = await ReadBytes(entry.file);
                    if (bytes == null || bytes.Length < 4) continue;
                    await InstantiateGlb(entry.stem, bytes);
                }
                Debug.Log("Concordia HubKit loaded " + Runtime.Count + " meshes");
            }
            catch (Exception e)
            {
                Debug.LogWarning("Concordia HubKit load failed: " + e.Message);
            }
            _loaded = true;
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
        }

        static void EnsureCache()
        {
            if (_cache) return;
            var go = new GameObject("HubKitCache");
            UnityEngine.Object.DontDestroyOnLoad(go);
            go.SetActive(false);
            _cache = go.transform;
        }

        static async Task InstantiateGlb(string stem, byte[] bytes)
        {
            var key = (stem ?? "").ToLowerInvariant();
            if (key.Length == 0 || Runtime.ContainsKey(key)) return;
            var import = new GltfImport();
            var ok = await import.LoadGltfBinary(bytes);
            if (!ok) return;
            EnsureCache();
            var tmpl = new GameObject(key);
            tmpl.transform.SetParent(_cache, false);
            await import.InstantiateMainSceneAsync(tmpl.transform);
            tmpl.SetActive(false);
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
