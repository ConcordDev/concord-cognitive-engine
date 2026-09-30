using System.IO;
using UnityEditor;
using UnityEngine;

namespace Concordia.Editor
{
    /// <summary>
    /// Generate Unity Mesh LODs for the heavy PolyHaven models.
    ///
    /// Root cause of the Hub's frame time (LookCapture perf, 2026-09-30): the
    /// PolyHaven jacaranda FBX ships only LOD0 — 3.86 M triangles — and
    /// HubWilderness scatters dozens of copies, all drawn at full detail and
    /// again for shadows: ~247 M triangles per frame, ~1 s main-thread frames
    /// even in the editor, which froze the WebGL build.
    ///
    /// Mesh LOD keeps the original mesh as LOD0 (full detail up close) and adds
    /// reduced levels that Unity selects automatically by on-screen size, so
    /// distant copies stop costing millions of triangles they can't show.
    /// Nothing is replaced or simplified at close range.
    /// Idempotent. Writes Generated/BuildAssets/mesh-lod-report.txt.
    /// </summary>
    public static class ConcordiaMeshLod
    {
        static readonly string[] Roots = { "Assets/Concordia/PolyHaven/Models" };
        const string ReportPath = "Assets/Concordia/Generated/BuildAssets/mesh-lod-report.txt";

        [MenuItem("Concordia/Generate Mesh LODs (PolyHaven models)")]
        public static void Apply()
        {
            var log = new System.Text.StringBuilder();
            int changed = 0, total = 0;
            foreach (var guid in AssetDatabase.FindAssets("t:Model", Roots))
            {
                var path = AssetDatabase.GUIDToAssetPath(guid);
                if (!(AssetImporter.GetAtPath(path) is ModelImporter mi)) continue;
                total++;
                if (mi.generateMeshLods) continue;
                mi.generateMeshLods = true;
                mi.SaveAndReimport();
                changed++;
                log.AppendLine("mesh-lod  " + path);
            }
            var summary = $"Mesh LOD generation enabled on {changed} of {total} PolyHaven models";
            Directory.CreateDirectory(Path.GetDirectoryName(ReportPath));
            File.WriteAllText(ReportPath, "# " + summary + "\n" + log);
            Debug.Log("[MeshLod] " + summary);
        }

        /// Batchmode entry: -executeMethod Concordia.Editor.ConcordiaMeshLod.ApplyAndQuit
        public static void ApplyAndQuit()
        {
            Apply();
            EditorApplication.Exit(0);
        }
    }
}
