using System.Diagnostics;
using System.IO;
using MCPForUnity.Editor.Services.Transport.Transports;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using Debug = UnityEngine.Debug;

namespace Concordia.Editor
{
    [InitializeOnLoad]
    static class ConcordiaBoot
    {
        static bool _didKick;

        static ConcordiaBoot()
        {
            EditorApplication.delayCall += KickOnce;
            EditorApplication.update += WatchPlayRequest;
            EditorApplication.update += WatchWebExport;
            EditorApplication.update += WatchStopPlay;
            EditorApplication.update += WatchShedRam;
        }

        static void WatchShedRam()
        {
            const string flag = "/tmp/concordia-request-shed-ram";
            if (!File.Exists(flag)) return;
            try { File.Delete(flag); } catch { return; }
            ShedRamForPlayQa();
        }

        static void WatchPlayRequest()
        {
            const string flag = "/tmp/concordia-request-play";
            if (!System.IO.File.Exists(flag)) return;
            if (EditorApplication.isCompiling) return;
            try { System.IO.File.Delete(flag); } catch { return; }
            PlayHubNow();
        }

        static void WatchStopPlay()
        {
            const string flag = "/tmp/concordia-request-stop";
            if (!System.IO.File.Exists(flag)) return;
            try { System.IO.File.Delete(flag); } catch { return; }
            if (EditorApplication.isPlaying) EditorApplication.isPlaying = false;
        }

        static void WatchWebExport()
        {
            const string flag = "/tmp/concordia-request-webgl-export";
            if (!System.IO.File.Exists(flag)) return;
            if (ConcordiaWebExport.Busy) return;
            if (EditorApplication.isCompiling || EditorApplication.isPlaying) return;
            try { System.IO.File.Delete(flag); } catch { return; }
            ConcordiaWebExport.ExportInEditor();
        }

        static void KickOnce()
        {
            if (_didKick) return;
            _didKick = true;
            EditorPrefs.SetBool("MCPForUnity.UseHttpTransport", false);
            EditorPrefs.SetBool("MCPForUnity.AutoStartOnLoad", true);
            try
            {
                StdioBridgeHost.StartAutoConnect();
                Debug.Log("[Concordia] MCP stdio bridge started on port " + StdioBridgeHost.GetCurrentPort());
            }
            catch (System.Exception e)
            {
                Debug.LogWarning("[Concordia] MCP stdio start: " + e.Message);
            }
            try { CxBake.Ensure(false); }
            catch (System.Exception e) { Debug.LogWarning("[Concordia] CX bake: " + e.Message); }
            CloseTutorialWindows();
            var path = EditorSceneManager.GetActiveScene().path;
            if (path.Contains("GetStarted") || string.IsNullOrEmpty(path))
                ConcordiaMenu.BuildHubSceneSilent();
        }

        static void CloseTutorialWindows()
        {
            foreach (var w in Resources.FindObjectsOfTypeAll<EditorWindow>())
            {
                if (w == null) continue;
                var n = w.GetType().Name;
                if (n.Contains("Tutorial") || n.Contains("Welcome") || n.Contains("GetStarted") || n.Contains("IET"))
                    w.Close();
            }
        }

        [MenuItem("Concordia/Start MCP Bridge")]
        public static void StartMcpBridge()
        {
            EditorPrefs.SetBool("MCPForUnity.UseHttpTransport", false);
            EditorPrefs.SetBool("MCPForUnity.AutoStartOnLoad", true);
            StdioBridgeHost.StartAutoConnect();
            Debug.Log("[Concordia] MCP stdio bridge started on port " + StdioBridgeHost.GetCurrentPort());
        }

        [MenuItem("Concordia/Play Hub Now")]
        public static void PlayHubNow()
        {
            // Enter Play Mode Options (Disable Domain Reload) restores
            // Temp/__Backupscenes and aborts Play in ~20–30ms (0 beats).
            // Force classic Play Mode so Hub can hold.
            if (EditorSettings.enterPlayModeOptionsEnabled
                || EditorSettings.enterPlayModeOptions != EnterPlayModeOptions.None)
            {
                EditorSettings.enterPlayModeOptionsEnabled = false;
                EditorSettings.enterPlayModeOptions = EnterPlayModeOptions.None;
                Debug.Log("[Concordia] disabled Enter Play Mode Options (was aborting Play via __Backupscenes)");
            }
            // Do not ImportAsset here — recursive reimport of Canon/sere blocks the
            // Editor main thread (>30s when disk is tight) and starves Coplay commands
            // while the bridge still pongs. Canon is already in the project.
            const string hub = "Assets/Scenes/ConcordiaHub.unity";
            if (EditorApplication.isCompiling)
            {
                EditorApplication.delayCall += PlayHubNow;
                return;
            }
            if (EditorApplication.isPlaying)
            {
                EditorApplication.isPlaying = false;
                EditorApplication.delayCall += PlayHubNow;
                return;
            }
            if (System.IO.File.Exists(hub)) EditorSceneManager.OpenScene(hub);
            else ConcordiaMenu.BuildHubSceneSilent();
            EditorApplication.isPlaying = true;
            Debug.Log("[Concordia] Play Hub Now lean=" + ConcordiaHost.LeanPlay
                + " memMB=" + SystemInfo.systemMemorySize);
        }

        /// <summary>
        /// Stops Ollama / llama-server so 16GB Macs can hold Play Hub.
        /// Runs apps/concordia-living-world/scripts/shed-ram-for-unity-qa.sh.
        /// </summary>
        [MenuItem("Concordia/Shed RAM for Play QA")]
        public static void ShedRamForPlayQa()
        {
            // Assets/ → unity-client/ → living-world/
            var livingWorld = Path.GetFullPath(Path.Combine(Application.dataPath, "..", ".."));
            var script = Path.Combine(livingWorld, "scripts", "shed-ram-for-unity-qa.sh");
            if (!File.Exists(script))
            {
                Debug.LogError("[Concordia] shed-ram-for-unity-qa.sh missing at " + script);
                return;
            }
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = "/bin/bash",
                    Arguments = "\"" + script + "\"",
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true
                };
                var p = Process.Start(psi);
                if (p == null)
                {
                    Debug.LogError("[Concordia] failed to start shed-ram script");
                    return;
                }
                var stdout = p.StandardOutput.ReadToEnd();
                var stderr = p.StandardError.ReadToEnd();
                p.WaitForExit(120000);
                if (!string.IsNullOrEmpty(stdout)) Debug.Log("[Concordia] shed-ram:\n" + stdout);
                if (!string.IsNullOrEmpty(stderr)) Debug.LogWarning("[Concordia] shed-ram stderr:\n" + stderr);
                Debug.Log("[Concordia] Shed RAM done. exit=" + p.ExitCode + " — then Concordia → Play Hub Now");
            }
            catch (System.Exception e)
            {
                Debug.LogError("[Concordia] Shed RAM failed: " + e.Message);
            }
        }

        [MenuItem("Concordia/Shed RAM then Play Hub")]
        public static void ShedThenPlay()
        {
            ShedRamForPlayQa();
            EditorApplication.delayCall += PlayHubNow;
        }

        /// <summary>CLI: Unity -executeMethod Concordia.Editor.ConcordiaBoot.PlayHubFromCli</summary>
        public static void PlayHubFromCli()
        {
            EditorApplication.delayCall += () =>
            {
                if (EditorApplication.isCompiling)
                {
                    EditorApplication.delayCall += PlayHubFromCli;
                    return;
                }
                PlayHubNow();
            };
        }

        [MenuItem("Concordia/Reset Editor Layout (dock Game tab)")]
        public static void ResetLayout()
        {
            EditorApplication.ExecuteMenuItem("Window/Layouts/Default");
        }
    }
}
