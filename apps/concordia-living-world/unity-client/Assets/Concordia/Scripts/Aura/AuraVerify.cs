using System.Text;
using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// Aura: the loop's proof channel. Every roadmap task states its result as a real
    /// <c>[AuraVerify] &lt;ID&gt; PASS|FAIL &lt;facts&gt;</c> console line read from live state,
    /// never as a claim. Development/editor only, so it can never change shipped behaviour.
    /// Never logs tokens, user ids or secrets — only the facts the roadmap asks for.
    /// </summary>
    public static class AuraVerify
    {
        public static int Passes;
        public static int Fails;

        /// <summary>True once the dev-key driver object exists (editor/development builds).</summary>
        public static bool KeysInstalled { get; private set; }

        static bool _keysInstalled;

        /// <summary>Record a passing check: <c>[AuraVerify] ID PASS facts</c>.</summary>
        public static void Pass(string id, string facts)
        {
            Passes++;
            Debug.Log("[AuraVerify] " + Id(id) + " PASS " + Facts(facts));
        }

        /// <summary>Record a failing check. Logged as a warning so Play health counts see it.</summary>
        public static void Fail(string id, string facts)
        {
            Fails++;
            Debug.LogWarning("[AuraVerify] " + Id(id) + " FAIL " + Facts(facts));
        }

        /// <summary>
        /// Live state one-liner: world, position, hp, stamina, poise, gateway state,
        /// active quests and equipped kit. Logs and returns the same text.
        /// </summary>
        public static string Snapshot()
        {
            var sb = new StringBuilder(192);
            sb.Append("world=?").Append(" pos=?").Append(" hp=?").Append(" stamina=?").Append(" poise=?");

            var player = UnityEngine.Object.FindAnyObjectByType<ConcordiaPlayer>();
            if (player != null)
            {
                var p = player.transform.position;
                sb.Length = 0;
                sb.Append("world=").Append(player.world);
                sb.Append(" pos=(").Append(F1(p.x)).Append(',').Append(F1(p.y)).Append(',').Append(F1(p.z)).Append(')');
                sb.Append(" hp=").Append(F0(player.hp));
                sb.Append(" stamina=").Append(F0(player.stamina));
                sb.Append(" poise=").Append(F0(player.poise));
            }

            sb.Append(" client=").Append(Gateway());

            try { sb.Append(" quests=").Append(Quests()); }
            catch (System.Exception e) { sb.Append(" quests=<").Append(e.GetType().Name).Append('>'); }

            try { sb.Append(" gear=").Append(Gear()); }
            catch (System.Exception e) { sb.Append(" gear=<").Append(e.GetType().Name).Append('>'); }

            string line = sb.ToString();
            Debug.Log("[AuraVerify] SNAPSHOT " + line);
            return line;
        }

        static string Gateway()
        {
            var client = ConcordClient.Live;
            if (client == null) return "absent";
            string reason = string.IsNullOrEmpty(ConcordClient.LastReason) ? "unknown" : ConcordClient.LastReason;
            return client.Connected ? "connected(" + reason + ")" : "offline(" + reason + ")";
        }

        static string Quests()
        {
            var active = QuestLog.Active;
            if (active == null || active.Count == 0) return "0";
            var sb = new StringBuilder(64);
            sb.Append(active.Count).Append(':');
            for (int i = 0; i < active.Count; i++)
            {
                var a = active[i];
                if (i > 0) sb.Append(',');
                string qid = a?.quest != null && !string.IsNullOrEmpty(a.quest.id) ? a.quest.id : "?";
                sb.Append(qid).Append('[').Append(DoneCount(a)).Append('/').Append(a?.done?.Length ?? 0).Append(']');
            }
            return sb.ToString();
        }

        static int DoneCount(QuestLog.ActiveQuest a)
        {
            if (a?.done == null) return 0;
            int n = 0;
            for (int i = 0; i < a.done.Length; i++) if (a.done[i]) n++;
            return n;
        }

        static string Gear()
        {
            string equipped = string.IsNullOrEmpty(KitBag.Equipped) ? "none" : KitBag.Equipped;
            int items = KitBag.Items != null ? KitBag.Items.Count : 0;
            return equipped + " items=" + items;
        }

        static string Id(string id) => string.IsNullOrEmpty(id) ? "UNKNOWN" : id.Trim();

        static string Facts(string facts) => string.IsNullOrEmpty(facts) ? "-" : facts;

        static string F0(float v) => v.ToString("F0");

        static string F1(float v) => v.ToString("F1");

        // ---- dev keys --------------------------------------------------------------------
        // F10 prints a snapshot in Play. Editor/development builds only; F1/F8/F9 are
        // already owned by ConcordiaHUD, and nothing else binds F10.

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void InstallKeys()
        {
            if (_keysInstalled) return;
            if (!Application.isEditor && !Debug.isDebugBuild) return;
            _keysInstalled = true;

            var go = new GameObject("~AuraVerifyKeys");
            go.hideFlags = HideFlags.DontSave;
            UnityEngine.Object.DontDestroyOnLoad(go);
            go.AddComponent<KeyDriver>();
            KeysInstalled = true;
            Debug.Log("[AuraVerify] dev keys installed — F10 prints a snapshot");
        }

        /// <summary>
        /// Reads F10 and prints a snapshot. Exposed statically so verification can invoke the
        /// exact same code path F10 takes; it only ever logs.
        /// </summary>
        public sealed class KeyDriver : MonoBehaviour
        {
            public static KeyDriver Instance { get; private set; }

            void Awake() { Instance = this; }

            void OnDestroy() { if (Instance == this) Instance = null; }

            void Update()
            {
                if (Input.GetKeyDown(KeyCode.F10)) Trigger();
            }

            /// <summary>The F10 action itself: log a live snapshot.</summary>
            public static void Trigger() { Snapshot(); }
        }
    }
}
