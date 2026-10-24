using System.IO;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEngine;

namespace Concordia.Editor
{
    /// <summary>
    /// Batchmode WebGL export used by scripts/export-unity-web.mjs.
    /// Writes index.html to concord-frontend/.unity-web-staging/ so the Next
    /// route can nonce it; other files are copied to public/unity-client/.
    /// </summary>
    public static class ConcordiaWebExport
    {
        public static bool Busy;

        /// Models above this (source + dependencies) stream as AssetBundles
        /// instead of riding in the main download. See ConcordiaBuildAssetRegistry.
        const long StreamAboveBytes = 64L * 1024 * 1024;

        public static void Export()
        {
            ConcordiaUrpEnsure.Ensure();
            ConcordiaShaderKeep.Ensure(); // runtime-built materials need their shaders shipped
            ConcordiaMenu.BuildHubSceneSilent();
            ConcordiaBuildAssetRegistry.Generate(StreamAboveBytes); // ship the assets the editor uses (see BuildAssets)

            var repoRoot = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "..", ".."));
            var staging = System.Environment.GetEnvironmentVariable("CONCORD_UNITY_STAGING");
            if (string.IsNullOrEmpty(staging))
                staging = Path.Combine(repoRoot, "concord-frontend", ".unity-web-staging");
            if (Directory.Exists(staging)) Directory.Delete(staging, true);
            Directory.CreateDirectory(staging);

            // Last path component becomes the wasm/loader stem. Do not use a
            // dotfile folder name — Next/nginx hide those and the page 404s.
            var buildFolder = Path.Combine(staging, "concordia");
            if (Directory.Exists(staging)) Directory.Delete(staging, true);
            Directory.CreateDirectory(staging);

            // WebGL BuildPlayer writes a FOLDER (index.html + Build/ + TemplateData/).
            var opts = new BuildPlayerOptions
            {
                scenes = new[] { "Assets/Scenes/ConcordiaHub.unity" },
                locationPathName = staging,
                target = BuildTarget.WebGL,
                options = BuildOptions.CompressWithLz4
            };

            PlayerSettings.WebGL.exceptionSupport = WebGLExceptionSupport.None;
            PlayerSettings.WebGL.threadsSupport = false;
            PlayerSettings.WebGL.decompressionFallback = true;

            var report = BuildPipeline.BuildPlayer(opts);
            if (report.summary.result != BuildResult.Succeeded)
            {
                Debug.LogError("Concordia WebGL export failed: " + report.summary.result);
                if (Application.isBatchMode)
                    EditorApplication.Exit(1);
                return;
            }
            if (!BuildStreamedBundles(Path.Combine(staging, "StreamingAssets", "Streamed")))
            {
                Debug.LogError("Concordia WebGL export: streamed asset bundles failed");
                if (Application.isBatchMode)
                    EditorApplication.Exit(1);
                return;
            }
            ShipOrganicRegistry(Path.Combine(staging, "StreamingAssets", "HubKit", "organic"));
            Debug.Log("Concordia WebGL export wrote " + staging);
        }

        /// OrganicKit reads the registry and bind contract from project paths, which a
        /// browser cannot open; on WebGL it fetches these copies from the kit instead.
        static void ShipOrganicRegistry(string outDir)
        {
            Directory.CreateDirectory(outDir);
            foreach (var src in new[] { OrganicKit.ManifestPath, OrganicKit.BindPath })
            {
                var full = Path.GetFullPath(Path.Combine(Application.dataPath, "..", src));
                if (File.Exists(full)) File.Copy(full, Path.Combine(outDir, Path.GetFileName(src)), true);
                else Debug.LogWarning("[Concordia] export: " + src + " missing; organic meshes will not bind on web");
            }
        }

        /// One AssetBundle per streamed registry path, named as the registry
        /// records it, so BuildAssets can fetch each on its own. Built after
        /// BuildPlayer, when WebGL is already the active target.
        static bool BuildStreamedBundles(string outDir)
        {
            var reg = ConcordiaBuildAssetRegistry.Current();
            if (!reg || reg.streamed.Count == 0) return true;
            var builds = new AssetBundleBuild[reg.streamed.Count];
            for (int i = 0; i < builds.Length; i++)
                builds[i] = new AssetBundleBuild
                {
                    assetBundleName = reg.streamedBundles[i],
                    assetNames = new[] { reg.streamed[i] },
                };
            var work = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "Library", "ConcordiaStreamedBundles"));
            Directory.CreateDirectory(work);
            var manifest = BuildPipeline.BuildAssetBundles(work, builds,
                BuildAssetBundleOptions.ChunkBasedCompression, BuildTarget.WebGL);
            if (!manifest) return false;
            Directory.CreateDirectory(outDir);
            foreach (var b in reg.streamedBundles)
            {
                var src = Path.Combine(work, b);
                if (!File.Exists(src)) return false;
                File.Copy(src, Path.Combine(outDir, b), true);
                Debug.Log($"[Concordia] streamed bundle {b} ({new FileInfo(src).Length / (1024 * 1024)} MB)");
            }
            return true;
        }

        [MenuItem("Concordia/Export WebGL (in Editor)")]
        public static void ExportInEditor()
        {
            if (Busy)
            {
                Debug.LogWarning("[Concordia] WebGL export already running.");
                return;
            }
            if (EditorApplication.isPlaying)
            {
                Debug.LogWarning("[Concordia] Stop Play before WebGL export.");
                return;
            }
            Busy = true;
            try { Export(); }
            finally { Busy = false; }
        }
    }
}
