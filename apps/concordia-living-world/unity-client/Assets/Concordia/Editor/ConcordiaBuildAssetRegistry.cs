using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using UnityEditor;
using UnityEngine;

namespace Concordia.Editor
{
    /// <summary>
    /// Export step: builds Resources/Concordia/BuildAssetRegistry.asset — the
    /// project assets a build ships, so builds show the same characters, gear and
    /// textures as the editor (see BuildAssets). Contents:
    ///   1. the core character set (CX prefabs, the Rocketbox humans ModularPerson
    ///      asks for, locomotion controllers), always;
    ///   2. every path / FreePacks stem the editor actually loaded, recorded by
    ///      BuildAssets into Generated/BuildAssets/used-paths.txt (grows as the
    ///      game is played in the editor; the export's own Hub build adds to it).
    /// Writes Generated/BuildAssets/registry-report.txt: every asset and the
    /// on-disk size of it plus its dependencies, so the download cost is visible.
    /// </summary>
    public static class ConcordiaBuildAssetRegistry
    {
        const string RegistryPath = "Assets/Concordia/Resources/Concordia/BuildAssetRegistry.asset";
        const string ReportPath = "Assets/Concordia/Generated/BuildAssets/registry-report.txt";

        static readonly string[] CoreFolders = { "Assets/Concordia/Generated/Prefabs" };
        static readonly string[] CorePaths =
        {
            "Assets/Concordia/Models/humans/rocketbox/Male_Adult_01/Male_Adult_01.fbx",
            "Assets/Concordia/Models/humans/rocketbox/Male_Adult_05/Male_Adult_05.fbx",
            "Assets/Concordia/Models/humans/rocketbox/Male_Adult_08/Male_Adult_08.fbx",
            "Assets/Concordia/Models/humans/rocketbox/Female_Adult_01/Female_Adult_01.fbx",
            "Assets/Concordia/Models/humans/rocketbox/Female_Adult_04/Female_Adult_04.fbx",
            "Assets/Concordia/Anim/ConcordiaLocomotion.controller",
            "Assets/Concordia/Anim/SoldierLocomotion.controller",
        };

        [MenuItem("Concordia/Generate Build Asset Registry")]
        public static void Generate()
        {
            var paths = new SortedSet<string>(CorePaths.Where(p => File.Exists(p)));
            foreach (var folder in CoreFolders)
                if (AssetDatabase.IsValidFolder(folder))
                    foreach (var guid in AssetDatabase.FindAssets("t:Prefab", new[] { folder }))
                        paths.Add(AssetDatabase.GUIDToAssetPath(guid));

            var keys = new SortedDictionary<string, string>();

            // Rocketbox skins are bound at runtime by material name (FreePacks
            // BindNamedSkin: "<material>_color" / "_normal", searched project-wide).
            // Run that same search for every core body so its maps ship even if no
            // one has played in the editor since the last export.
            foreach (var p in paths.ToList())
            {
                if (!(AssetDatabase.LoadMainAssetAtPath(p) is GameObject go)) continue;
                foreach (var r in go.GetComponentsInChildren<Renderer>(true))
                    foreach (var m in r.sharedMaterials)
                    {
                        if (!m) continue;
                        var name = m.name.Replace(" (Instance)", "").Trim();
                        foreach (var suffix in new[] { "_color", "_normal" })
                        {
                            var tex = FreePacks.FindSkinPath(name + suffix);
                            if (tex == null) continue;
                            keys["skin:" + name + suffix] = tex;
                            paths.Add(tex);
                        }
                    }
            }
            if (File.Exists(BuildAssets.UsedPathsFile))
            {
                foreach (var line in File.ReadAllLines(BuildAssets.UsedPathsFile))
                {
                    var f = line.Split('\t');
                    if (f.Length == 2 && f[0] == "path") paths.Add(f[1]);
                    else if (f.Length == 3 && f[0] == "key") { keys[f[1]] = f[2]; paths.Add(f[2]); }
                }
            }

            var reg = AssetDatabase.LoadAssetAtPath<BuildAssetRegistry>(RegistryPath);
            if (!reg)
            {
                Directory.CreateDirectory(Path.GetDirectoryName(RegistryPath));
                reg = ScriptableObject.CreateInstance<BuildAssetRegistry>();
                AssetDatabase.CreateAsset(reg, RegistryPath);
            }
            reg.paths.Clear(); reg.objects.Clear(); reg.keys.Clear(); reg.keyPaths.Clear();

            var report = new StringBuilder();
            var counted = new HashSet<string>();
            long totalBytes = 0;
            int missing = 0;
            foreach (var p in paths)
            {
                var obj = AssetDatabase.LoadMainAssetAtPath(p);
                if (!obj) { missing++; report.AppendLine("MISSING  " + p); continue; }
                reg.paths.Add(p);
                reg.objects.Add(obj);
                long bytes = 0;
                foreach (var dep in AssetDatabase.GetDependencies(p, true))
                {
                    if (!counted.Add(dep) || !File.Exists(dep)) continue;
                    bytes += new FileInfo(dep).Length;
                }
                totalBytes += bytes;
                report.AppendLine($"{bytes / 1024,9} KB  {p}");
            }
            foreach (var kv in keys)
                if (reg.paths.Contains(kv.Value)) { reg.keys.Add(kv.Key); reg.keyPaths.Add(kv.Value); }

            EditorUtility.SetDirty(reg);
            AssetDatabase.SaveAssets();

            var summary = $"{reg.paths.Count} assets, {reg.keys.Count} stems, {missing} missing, ~{totalBytes / (1024 * 1024)} MB source incl. dependencies";
            Directory.CreateDirectory(Path.GetDirectoryName(ReportPath));
            File.WriteAllText(ReportPath, "# Build asset registry — " + summary + "\n" + report);
            Debug.Log("[BuildAssetRegistry] " + summary + " → " + RegistryPath + " (report: " + ReportPath + ")");
        }
    }
}
