using System.Collections.Generic;
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
        GUIStyle _title, _small, _center, _prompt, _card, _cardSub, _btn, _log;
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
            _log = Sty(13, FontStyle.Normal, TextAnchor.UpperLeft, new Color(0.94f, 0.88f, 0.74f));
            _btn = new GUIStyle(GUI.skin.button)
            {
                fontSize = 13,
                fontStyle = FontStyle.Bold,
                alignment = TextAnchor.MiddleCenter,
                wordWrap = true
            };
            if (_font) _btn.font = _font;
            _btn.normal.textColor = new Color(1f, 0.93f, 0.78f);
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
            PartyStrip();
            TargetBar(w);
            Rings(w);
            if (!player.Busy) Minimap(h);
            Prompt(w, h);
            Toast(w);
            Arrival(w, h);
            ConsequenceFeed(w, h);
            if (player.talkOpen) TalkPanel(w, h);
            if (player.menuOpen) KitMenu(w, h);
            if (player.skillOpen) SkillSheet(w, h);
            PlotBar(w, h);
            Hints(w, h);
        }

        void Hints(float w, float h)
        {
            GUI.color = new Color(0.92f, 0.84f, 0.66f, 0.88f);
            GUI.Label(new Rect(18, h - 22, w - 36, 20),
                player.talkOpen
                    ? "Type  ·  Enter  send  ·  Esc  leave  ·  2B " + TwoBStatus()
                    : player.skillOpen
                        ? "K  close  ·  click a skill  ·  [ ]  group  ·  Esc  close"
                        : player.menuOpen
                            ? "I  close  ·  click a weapon  ·  1/2/3  combat slot  ·  K  lattice  ·  Esc  close"
                            : "I  kit   ·   K  " + SkillLattice.CatalogCount + " skills   ·   1/2/3  " + SkillLattice.ActiveSkill
                              + "   ·   H  horde   ·   J  extract   ·   LMB  swing   ·   X  dodge   ·   E  use",
                _small);
            GUI.color = Color.white;
        }

        void Vitals()
        {
            var world = Canon.Get(player.world);
            var live = Canon.SteelLive(player.world, player.transform.position);
            GUI.color = new Color(0f, 0f, 0f, 0.45f);
            var city = CityAtlas.Nearest(player.world, player.transform.position, 18f);
            GUI.DrawTexture(new Rect(22, 28, 300, 108), _white);
            GUI.color = Color.white;
            GUI.Label(new Rect(32, 32, 280, 22), world.title.ToUpperInvariant(), _title);
            GUI.Label(new Rect(32, 54, 280, 16),
                (live ? "LIVE STEEL" : "FLOWER-LAW") + (city == null ? "" : "  ·  " + city.name)
                + (string.IsNullOrEmpty(player.kitWeapon) ? "" : "  ·  " + player.kitWeapon)
                + "  ·  " + SkillLattice.HudLine(), _small);
            GUI.Label(new Rect(32, 70, 280, 16), WorldClock.HudClock()
                + (string.IsNullOrEmpty(ConcordClient.HudLine) ? "" : "  ·  " + ConcordClient.HudLine), _small);
            GUI.Label(new Rect(32, 86, 280, 16),
                !string.IsNullOrEmpty(WorldClock.NearbyAct) ? WorldClock.NearbyAct
                : HubObjectives.Line(), _small);
            var lineage = WorldMemory.LineageLine(player.world);
            if (!string.IsNullOrEmpty(lineage))
                GUI.Label(new Rect(32, 102, 280, 14), lineage, _small);
            else if (Plots.Nearby != null)
                GUI.Label(new Rect(32, 102, 280, 14), "scheme nearby — Expose / Abet / Ignore", _small);
        }

        static string TwoBStatus()
        {
            var c = ConcordClient.Live;
            if (c != null && c.Connected) return "live";
            var why = string.IsNullOrEmpty(ConcordClient.LastReason) ? "no_gateway" : ConcordClient.LastReason;
            return why;
        }

        void TalkPanel(float w, float h)
        {
            float pw = 640f, ph = 308f;
            float x = (w - pw) * 0.5f, y = h - ph - 36f;
            GUI.color = new Color(0.04f, 0.03f, 0.02f, 0.88f);
            GUI.DrawTexture(new Rect(x, y, pw, ph), _white);
            GUI.color = Color.white;
            var who = player.talkNpc != null && player.talkNpc.def != null ? player.talkNpc.def.name : "Someone";
            GUI.Label(new Rect(x + 16, y + 10, pw - 32, 22), who + "  ·  2B " + TwoBStatus(), _title);
            var log = player.talkLog.Count == 0 ? "" : string.Join("\n", player.talkLog);
            GUI.Label(new Rect(x + 16, y + 36, pw - 32, 140), log, _log);
            GUI.SetNextControlName("TalkDraft");
            player.talkDraft = GUI.TextField(new Rect(x + 16, y + 186, pw - 140, 28), player.talkDraft ?? "", 240);
            if (player.focusTalk)
            {
                GUI.FocusControl("TalkDraft");
                player.focusTalk = false;
            }
            if (GUI.Button(new Rect(x + pw - 116, y + 186, 100, 28), "Send", _btn))
                player.SubmitTalk();
            var aff = Bonds.Get(Bonds.Key(player.talkNpc));
            DrawBar(x + 16, y + 220, 220, 8, aff, new Color(0.92f, 0.42f, 0.55f));
            GUI.Label(new Rect(x + 244, y + 214, 160, 18), "affinity " + Mathf.RoundToInt(aff * 100f) + "%", _small);
            if (KitBag.HasLoot())
            {
                if (GUI.Button(new Rect(x + pw - 116, y + 216, 100, 24), "Give", _btn))
                    player.AppendTalk(Bonds.Give(player.talkNpc));
            }
            else
                GUI.Label(new Rect(x + pw - 200, y + 214, 184, 18), "no gift in kit", _small);
            var lev = LeverageHint();
            if (!string.IsNullOrEmpty(lev))
                GUI.Label(new Rect(x + 16, y + 238, pw - 32, 32), lev, _small);
            var talkLineage = WorldMemory.LineageLine(player.world);
            if (!string.IsNullOrEmpty(talkLineage))
                GUI.Label(new Rect(x + 16, y + 270, pw - 32, 18), talkLineage, _small);
        }

        string LeverageHint()
        {
            if (player.talkNpc == null) return "";
            var key = Bonds.Key(player.talkNpc);
            var p = WorldBook.FindPerson(player.world, key);
            if (p == null && player.talkNpc.def != null)
            {
                p = WorldBook.FindPerson(player.world, player.talkNpc.def.id);
                if (p == null) p = WorldBook.FindPerson(player.world, player.talkNpc.def.name);
            }
            var lev = WorldBook.LeverageLine(p);
            if (string.IsNullOrEmpty(lev)) return "";
            var aff = Bonds.Get(key);
            if (aff < 0.22f) return "They carry leverage. Talk or give until they open it.";
            return "Leverage: " + lev;
        }

        void KitMenu(float w, float h)
        {
            float pw = 860f, ph = 420f;
            float x = (w - pw) * 0.5f, y = (h - ph) * 0.5f - 10f;
            GUI.color = new Color(0.04f, 0.03f, 0.02f, 0.9f);
            GUI.DrawTexture(new Rect(x, y, pw, ph), _white);
            GUI.color = Color.white;
            GUI.Label(new Rect(x + 18, y + 12, pw - 36, 24), "KIT  ·  inventory  ·  weapons", _title);
            float col = (pw - 48f) / 2f;
            DrawInvCol(x + 16, y + 44, col, "Carry", false);
            DrawInvCol(x + 32 + col, y + 44, col, "Weapons", true);
            GUI.Label(new Rect(x + 18, y + ph - 48, pw - 36, 18),
                SkillLattice.FromKernel
                    ? "K  opens the " + SkillLattice.CatalogCount + "-skill lattice  ·  " + SkillLattice.HudLine()
                    : "K  opens the lattice. skills.mastery unbound until Concord answers.", _small);
            GUI.Label(new Rect(x + 18, y + ph - 28, pw - 36, 18), QuestLog.HudBlock(), _small);
        }

        void SkillSheet(float w, float h)
        {
            float pw = Mathf.Min(1080f, w - 48f), ph = Mathf.Min(620f, h - 80f);
            float x = (w - pw) * 0.5f, y = (h - ph) * 0.5f;
            GUI.color = new Color(0.03f, 0.02f, 0.015f, 0.92f);
            GUI.DrawTexture(new Rect(x, y, pw, ph), _white);
            GUI.color = Color.white;
            var head = SkillLattice.FromKernel
                ? SkillLattice.CatalogCount + " SKILLS  ·  " + SkillLattice.TrainedCount + " trained  ·  kernel"
                : "SKILLS  ·  skills.mastery unbound";
            GUI.Label(new Rect(x + 18, y + 12, pw - 36, 24), head, _title);
            GUI.Label(new Rect(x + 18, y + 38, pw - 36, 18), SkillLattice.HudLine(), _small);
            if (!SkillLattice.FromKernel)
            {
                GUI.Label(new Rect(x + 18, y + 70, pw - 36, 80),
                    "The catalog lives on Concord. This overlay stays empty until skills.mastery answers. Kit arts are not this lattice.",
                    _small);
                return;
            }
            int cols = Mathf.Max(1, SkillLattice.Groups.Count);
            float colW = (pw - 36f) / cols;
            for (int g = 0; g < cols; g++)
            {
                var group = SkillLattice.Groups[g];
                float cx = x + 18 + colW * g;
                var title = group == SkillLattice.Group ? "▸ " + group.ToUpperInvariant() : group.ToUpperInvariant();
                if (GUI.Button(new Rect(cx, y + 62, colW - 10, 24), title, _btn))
                    SkillLattice.Group = group;
                float yy = y + 92f;
                for (int i = 0; i < SkillLattice.All.Count; i++)
                {
                    var row = SkillLattice.All[i];
                    if (row.group != group) continue;
                    var mark = row.skillType == SkillLattice.ActiveSkill ? "▸ " : "  ";
                    var label = mark + row.skillType + "  L" + row.level;
                    if (GUI.Button(new Rect(cx, yy, colW - 10, 22), label, _btn))
                    {
                        SkillLattice.Group = group;
                        SkillLattice.ActiveSkill = row.skillType;
                    }
                    yy += 24f;
                    if (yy > y + ph - 36f) break;
                }
            }
        }

        void DrawInvCol(float x, float y, float w, string title, bool weaponsOnly)
        {
            GUI.Label(new Rect(x, y, w, 20), title, _center);
            float yy = y + 26f;
            var items = KitBag.Items;
            if (items.Count == 0)
            {
                GUI.Label(new Rect(x, yy, w, 36), weaponsOnly ? "No other kit yet. Q cycles faction steel." : "Empty hands. Take from the ring.", _small);
                return;
            }
            for (int i = 0; i < items.Count; i++)
            {
                var it = items[i];
                if (weaponsOnly && it.kind != "weapon") continue;
                if (!weaponsOnly && it.kind == "weapon") continue;
                var label = (it.id == KitBag.Equipped ? "▸ " : "  ") + it.name;
                if (!string.IsNullOrEmpty(it.affixLine)) label += "  ·  " + it.affixLine;
                if (weaponsOnly)
                {
                    if (GUI.Button(new Rect(x, yy, w - 8, 32), label, _btn))
                        player.HoldFromBag(it.stem);
                }
                else
                    GUI.Label(new Rect(x, yy, w - 8, 28), label, _small);
                yy += 36f;
                if (yy > y + 300f) break;
            }
        }

        void DrawSkillCol(float x, float y, float w)
        {
            GUI.Label(new Rect(x, y, w, 40),
                SkillLattice.FromKernel
                    ? "K  " + SkillLattice.CatalogCount + " skills"
                    : "K  lattice unbound", _small);
        }

        void Rings(float w)
        {
            float cx = w - 78f;
            float cy = 78f;
            DrawRing(cx, cy, 62, player.hp / 100f, new Color(0.78f, 0.18f, 0.16f));
            DrawRing(cx, cy, 48, player.stamina / 100f, new Color(0.86f, 0.64f, 0.22f));
            DrawRing(cx, cy, 34, player.poise / 16f, new Color(0.42f, 0.72f, 0.82f));
            if (WorldBoss.Live && WorldBoss.Live.HpPct >= 0f)
                DrawRing(cx, cy + 86f, 44, WorldBoss.Live.HpPct, new Color(0.78f, 0.22f, 0.16f));
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
            if (WorldBoss.Live)
                Dot(WorldBoss.Live.transform.position, new Color(0.9f, 0.18f, 0.12f), 7f);
            foreach (var n in FindObjectsByType<GuestNpc>(FindObjectsInactive.Exclude))
                if (n) Dot(n.transform.position, new Color(0.75f, 0.82f, 0.55f), 3f);
            foreach (var host in FindObjectsByType<Hostile>(FindObjectsInactive.Exclude))
                if (host) Dot(host.transform.position, new Color(0.82f, 0.18f, 0.14f), 4f);
            foreach (var b in FindObjectsByType<QuestBeacon>(FindObjectsInactive.Exclude))
            {
                if (!b || !BeaconMatchesQuest(b)) continue;
                Dot(b.transform.position, new Color(1f, 0.82f, 0.22f), 6f);
            }
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

        void ConsequenceFeed(float w, float h)
        {
            int n = WorldClock.FeedCount;
            if (n <= 0 || player.talkOpen || player.menuOpen || player.skillOpen) return;
            float fw = 320f;
            float fh = 18f + n * 16f;
            float x = w - fw - 18f;
            float y = 28f;
            GUI.color = new Color(0f, 0f, 0f, 0.42f);
            GUI.DrawTexture(new Rect(x, y, fw, fh), _white);
            GUI.color = new Color(0.86f, 0.78f, 0.62f, 0.92f);
            for (int i = 0; i < n; i++)
            {
                var beat = WorldClock.FeedAt(i);
                if (string.IsNullOrEmpty(beat.line)) continue;
                var prefix = string.IsNullOrEmpty(beat.channel) ? "" : beat.channel + "  ·  ";
                GUI.Label(new Rect(x + 10, y + 6 + i * 16f, fw - 20, 16), prefix + beat.line, _small);
            }
            GUI.color = Color.white;
        }

        void PartyStrip()
        {
            var run = ConcordClient.RunLine;
            float extra = string.IsNullOrEmpty(run) ? 0f : 18f;
            GUI.color = new Color(0f, 0f, 0f, 0.4f);
            GUI.DrawTexture(new Rect(22, 142, 300, 28 + extra), _white);
            GUI.color = Color.white;
            GUI.Label(new Rect(32, 144, 280, 16), ConcordClient.PartyLine, _small);
            DrawBar(170, 150, 140, 8, player.hp / 100f, new Color(0.78f, 0.18f, 0.16f));
            if (!string.IsNullOrEmpty(run))
                GUI.Label(new Rect(32, 162, 280, 16), run, _small);
        }

        void PlotBar(float w, float h)
        {
            var plot = Plots.Nearby;
            if (plot == null || player.talkOpen || player.menuOpen || player.skillOpen) return;
            float pw = 520f, ph = 72f;
            float x = (w - pw) * 0.5f, y = h - 118f;
            GUI.color = new Color(0.05f, 0.03f, 0.02f, 0.88f);
            GUI.DrawTexture(new Rect(x, y, pw, ph), _white);
            GUI.color = Color.white;
            GUI.Label(new Rect(x + 12, y + 6, pw - 24, 32), plot.text, _small);
            if (GUI.Button(new Rect(x + 12, y + 40, 150, 24), "Expose", _btn))
                Plots.Intervene("expose");
            if (GUI.Button(new Rect(x + 176, y + 40, 150, 24), "Abet", _btn))
                Plots.Intervene("abet");
            if (GUI.Button(new Rect(x + 340, y + 40, 166, 24), "Ignore", _btn))
                Plots.Intervene("ignore");
        }

        void TargetBar(float w)
        {
            TrainingDummy dummy = null;
            Hostile host = null;
            float best = 22f;
            var origin = player.transform.position;
            var fwd = player.cam ? player.cam.PlanarForward : player.transform.forward;
            foreach (var h in FindObjectsByType<Hostile>(FindObjectsInactive.Exclude))
            {
                if (!h) continue;
                var to = h.transform.position - origin;
                to.y = 0f;
                var dist = to.magnitude;
                if (dist > best || dist < 0.4f) continue;
                if (Vector3.Dot(fwd.normalized, to.normalized) < 0.25f) continue;
                best = dist;
                host = h;
                dummy = h.GetComponent<TrainingDummy>() ?? h.GetComponentInParent<TrainingDummy>();
            }
            if (host == null)
            {
                foreach (var d in FindObjectsByType<TrainingDummy>(FindObjectsInactive.Exclude))
                {
                    if (!d || d.hp <= 0f) continue;
                    var to = d.transform.position - origin;
                    to.y = 0f;
                    var dist = to.magnitude;
                    if (dist > 8f || dist < 0.4f) continue;
                    if (Vector3.Dot(fwd.normalized, to.normalized) < 0.35f) continue;
                    dummy = d;
                    break;
                }
            }
            var peril = Hostile.TelegraphKind;
            if (dummy == null && string.IsNullOrEmpty(peril)) return;
            float cx = w * 0.5f;
            float y = 64f;
            GUI.color = new Color(0f, 0f, 0f, 0.5f);
            GUI.DrawTexture(new Rect(cx - 160, y, 320, string.IsNullOrEmpty(peril) ? 36 : 52), _white);
            GUI.color = Color.white;
            var label = dummy ? dummy.name : (host ? host.name : "foe");
            float hpT = dummy ? Mathf.Clamp01(dummy.hp / 80f) : 1f;
            GUI.Label(new Rect(cx - 150, y + 2, 300, 16), label.ToUpperInvariant(), _center);
            DrawBar(cx - 140, y + 20, 280, 8, hpT, new Color(0.82f, 0.16f, 0.14f));
            if (!string.IsNullOrEmpty(peril))
            {
                var hint = peril == "thrust" ? "Thrust — X"
                    : peril == "sweep" ? "Sweep — Space"
                    : peril == "grab" ? "Grab — X"
                    : peril;
                GUI.Label(new Rect(cx - 150, y + 30, 300, 18), hint, _center);
            }
        }

        static bool BeaconMatchesQuest(QuestBeacon b)
        {
            if (b.tokens == null || QuestLog.Active.Count == 0) return false;
            foreach (var a in QuestLog.Active)
            {
                var objs = a.quest?.objectives;
                if (objs == null) continue;
                foreach (var o in objs)
                {
                    if (o == null || string.IsNullOrEmpty(o.target)) continue;
                    foreach (var tok in b.tokens)
                        if (QuestLog.Hit(new HashSet<string> { QuestLog.Norm(tok) }, o.target)
                            || QuestLog.Norm(tok) == QuestLog.Norm(o.target))
                            return true;
                }
            }
            return false;
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
