using System.Collections.Generic;
using System.Globalization;
using System.Text;
using Unity.Jobs.LowLevel.Unsafe;
using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// Headless shared-world host (World lens step 3, "Host behind Concord").
    /// Runs only when ConcordiaHost.WorldHostMode. Registers as this world's host
    /// with Concord, then publishes:
    ///   host:manifest — every NPC's id, name and look (chunked: the gateway
    ///                   caps frames at 64 KB), on start and every 10 s
    ///   host:snapshot — positions / facing / speed / activity at ~7 Hz
    /// Concord fans both out to everyone in world:&lt;id&gt; (server/lib/world-host.js),
    /// so every player sees this one simulation.
    /// </summary>
    public class WorldHostPublisher : MonoBehaviour
    {
        const float SnapshotInterval = 0.15f;
        const float ManifestInterval = 10f;
        const int ManifestChunk = 32;

        ConcordClient _client;
        bool _registered;
        float _nextSnapshot, _nextManifest, _nextRegister;
        readonly List<NpcLife> _npcs = new List<NpcLife>();
        readonly Dictionary<NpcLife, Vector3> _lastPos = new Dictionary<NpcLife, Vector3>();
        readonly StringBuilder _sb = new StringBuilder(16 * 1024);
        static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

        // A headless host has no display to pace it: batchmode runs the frame
        // loop flat out and the job system sizes itself to the HOST's cores.
        // On a 6.8-CPU pod slice of a 128-thread machine that was 600% CPU and
        // 269 threads (measured 2026-09-27) — the whole box, starving the
        // backend it talks to. NPC life needs a steady ~30 Hz, not more.
        //   CONCORD_HOST_FPS (default 30), CONCORD_HOST_JOB_WORKERS (default 2)
        static int HostFps => EnvInt("CONCORD_HOST_FPS", 30, 5, 120);

        static int EnvInt(string key, int fallback, int min, int max)
        {
            var v = System.Environment.GetEnvironmentVariable(key);
            return int.TryParse(v, out var n) && n >= min && n <= max ? n : fallback;
        }

        static void PaceHeadless()
        {
            QualitySettings.vSyncCount = 0;
            Application.targetFrameRate = HostFps;
            var workers = EnvInt("CONCORD_HOST_JOB_WORKERS", 2, 1, 64);
            if (workers < JobsUtility.JobWorkerMaximumCount && JobsUtility.JobWorkerCount != workers)
                JobsUtility.JobWorkerCount = workers;
            Debug.Log($"[WorldHost] paced: {Application.targetFrameRate} fps, {JobsUtility.JobWorkerCount} job workers");
        }

        public static void Install(ConcordClient client)
        {
            if (client == null || FindAnyObjectByType<WorldHostPublisher>()) return;
            PaceHeadless();
            var go = new GameObject("WorldHostPublisher");
            go.AddComponent<WorldHostPublisher>()._client = client;
            client.OnEvent += (evt, text) =>
            {
                if (evt == "host:register:ack" && text.Contains("\"ok\":true")) Registered = true;
                if (evt == "host:register:ack" && !text.Contains("\"ok\":true")) Debug.LogWarning("[WorldHost] register refused: " + text);
                if (evt == "host:error") Debug.LogWarning("[WorldHost] " + text);
            };
            Debug.Log("[WorldHost] publisher installed — this process hosts the world");
        }

        public static bool Registered { get; private set; }

        // Stable for this host's lifetime — all the protocol needs (ids are only
        // ever issued by this one host).
        readonly Dictionary<NpcLife, string> _ids = new Dictionary<NpcLife, string>();
        int _nextId;
        string Id(NpcLife n)
        {
            if (!_ids.TryGetValue(n, out var id)) { id = "npc-" + (++_nextId).ToString(Inv); _ids[n] = id; }
            return id;
        }

        float _nextPaceCheck;

        void Update()
        {
            // Other systems (the performance profile) set targetFrameRate for
            // players; the host keeps its own pace.
            if (Time.realtimeSinceStartup >= _nextPaceCheck)
            {
                _nextPaceCheck = Time.realtimeSinceStartup + 5f;
                if (Application.targetFrameRate != HostFps) Application.targetFrameRate = HostFps;
            }
            if (_client == null || !_client.Ready) { Registered = false; return; }
            if (!Registered)
            {
                if (Time.realtimeSinceStartup < _nextRegister) return;
                _nextRegister = Time.realtimeSinceStartup + 5f;
                _ = _client.SendRaw("host:register", "{\"worldId\":\"" + _client.WorldId + "\"}");
                return;
            }
            if (Time.realtimeSinceStartup >= _nextManifest)
            {
                _nextManifest = Time.realtimeSinceStartup + ManifestInterval;
                RefreshPopulation();
                SendManifest();
            }
            if (Time.realtimeSinceStartup >= _nextSnapshot)
            {
                _nextSnapshot = Time.realtimeSinceStartup + SnapshotInterval;
                SendSnapshot();
            }
        }

        void RefreshPopulation()
        {
            _npcs.Clear();
            foreach (var n in FindObjectsByType<NpcLife>(FindObjectsInactive.Exclude))
                if (n && n.isActiveAndEnabled) _npcs.Add(n);
        }

        void SendManifest()
        {
            for (int start = 0; start < _npcs.Count; start += ManifestChunk)
            {
                _sb.Clear();
                _sb.Append("{\"worldId\":\"").Append(_client.WorldId).Append("\",\"append\":").Append(start > 0 ? "true" : "false").Append(",\"entities\":[");
                int end = Mathf.Min(start + ManifestChunk, _npcs.Count);
                bool first = true;
                for (int i = start; i < end; i++)
                {
                    var n = _npcs[i];
                    if (!n) continue;
                    var person = n.GetComponentInChildren<ModularPerson>();
                    var look = person != null ? JsonUtility.ToJson(person.look) : "{}";
                    if (!first) _sb.Append(',');
                    first = false;
                    _sb.Append("{\"id\":\"").Append(Id(n))
                       .Append("\",\"name\":").Append(Quote(n.gameObject.name))
                       .Append(",\"kind\":\"person\",\"look\":").Append(Quote(look)).Append('}');
                }
                _sb.Append("]}");
                _ = _client.SendRaw("host:manifest", _sb.ToString());
            }
        }

        void SendSnapshot()
        {
            _sb.Clear();
            _sb.Append("{\"worldId\":\"").Append(_client.WorldId).Append("\",\"entities\":[");
            bool first = true;
            foreach (var n in _npcs)
            {
                if (!n) continue;
                var t = n.transform;
                var p = t.position;
                float speed = 0f;
                if (_lastPos.TryGetValue(n, out var prev)) { var d = p - prev; d.y = 0f; speed = d.magnitude / SnapshotInterval; }
                _lastPos[n] = p;
                if (!first) _sb.Append(',');
                first = false;
                _sb.Append("{\"id\":\"").Append(Id(n))
                   .Append("\",\"x\":").Append(p.x.ToString("0.##", Inv))
                   .Append(",\"y\":").Append(p.y.ToString("0.##", Inv))
                   .Append(",\"z\":").Append(p.z.ToString("0.##", Inv))
                   .Append(",\"yaw\":").Append(t.eulerAngles.y.ToString("0.#", Inv))
                   .Append(",\"speed\":").Append(speed.ToString("0.##", Inv))
                   .Append(",\"act\":").Append(Quote(n.act ?? "")).Append('}');
            }
            _sb.Append("]}");
            _ = _client.SendRaw("host:snapshot", _sb.ToString());
        }

        static string Quote(string s)
        {
            if (s == null) return "\"\"";
            var b = new StringBuilder(s.Length + 8).Append('"');
            foreach (var c in s)
            {
                if (c == '"' || c == '\\') b.Append('\\').Append(c);
                else if (c < 0x20) b.Append("\\u").Append(((int)c).ToString("x4", Inv));
                else b.Append(c);
            }
            return b.Append('"').ToString();
        }
    }
}
