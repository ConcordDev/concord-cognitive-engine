using System.Collections.Generic;
using UnityEngine;
using Concordia.ConKay;
using Concordia.GameplayCore;
#if UNITY_EDITOR
using UnityEditor;
#endif

namespace Concordia
{
    /// <summary>
    /// Concordia's diegetic HUD and ConKay system projection surface.
    /// Gameplay state remains authoritative outside this class; this component only renders it.
    /// </summary>
    public sealed class ConcordiaHUD : MonoBehaviour
    {
        public enum HudMode { Explore, Combat, Social, Scheme }

        public ConcordiaPlayer player;
        public static bool DebugHud;
        public static WorldGate Bearing;

        GUIStyle _title, _small, _center, _prompt, _card, _cardSub, _btn, _log;
        GUIStyle _systemTitle, _systemSmall, _systemFact, _systemMuted;
        Texture2D _white, _ring, _hudSkin;
        Font _font;
        HudMode _mode = HudMode.Explore;
        bool _systemOpen;
        float _hurtT;
        float _lastHp = -1f;
        float _announceT;
        float _announceDuration;
        string _announceTitle;
        string _announceLine;
        string _lastFeed;
        string _seenToast;
        readonly Queue<Card> _cards = new Queue<Card>();
        bool _liveFilm;

        struct Card
        {
            public string title;
            public string line;
            public float duration;
            public bool film;
        }

        public static void Announce(string title, string line)
        {
            var huds = FindObjectsByType<ConcordiaHUD>(FindObjectsInactive.Exclude, FindObjectsSortMode.None);
            for (var i = 0; i < huds.Length; i++)
                huds[i].Enqueue(title, line, 4.6f, true);
        }

        void Enqueue(string title, string line, float duration, bool film)
        {
            if (string.IsNullOrEmpty(title) && string.IsNullOrEmpty(line)) return;
            while (_cards.Count >= 5) _cards.Dequeue();
            _cards.Enqueue(new Card { title = title ?? string.Empty, line = line ?? string.Empty, duration = duration, film = film });
        }

        void Awake()
        {
            if (!player) player = GetComponentInParent<ConcordiaPlayer>();
        }

        void Update()
        {
            if (!player) return;
            if (Input.GetKeyDown(KeyCode.F8)) DebugHud = !DebugHud;
            if (Input.GetKeyDown(KeyCode.Tab)) _systemOpen = !_systemOpen;
            if (_lastHp < 0f) _lastHp = player.hp;
            if (player.hp < _lastHp - 0.5f) _hurtT = 2.8f;
            _lastHp = player.hp;
            _hurtT = Mathf.Max(0f, _hurtT - Time.unscaledDeltaTime);
            TickCards();
            DrainFeed();
            DrainToast();
            UpdateBearing();
        }

        void TickCards()
        {
            if (_announceT > 0f)
            {
                _announceT -= Time.unscaledDeltaTime;
                return;
            }
            _announceTitle = null;
            _announceLine = null;
            _liveFilm = false;
            if (_cards.Count == 0) return;
            var card = _cards.Dequeue();
            _announceTitle = card.title;
            _announceLine = card.line;
            _liveFilm = card.film;
            _announceDuration = Mathf.Max(0.2f, card.duration);
            _announceT = _announceDuration;
        }

        void DrainFeed()
        {
            if (WorldClock.FeedCount <= 0) return;
            var beat = WorldClock.FeedAt(0);
            if (string.IsNullOrEmpty(beat.line) || beat.line == _lastFeed) return;
            _lastFeed = beat.line;
            Enqueue(beat.channel, beat.line, 3.2f, false);
        }

        void DrainToast()
        {
            if (string.IsNullOrEmpty(player.toast))
            {
                _seenToast = null;
                return;
            }
            if (player.toast == _seenToast) return;
            _seenToast = player.toast;
            Enqueue(string.Empty, player.toast, 2.6f, false);
        }

        WorldGate[] _gateCache;
        float _gateCacheAt;

        void UpdateBearing()
        {
            Bearing = null;
            if (!player.cam || player.world != WorldId.Hub) return;
            // Force Full melted ~48–52s: FindObjectsByType<WorldGate> every frame + GC.
            if (_gateCache == null || Time.unscaledTime - _gateCacheAt > 2f)
            {
                _gateCache = FindObjectsByType<WorldGate>(FindObjectsInactive.Exclude, FindObjectsSortMode.None);
                _gateCacheAt = Time.unscaledTime;
            }
            var forward = player.cam.PlanarForward;
            var best = 0.78f;
            var gates = _gateCache;
            if (gates == null) return;
            for (var i = 0; i < gates.Length; i++)
            {
                var gate = gates[i];
                if (!gate) continue;
                var to = gate.transform.position - player.transform.position;
                to.y = 0f;
                if (to.sqrMagnitude < 4f) continue;
                var dot = Vector3.Dot(forward.normalized, to.normalized);
                if (dot > best)
                {
                    best = dot;
                    Bearing = gate;
                }
            }
        }

        void EnsureStyles()
        {
            if (_title != null) return;
            _white = Texture2D.whiteTexture;
            _ring = Disc(64);
#if UNITY_EDITOR
            _font = AssetDatabase.LoadAssetAtPath<Font>("Assets/SourceFiles/Fonts/Inter-Variable.ttf");
#endif
            if (!_font) _font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            _hudSkin = CxDress.Hud(player && Canon.SteelLive(player.world, player.transform.position), "health");
            _title = Style(18, FontStyle.Bold, TextAnchor.UpperLeft, new Color(1f, 0.93f, 0.78f));
            _small = Style(12, FontStyle.Normal, TextAnchor.UpperLeft, new Color(0.86f, 0.78f, 0.62f, 0.92f));
            _center = Style(13, FontStyle.Bold, TextAnchor.MiddleCenter, new Color(0.95f, 0.88f, 0.7f));
            _prompt = Style(16, FontStyle.Bold, TextAnchor.MiddleCenter, new Color(1f, 0.96f, 0.86f));
            _card = Style(42, FontStyle.Bold, TextAnchor.MiddleCenter, Color.white);
            _cardSub = Style(16, FontStyle.Normal, TextAnchor.MiddleCenter, new Color(0.92f, 0.82f, 0.62f));
            _log = Style(13, FontStyle.Normal, TextAnchor.UpperLeft, new Color(0.94f, 0.88f, 0.74f));
            _btn = new GUIStyle(GUI.skin.button) { fontSize = 13, fontStyle = FontStyle.Bold, alignment = TextAnchor.MiddleCenter, wordWrap = true };
            if (_font) _btn.font = _font;
            _btn.normal.textColor = new Color(1f, 0.93f, 0.78f);
            _systemTitle = Style(20, FontStyle.Bold, TextAnchor.UpperLeft, new Color(0.86f, 0.96f, 1f));
            _systemSmall = Style(12, FontStyle.Normal, TextAnchor.UpperLeft, new Color(0.72f, 0.86f, 0.92f));
            _systemFact = Style(13, FontStyle.Normal, TextAnchor.UpperLeft, new Color(0.92f, 0.96f, 0.96f));
            _systemMuted = Style(11, FontStyle.Italic, TextAnchor.UpperLeft, new Color(0.58f, 0.72f, 0.78f));
        }

        GUIStyle Style(int size, FontStyle fontStyle, TextAnchor anchor, Color color)
        {
            var style = new GUIStyle(GUI.skin.label) { fontSize = size, fontStyle = fontStyle, alignment = anchor, wordWrap = true, richText = true };
            if (_font) style.font = _font;
            style.normal.textColor = color;
            return style;
        }

        void OnGUI()
        {
            if (!player || CharacterCreator.IsOpen) return;
            EnsureStyles();
            var width = Screen.width;
            var height = Screen.height;
            _mode = ResolveMode();
            DrawCompass(width);
            DrawVitals();
            DrawPrompt(width, height);
            if (_mode == HudMode.Combat) DrawTarget(width);
            DrawRings(width);
            DrawToast(width, height);
            DrawArrival(width, height);
            if (player.talkOpen) DrawTalk(width, height);
            if (player.menuOpen) DrawKit(width, height);
            if (player.skillOpen) DrawSkills(width, height);
            DrawHints(width, height);
            if (_systemOpen) DrawSystem(width, height);
        }

        HudMode ResolveMode()
        {
            if (player.talkOpen) return HudMode.Social;
            if (Hostile.TelegraphKind != null) return HudMode.Combat;
            return HudMode.Explore;
        }

        void DrawVitals()
        {
            var world = Canon.Get(player.world);
            var live = Canon.SteelLive(player.world, player.transform.position);
            var city = CityAtlas.Nearest(player.world, player.transform.position, 18f);
            var height = city != null ? 54f : 36f;
            GUI.color = new Color(0f, 0f, 0f, 0.42f);
            if (_hudSkin)
            {
                GUI.color = Color.white;
                GUI.DrawTexture(new Rect(18f, 22f, 276f, height + 12f), _hudSkin, ScaleMode.StretchToFill);
            }
            else GUI.DrawTexture(new Rect(22f, 28f, 268f, height), _white);
            GUI.color = Color.white;
            GUI.Label(new Rect(54f, 32f, 230f, 22f), world.title, _title);
            GUI.Label(new Rect(54f, 50f, 230f, 18f), city == null ? (live ? "LIVE STEEL" : "FLOWER-LAW") : city.name, _small);
            if (DebugHud)
            {
                GUI.Label(new Rect(32f, 78f, 250f, 18f), "HP " + player.hp.ToString("0") + "  ST " + player.stamina.ToString("0") + "  POISE " + player.poise.ToString("0"), _small);
                GUI.Label(new Rect(32f, 96f, 250f, 18f), WorldClock.HudClock(), _small);
                GUI.Label(new Rect(32f, 114f, 250f, 32f), WorldField.HudLine(player.world, player.transform.position), _small);
            }
        }

        void DrawCompass(float width)
        {
            if (!player.cam) return;
            var center = width * 0.5f;
            GUI.color = new Color(0f, 0f, 0f, 0.35f);
            GUI.DrawTexture(new Rect(center - 160f, 24f, 320f, 18f), _white);
            GUI.color = Color.white;
            LabelCompass("N", Mathf.PI, center);
            LabelCompass("E", -Mathf.PI * 0.5f, center);
            LabelCompass("S", 0f, center);
            LabelCompass("W", Mathf.PI * 0.5f, center);
        }

        void LabelCompass(string label, float yaw, float center)
        {
            var delta = Mathf.DeltaAngle(player.cam.yaw * Mathf.Rad2Deg, yaw * Mathf.Rad2Deg);
            if (Mathf.Abs(delta) < 80f) GUI.Label(new Rect(center + delta / 90f * 70f - 10f, 22f, 20f, 18f), label, _center);
        }

        void DrawPrompt(float width, float height)
        {
            var line = player.prompt;
            if (string.IsNullOrEmpty(line)) line = RoadWorld.NearLine;
            var resolution = GameplayCoreBridge.Live == null ? null : GameplayCoreBridge.Live.ResolveInteraction(player.transform.position);
            var detail = resolution != null && resolution.found
                ? (resolution.available ? "Verbs: " + resolution.VerbLine() : "Why unavailable: " + resolution.why)
                : null;
            if (string.IsNullOrEmpty(line) && string.IsNullOrEmpty(detail)) return;
            var panelHeight = string.IsNullOrEmpty(detail) ? 36f : 54f;
            GUI.color = new Color(0f, 0f, 0f, 0.5f);
            GUI.DrawTexture(new Rect(width * 0.5f - 240f, height - 92f, 480f, panelHeight), _white);
            GUI.color = Color.white;
            if (!string.IsNullOrEmpty(line)) GUI.Label(new Rect(width * 0.5f - 230f, height - 90f, 460f, 28f), line, _prompt);
            if (!string.IsNullOrEmpty(detail)) GUI.Label(new Rect(width * 0.5f - 230f, height - 64f, 460f, 20f), detail, _small);
        }

        void DrawRings(float width)
        {
            var cx = width - 78f;
            var cy = 78f;
            DrawRing(cx, cy, 62f, player.hp / 100f, new Color(0.78f, 0.18f, 0.16f));
            DrawRing(cx, cy, 48f, player.stamina / 100f, new Color(0.86f, 0.64f, 0.22f));
            DrawRing(cx, cy, 34f, player.poise / 16f, new Color(0.42f, 0.72f, 0.82f));
        }

        void DrawRing(float cx, float cy, float size, float value, Color color)
        {
            value = Mathf.Clamp01(value);
            GUI.color = new Color(0.06f, 0.04f, 0.03f, 0.55f);
            GUI.DrawTexture(new Rect(cx - size * 0.5f, cy - size * 0.5f, size, size), _ring);
            GUI.color = new Color(color.r, color.g, color.b, 0.18f + value * 0.72f);
            GUI.DrawTexture(new Rect(cx - size * value * 0.5f, cy - size * value * 0.5f, size * value, size * value), _ring);
            GUI.color = Color.white;
        }

        void DrawTarget(float width)
        {
            GUI.color = new Color(0f, 0f, 0f, 0.5f);
            GUI.DrawTexture(new Rect(width * 0.5f - 160f, 64f, 320f, 42f), _white);
            GUI.color = Color.white;
            GUI.Label(new Rect(width * 0.5f - 150f, 68f, 300f, 18f), Hostile.TelegraphKind ?? "combat", _center);
            GUI.Label(new Rect(width * 0.5f - 150f, 86f, 300f, 18f), "X dodge  ·  C guard", _small);
        }

        void DrawToast(float width, float height)
        {
            if (_announceT <= 0f || _liveFilm || string.IsNullOrEmpty(_announceLine) && string.IsNullOrEmpty(_announceTitle)) return;
            var t = _announceT / Mathf.Max(_announceDuration, 0.2f);
            var alpha = t > 0.8f ? (1f - t) / 0.2f : t < 0.2f ? t / 0.2f : 1f;
            GUI.color = new Color(0.05f, 0.03f, 0.02f, 0.72f * alpha);
            GUI.DrawTexture(new Rect(width * 0.5f - 280f, 118f, 560f, 48f), _white);
            GUI.color = new Color(1f, 1f, 1f, alpha);
            GUI.Label(new Rect(width * 0.5f - 270f, 122f, 540f, 40f), string.IsNullOrEmpty(_announceTitle) ? _announceLine : _announceTitle + "  ·  " + _announceLine, _center);
            GUI.color = Color.white;
        }

        void DrawArrival(float width, float height)
        {
            if (_announceT <= 0f || !_liveFilm || string.IsNullOrEmpty(_announceTitle)) return;
            var t = _announceT / Mathf.Max(_announceDuration, 0.2f);
            var alpha = t > 0.75f ? (1f - t) / 0.25f : t < 0.25f ? t / 0.25f : 1f;
            GUI.color = new Color(0f, 0f, 0f, 0.55f * alpha);
            GUI.DrawTexture(new Rect(0f, height * 0.38f, width, height * 0.24f), _white);
            GUI.color = new Color(1f, 1f, 1f, alpha);
            GUI.Label(new Rect(40f, height * 0.4f, width - 80f, 54f), _announceTitle, _card);
            GUI.color = new Color(0.92f, 0.82f, 0.62f, alpha);
            GUI.Label(new Rect(80f, height * 0.5f, width - 160f, 40f), _announceLine, _cardSub);
            GUI.color = Color.white;
        }

        void DrawHints(float width, float height)
        {
            if (_systemOpen || player.talkOpen || player.menuOpen || player.skillOpen) return;
            var line = _mode == HudMode.Combat ? "LMB swing  ·  X dodge  ·  C guard  ·  Tab system" : "E use  ·  I kit  ·  K skills  ·  Tab system";
            GUI.color = new Color(0.92f, 0.84f, 0.66f, 0.88f);
            GUI.Label(new Rect(18f, height - 22f, width - 36f, 20f), line, _small);
            GUI.color = Color.white;
        }

        void DrawTalk(float width, float height)
        {
            var pw = 640f;
            var ph = 308f;
            var x = (width - pw) * 0.5f;
            var y = height - ph - 36f;
            GUI.color = new Color(0.04f, 0.03f, 0.02f, 0.88f);
            GUI.DrawTexture(new Rect(x, y, pw, ph), _white);
            GUI.color = Color.white;
            var who = player.talkNpc != null && player.talkNpc.def != null ? player.talkNpc.def.name : "Someone";
            GUI.Label(new Rect(x + 16f, y + 10f, pw - 32f, 22f), who + "  ·  dialogue", _title);
            GUI.Label(new Rect(x + 16f, y + 36f, pw - 32f, 140f), player.talkLog.Count == 0 ? string.Empty : string.Join("\n", player.talkLog), _log);
            GUI.SetNextControlName("TalkDraft");
            player.talkDraft = GUI.TextField(new Rect(x + 16f, y + 186f, pw - 140f, 28f), player.talkDraft ?? string.Empty, 240);
            if (player.focusTalk)
            {
                GUI.FocusControl("TalkDraft");
                player.focusTalk = false;
            }
            if (GUI.Button(new Rect(x + pw - 116f, y + 186f, 100f, 28f), "Send", _btn)) player.SubmitTalk();
        }

        void DrawKit(float width, float height)
        {
            var pw = 860f;
            var ph = 420f;
            var x = (width - pw) * 0.5f;
            var y = (height - ph) * 0.5f;
            GUI.color = new Color(0.04f, 0.03f, 0.02f, 0.9f);
            GUI.DrawTexture(new Rect(x, y, pw, ph), _white);
            GUI.color = Color.white;
            GUI.Label(new Rect(x + 18f, y + 12f, pw - 36f, 24f), "KIT  ·  inventory  ·  weapons", _title);
            GUI.Label(new Rect(x + 18f, y + 44f, pw - 36f, 22f), KitBag.Items.Count == 0 ? "Empty hands." : "Select an item to equip.", _small);
            var yy = y + 78f;
            foreach (var item in KitBag.Items)
            {
                if (item == null || item.kind != "weapon") continue;
                var label = item.id == KitBag.Equipped ? "▸ " : "  ";
                if (GUI.Button(new Rect(x + 18f, yy, pw - 36f, 30f), label + item.name, _btn)) player.HoldFromBag(item.stem);
                yy += 34f;
                if (yy > y + ph - 52f) break;
            }
            GUI.Label(new Rect(x + 18f, y + ph - 28f, pw - 36f, 18f), QuestLog.HudBlock(), _small);
        }

        void DrawSkills(float width, float height)
        {
            var pw = Mathf.Min(820f, width - 48f);
            var ph = Mathf.Min(520f, height - 80f);
            var x = (width - pw) * 0.5f;
            var y = (height - ph) * 0.5f;
            GUI.color = new Color(0.03f, 0.02f, 0.015f, 0.92f);
            GUI.DrawTexture(new Rect(x, y, pw, ph), _white);
            GUI.color = Color.white;
            GUI.Label(new Rect(x + 18f, y + 12f, pw - 36f, 24f), SkillLattice.FromKernel ? SkillLattice.CatalogCount + " skills  ·  " + SkillLattice.TrainedCount + " trained" : "Skills  ·  unbound", _title);
            GUI.Label(new Rect(x + 18f, y + 40f, pw - 36f, 18f), SkillLattice.HudLine(), _small);
            if (!SkillLattice.FromKernel) GUI.Label(new Rect(x + 18f, y + 76f, pw - 36f, 60f), "The capability catalog is not currently bound to an authoritative row.", _small);
        }

        void DrawSystem(float width, float height)
        {
            var bridge = GameplayCoreBridge.Live;
            if (bridge == null || bridge.ConcordLink == null) return;
            var snapshot = bridge.ConcordLink.InspectPlayer();
            var pw = Mathf.Min(560f, width - 48f);
            var ph = Mathf.Min(430f, height - 90f);
            var x = width - pw - 24f;
            var y = 74f;
            GUI.color = new Color(0.025f, 0.055f, 0.07f, 0.94f);
            GUI.DrawTexture(new Rect(x, y, pw, ph), _white);
            GUI.color = new Color(0.16f, 0.46f, 0.54f, 0.9f);
            GUI.DrawTexture(new Rect(x, y, 4f, ph), _white);
            GUI.color = Color.white;
            GUI.Label(new Rect(x + 18f, y + 14f, pw - 36f, 24f), snapshot.title, _systemTitle);
            GUI.Label(new Rect(x + 18f, y + 40f, pw - 36f, 18f), "ConKay projection  ·  " + snapshot.viewerRole + "  ·  " + snapshot.confidence, _systemSmall);
            GUI.Label(new Rect(x + 18f, y + 62f, pw - 36f, 34f), snapshot.why, _systemMuted);
            var yy = y + 104f;
            var shown = 0;
            for (var i = 0; i < snapshot.facts.Count && shown < 9; i++)
            {
                var fact = snapshot.facts[i];
                if (fact == null || string.IsNullOrEmpty(fact.key)) continue;
                GUI.Label(new Rect(x + 18f, yy, pw - 36f, 20f), fact.key + "  " + fact.value, _systemFact);
                yy += 21f;
                shown++;
            }
            if (snapshot.events.Count > 0)
            {
                yy += 8f;
                GUI.Label(new Rect(x + 18f, yy, pw - 36f, 18f), "RECENT CONSEQUENCES", _systemSmall);
                yy += 20f;
                var first = Mathf.Max(0, snapshot.events.Count - 3);
                for (var i = first; i < snapshot.events.Count && yy < y + ph - 46f; i++)
                {
                    var evt = snapshot.events[i];
                    if (evt == null) continue;
                    GUI.Label(new Rect(x + 18f, yy, pw - 36f, 18f), evt.kind + "  ·  " + evt.title, _systemFact);
                    yy += 19f;
                }
            }
            GUI.Label(new Rect(x + 18f, y + ph - 28f, pw - 36f, 18f), "Tab close  ·  source: Concord Link  ·  read-only", _systemMuted);
            GUI.color = Color.white;
        }

        static Texture2D Disc(int size)
        {
            var texture = new Texture2D(size, size, TextureFormat.RGBA32, false);
            texture.wrapMode = TextureWrapMode.Clamp;
            var midpoint = (size - 1) * 0.5f;
            for (var y = 0; y < size; y++)
            for (var x = 0; x < size; x++)
            {
                var d = Mathf.Sqrt((x - midpoint) * (x - midpoint) + (y - midpoint) * (y - midpoint)) / midpoint;
                var alpha = d < 0.92f ? 1f : d < 1f ? 1f - (d - 0.92f) / 0.08f : 0f;
                texture.SetPixel(x, y, new Color(1f, 1f, 1f, alpha));
            }
            texture.Apply();
            return texture;
        }
    }
}
