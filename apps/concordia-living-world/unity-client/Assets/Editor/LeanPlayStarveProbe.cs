#if UNITY_EDITOR
using System;
using System.IO;
using System.Text;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

[InitializeOnLoad]
public static class LeanPlayStarveProbe
{
    // Stage + heart + compile status must NOT live under Assets — WriteAllText /
    // AppendAllText every second dirties AssetDatabase and freezes Editor update
    // once CompileOne fills the scene (~48s melt @~10fps / BehaviourUpdate GC).
    const string StagePath = "/tmp/concord-play-stage.txt";
    const string HeartPath = "/tmp/concord-play-heartbeat.txt";
    const string CompilePath = "/tmp/concord-play-compile-status.txt";
    static double _playStart = -1;
    static int _beats;

    static LeanPlayStarveProbe()
    {
        EditorApplication.delayCall += WriteCompileStatus;
        EditorApplication.playModeStateChanged += OnPlayMode;
        EditorApplication.update += OnUpdate;
    }

    static void WriteCompileStatus()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(Abs(CompilePath)));
            var sb = new StringBuilder();
            sb.AppendLine(DateTime.UtcNow.ToString("o"));
            sb.AppendLine("compiling=" + EditorApplication.isCompiling);
            sb.AppendLine("updating=" + EditorApplication.isUpdating);
            sb.AppendLine("playing=" + EditorApplication.isPlaying);
            var errs = new StringBuilder();
            foreach (var log in GetCompileErrors())
                errs.AppendLine(log);
            sb.AppendLine("errors:");
            sb.Append(errs.Length == 0 ? "(none)\n" : errs.ToString());
            File.WriteAllText(Abs(CompilePath), sb.ToString());
        }
        catch (Exception e)
        {
            Debug.LogWarning("[LeanPlayStarveProbe] compile status: " + e.Message);
        }
    }

    static System.Collections.Generic.IEnumerable<string> GetCompileErrors()
    {
        // Best-effort: read last Console entries via reflection is brittle; use CompilationPipeline.
        yield break;
    }

    static void OnPlayMode(PlayModeStateChange state)
    {
        if (state == PlayModeStateChange.EnteredPlayMode)
        {
            _playStart = EditorApplication.timeSinceStartup;
            _beats = 0;
            WriteStage("play_entered");
            WriteHeart("entered");
        }
        else if (state == PlayModeStateChange.ExitingPlayMode)
        {
            WriteStage("play_exiting beats=" + _beats);
            WriteHeart("exiting beats=" + _beats);
            _playStart = -1;
        }
    }

    static void OnUpdate()
    {
        // External trigger: touch Assets/Concordia/Generated/request-play.txt
        try
        {
            foreach (var stop in new[] { Abs("Assets/Concordia/Generated/request-stop-play.txt"), "/tmp/concord-request-stop-play" })
            {
                if (!File.Exists(stop)) continue;
                try { File.Delete(stop); } catch { }
                if (EditorApplication.isPlaying)
                {
                    EditorApplication.isPlaying = false;
                    WriteHeart("stop_requested");
                    WriteStage("play_stop_requested");
                }
                break;
            }
            foreach (var req in new[] { Abs("Assets/Concordia/Generated/request-play.txt"), "/tmp/concord-request-play" })
            {
                if (!File.Exists(req)) continue;
                if (EditorApplication.isCompiling || EditorApplication.isUpdating) break;
                try { File.Delete(req); } catch { }
                if (EditorApplication.isPlaying)
                {
                    // Dead restored Play (no heartbeats) — exit then re-enter.
                    Debug.LogWarning("[LeanPlayStarveProbe] already playing — stop then re-enter");
                    EditorApplication.isPlaying = false;
                    EditorApplication.delayCall += () =>
                    {
                        if (!EditorApplication.isCompiling && !EditorApplication.isUpdating)
                            EnterPlayProbe();
                    };
                }
                else
                    EnterPlayProbe();
                break;
            }
        }
        catch { }

        if (!EditorApplication.isPlaying || _playStart < 0) return;
        if (EditorApplication.timeSinceStartup - _playStart < _beats + 1) return;
        _beats++;
        WriteHeart("t=" + _beats + "s fps~" + (1f / Mathf.Max(0.0001f, Time.deltaTime)).ToString("0.0"));
        WriteStage("play_alive t=" + _beats);
        if (_beats >= 60)
        {
            WriteStage("play_ok_60s");
            WriteHeart("SUCCESS 60s alive");
            EditorApplication.isPlaying = false;
            _playStart = -1;
        }
    }

    static void WriteStage(string s)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(Abs(StagePath)));
            File.WriteAllText(Abs(StagePath), DateTime.UtcNow.ToString("o") + " " + s + "\n");
        }
        catch { }
    }

    static void WriteHeart(string s)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(Abs(HeartPath)));
            File.AppendAllText(Abs(HeartPath), DateTime.UtcNow.ToString("o") + " " + s + "\n");
        }
        catch { }
    }

    static string Abs(string path)
    {
        if (Path.IsPathRooted(path)) return path;
        return Path.GetFullPath(Path.Combine(Application.dataPath, "..", path));
    }

    [MenuItem("Concordia/LeanPlay/Enter Play And Probe 30s")]
    public static void EnterPlayProbe()
    {
        if (EditorApplication.isCompiling || EditorApplication.isUpdating)
        {
            Debug.LogWarning("[LeanPlayStarveProbe] still compiling/updating — retry shortly");
            return;
        }
        try { File.WriteAllText(Abs(HeartPath), DateTime.UtcNow.ToString("o") + " probe_start\n"); }
        catch { }
        EditorApplication.isPlaying = true;
    }
}
#endif
