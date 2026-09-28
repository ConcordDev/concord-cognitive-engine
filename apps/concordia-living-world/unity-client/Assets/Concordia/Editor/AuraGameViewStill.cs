using System.IO;
using UnityEditor;
using UnityEngine;

namespace Concordia.Editor
{
    [InitializeOnLoad]
    static class AuraGameViewStill
    {
        const string Dir = "/Users/dutch/.zuko/remaining-work/aura-stills";
        static double _entered = -1;
        static bool _shot;

        static AuraGameViewStill()
        {
            EditorApplication.playModeStateChanged += OnPlay;
            EditorApplication.update += OnUpdate;
        }

        static void OnPlay(PlayModeStateChange s)
        {
            if (s == PlayModeStateChange.EnteredPlayMode)
            {
                _entered = EditorApplication.timeSinceStartup;
                _shot = false;
            }
            else if (s == PlayModeStateChange.ExitingPlayMode)
            {
                _entered = -1;
            }
        }

        static void OnUpdate()
        {
            if (_shot || _entered < 0 || !EditorApplication.isPlaying) return;
            if (EditorApplication.timeSinceStartup - _entered < 4.0) return;
            _shot = true;
            try
            {
                Directory.CreateDirectory(Dir);
                var name = "aura-court-game-" + System.DateTime.Now.ToString("yyyyMMdd-HHmmss") + ".png";
                var path = Path.Combine(Dir, name);
                // Prefer GameView capture via ScreenCapture (writes relative to project unless absolute)
                ScreenCapture.CaptureScreenshot(path);
                Debug.Log("[AuraGameViewStill] CaptureScreenshot -> " + path);
                // Also dump a marker
                File.WriteAllText(Path.Combine(Dir, "last-game-still.txt"), path + "\nlean=" + ConcordiaHost.LeanPlay);
            }
            catch (System.Exception e)
            {
                Debug.LogWarning("[AuraGameViewStill] " + e.Message);
            }
        }
    }
}
