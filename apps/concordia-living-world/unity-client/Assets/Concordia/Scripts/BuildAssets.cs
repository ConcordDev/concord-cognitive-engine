using System.Collections;
using System.Collections.Generic;
using System.IO;
using UnityEngine;
using UnityEngine.Networking;
#if UNITY_EDITOR
using UnityEditor;
#endif

namespace Concordia
{
    /// <summary>
    /// One loader for project assets addressed by path, so the editor and every
    /// build use the SAME assets.
    ///
    /// Concordia builds its world in code and loaded characters, gear, textures
    /// and controllers with AssetDatabase.LoadAssetAtPath — which exists only in
    /// the editor. Builds (the WebGL client, the headless world host) therefore
    /// shipped none of them: people were bodiless in the browser (2026-09-27).
    ///
    /// Editor: loads through AssetDatabase exactly as before, and records each
    /// path (and each FreePacks stem → path) that is actually used into
    /// Generated/BuildAssets/used-paths.txt. Export: ConcordiaBuildAssetRegistry
    /// turns that record plus a core include list into a Resources registry, so a
    /// build ships exactly what the game uses. Build: loads from that registry.
    ///
    /// Streamed assets (web): models too heavy for the main download are not in
    /// the registry's objects; Load returns null for them until
    /// <see cref="LoadStreamed"/> has fetched their AssetBundles, after which
    /// they resolve like any other path. Callers rebuild what used a fallback
    /// once <see cref="StreamingDone"/> is true.
    /// </summary>
    public static class BuildAssets
    {
        public const string RegistryResource = "Concordia/BuildAssetRegistry";
        public const string UsedPathsFile = "Assets/Concordia/Generated/BuildAssets/used-paths.txt";

        /// <summary>Paths the build streams instead of shipping up front (empty in the editor).</summary>
        public static int StreamedCount
        {
#if UNITY_EDITOR
            get => 0;
#else
            get { Ensure(); return _streamed.Count; }
#endif
        }

        /// <summary>True for a lookup key whose asset streams (arrived or not).</summary>
        public static bool IsStreamedKey(string key)
        {
#if UNITY_EDITOR
            return false;
#else
            return !string.IsNullOrEmpty(key) && Keys.TryGetValue(key, out var path) && _streamed.Contains(path);
#endif
        }

        /// <summary>How many streamed assets have arrived.</summary>
        public static int StreamedLoaded { get; private set; }

        /// <summary>True once every streamed asset has arrived or failed.</summary>
        public static bool StreamingDone { get; private set; }

        static bool _streamingStarted;

        /// <summary>
        /// Coroutine: fetch each streamed AssetBundle one at a time (one heavy
        /// download in memory at once) and register its asset under its editor
        /// path. Runs once; later calls finish immediately. Never throws.
        /// </summary>
        public static IEnumerator LoadStreamed()
        {
#if UNITY_EDITOR
            StreamingDone = true;
            yield break;
#else
            if (_streamingStarted) yield break;
            _streamingStarted = true;
            Ensure();
            for (int i = 0; i < _streamed.Count && i < _streamedBundles.Count; i++)
            {
                var path = _streamed[i];
                var url = Application.streamingAssetsPath + "/Streamed/" + _streamedBundles[i];
                using (var req = UnityWebRequestAssetBundle.GetAssetBundle(url))
                {
                    yield return req.SendWebRequest();
                    if (req.result != UnityWebRequest.Result.Success)
                    {
                        Debug.LogWarning($"[BuildAssets] streamed {path} failed: {req.error}");
                        continue;
                    }
                    var bundle = DownloadHandlerAssetBundle.GetContent(req);
                    if (!bundle) { Debug.LogWarning($"[BuildAssets] streamed {path}: no bundle"); continue; }
                    var op = bundle.LoadAssetAsync<GameObject>(path);
                    yield return op;
                    if (op.asset)
                    {
                        _registry[path] = op.asset;
                        StreamedLoaded++;
                        Debug.Log($"[BuildAssets] streamed {path}");
                    }
                    else Debug.LogWarning($"[BuildAssets] streamed {path}: asset missing in bundle");
                    bundle.Unload(false); // keep the loaded model, free the bundle
                }
            }
            StreamingDone = true;
#endif
        }

        public static T Load<T>(string path) where T : Object
        {
            if (string.IsNullOrEmpty(path)) return null;
#if UNITY_EDITOR
            var o = AssetDatabase.LoadAssetAtPath<T>(path);
            if (o) Record(path);
            return o;
#else
            return Registry.TryGetValue(path, out var obj) ? obj as T : null;
#endif
        }

        /// <summary>Resolve a lookup key (e.g. a FreePacks stem) recorded in the editor.</summary>
        public static T LoadByKey<T>(string key) where T : Object
        {
            if (string.IsNullOrEmpty(key)) return null;
#if UNITY_EDITOR
            return null; // the editor resolves keys through its own index
#else
            return Keys.TryGetValue(key, out var path) ? Load<T>(path) : null;
#endif
        }

        /// <summary>Editor: remember that <paramref name="key"/> resolved to <paramref name="path"/>.</summary>
        public static void RecordKey(string key, string path)
        {
#if UNITY_EDITOR
            if (string.IsNullOrEmpty(key) || string.IsNullOrEmpty(path)) return;
            Append("key\t" + key + "\t" + path);
            Record(path);
#endif
        }

#if UNITY_EDITOR
        static readonly HashSet<string> _seen = new HashSet<string>();

        static void Record(string path)
        {
            if (!path.StartsWith("Assets/")) return;
            Append("path\t" + path);
        }

        static bool _loaded;

        static string FullPath => Path.Combine(Path.GetDirectoryName(Application.dataPath) ?? ".", UsedPathsFile);

        static void Append(string line)
        {
            try
            {
                if (!_loaded)
                {
                    _loaded = true;
                    if (File.Exists(FullPath)) foreach (var l in File.ReadAllLines(FullPath)) _seen.Add(l);
                }
                if (!_seen.Add(line)) return;
                Directory.CreateDirectory(Path.GetDirectoryName(FullPath));
                File.AppendAllText(FullPath, line + "\n");
            }
            catch { /* recording is best-effort; never break the editor */ }
        }
#else
        static Dictionary<string, Object> _registry;
        static Dictionary<string, string> _keys;
        static readonly List<string> _streamed = new List<string>();
        static readonly List<string> _streamedBundles = new List<string>();

        static Dictionary<string, Object> Registry { get { Ensure(); return _registry; } }
        static Dictionary<string, string> Keys { get { Ensure(); return _keys; } }

        static void Ensure()
        {
            if (_registry != null) return;
            _registry = new Dictionary<string, Object>(512);
            _keys = new Dictionary<string, string>(512);
            var reg = Resources.Load<BuildAssetRegistry>(RegistryResource);
            if (!reg) { Debug.LogWarning("[BuildAssets] no registry in this build — project assets unavailable"); return; }
            for (int i = 0; i < reg.paths.Count && i < reg.objects.Count; i++)
                if (reg.objects[i]) _registry[reg.paths[i]] = reg.objects[i];
            for (int i = 0; i < reg.keys.Count && i < reg.keyPaths.Count; i++)
                _keys[reg.keys[i]] = reg.keyPaths[i];
            if (reg.streamed != null && reg.streamedBundles != null)
            {
                _streamed.AddRange(reg.streamed);
                _streamedBundles.AddRange(reg.streamedBundles);
            }
            Debug.Log($"[BuildAssets] registry: {_registry.Count} assets, {_keys.Count} keys, {_streamed.Count} streamed");
        }
#endif
    }
}
