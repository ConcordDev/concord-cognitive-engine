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
        public static void Export()
        {
            ConcordiaUrpEnsure.Ensure();
            ConcordiaMenu.BuildHubSceneSilent();

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
                EditorApplication.Exit(1);
                return;
            }
            Debug.Log("Concordia WebGL export wrote " + staging);
        }
    }
}
