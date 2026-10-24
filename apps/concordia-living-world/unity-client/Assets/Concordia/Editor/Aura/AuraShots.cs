using System.IO;
using UnityEditor;
using UnityEngine;

namespace Concordia.Editor
{
    /// <summary>
    /// Aura: reusable Play-mode evidence capture for the nonstop loop.
    /// Writes <c>~/.zuko/aura-shots/&lt;ID&gt;.png</c> and probes live scene health so every
    /// roadmap task can log a real number instead of a claim. Counts are scoped to the
    /// current Play session (reset on EnteredPlayMode), so they measure Play, not the editor.
    /// </summary>
    [InitializeOnLoad]
    public static class AuraShots
    {
        public const string Dir = "/Users/dutch/.zuko/aura-shots";

        public static int Errors;
        public static int Warnings;
        static int _lastErrors;
        static int _lastWarnings;

        static AuraShots()
        {
            Application.logMessageReceived += OnLog;
            EditorApplication.playModeStateChanged += OnPlayModeChanged;
        }

        static void OnPlayModeChanged(PlayModeStateChange s)
        {
            if (s == PlayModeStateChange.EnteredPlayMode)
            {
                Errors = 0;
                Warnings = 0;
                _lastErrors = 0;
                _lastWarnings = 0;
            }
        }

        static void OnLog(string message, string stackTrace, LogType type)
        {
            if (!Application.isPlaying) return;
            switch (type)
            {
                case LogType.Error:
                case LogType.Exception:
                case LogType.Assert:
                    Errors++;
                    break;
                case LogType.Warning:
                    Warnings++;
                    break;
            }
        }

        public static void ResetCounters()
        {
            Errors = 0;
            Warnings = 0;
            _lastErrors = 0;
            _lastWarnings = 0;
        }

        /// <summary>Capture the Game View to <c>~/.zuko/aura-shots/&lt;id&gt;.png</c>. Returns the path.</summary>
        public static string Capture(string id)
        {
            if (string.IsNullOrEmpty(id)) id = "shot";
            Directory.CreateDirectory(Dir);
            string path = Path.Combine(Dir, id + ".png");
            try
            {
                if (File.Exists(path)) File.Delete(path);
            }
            catch (System.Exception e)
            {
                Debug.LogWarning("[AuraShots] could not clear old shot: " + e.Message);
            }
            ScreenCapture.CaptureScreenshot(path);
            return path;
        }

        /// <summary>One-line live health probe. Safe in Play; returns a sentinel in Edit mode.</summary>
        public static string Probe()
        {
            if (!Application.isPlaying)
                return "fps=- world=- transforms=- hero=False heroMeshes=0 errors=" + Errors +
                       " warnings=" + Warnings + " lean=" + ConcordiaHost.LeanPlay + " (edit mode)";

            int worldChildren = -1;
            var wb = GameObject.Find("WorldBuilder");
            if (wb != null) worldChildren = wb.transform.childCount;
            if (worldChildren < 0)
            {
                var wroot = GameObject.Find("World");
                if (wroot != null) worldChildren = wroot.transform.childCount;
            }

            int transforms = Object.FindObjectsByType<Transform>(FindObjectsInactive.Exclude).Length;

            var person = Object.FindAnyObjectByType<ModularPerson>();
            int heroMeshes = 0;
            if (person != null)
            {
                foreach (var smr in person.GetComponentsInChildren<SkinnedMeshRenderer>(true))
                {
                    if (smr.sharedMesh != null && smr.enabled && smr.gameObject.activeInHierarchy) heroMeshes++;
                }
            }

            float fps = Time.smoothDeltaTime > 0f ? 1f / Time.smoothDeltaTime : 0f;
            string combat = "";
            var player = Object.FindAnyObjectByType<ConcordiaPlayer>();
            if (player != null)
            {
                var p = player.transform.position;
                combat = " pos=(" + p.x.ToString("F1") + "," + p.y.ToString("F1") + "," + p.z.ToString("F1") + ")";
            }

            string line = "fps=" + fps.ToString("F1") +
                          " world=" + worldChildren +
                          " transforms=" + transforms +
                          " hero=" + (person != null) +
                          " heroMeshes=" + heroMeshes +
                          " errors=" + Errors +
                          " warnings=" + Warnings +
                          " lean=" + ConcordiaHost.LeanPlay +
                          combat;
            _lastErrors = Errors;
            _lastWarnings = Warnings;
            return line;
        }

        /// <summary>Capture + probe + log in one call. Entry point for execute_script.</summary>
        public static string Execute() { return CaptureAndProbe("B-03"); }

        public static string CaptureAndProbe(string id)
        {
            string path = Capture(id);
            string probe = Probe();
            Debug.Log("[AuraVerify] " + id + " SNAPSHOT " + probe + " shot=" + path);
            return probe + " shot=" + path;
        }

        [MenuItem("Concordia/Aura/Capture Shot + Probe")]
        static void MenuCapture()
        {
            CaptureAndProbe(Application.isPlaying ? "adhoc-play" : "adhoc-edit");
        }
    }
}
