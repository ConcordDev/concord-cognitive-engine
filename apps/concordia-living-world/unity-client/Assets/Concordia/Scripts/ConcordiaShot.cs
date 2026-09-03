using System.Collections;
using System.IO;
using System.Text;
using UnityEngine;
#if UNITY_EDITOR
using UnityEditor;
#endif

namespace Concordia
{
    public static class ConcordiaShot
    {
        public static IEnumerator Grab()
        {
            for (int i = 0; i < 50; i++) yield return null;
            if (CharacterCreator.IsOpen) CharacterCreator.SkipNow();
            yield return new WaitForSeconds(0.35f);
            ForceGameView();
            DumpBind();

            var cam = Camera.main;
            var chase = cam ? cam.GetComponent<ChaseCamera>() : null;
            var savedPos = cam ? cam.transform.position : Vector3.zero;
            var savedRot = cam ? cam.transform.rotation : Quaternion.identity;
            var savedFov = cam ? cam.fieldOfView : 52f;
            if (chase) chase.enabled = false;

            // 1) Third-person person on the plaza floor
            PosePerson(cam);
            yield return null;
            yield return new WaitForEndOfFrame();
            Capture("/tmp/concordia-person-now.png");
            CopyShot("/tmp/concordia-person-now.png", "Assets/Concordia/Shots/person-now.png");
            CopyShot("/tmp/concordia-person-now.png", "Assets/Concordia/Shots/game-view-now.png");
            CopyShot("/tmp/concordia-person-now.png", "/tmp/concordia-play.png");

            // 2) Plaza overview — dirt court under the dome
            if (cam)
            {
                cam.transform.position = new Vector3(0f, 16f, -30f);
                cam.transform.LookAt(new Vector3(0f, 6f, 0f));
                cam.fieldOfView = 55f;
            }
            yield return null;
            yield return new WaitForEndOfFrame();
            Capture("/tmp/concordia-play-plaza.png");
            CopyShot("/tmp/concordia-play-plaza.png", "Assets/Concordia/Shots/concordia-play-plaza.png");

            // 2b) Founding Day stand — three pillars on the dirt
            if (cam)
            {
                cam.transform.position = new Vector3(-4.2f, 2.4f, -11.5f);
                cam.transform.LookAt(new Vector3(1.2f, 1.35f, 0.2f));
                cam.fieldOfView = 42f;
            }
            yield return null;
            yield return new WaitForEndOfFrame();
            Capture("/tmp/concordia-play-pillars.png");
            CopyShot("/tmp/concordia-play-pillars.png", "Assets/Concordia/Shots/concordia-play-pillars.png");

            // 3) Frontier (west)
            if (cam)
            {
                cam.transform.position = new Vector3(-38f, 8f, 0f);
                cam.transform.LookAt(new Vector3(-22f, 5f, 0f));
            }
            yield return null;
            yield return new WaitForEndOfFrame();
            Capture("/tmp/concordia-play-frontier.png");
            CopyShot("/tmp/concordia-play-frontier.png", "Assets/Concordia/Shots/concordia-play-frontier.png");

            // 4) Cyber (east)
            if (cam)
            {
                cam.transform.position = new Vector3(38f, 8f, 0f);
                cam.transform.LookAt(new Vector3(22f, 5f, 0f));
            }
            yield return null;
            yield return new WaitForEndOfFrame();
            Capture("/tmp/concordia-play-cyber.png");
            CopyShot("/tmp/concordia-play-cyber.png", "Assets/Concordia/Shots/concordia-play-cyber.png");

            if (cam)
            {
                cam.transform.SetPositionAndRotation(savedPos, savedRot);
                cam.fieldOfView = savedFov;
            }
            if (chase) chase.enabled = true;
            DumpBind();
            Debug.Log("ConcordiaShot wrote Game-view person-now + plaza/frontier/cyber");
        }

        public static IEnumerator Tour(ConcordiaGame game)
        {
            try { File.Delete("/tmp/concordia-request-tour"); } catch { }
            for (int i = 0; i < 20; i++) yield return null;
            if (CharacterCreator.IsOpen) CharacterCreator.SkipNow();
            yield return new WaitForSeconds(0.4f);
            ForceGameView();
            var dump = new StringBuilder();
            dump.AppendLine(System.DateTime.Now.ToString("o"));
            foreach (WorldId id in System.Enum.GetValues(typeof(WorldId)))
            {
                if (!game) yield break;
                game.Travel(id);
                yield return new WaitForSeconds(0.85f);
                var cities = CityAtlas.For(id);
                dump.AppendLine(id + " " + Canon.Get(id).title + " cities=" + cities.Length);
                foreach (var c in cities)
                    dump.AppendLine("  " + c.name + " @ " + c.x.ToString("0.0") + "," + c.z.ToString("0.0"));
                var cam = Camera.main;
                var chase = cam ? cam.GetComponent<ChaseCamera>() : null;
                if (chase) chase.enabled = false;
                if (cam)
                {
                    cam.transform.position = new Vector3(0f, 28f, -42f);
                    cam.transform.LookAt(new Vector3(0f, 2f, 8f));
                    cam.fieldOfView = 58f;
                }
                yield return new WaitForEndOfFrame();
                Capture("/tmp/concordia-world-" + id + ".png");
                if (cities.Length > 0)
                {
                    game.EnterCity(cities[0]);
                    yield return new WaitForSeconds(0.35f);
                    if (cam)
                    {
                        var p = new Vector3(cities[0].x, 0f, cities[0].z);
                        cam.transform.position = p + new Vector3(8f, 14f, -16f);
                        cam.transform.LookAt(p + Vector3.up * 2f);
                    }
                    yield return new WaitForEndOfFrame();
                    Capture("/tmp/concordia-city-" + id + ".png");
                }
                if (chase) chase.enabled = true;
            }
            if (game) game.Travel(WorldId.Hub);
            try { File.WriteAllText("/tmp/concordia-atlas.txt", dump.ToString() + "\n" + CityAtlas.Dump()); }
            catch { }
            Debug.Log("ConcordiaShot tour wrote every world + /tmp/concordia-atlas.txt");
        }

        static void PosePerson(Camera cam)
        {
            if (!cam) return;
            cam.nearClipPlane = 0.18f;
            cam.farClipPlane = 220f;
            cam.fieldOfView = 48f;
            var player = GameObject.Find("Player");
            if (!player)
            {
                cam.transform.position = new Vector3(1.7f, 2.6f, -16.2f);
                cam.transform.LookAt(new Vector3(0f, 1.4f, -11f));
                return;
            }
            var feet = player.transform.position;
            if (feet.y < 0f || feet.y > 4f) feet.y = 0.1f;
            var focus = feet + Vector3.up * 1.25f;
            cam.transform.position = focus + new Vector3(1.8f, 1.2f, -5.4f);
            cam.transform.LookAt(focus);
        }

        static void Capture(string path)
        {
            try
            {
                var tex = ScreenCapture.CaptureScreenshotAsTexture();
                if (tex != null && tex.width > 64 && tex.height > 64)
                {
                    File.WriteAllBytes(path, tex.EncodeToPNG());
                    Debug.Log("ConcordiaShot capture " + tex.width + "x" + tex.height + " " + path);
                    Object.Destroy(tex);
                    return;
                }
                if (tex) Object.Destroy(tex);
            }
            catch (System.Exception e) { Debug.LogWarning("ConcordiaShot screenshot: " + e.Message); }

            var cam = Camera.main;
            if (!cam) return;
            int w = 1280, h = 720;
            var rt = RenderTexture.GetTemporary(w, h, 24, RenderTextureFormat.ARGB32);
            var prev = cam.targetTexture;
            cam.targetTexture = rt;
            cam.Render();
            var prevA = RenderTexture.active;
            RenderTexture.active = rt;
            var tex2 = new Texture2D(w, h, TextureFormat.RGB24, false);
            tex2.ReadPixels(new Rect(0, 0, w, h), 0, 0);
            tex2.Apply();
            cam.targetTexture = prev;
            RenderTexture.active = prevA;
            RenderTexture.ReleaseTemporary(rt);
            File.WriteAllBytes(path, tex2.EncodeToPNG());
            Object.Destroy(tex2);
        }

        static void ForceGameView()
        {
#if UNITY_EDITOR
            try
            {
                var t = typeof(EditorWindow).Assembly.GetType("UnityEditor.GameView");
                if (t == null) return;
                var win = EditorWindow.GetWindow(t, false, "Game", true);
                win.minSize = new Vector2(1280, 720);
                var r = win.position;
                if (r.width < 800 || r.height < 450)
                    win.position = new Rect(48, 48, 1280, 800);
                win.Show();
                win.Focus();
            }
            catch { }
#endif
        }

        static void DumpBind()
        {
            try
            {
                var sb = new StringBuilder();
                sb.AppendLine(System.DateTime.Now.ToString("o"));
                sb.AppendLine("screen=" + Screen.width + "x" + Screen.height);
                var cam = Camera.main;
                sb.AppendLine(cam
                    ? ("cam pos=" + cam.transform.position + " fov=" + cam.fieldOfView + " near=" + cam.nearClipPlane)
                    : "cam=none");
                var player = GameObject.Find("Player");
                sb.AppendLine(player ? ("player pos=" + player.transform.position) : "player=none");
                if (player)
                {
                    var kenney = false;
                    foreach (var t in player.GetComponentsInChildren<Transform>(true))
                    {
                        if (t.name == "KenneyPerson") kenney = true;
                        if (t.name == "KenneyPerson" || t.name == "Person" || t.name == "Hips" || t.name == "Skull" || t.name == "Tunic")
                            sb.AppendLine("  xf " + t.name + " pos=" + t.position + " lossy=" + t.lossyScale);
                    }
                    sb.AppendLine("kenneyChild=" + kenney);
                    int n = 0;
                    float maxDim = 0f;
                    string biggest = "none";
                    foreach (var r in player.GetComponentsInChildren<Renderer>(true))
                    {
                        var s = r.bounds.size;
                        float d = Mathf.Max(s.x, Mathf.Max(s.y, s.z));
                        if (d > maxDim) { maxDim = d; biggest = r.name + " " + d.ToString("0.00"); }
                        if (n++ > 40) continue;
                        sb.AppendLine("  rend " + r.name + " " + r.GetType().Name + " en=" + r.enabled + " bounds=" + r.bounds);
                    }
                    sb.AppendLine("maxRenderer=" + biggest);

                }
                sb.AppendLine("creatorOpen=" + CharacterCreator.IsOpen);
                File.WriteAllText("/tmp/concordia-person-bind.txt", sb.ToString());
            }
            catch { }
        }

        static void CopyShot(string src, string dest)
        {
            try
            {
                var dir = Path.GetDirectoryName(dest);
                if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                if (File.Exists(src)) File.Copy(src, dest, true);
            }
            catch { }
        }
    }
}
