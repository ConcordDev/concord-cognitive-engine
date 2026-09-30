using System.IO;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEngine;

namespace Concordia.Editor
{
    /// <summary>
    /// Linux dedicated-server build of Concordia — the headless shared-world
    /// host (World lens step 3). Batchmode:
    ///   Unity -batchmode -quit -projectPath … -executeMethod Concordia.Editor.ConcordiaServerExport.BuildLinuxServer
    /// Output: $CONCORD_SERVER_BUILD or ~/concord/builds/concordia-linux-server/
    /// Run on the server with: ./ConcordiaHost.x86_64 -batchmode -nographics -concordWorldHost
    ///   -concordGateway=ws://127.0.0.1:5050/unity-ws -concordToken=… -concordWorld=concordia-hub
    /// </summary>
    public static class ConcordiaServerExport
    {
        public static void BuildLinuxServer()
        {
            ConcordiaUrpEnsure.Ensure();
            ConcordiaShaderKeep.Ensure(); // runtime-built materials need their shaders shipped
            ConcordiaMenu.BuildHubSceneSilent();
            ConcordiaBuildAssetRegistry.Generate(); // ship the assets the editor uses (see BuildAssets)

            var outDir = System.Environment.GetEnvironmentVariable("CONCORD_SERVER_BUILD");
            if (string.IsNullOrEmpty(outDir))
                outDir = Path.Combine(System.Environment.GetFolderPath(System.Environment.SpecialFolder.UserProfile), "concord", "builds", "concordia-linux-server");
            if (Directory.Exists(outDir)) Directory.Delete(outDir, true);
            Directory.CreateDirectory(outDir);

            var opts = new BuildPlayerOptions
            {
                scenes = new[] { "Assets/Scenes/ConcordiaHub.unity" },
                locationPathName = Path.Combine(outDir, "ConcordiaHost.x86_64"),
                target = BuildTarget.StandaloneLinux64,
                subtarget = (int)StandaloneBuildSubtarget.Server,
                options = BuildOptions.None,
            };
            var report = BuildPipeline.BuildPlayer(opts);
            if (report.summary.result != BuildResult.Succeeded)
            {
                Debug.LogError("Concordia Linux server build failed: " + report.summary.result);
                if (Application.isBatchMode) EditorApplication.Exit(1);
                return;
            }
            Debug.Log($"Concordia Linux server build OK: {outDir} ({report.summary.totalSize / (1024 * 1024)} MB)");
        }
    }
}
