using MCPForUnity.Editor.Services.Transport.Transports;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

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
        }

        static void WatchPlayRequest()
        {
            const string flag = "/tmp/concordia-request-play";
            if (!System.IO.File.Exists(flag)) return;
            if (EditorApplication.isCompiling) return;
            try { System.IO.File.Delete(flag); } catch { return; }
            PlayHubNow();
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
            AssetDatabase.ImportAsset("Assets/Concordia/Resources/Concordia/Canon/sere", ImportAssetOptions.ImportRecursive);
            const string hub = "Assets/Scenes/ConcordiaHub.unity";
            if (EditorApplication.isPlaying)
            {
                EditorApplication.isPlaying = false;
                EditorApplication.delayCall += PlayHubNow;
                return;
            }
            if (System.IO.File.Exists(hub)) EditorSceneManager.OpenScene(hub);
            else ConcordiaMenu.BuildHubSceneSilent();
            EditorApplication.isPlaying = true;
            Debug.Log("[Concordia] Play Hub Now");
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
