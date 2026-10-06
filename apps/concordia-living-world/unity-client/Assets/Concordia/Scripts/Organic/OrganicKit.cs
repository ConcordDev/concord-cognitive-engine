using System;
using System.Collections.Generic;
using System.IO;
using UnityEngine;
#if UNITY_EDITOR
using UnityEditor;
#endif

namespace Concordia
{
    /// <summary>
    /// Runtime index for the authored organic mesh registry
    /// (Assets/Concordia/Models/Generated/ORGANIC_MANIFEST.json).
    ///
    /// The registry is the source of truth for 125 TRELLIS meshes; before this class
    /// existed nothing in the runtime referenced it, so the meshes were a folder of
    /// glbs nobody could see. This class does not import anything itself: it registers
    /// each mesh with HubKit, which owns the single glTFast import path, the Standard
    /// to URP sweep, and the lazy first-use policy.
    ///
    /// It also reads ORGANIC_BIND.json, the Unity bind contract (world, role, metres,
    /// collider policy, snap) that turns a registry row into a placeable object.
    /// </summary>
    public static class OrganicKit
    {
        /// <summary>Registry of truth. Category folders live beside it.</summary>
        public const string ManifestPath = "Assets/Concordia/Models/Generated/ORGANIC_MANIFEST.json";

        /// <summary>Unity bind contract written next to the registry.</summary>
        public const string BindPath = "Assets/Concordia/Models/Generated/ORGANIC_BIND.json";

        [Serializable]
        public sealed class BindRow
        {
            public string id;
            public string world;
            public string role;          // hero | landmark | flora
            public float maxDimension;
            public float colliderHeight;
            public int snapM;
            public string colliders;     // mesh | box | trunk
            public string law;           // inside_42m | outside_42m | outside_wall | outside_hub_disk
            public string note;
        }

        [Serializable]
        sealed class BindRoot
        {
            public string schema;
            public string note;
            public BindRow[] rows;
        }

        static readonly Dictionary<string, string> Files = new Dictionary<string, string>(160);
        static readonly Dictionary<string, BindRow> Binds = new Dictionary<string, BindRow>(64);
        static bool _indexed;
        static string _source = "(not indexed)";

        public static bool Indexed => _indexed;
        public static string Source => _source;
        public static int Count => Files.Count;
        public static int BindCount => Binds.Count;

        /// <summary>
        /// Mirrors HubKit's session reset. Play Mode here enters with Reload Domain disabled,
        /// so this index outlives the session while HubKit's Index does not - HubKit clears
        /// its Index in LoadAll, which would drop every one of the 125 external stems this
        /// class registered. Clearing the flag makes EnsureIndexed re-register them into the
        /// fresh HubKit index on the next staging pass.
        /// </summary>
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetSessionState()
        {
            Files.Clear();
            Binds.Clear();
            _indexed = false;
            _source = "(not indexed)";
        }

        public static string Summary() =>
            "organic meshes=" + Count + " binds=" + BindCount + " source=" + Source;

        /// <summary>
        /// Register every registry mesh with HubKit and load the bind contract.
        /// Safe to call repeatedly. HubKit clears its index during its own manifest
        /// load, so callers must let <see cref="HubKit.EnsureLoaded"/> settle first.
        /// </summary>
        public static void EnsureIndexed()
        {
            if (_indexed) return;
            var raw = ReadText(ManifestPath);
            if (string.IsNullOrEmpty(raw))
            {
                Debug.LogWarning("[Concordia] OrganicKit: " + ManifestPath + " not found; organic meshes stay unbound.");
                _indexed = true;
                _source = "(missing)";
                return;
            }

            try
            {
                ParseRegistry(raw);
                LoadBinds();
                _indexed = true;
                Debug.Log("[Concordia] OrganicKit: " + Summary());
            }
            catch (Exception e)
            {
                Debug.LogWarning("[Concordia] OrganicKit index failed: " + e.Message);
            }
        }

        public static bool Has(string id) => !string.IsNullOrEmpty(id) && Files.ContainsKey(id);

        public static string FileFor(string id) =>
            !string.IsNullOrEmpty(id) && Files.TryGetValue(id, out var file) ? file : null;

        public static BindRow Bind(string id) =>
            !string.IsNullOrEmpty(id) && Binds.TryGetValue(id, out var row) ? row : null;

        public static BindRow[] Rows()
        {
            var rows = new BindRow[Binds.Count];
            Binds.Values.CopyTo(rows, 0);
            return rows;
        }

        /// <summary>Bind rows whose world field matches, in table order.</summary>
        public static BindRow[] RowsFor(WorldId world)
        {
            var key = world.ToString();
            var list = new List<BindRow>(4);
            foreach (var row in Rows())
                if (row != null && string.Equals(row.world, key, StringComparison.OrdinalIgnoreCase))
                    list.Add(row);
            return list.ToArray();
        }

        /// <summary>
        /// Line scan of the registry. The "assets" member is a JSON object keyed by id,
        /// which JsonUtility cannot deserialize into a class, and the registry is
        /// canonical and shared with the browser and server lanes, so it is read
        /// as authored text rather than reshaped for Unity.
        /// </summary>
        static void ParseRegistry(string raw)
        {
            Files.Clear();
            string current = null;
            var lines = raw.Split('\n');
            for (var i = 0; i < lines.Length; i++)
            {
                var line = lines[i].Trim();
                if (line.Length == 0) continue;

                if (line.StartsWith("\"", StringComparison.Ordinal) && line.EndsWith(": {", StringComparison.Ordinal))
                {
                    var key = line.Substring(1, line.IndexOf('"', 1) - 1);
                    current = key.Length > 0 && key.IndexOf(' ') < 0 ? key : null;
                }

                if (current == null || !line.StartsWith("\"lodsFile\"", StringComparison.Ordinal)) continue;
                var value = Value(line);
                if (string.IsNullOrEmpty(value)) continue;
                Files[current] = value.Replace('\\', '/');
                HubKit.IndexExternal(current, Files[current]);
            }

            _source = ManifestPath;
        }

        static void LoadBinds()
        {
            Binds.Clear();
            var raw = ReadText(BindPath);
            if (string.IsNullOrEmpty(raw))
            {
                Debug.LogWarning("[Concordia] OrganicKit: " + BindPath + " not found; no organic bind rows.");
                return;
            }

            var root = JsonUtility.FromJson<BindRoot>(raw);
            if (root?.rows == null) return;
            foreach (var row in root.rows)
            {
                if (row == null || string.IsNullOrEmpty(row.id)) continue;
                Binds[row.id] = row;
            }
        }

        static string Value(string line)
        {
            var first = line.IndexOf('"', line.IndexOf(':'));
            if (first < 0) return null;
            var last = line.IndexOf('"', first + 1);
            return last < first ? null : line.Substring(first + 1, last - first - 1);
        }

        static string ReadText(string projectRelativePath)
        {
#if UNITY_EDITOR
            var asset = AssetDatabase.LoadAssetAtPath<TextAsset>(projectRelativePath);
            if (asset) return asset.text;
#endif
            var path = ProjectPath(projectRelativePath);
            return path != null && File.Exists(path) ? File.ReadAllText(path) : null;
        }

        /// <summary>Absolute path for an Assets/ relative path, in editor and desktop players.</summary>
        public static string ProjectPath(string projectRelativePath)
        {
            if (string.IsNullOrEmpty(projectRelativePath)) return null;
            var rel = projectRelativePath.Replace('\\', '/');
            if (!rel.StartsWith("Assets/", StringComparison.Ordinal)) return null;
            var root = Directory.GetParent(Application.dataPath);
            return root == null ? null : Path.Combine(root.FullName, rel);
        }
    }
}
