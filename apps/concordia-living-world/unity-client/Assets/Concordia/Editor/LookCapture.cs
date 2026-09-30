using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Concordia.Editor
{
    /// <summary>
    /// Unattended look capture for comparing render settings (e.g. Gamma vs
    /// Linear). Launch the editor (not -batchmode: play mode and the GPU are
    /// needed) with:
    ///   -executeMethod Concordia.Editor.LookCapture.Run -lookLabel before [-lookWait 45]
    /// It opens ConcordiaHub, enters play mode, waits for the code-built world,
    /// renders the main camera plus a raised overview angle to PNGs in
    /// ~/concord/look-shots/&lt;label&gt;/, writes settings.txt, and quits.
    /// </summary>
    [InitializeOnLoad]
    public static class LookCapture
    {
        const string PendingKey = "Concordia.LookCapture.Pending";
        const string LabelKey = "Concordia.LookCapture.Label";
        const string WaitKey = "Concordia.LookCapture.Wait";
        const string PoseKey = "Concordia.LookCapture.Pose"; // "px,py,pz,qx,qy,qz,qw" — fixes the camera across runs
        static double _playStarted = -1;
        static double _hourPinnedAt = -1;
        const float PinnedHour = 13f;

        static LookCapture()
        {
            EditorApplication.playModeStateChanged += OnPlayMode;
            EditorApplication.update += OnUpdate;
        }

        public static void Run()
        {
            var args = System.Environment.GetCommandLineArgs();
            string label = "capture";
            float wait = 45f;
            for (int i = 0; i < args.Length - 1; i++)
            {
                if (args[i] == "-lookLabel") label = args[i + 1];
                if (args[i] == "-lookWait") float.TryParse(args[i + 1], out wait);
                if (args[i] == "-lookPose") SessionState.SetString(PoseKey, args[i + 1]);
            }
            SessionState.SetBool(PendingKey, true);
            SessionState.SetString(LabelKey, label);
            SessionState.SetFloat(WaitKey, wait);
            EditorSceneManager.OpenScene("Assets/Scenes/ConcordiaHub.unity");
            EditorApplication.EnterPlaymode();
        }

        static void OnPlayMode(PlayModeStateChange s)
        {
            if (!SessionState.GetBool(PendingKey, false)) return;
            if (s == PlayModeStateChange.EnteredPlayMode) _playStarted = EditorApplication.timeSinceStartup;
        }

        static void OnUpdate()
        {
            if (!SessionState.GetBool(PendingKey, false) || !EditorApplication.isPlaying) return;
            if (_playStarted < 0) _playStarted = EditorApplication.timeSinceStartup;
            double elapsed = EditorApplication.timeSinceStartup - _playStarted;
            float wait = SessionState.GetFloat(WaitKey, 45f);
            if (elapsed < wait) return;
            // A fixed wait isn't enough: after a script recompile or asset reimport
            // the world (player, Court, its people) can still be building at 45 s,
            // which once looked like "Linear color space removes the Court". Wait
            // until the player and the Court's people exist, up to 180 s more.
            if (!WorldReady() && elapsed < wait + 180f) return;
            // Pin the time of day so runs are comparable (the clock comes
            // from the server and moves between runs), then let lighting settle.
            if (_hourPinnedAt < 0)
            {
                WorldClock.Hour = PinnedHour;
                HubLook.ApplyHour(WorldClock.World, PinnedHour);
                _hourPinnedAt = EditorApplication.timeSinceStartup;
                return;
            }
            if (EditorApplication.timeSinceStartup - _hourPinnedAt < 3.0) return;
            WorldClock.Hour = PinnedHour;
            HubLook.ApplyHour(WorldClock.World, PinnedHour);
            SessionState.SetBool(PendingKey, false);

            var dir = Path.Combine(System.Environment.GetEnvironmentVariable("HOME") ?? ".", "concord", "look-shots", SessionState.GetString(LabelKey, "capture"));
            Directory.CreateDirectory(dir);
            var cam = Camera.main;
            int shots = 0;
            string poseUsed = "";
            if (cam)
            {
                var pose = SessionState.GetString(PoseKey, "").Split(',');
                if (pose.Length == 7)
                {
                    var f = System.Array.ConvertAll(pose, x => float.Parse(x, System.Globalization.CultureInfo.InvariantCulture));
                    cam.transform.SetPositionAndRotation(new Vector3(f[0], f[1], f[2]), new Quaternion(f[3], f[4], f[5], f[6]));
                    poseUsed = "fixed";
                }
                var p0 = cam.transform.position; var q0 = cam.transform.rotation;
                poseUsed += " pose=" + string.Join(",", new[] { p0.x, p0.y, p0.z, q0.x, q0.y, q0.z, q0.w }
                    .Select(v => v.ToString("R", System.Globalization.CultureInfo.InvariantCulture)));
                shots += Render(cam, Path.Combine(dir, "player-view.png"));
                var t = cam.transform;
                Vector3 pos = t.position; Quaternion rot = t.rotation;
                t.position = pos + Vector3.up * 28f - t.forward * 30f;
                t.rotation = Quaternion.LookRotation((pos + t.forward * 20f) - t.position, Vector3.up);
                shots += Render(cam, Path.Combine(dir, "overview.png"));
                t.position = pos; t.rotation = rot;
            }
            File.WriteAllText(Path.Combine(dir, "settings.txt"),
                $"colorSpace={PlayerSettings.colorSpace}\nhour={WorldClock.Hour}\nworldReady={WorldReady()}\nwaitedSeconds={EditorApplication.timeSinceStartup - _playStarted:F0}\nshots={shots}\ncamera-pose={poseUsed}\ncamera={(cam ? cam.name : "none")}\ntime={System.DateTime.Now:O}\n");
            try { File.WriteAllText(Path.Combine(dir, "scene-dump.txt"), DumpScene(cam)); }
            catch (System.Exception e) { File.WriteAllText(Path.Combine(dir, "scene-dump.txt"), "dump failed: " + e); }
            Debug.Log($"[LookCapture] {shots} shots -> {dir}");
            EditorApplication.ExitPlaymode();
            EditorApplication.delayCall += () => EditorApplication.Exit(0);
        }

        /// Runtime facts for diagnosing the look: renderers near the camera with
        /// their shader (missing shaders render magenta), texture tiling, the
        /// object under the camera, fog and volume state.
        static string DumpScene(Camera cam)
        {
            var sb = new System.Text.StringBuilder();
            sb.AppendLine($"fog={RenderSettings.fog} mode={RenderSettings.fogMode} density={RenderSettings.fogDensity} start={RenderSettings.fogStartDistance} end={RenderSettings.fogEndDistance} color={RenderSettings.fogColor}");
            sb.AppendLine($"ambientMode={RenderSettings.ambientMode} ambientIntensity={RenderSettings.ambientIntensity} sky={RenderSettings.ambientSkyColor}");
            foreach (var v in Object.FindObjectsByType<UnityEngine.Rendering.Volume>(FindObjectsSortMode.None))
            {
                sb.Append($"volume {v.name} global={v.isGlobal} weight={v.weight} profile={(v.sharedProfile ? v.sharedProfile.name : "none")}:");
                if (v.sharedProfile) foreach (var c in v.sharedProfile.components) sb.Append(" " + c.GetType().Name + (c.active ? "" : "(off)"));
                sb.AppendLine();
            }
            if (!cam) return sb.ToString();
            var cp = cam.transform.position;
            if (Physics.Raycast(cp, Vector3.down, out var hit, 200f))
                sb.AppendLine($"under-camera: {HierPath(hit.collider.transform)} y={hit.point.y:F2}");
            var rows = new System.Collections.Generic.List<(float d, string line)>();
            foreach (var r in Object.FindObjectsByType<Renderer>(FindObjectsSortMode.None))
            {
                if (!r.enabled || !r.gameObject.activeInHierarchy) continue;
                float d = Vector3.Distance(cp, r.bounds.ClosestPoint(cp));
                if (d > 40f) continue;
                var mats = r.sharedMaterials;
                var parts = new System.Collections.Generic.List<string>();
                foreach (var m in mats)
                {
                    if (!m) { parts.Add("<null material>"); continue; }
                    var sh = m.shader;
                    string shn = sh ? sh.name : "<no shader>";
                    bool broken = !sh || !sh.isSupported || shn.Contains("InternalErrorShader");
                    string tex = "";
                    if (m.HasProperty("_BaseMap") && m.GetTexture("_BaseMap")) tex = $" base={m.GetTexture("_BaseMap").name} tile={m.GetTextureScale("_BaseMap")}";
                    else if (m.HasProperty("_MainTex") && m.GetTexture("_MainTex")) tex = $" main={m.GetTexture("_MainTex").name} tile={m.GetTextureScale("_MainTex")}";
                    parts.Add($"{m.name}[{shn}{(broken ? " BROKEN" : "")}]{tex}");
                }
                var mf = r.GetComponent<MeshFilter>();
                string mesh = mf && mf.sharedMesh ? $"{mf.sharedMesh.name}({mf.sharedMesh.vertexCount}v)" : (r is SkinnedMeshRenderer smr && smr.sharedMesh ? $"{smr.sharedMesh.name}(skinned)" : "-");
                rows.Add((d, $"{d,6:F1}m  {HierPath(r.transform)}  mesh={mesh} size={r.bounds.size}  {string.Join(" | ", parts)}"));
            }
            rows.Sort((a, b) => a.d.CompareTo(b.d));
            sb.AppendLine($"renderers within 40m: {rows.Count}");
            foreach (var row in rows.Take(160)) sb.AppendLine(row.line);
            return sb.ToString();
        }

        static bool WorldReady()
        {
            // The hero's body attaches only after the Hub finishes staging
            // ("defer ModularPerson.AttachHero until Hub staged"), so require the
            // player's own body, not just the Player shell, plus the Court's people.
            var player = GameObject.Find("Player");
            if (!player || !player.GetComponentInChildren<SkinnedMeshRenderer>()) return false;
            int people = 0;
            foreach (var t in Object.FindObjectsByType<Transform>(FindObjectsSortMode.None))
                if (t.name == "AuthoredPerson" && ++people >= 8) return true;
            return false;
        }

        static string HierPath(Transform t)
        {
            var s = t.name;
            for (var p = t.parent; p != null; p = p.parent) s = p.name + "/" + s;
            return s;
        }

        static int Render(Camera cam, string path)
        {
            const int w = 1600, h = 900;
            var rt = new RenderTexture(w, h, 24, RenderTextureFormat.ARGB32) { antiAliasing = 4 };
            var prev = cam.targetTexture;
            cam.targetTexture = rt;
            cam.Render();
            var old = RenderTexture.active;
            RenderTexture.active = rt;
            var tex = new Texture2D(w, h, TextureFormat.RGB24, false);
            tex.ReadPixels(new Rect(0, 0, w, h), 0, 0);
            tex.Apply();
            File.WriteAllBytes(path, tex.EncodeToPNG());
            RenderTexture.active = old;
            cam.targetTexture = prev;
            Object.DestroyImmediate(tex);
            rt.Release();
            return 1;
        }
    }
}
