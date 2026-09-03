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
        Texture2D _white, _ring;
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
            _ring = Disc(64);
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
            Compass(w);
            Vitals();
            Rings(w);
            Minimap(h);
            Prompt(w, h);
            Toast(w);
            Arrival(w, h);
            Hints(w, h);
        }

        void Hints(float w, float h)
        {
            GUI.color = new Color(0.92f, 0.84f, 0.66f, 0.88f);
            GUI.Label(new Rect(18, h - 22, w - 36, 20),
                "WASD  walk   ·   Shift  run   ·   Space  jump   ·   LMB  " + Canon.Get(player.world).style.light
                + "   ·   F  " + Canon.Get(player.world).style.heavy
                + "   ·   G  " + Canon.Get(player.world).style.special
                + "   ·   Q  kit   ·   E  talk   ·   V  camera",
                _small);
            GUI.color = Color.white;
        }

        void Vitals()
        {
            var world = Canon.Get(player.world);
            var live = Canon.SteelLive(player.world, player.transform.position);
            GUI.color = new Color(0f, 0f, 0f, 0.45f);
            var city = CityAtlas.Nearest(player.world, player.transform.position, 18f);
            GUI.DrawTexture(new Rect(22, 28, 300, 148), _white);
            GUI.color = Color.white;
            GUI.Label(new Rect(32, 32, 280, 22), world.title.ToUpperInvariant(), _title);
            GUI.Label(new Rect(32, 54, 280, 16),
                (live ? "LIVE STEEL" : "FLOWER-LAW") + (city == null ? "" : "  ·  " + city.name)
                + (string.IsNullOrEmpty(player.kitWeapon) ? "" : "  ·  " + player.kitWeapon), _small);
            GUI.Label(new Rect(32, 70, 520, 16), WorldClock.HudClock() + "  ·  " + KingdomBook.HudLine(), _small);
            GUI.Label(new Rect(32, 86, 520, 16),
                !string.IsNullOrEmpty(WorldClock.NearbyAct) ? WorldClock.NearbyAct
                : !string.IsNullOrEmpty(WorldClock.LastEvent) ? WorldClock.LastEvent
                : ConcordClient.StatusJson, _small);
            GUI.Label(new Rect(32, 102, 520, 16), HubObjectives.Line(), _small);
            GUI.Label(new Rect(32, 118, 520, 16), QuestLog.HudBlock(), _small);
            GUI.Label(new Rect(32, 134, 520, 16), SkillLedger.Line(), _small);
        }

        void Rings(float w)
        {
            float cx = w - 78f;
            float cy = 78f;
            DrawRing(cx, cy, 62, player.hp / 100f, new Color(0.78f, 0.18f, 0.16f));
            DrawRing(cx, cy, 48, player.stamina / 100f, new Color(0.86f, 0.64f, 0.22f));
            DrawRing(cx, cy, 34, player.poise / 16f, new Color(0.42f, 0.72f, 0.82f));
        }

        void DrawRing(float cx, float cy, float size, float t, Color c)
        {
            t = Mathf.Clamp01(t);
            var r = new Rect(cx - size * 0.5f, cy - size * 0.5f, size, size);
            GUI.color = new Color(0.06f, 0.04f, 0.03f, 0.55f);
            if (_ring) GUI.DrawTexture(r, _ring);
            GUI.color = new Color(c.r, c.g, c.b, 0.18f + 0.72f * t);
            if (_ring) GUI.DrawTexture(new Rect(cx - size * 0.5f * t, cy - size * 0.5f * t, size * t, size * t), _ring);
            GUI.color = Color.white;
        }

        void Minimap(float h)
        {
            const float s = 118f;
            float x = 22f;
            float y = h - s - 28f;
            GUI.color = new Color(0.04f, 0.05f, 0.04f, 0.62f);
            if (_ring) GUI.DrawTexture(new Rect(x, y, s, s), _ring);
            GUI.color = Color.white;
            var origin = player.transform.position;
            float scale = 0.42f;
            void Dot(Vector3 world, Color c, float px)
            {
                var d = world - origin;
                d.y = 0f;
                float mx = x + s * 0.5f + d.x * scale;
                float my = y + s * 0.5f - d.z * scale;
                if (mx < x + 6 || mx > x + s - 6 || my < y + 6 || my > y + s - 6) return;
                GUI.color = c;
                GUI.DrawTexture(new Rect(mx - px * 0.5f, my - px * 0.5f, px, px), _white);
                GUI.color = Color.white;
            }
            GUI.color = new Color(0.95f, 0.9f, 0.7f, 0.95f);
            GUI.DrawTexture(new Rect(x + s * 0.5f - 3, y + s * 0.5f - 3, 6, 6), _white);
            GUI.color = Color.white;
            foreach (var c in CityAtlas.For(player.world))
                Dot(new Vector3(c.x, 0f, c.z), new Color(0.85f, 0.7f, 0.35f), 5f);
            foreach (var g in FindObjectsByType<DungeonGate>(FindObjectsInactive.Exclude))
                if (g) Dot(g.transform.position, new Color(0.55f, 0.35f, 0.2f), 5f);
            foreach (var n in FindObjectsByType<GuestNpc>(FindObjectsInactive.Exclude))
                if (n) Dot(n.transform.position, new Color(0.75f, 0.82f, 0.55f), 3f);
            foreach (var host in FindObjectsByType<Hostile>(FindObjectsInactive.Exclude))
                if (host) Dot(host.transform.position, new Color(0.82f, 0.18f, 0.14f), 4f);
            if (player.world == WorldId.Hub)
                foreach (var g in Canon.Gates)
                    Dot(new Vector3(Mathf.Cos(g.angle), 0f, Mathf.Sin(g.angle)) * Canon.RingRadius, g.color, 4f);
        }

        static Texture2D Disc(int n)
        {
            var tex = new Texture2D(n, n, TextureFormat.RGBA32, false);
            tex.wrapMode = TextureWrapMode.Clamp;
            tex.filterMode = FilterMode.Bilinear;
            float mid = (n - 1) * 0.5f;
            for (int y = 0; y < n; y++)
            for (int x = 0; x < n; x++)
            {
                float d = Mathf.Sqrt((x - mid) * (x - mid) + (y - mid) * (y - mid)) / mid;
                float a = d < 0.92f ? 1f : d < 1f ? 1f - (d - 0.92f) / 0.08f : 0f;
                tex.SetPixel(x, y, new Color(1f, 1f, 1f, a));
            }
            tex.Apply();
            return tex;
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
            if (player.world != WorldId.Hub)
            {
                float cityBest = 0.72f;
                string cityName = null;
                foreach (var c in CityAtlas.For(player.world))
                {
                    var to = new Vector3(c.x, 0f, c.z) - player.transform.position;
                    to.y = 0f;
                    if (to.sqrMagnitude < 16f) continue;
                    float dot = Vector3.Dot(fwd.normalized, to.normalized);
                    if (dot > cityBest) { cityBest = dot; cityName = c.name; }
                }
                if (!string.IsNullOrEmpty(cityName))
                    GUI.Label(new Rect(cx - 120, 42, 240, 18), cityName, _center);
            }
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
