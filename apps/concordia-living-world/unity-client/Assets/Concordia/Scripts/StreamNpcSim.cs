using System.Collections.Generic;
using System.IO;
using System.Text;
using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// Lightweight NPC records for Simulation / Abstract bands — schedule without full AI.
    /// StreamNpcPresence parks state here when the player leaves Full range.
    /// </summary>
    public static class StreamNpcSim
    {
        public sealed class Record
        {
            public string Id;
            public string Name;
            public string Act = "idle";
            public NpcLife.Job Job = NpcLife.Job.Wander;
            public Vector3 Home;
            public Vector3 Pos;
            public float Yaw;
            public WorldId World;
            public StreamLodBand Band = StreamLodBand.Simulation;
            public float NextActAt;
            public GameObject Body;
        }

        static readonly List<Record> _all = new List<Record>(128);
        static readonly Dictionary<string, Record> _byId = new Dictionary<string, Record>();
        static float _tickAt;
        static Transform _bodyHold;

        /// <summary>LeanPlay Full-body hard cap (SLICE 5). 0 = use default (10 Lean / 48 Full).</summary>
        public static int LeanFullBodyCapOverride;

        public static IReadOnlyList<Record> All => _all;
        public static int Count => _all.Count;

        public static int FullBodyCap
        {
            get
            {
                if (LeanFullBodyCapOverride > 0) return LeanFullBodyCapOverride;
                return ConcordiaHost.LeanPlay ? 10 : 48;
            }
        }

        public static int CountLiveFullBodies()
        {
            int n = 0;
            for (var i = 0; i < _all.Count; i++)
            {
                var r = _all[i];
                if (r == null || !r.Body) continue;
                if (!r.Body.activeInHierarchy) continue;
                if (r.Band < StreamLodBand.Full) continue;
                n++;
            }
            return n;
        }

        public static int CountHubSeeded()
        {
            int n = 0;
            for (var i = 0; i < _all.Count; i++)
            {
                var r = _all[i];
                if (r == null || string.IsNullOrEmpty(r.Id)) continue;
                if (r.Id.StartsWith("hub-", System.StringComparison.Ordinal)) n++;
            }
            return n;
        }

        public static Record Upsert(string id, string name, Vector3 pos, float yaw, NpcLife.Job job, WorldId world)
        {
            if (string.IsNullOrEmpty(id)) id = "npc-" + (_all.Count + 1);
            if (!_byId.TryGetValue(id, out var rec))
            {
                rec = new Record { Id = id };
                _byId[id] = rec;
                _all.Add(rec);
            }
            rec.Name = name ?? id;
            rec.Pos = pos;
            rec.Home = pos;
            rec.Yaw = yaw;
            rec.Job = job;
            rec.World = world;
            return rec;
        }

        public static bool TryGet(string id, out Record rec) => _byId.TryGetValue(id, out rec);

        public static void Remove(string id)
        {
            if (!_byId.TryGetValue(id, out var rec)) return;
            _byId.Remove(id);
            _all.Remove(rec);
        }

        public static void Tick(float now)
        {
            if (now < _tickAt) return;
            _tickAt = now + 0.5f;
            var player = ConcordiaPlayer.Live;
            for (var i = 0; i < _all.Count; i++)
            {
                var r = _all[i];
                if (r == null) continue;
                if (now >= r.NextActAt)
                {
                    r.NextActAt = now + 2.5f + (i % 5) * 0.35f;
                    r.Act = r.Job switch
                    {
                        NpcLife.Job.Stall => "open",
                        NpcLife.Job.Watch => "patrol",
                        NpcLife.Job.Sit => "watch",
                        NpcLife.Job.Sweep => "work",
                        _ => (i + (int)(now * 0.1f)) % 3 == 0 ? "deliver" : "gather"
                    };
                    // Data-only (no body): keep schedule near Home. Live Full bodies own locomotion.
                    if (!r.Body || !r.Body.activeInHierarchy)
                    {
                        var ang = i * 0.7f + now * 0.05f;
                        r.Pos = r.Home + new Vector3(Mathf.Cos(ang) * 2.2f, 0f, Mathf.Sin(ang) * 2.2f);
                    }
                    else if (r.Band >= StreamLodBand.Full)
                    {
                        r.Pos = r.Body.transform.position;
                        var life = r.Body.GetComponent<NpcLife>();
                        if (life) life.act = r.Act;
                    }
                }

                if (!player || r.Band >= StreamLodBand.Full) continue;
                var d = Vector3.Distance(player.transform.position, r.Pos);
                if (d < 28f) TryRematerialize(r);
            }
            FlushRegistry(now);
        }

        /// <summary>Force near-ring rematerialize around a focus (stills / proof). Honors Full cap.</summary>
        public static int RematerializeNear(Vector3 focus, float radius = 28f, int maxSpawn = 8)
        {
            int spawned = 0;
            float r2 = radius * radius;
            for (var i = 0; i < _all.Count && spawned < maxSpawn; i++)
            {
                var r = _all[i];
                if (r == null) continue;
                if ((r.Pos - focus).sqrMagnitude > r2) continue;
                if (r.Band >= StreamLodBand.Full && r.Body && r.Body.activeInHierarchy) continue;
                var before = CountLiveFullBodies();
                TryRematerialize(r);
                if (CountLiveFullBodies() > before) spawned++;
            }
            return spawned;
        }


        static float _flushAt;
        static string RegistryPath
        {
            get
            {
                var root = Application.persistentDataPath;
                if (string.IsNullOrEmpty(root)) root = "/tmp";
                return Path.Combine(root, "concord-stream-cells", "npc-sim.json");
            }
        }

        public static void FlushRegistry(float now)
        {
            if (now < _flushAt) return;
            _flushAt = now + 8f;
            try
            {
                var dir = Path.GetDirectoryName(RegistryPath);
                if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                var sb = new StringBuilder(512 + _all.Count * 96);
                sb.Append("{\"npcs\":[");
                var first = true;
                for (var i = 0; i < _all.Count; i++)
                {
                    var r = _all[i];
                    if (r == null) continue;
                    if (!first) sb.Append(',');
                    first = false;
                    sb.Append("{\"id\":\"").Append(r.Id)
                      .Append("\",\"name\":\"").Append(r.Name)
                      .Append("\",\"act\":\"").Append(r.Act)
                      .Append("\",\"job\":").Append((int)r.Job)
                      .Append(",\"band\":").Append((int)r.Band)
                      .Append(",\"x\":").Append(r.Pos.x.ToString("0.##"))
                      .Append(",\"y\":").Append(r.Pos.y.ToString("0.##"))
                      .Append(",\"z\":").Append(r.Pos.z.ToString("0.##"))
                      .Append(",\"world\":").Append((int)r.World)
                      .Append('}');
                }
                sb.Append("]}");
                File.WriteAllText(RegistryPath, sb.ToString());
            }
            catch { }
        }

        public static void TryRematerialize(Record r)
        {
            if (r == null) return;
            if (r.Body)
            {
                // Already Full + active — no-op promote.
                if (r.Band >= StreamLodBand.Full && r.Body.activeInHierarchy)
                {
                    var presenceOk = r.Body.GetComponent<StreamNpcPresence>()
                                     ?? r.Body.AddComponent<StreamNpcPresence>();
                    presenceOk.BindSimId(r.Id);
                    return;
                }
                // Cap before waking Simulation/Abstract husks into Full.
                if (CountLiveFullBodies() >= FullBodyCap)
                {
                    if (ConcordiaHost.LeanPlay)
                        Debug.Log("[Concordia] LeanPlay: rematerialize SKIP cap id=" + r.Id
                                  + " live=" + CountLiveFullBodies() + "/" + FullBodyCap);
                    return;
                }
                var presence = r.Body.GetComponent<StreamNpcPresence>()
                               ?? r.Body.AddComponent<StreamNpcPresence>();
                presence.BindSimId(r.Id);
                presence.Apply(StreamLodBand.Full);
                r.Band = StreamLodBand.Full;
                if (ConcordiaHost.LeanPlay)
                    Debug.Log("[Concordia] LeanPlay: rematerialize husk id=" + r.Id
                              + " live=" + CountLiveFullBodies() + "/" + FullBodyCap);
                return;
            }
            if (CountLiveFullBodies() >= FullBodyCap)
            {
                if (ConcordiaHost.LeanPlay)
                    Debug.Log("[Concordia] LeanPlay: rematerialize SKIP cap id=" + r.Id
                              + " live=" + CountLiveFullBodies() + "/" + FullBodyCap);
                return;
            }
            var root = ResolveBodyParent(r.World);
            if (!root) return;
            var look = Appearance.Random(r.Name.GetHashCode());
            look.displayName = r.Name;
            var go = ModularPerson.SpawnNpc(root, r.Pos, r.Yaw, look, r.Job == NpcLife.Job.Wander, 6f);
            go.name = r.Name;
            var life = go.GetComponent<NpcLife>() ?? go.AddComponent<NpcLife>();
            life.job = r.Job;
            life.act = r.Act;
            r.Body = go;
            r.Band = StreamLodBand.Full;
            var p = go.GetComponent<StreamNpcPresence>() ?? go.AddComponent<StreamNpcPresence>();
            p.BindSimId(r.Id);
            p.Apply(StreamLodBand.Full);
            if (ConcordiaHost.LeanPlay)
                Debug.Log("[Concordia] LeanPlay: rematerialize NEW id=" + r.Id
                          + " live=" + CountLiveFullBodies() + "/" + FullBodyCap
                          + " pos=" + r.Pos.ToString("F1"));
        }

        /// <summary>Still-proof escape hatch when Lean Full cap blocks TryRematerialize.</summary>
        public static GameObject ForceSpawnBody(Record r)
        {
            if (r == null) return null;
            if (r.Body) return r.Body;
            var root = ResolveBodyParent(r.World);
            if (!root) return null;
            var look = Appearance.Random(r.Name.GetHashCode());
            look.displayName = r.Name;
            var go = ModularPerson.SpawnNpc(root, r.Pos, r.Yaw, look, r.Job == NpcLife.Job.Wander, 6f);
            go.name = r.Name;
            var life = go.GetComponent<NpcLife>() ?? go.AddComponent<NpcLife>();
            life.job = r.Job;
            life.act = r.Act;
            r.Body = go;
            r.Band = StreamLodBand.Full;
            var p = go.GetComponent<StreamNpcPresence>() ?? go.AddComponent<StreamNpcPresence>();
            p.BindSimId(r.Id);
            return go;
        }

        static Transform ResolveBodyParent(WorldId world)
        {
            if (ContinentStream.Live)
            {
                var chunk = ContinentStream.Live.ChunkOf(world);
                if (chunk) return chunk;
                return ContinentStream.Live.transform;
            }
            if (_bodyHold) return _bodyHold;
            var existing = GameObject.Find("DataNpcHold");
            if (existing) { _bodyHold = existing.transform; return _bodyHold; }
            var go = new GameObject("DataNpcHold");
            Object.DontDestroyOnLoad(go);
            _bodyHold = go.transform;
            return _bodyHold;
        }

        public static void ParkFromBody(GameObject go, StreamLodBand band)
        {
            if (!go) return;
            var life = go.GetComponent<NpcLife>();
            var id = go.name;
            var presence = go.GetComponent<StreamNpcPresence>();
            if (presence != null && !string.IsNullOrEmpty(presence.SimId)) id = presence.SimId;
            var world = ConcordiaPlayer.Live ? ConcordiaPlayer.Live.world : WorldClock.World;
            var rec = Upsert(id, go.name, go.transform.position, go.transform.eulerAngles.y,
                life ? life.job : NpcLife.Job.Wander, world);
            rec.Act = life ? life.act : "idle";
            rec.Band = band;
            rec.Body = go; // keep husk — Abstract just deactivates
            if (ConcordiaHost.LeanPlay && (id.StartsWith("hub-", System.StringComparison.Ordinal)
                                          || band <= StreamLodBand.Simulation))
            {
                Debug.Log("[Concordia] LeanPlay: park id=" + id + " band=" + band
                          + " sim=" + Count + " live=" + CountLiveFullBodies());
            }
            WorldStreamManager.Ensure()?.SaveCellBlob(
                StreamCellId.ForWorld(world, StreamCellKind.Settlement),
                "{\"npc\":\"" + rec.Id + "\",\"act\":\"" + rec.Act + "\",\"band\":" + (int)band + "}");
        }
    }
}
