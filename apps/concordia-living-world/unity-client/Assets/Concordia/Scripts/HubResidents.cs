using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// The Hub's population is the server's people. `npc:residents` returns the
    /// world's living, named NPCs. Bind() puts them on the client's own crowd
    /// (Full: crowd-walk/stall/sit GuestNpcs; Lean: hub-* StreamNpcSim rows),
    /// matching jobs to places. Positions stay the client's: its city layout is
    /// its own. With no answer from the server (offline, older backend) the
    /// crowd keeps its unlabeled names; nothing is invented to fill the gap.
    ///
    /// `npc:conversation-bid` carries the whole exchange. When both speakers are
    /// standing near the player, PlayConversation speaks it over their heads,
    /// line by line; otherwise it is one named line in the act feed.
    /// </summary>
    public static class HubResidents
    {
        [Serializable]
        public class Resident
        {
            public string id, name, job, activity, faction, backstory;
        }

        [Serializable] class ResidentsData { public bool ok; public Resident[] residents; }
        [Serializable] class ResidentsFrame { public ResidentsData data; }

        [Serializable] public class Line { public string from, text; }
        [Serializable] class ConversationData { public string id, npcA, npcB, nameA, nameB, opener; public Line[] lines; }
        [Serializable] class ConversationFrame { public ConversationData data; }

        /// <summary>Play a conversation only when the player is this close to a speaker.</summary>
        const float HearM = 30f;

        static readonly List<Resident> People = new List<Resident>();
        static readonly Dictionary<string, Resident> ByServerId = new Dictionary<string, Resident>();
        /// <summary>Client slot id (crowd-* / hub-*) → server resident id.</summary>
        static readonly Dictionary<string, string> SlotToServer = new Dictionary<string, string>();
        static readonly HashSet<string> Played = new HashSet<string>();

        public static int Count => People.Count;
        public static int Bound => SlotToServer.Count;

        static readonly string[] StallJobs = { "merchant", "vendor", "trader", "farmer", "fisher", "builder", "crafter", "smith", "baker", "cook" };
        static readonly string[] GuardJobs = { "guard", "warden", "soldier" };
        static readonly string[] HallJobs = { "clerk", "scholar", "scribe", "priest", "healer", "noble" };

        public static void Apply(string frameJson)
        {
            ResidentsFrame frame = null;
            try { frame = JsonUtility.FromJson<ResidentsFrame>(frameJson); }
            catch (Exception e) { Debug.LogWarning("[Concordia] HubResidents: unreadable npc:residents (" + e.Message + ")"); }
            var list = frame?.data?.residents;
            if (frame?.data == null || !frame.data.ok || list == null) return;

            People.Clear();
            ByServerId.Clear();
            foreach (var r in list)
            {
                if (r == null || string.IsNullOrEmpty(r.id) || string.IsNullOrEmpty(r.name)) continue;
                People.Add(r);
                ByServerId[r.id] = r;
            }
            SlotToServer.Clear();
            Debug.Log("[Concordia] HubResidents: " + People.Count + " residents from the server");
            Bind();
        }

        /// <summary>Idempotent. Called when residents arrive and again after each crowd pass.</summary>
        public static void Bind()
        {
            if (People.Count == 0) return;
            var used = new HashSet<string>(SlotToServer.Values);
            var bound = 0;

            foreach (var g in UnityEngine.Object.FindObjectsByType<GuestNpc>(FindObjectsInactive.Include))
            {
                if (!g || g.def == null || string.IsNullOrEmpty(g.def.id)) continue;
                var slot = g.def.id;
                if (!slot.StartsWith("crowd-", StringComparison.Ordinal)) continue;
                var r = ResidentFor(slot, Prefer(slot), used);
                if (r == null) continue;
                g.def.name = r.name;
                g.def.title = Pretty(r.job);
                g.def.line = FirstSentence(r.backstory);
                g.personId = r.id;
                g.gameObject.name = r.name;
                PersonLabel.Attach(g.transform, r.name, g.def.title);
                bound++;
            }

            foreach (var rec in StreamNpcSim.All)
            {
                if (rec == null || string.IsNullOrEmpty(rec.Id) || !rec.Id.StartsWith("hub-", StringComparison.Ordinal)) continue;
                var r = ResidentFor(rec.Id, Prefer(rec.Id), used);
                if (r == null) continue;
                rec.Name = r.name;
                if (rec.Body) rec.Body.name = r.name;
                bound++;
            }

            if (bound > 0)
                Debug.Log("[Concordia] HubResidents: bound " + SlotToServer.Count + " crowd places to residents");
        }

        static Resident ResidentFor(string slot, string[] prefer, HashSet<string> used)
        {
            if (SlotToServer.TryGetValue(slot, out var known) && ByServerId.TryGetValue(known, out var kept))
                return kept;
            Resident pick = null;
            if (prefer != null)
                foreach (var r in People)
                    if (!used.Contains(r.id) && Array.IndexOf(prefer, (r.job ?? "").ToLowerInvariant()) >= 0) { pick = r; break; }
            if (pick == null)
                foreach (var r in People)
                    if (!used.Contains(r.id) && Array.IndexOf(GuardJobs, (r.job ?? "").ToLowerInvariant()) < 0) { pick = r; break; }
            if (pick == null) return null;
            used.Add(pick.id);
            SlotToServer[slot] = pick.id;
            return pick;
        }

        static string[] Prefer(string slot)
        {
            if (slot.StartsWith("crowd-stall", StringComparison.Ordinal) || slot.StartsWith("hub-mkt", StringComparison.Ordinal)) return StallJobs;
            if (slot.StartsWith("hub-wdn", StringComparison.Ordinal)) return GuardJobs;
            if (slot.StartsWith("hub-arc", StringComparison.Ordinal) || slot.StartsWith("hub-cnc", StringComparison.Ordinal)) return HallJobs;
            return null;
        }

        /// <summary>The body standing in for a server resident, if one is in the scene.</summary>
        public static Transform BodyFor(string serverId)
        {
            if (string.IsNullOrEmpty(serverId)) return null;
            foreach (var kv in SlotToServer)
            {
                if (kv.Value != serverId) continue;
                if (StreamNpcSim.TryGet(kv.Key, out var rec))
                    return rec.Body && rec.Body.activeInHierarchy ? rec.Body.transform : null;
                var g = WorldPresence.FindGuest(serverId);
                return g ? g.transform : null;
            }
            return null;
        }

        public static void PlayConversation(string frameJson)
        {
            ConversationData c = null;
            try { c = JsonUtility.FromJson<ConversationFrame>(frameJson)?.data; }
            catch { /* older frame shapes fall through to the feed line */ }
            if (c == null || string.IsNullOrEmpty(c.id) || !Played.Add(c.id))
                return;
            if (Played.Count > 512) Played.Clear();

            var a = BodyFor(c.npcA);
            var b = BodyFor(c.npcB);
            var player = ConcordiaPlayer.Live ? ConcordiaPlayer.Live.transform : null;
            var near = player && ((a && Vector3.Distance(player.position, a.position) < HearM)
                                  || (b && Vector3.Distance(player.position, b.position) < HearM));
            var lines = c.lines != null && c.lines.Length > 0
                ? c.lines
                : (string.IsNullOrEmpty(c.opener) ? null : new[] { new Line { from = c.nameA, text = c.opener } });

            if (!near || a == null || b == null || lines == null)
            {
                var who = !string.IsNullOrEmpty(c.nameA) && !string.IsNullOrEmpty(c.nameB)
                    ? c.nameA + " and " + c.nameB + " talk"
                    : "voices nearby";
                WorldClock.NoteAct(who);
                return;
            }

            var la = a.GetComponent<NpcLife>();
            var lb = b.GetComponent<NpcLife>();
            var seconds = 0f;
            foreach (var l in lines) seconds += SpeechSeconds(l?.text);
            if (la) la.Notice(b, seconds);
            if (lb) lb.Notice(a, seconds);
            var runner = a.GetComponent<NpcSpeech>() ?? a.gameObject.AddComponent<NpcSpeech>();
            runner.Play(lines, c.nameA, a, b);
        }

        internal static float SpeechSeconds(string text) =>
            Mathf.Clamp(1.6f + (text?.Length ?? 0) * 0.055f, 2f, 7f);

        static string Pretty(string job)
        {
            if (string.IsNullOrEmpty(job) || job == "generic") return "resident";
            return job.Replace('_', ' ');
        }

        static string FirstSentence(string text)
        {
            if (string.IsNullOrEmpty(text)) return "";
            var cut = text.IndexOf(". ", StringComparison.Ordinal);
            return cut > 0 ? text.Substring(0, cut + 1) : text;
        }
    }

    /// <summary>Speaks a conversation's lines over the two speakers, one at a time.</summary>
    public class NpcSpeech : MonoBehaviour
    {
        Coroutine _run;

        public void Play(HubResidents.Line[] lines, string nameA, Transform a, Transform b)
        {
            if (_run != null) StopCoroutine(_run);
            _run = StartCoroutine(Run(lines, nameA, a, b));
        }

        IEnumerator Run(HubResidents.Line[] lines, string nameA, Transform a, Transform b)
        {
            foreach (var l in lines)
            {
                if (l == null || string.IsNullOrEmpty(l.text)) continue;
                var speaker = l.from == nameA ? a : b;
                if (!speaker) yield break;
                var secs = HubResidents.SpeechSeconds(l.text);
                SpeechLine.Show(speaker, l.text, secs);
                yield return new WaitForSeconds(secs + 0.35f);
            }
            _run = null;
        }
    }

    /// <summary>One spoken line above a head. Same quiet TextMesh as PersonLabel, set higher.</summary>
    public class SpeechLine : MonoBehaviour
    {
        const float Height = 2.32f;
        const float MaxDist = 18f;
        const int Wrap = 34;

        Transform _host;
        TextMesh _face, _ink;
        float _until;

        public static void Show(Transform host, string text, float seconds)
        {
            if (!host) return;
            var line = host.GetComponentInChildren<SpeechLine>(true);
            if (!line)
            {
                var go = new GameObject("SpeechLine");
                go.transform.SetParent(host, false);
                line = go.AddComponent<SpeechLine>();
                line._host = host;
                line._ink = line.Make(new Color(0.06f, 0.05f, 0.04f, 0.9f), 0.002f);
                line._face = line.Make(new Color(1f, 0.97f, 0.88f, 0.98f), 0f);
            }
            var wrapped = WrapText(text, Wrap);
            line._face.text = wrapped;
            line._ink.text = wrapped;
            line._until = Time.time + seconds;
            line.gameObject.SetActive(true);
        }

        TextMesh Make(Color color, float z)
        {
            var child = new GameObject(z > 0f ? "Ink" : "Face");
            child.transform.SetParent(transform, false);
            child.transform.localPosition = new Vector3(0f, 0f, z);
            var tm = child.AddComponent<TextMesh>();
            tm.anchor = TextAnchor.LowerCenter;
            tm.alignment = TextAlignment.Center;
            tm.characterSize = 0.014f;
            tm.fontSize = 36;
            tm.fontStyle = FontStyle.Italic;
            tm.color = color;
            var font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            var rend = tm.GetComponent<Renderer>();
            if (font)
            {
                tm.font = font;
                if (rend && font.material) rend.sharedMaterial = font.material;
            }
            if (rend)
            {
                rend.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                rend.receiveShadows = false;
            }
            return tm;
        }

        void LateUpdate()
        {
            if (!_host || Time.time > _until)
            {
                gameObject.SetActive(false);
                return;
            }
            var cam = Camera.main;
            if (!cam) return;
            transform.position = _host.position + Vector3.up * Height;
            var d = Vector3.Distance(cam.transform.position, transform.position);
            var show = d < MaxDist;
            foreach (var r in GetComponentsInChildren<Renderer>()) r.enabled = show;
            if (!show) return;
            transform.rotation = Quaternion.LookRotation(transform.position - cam.transform.position);
            transform.localScale = Vector3.one * Mathf.Clamp(d * 0.045f, 0.7f, 1.15f) / Mathf.Max(0.0001f, _host.lossyScale.y);
        }

        static string WrapText(string text, int width)
        {
            if (string.IsNullOrEmpty(text) || text.Length <= width) return text ?? "";
            var sb = new System.Text.StringBuilder(text.Length + 8);
            var col = 0;
            foreach (var word in text.Split(' '))
            {
                if (col > 0 && col + word.Length + 1 > width) { sb.Append('\n'); col = 0; }
                else if (col > 0) { sb.Append(' '); col++; }
                sb.Append(word);
                col += word.Length;
            }
            return sb.ToString();
        }
    }
}
