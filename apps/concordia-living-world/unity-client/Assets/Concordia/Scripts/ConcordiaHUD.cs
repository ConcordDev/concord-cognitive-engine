using UnityEngine;
#if UNITY_EDITOR
using UnityEditor;
#endif

namespace Concordia
{
    /// <summary>
    /// Diegetic HUD. Inter, letterbox, thin bars. Arrival title is a film card.
    /// </summary>
    public class ConcordiaHUD : MonoBehaviour
    {
        public ConcordiaPlayer player;
        GUIStyle _title, _small, _center, _prompt, _card, _cardSub;
        Texture2D _white;
        static float _announceT;
        static string _announceTitle, _announceLine;
        Font _font;

        public static void Announce(string title, string line)
        {
            _announceT = 4.6f;
            _announceTitle = title;
            _announceLine = line;
        }

        void Ensure()
        {
            if (_title != null) return;
            _white = Texture2D.whiteTexture;
#if UNITY_EDITOR
            _font = AssetDatabase.LoadAssetAtPath<Font>("Assets/SourceFiles/Fonts/Inter-Variable.ttf");
#endif
            if (!_font) _font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");

            _title = Sty(18, FontStyle.Bold, TextAnchor.UpperLeft, new Color(1f, 0.93f, 0.78f));
            _small = Sty(12, FontStyle.Normal, TextAnchor.UpperLeft, new Color(0.86f, 0.78f, 0.62f, 0.92f));
            _center = Sty(13, FontStyle.Bold, TextAnchor.MiddleCenter, new Color(0.95f, 0.88f, 0.7f));
            _prompt = Sty(16, FontStyle.Bold, TextAnchor.MiddleCenter, new Color(1f, 0.96f, 0.86f));
            _card = Sty(42, FontStyle.Bold, TextAnchor.MiddleCenter, Color.white);
            _cardSub = Sty(16, FontStyle.Normal, TextAnchor.MiddleCenter, new Color(0.92f, 0.82f, 0.62f));
        }

        GUIStyle Sty(int size, FontStyle fs, TextAnchor a, Color c)
        {
            var s = new GUIStyle(GUI.skin.label) { fontSize = size, fontStyle = fs, alignment = a, wordWrap = true };
            if (_font) s.font = _font;
            s.normal.textColor = c;
            s.richText = true;
            return s;
        }

        void Update()
        {
            if (_announceT > 0f) _announceT -= Time.unscaledDeltaTime;
        }

        void OnGUI()
        {
            if (!player || CharacterCreator.IsOpen) return;
            Ensure();
            float w = Screen.width, h = Screen.height;
            Letterbox(w, h);
            Compass(w);
            Vitals();
            Prompt(w, h);
            Toast(w);
            Arrival(w, h);
            Hints(w, h);
        }

        void Letterbox(float w, float h)
        {
            GUI.color = new Color(0f, 0f, 0f, 0.72f);
            GUI.DrawTexture(new Rect(0, 0, w, 22), _white);
            GUI.DrawTexture(new Rect(0, h - 28, w, 28), _white);
            GUI.color = Color.white;
        }

        void Hints(float w, float h)
        {
            GUI.color = new Color(0.92f, 0.84f, 0.66f, 0.88f);
            GUI.Label(new Rect(18, h - 26, w - 36, 22),
                "WASD  walk   ·   Shift  run   ·   Space  jump   ·   LMB  slash   ·   F  heavy   ·   G  special   ·   E  talk   ·   V  camera   ·   Esc  mouse",
                _small);
            GUI.color = Color.white;
        }

        void Vitals()
        {
            var world = Canon.Get(player.world);
            var live = Canon.SteelLive(player.world, player.transform.position);
            GUI.color = new Color(0f, 0f, 0f, 0.45f);
            GUI.DrawTexture(new Rect(22, 36, 268, 118), _white);
            GUI.color = Color.white;
            GUI.Label(new Rect(32, 40, 250, 22), world.title.ToUpperInvariant(), _title);
            GUI.Label(new Rect(32, 62, 250, 16), live ? "LIVE STEEL" : "FLOWER-LAW", _small);
            DrawBar(32, 84, 196, 7, player.hp / 100f, new Color(0.78f, 0.18f, 0.16f));
            DrawBar(32, 94, 196, 5, player.stamina / 100f, new Color(0.86f, 0.64f, 0.22f));
            DrawBar(32, 102, 196, 4, player.poise / 16f, new Color(0.42f, 0.72f, 0.82f));
            GUI.Label(new Rect(32, 112, 250, 16), ConcordClient.StatusJson, _small);
            GUI.Label(new Rect(32, 128, 520, 18), HubObjectives.Line(), _small);
        }

        void Compass(float w)
        {
            if (!player.cam) return;
            float cx = w * 0.5f;
            float heading = player.cam.yaw;
            GUI.color = new Color(0f, 0f, 0f, 0.35f);
            GUI.DrawTexture(new Rect(cx - 160, 24, 320, 18), _white);
            GUI.color = Color.white;
            void Tick(string s, float worldYaw)
            {
                float d = Mathf.DeltaAngle(heading * Mathf.Rad2Deg, worldYaw * Mathf.Rad2Deg);
                float x = cx + d / 90f * 70f;
                if (Mathf.Abs(d) < 80f)
                    GUI.Label(new Rect(x - 10, 22, 20, 18), s, _center);
            }
            Tick("N", Mathf.PI);
            Tick("E", -Mathf.PI / 2f);
            Tick("S", 0f);
            Tick("W", Mathf.PI / 2f);

            var fwd = player.cam.PlanarForward;
            float best = 0.78f;
            string name = null;
            foreach (var g in Canon.Gates)
            {
                var gatePos = new Vector3(Mathf.Cos(g.angle), 0f, Mathf.Sin(g.angle)) * Canon.RingRadius;
                var toGate = gatePos - player.transform.position;
                toGate.y = 0f;
                if (toGate.sqrMagnitude < 4f) continue;
                float dot = Vector3.Dot(fwd.normalized, toGate.normalized);
                if (dot > best) { best = dot; name = g.shortName; }
            }
            if (!string.IsNullOrEmpty(name) && player.world == WorldId.Hub)
                GUI.Label(new Rect(cx - 80, 42, 160, 18), name, _center);
        }

        void Prompt(float w, float h)
        {
            if (string.IsNullOrEmpty(player.prompt)) return;
            GUI.color = new Color(0f, 0f, 0f, 0.5f);
            GUI.DrawTexture(new Rect(w * 0.5f - 240, h - 92, 480, 36), _white);
            GUI.color = Color.white;
            GUI.Label(new Rect(w * 0.5f - 230, h - 90, 460, 32), player.prompt, _prompt);
        }

        void Toast(float w)
        {
            if (string.IsNullOrEmpty(player.toast)) return;
            GUI.color = new Color(0.05f, 0.03f, 0.02f, 0.72f);
            GUI.DrawTexture(new Rect(w * 0.5f - 280, 118, 560, 48), _white);
            GUI.color = Color.white;
            GUI.Label(new Rect(w * 0.5f - 270, 122, 540, 40), player.toast, _center);
        }

        void Arrival(float w, float h)
        {
            if (_announceT <= 0f || string.IsNullOrEmpty(_announceTitle)) return;
            float t = _announceT / 4.6f;
            float a = t > 0.75f ? (1f - t) / 0.25f : t < 0.25f ? t / 0.25f : 1f;
            GUI.color = new Color(0f, 0f, 0f, 0.55f * a);
            GUI.DrawTexture(new Rect(0, h * 0.38f, w, h * 0.24f), _white);
            GUI.color = new Color(1f, 1f, 1f, a);
            GUI.Label(new Rect(40, h * 0.40f, w - 80, 54), _announceTitle, _card);
            GUI.color = new Color(0.92f, 0.82f, 0.62f, a);
            GUI.Label(new Rect(80, h * 0.50f, w - 160, 40), _announceLine, _cardSub);
            GUI.color = Color.white;
        }

        static void DrawBar(float x, float y, float w, float h, float t, Color c)
        {
            t = Mathf.Clamp01(t);
            GUI.color = new Color(0.08f, 0.06f, 0.04f, 0.95f);
            GUI.DrawTexture(new Rect(x, y, w, h), Texture2D.whiteTexture);
            GUI.color = c;
            GUI.DrawTexture(new Rect(x, y, w * t, h), Texture2D.whiteTexture);
            GUI.color = Color.white;
        }
    }
}
