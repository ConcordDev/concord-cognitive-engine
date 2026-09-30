using System;
using System.Collections.Generic;
using System.IO;
using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// Cell kinds the scheduler understands. Workers (ContinentStream, RoadWorld,
    /// RealmFill, interiors) enqueue work tagged by kind — they do not run their
    /// own parallel streaming loops.
    /// </summary>
    public enum StreamCellKind
    {
        Settlement,
        Road,
        Wilderness,
        Interior,
        Impostor,
        NavChunk,
        Systems
    }

    /// <summary>
    /// Four-band streaming LOD (Dutch brief). Maps onto existing SimLod +
    /// ContinentStream impostor/full chunk where possible.
    /// </summary>
    public enum StreamLodBand
    {
        /// <summary>Very far — HLOD / impostors / cheap geometry.</summary>
        Visual = 0,
        /// <summary>Far — settlements/economies/events as data only.</summary>
        Abstract = 1,
        /// <summary>Medium — NPCs as lightweight state, not GameObjects.</summary>
        Simulation = 2,
        /// <summary>Nearby — full fidelity: combat, anim, physics, AI, interiors.</summary>
        Full = 3
    }

    public readonly struct StreamCellId : IEquatable<StreamCellId>
    {
        public readonly WorldId World;
        public readonly StreamCellKind Kind;
        public readonly int Cx;
        public readonly int Cz;

        public StreamCellId(WorldId world, StreamCellKind kind, int cx, int cz)
        {
            World = world;
            Kind = kind;
            Cx = cx;
            Cz = cz;
        }

        public static StreamCellId ForWorld(WorldId world, StreamCellKind kind) =>
            new StreamCellId(world, kind, 0, 0);

        public static StreamCellId FromWorldPos(WorldId world, StreamCellKind kind, Vector3 pos, float cellMeters)
        {
            var m = Mathf.Max(8f, cellMeters);
            return new StreamCellId(world, kind, Mathf.FloorToInt(pos.x / m), Mathf.FloorToInt(pos.z / m));
        }

        public string Key => World + ":" + Kind + ":" + Cx + ":" + Cz;

        public bool Equals(StreamCellId other) =>
            World == other.World && Kind == other.Kind && Cx == other.Cx && Cz == other.Cz;

        public override bool Equals(object obj) => obj is StreamCellId other && Equals(other);
        public override int GetHashCode() => HashCode.Combine(World, Kind, Cx, Cz);
        public override string ToString() => Key;
    }

    public sealed class StreamJob
    {
        public StreamCellId Cell;
        public StreamLodBand TargetBand;
        public int Priority; // higher = sooner (player-ahead boost)
        public string Label;
        public Func<bool> Step; // return true when finished; false = needs another slice
        public float EnqueuedAt;
    }

    /// <summary>
    /// One central streaming scheduler. ContinentStream / RoadWorld / RealmFill
    /// enqueue work here; Update spends a few ms then yields. Prefetches ahead
    /// of the player. Persists lightweight per-cell state under /tmp so unload
    /// does not erase what happened (Play Mode must not thrash Assets/).
    /// </summary>
    public class WorldStreamManager : MonoBehaviour
    {
        public static WorldStreamManager Live { get; private set; }

        /// <summary>Cell size for positional cells (settlement/road/wilderness).</summary>
        public float CellMeters = 64f;

        /// <summary>Milliseconds of streaming work allowed per frame.</summary>
        public float BudgetMs = 3.5f;

        /// <summary>How far ahead (meters) to prefetch Full/Simulation bands.</summary>
        public float PrefetchAheadM = 120f;

        readonly List<StreamJob> _queue = new List<StreamJob>(64);
        readonly Dictionary<string, StreamLodBand> _resident = new Dictionary<string, StreamLodBand>(128);
        readonly Dictionary<string, string> _cellState = new Dictionary<string, string>(128);

        float _prefetchAt;
        int _jobsThisFrame;

        public static WorldStreamManager Ensure(GameObject host = null)
        {
            if (Live) return Live;
            if (!host)
            {
                var go = GameObject.Find("WorldStreamManager");
                if (!go) go = new GameObject("WorldStreamManager");
                host = go;
            }
            var mgr = host.GetComponent<WorldStreamManager>() ?? host.AddComponent<WorldStreamManager>();
            Live = mgr;
            return mgr;
        }

        void OnEnable() => Live = this;
        void OnDisable()
        {
            if (Live == this) Live = null;
        }

        void Update()
        {
            PrefetchIfDue();
            DrainBudget();
            StreamNpcSim.Tick(Time.unscaledTime);
            WildernessWildlife.Tick(Time.unscaledTime);
        }

        /// <summary>Map distance → band. Aligns with SimLod Real/Bulk/Virtual + impostors.</summary>
        public static StreamLodBand BandForDistance(float meters)
        {
            if (meters < 28f) return StreamLodBand.Full;         // ~SimLod.Real
            if (meters < 70f) return StreamLodBand.Simulation;  // ~SimLod.Bulk
            if (meters < ContinentStream.StreamInM) return StreamLodBand.Abstract;
            return StreamLodBand.Visual; // impostor / HLOD
        }

        public static SimLod ToSimLod(StreamLodBand band) => band switch
        {
            StreamLodBand.Full => SimLod.Real,
            StreamLodBand.Simulation => SimLod.Bulk,
            _ => SimLod.Virtual
        };

        public void Enqueue(StreamCellId cell, StreamLodBand target, int priority, string label, Func<bool> step)
        {
            if (step == null) return;
            var key = cell.Key;
            if (_resident.TryGetValue(key, out var have) && have >= target)
                return;
            // Dedupe: keep highest priority pending job for this cell+band
            for (var i = 0; i < _queue.Count; i++)
            {
                var j = _queue[i];
                if (j.Cell.Equals(cell) && j.TargetBand == target)
                {
                    if (priority > j.Priority) j.Priority = priority;
                    return;
                }
            }
            _queue.Add(new StreamJob
            {
                Cell = cell,
                TargetBand = target,
                Priority = priority,
                Label = label ?? key,
                Step = step,
                EnqueuedAt = Time.unscaledTime
            });
        }

        /// <summary>Mark a cell resident at band (after worker finishes a stage).</summary>
        public void MarkResident(StreamCellId cell, StreamLodBand band)
        {
            var key = cell.Key;
            if (_resident.TryGetValue(key, out var have) && have >= band) return;
            _resident[key] = band;
            SaveCellState(cell, band);
        }

        public bool TryGetResident(StreamCellId cell, out StreamLodBand band) =>
            _resident.TryGetValue(cell.Key, out band);

        static string CellStateRoot
        {
            get
            {
                var root = Application.persistentDataPath;
                if (string.IsNullOrEmpty(root)) root = "/tmp";
                return Path.Combine(root, "concord-stream-cells");
            }
        }

        public void SaveCellBlob(StreamCellId cell, string blob)
        {
            if (string.IsNullOrEmpty(blob)) return;
            _cellState[cell.Key] = blob;
            try
            {
                var dir = Path.Combine(CellStateRoot, cell.World.ToString(), cell.Kind.ToString());
                Directory.CreateDirectory(dir);
                File.WriteAllText(Path.Combine(dir, cell.Cx + "_" + cell.Cz + ".json"), blob);
            }
            catch { /* never thrash Assets during Play */ }
        }

        public string LoadCellBlob(StreamCellId cell)
        {
            if (_cellState.TryGetValue(cell.Key, out var mem) && !string.IsNullOrEmpty(mem))
                return mem;
            try
            {
                var path = Path.Combine(CellStateRoot, cell.World.ToString(), cell.Kind.ToString(),
                    cell.Cx + "_" + cell.Cz + ".json");
                if (File.Exists(path))
                {
                    var blob = File.ReadAllText(path);
                    _cellState[cell.Key] = blob;
                    return blob;
                }
            }
            catch { }
            return null;
        }

        void SaveCellState(StreamCellId cell, StreamLodBand band)
        {
            SaveCellBlob(cell, "{\"band\":" + (int)band + ",\"t\":" + Time.unscaledTime.ToString("0.00") + "}");
        }

        void PrefetchIfDue()
        {
            if (Time.unscaledTime < _prefetchAt) return;
            _prefetchAt = Time.unscaledTime + 0.35f;
            var player = ConcordiaPlayer.Live;
            if (!player) return;
            var pos = player.transform.position;
            var world = player.world;
            var ahead = pos;
            if (player.cam)
            {
                var f = player.cam.PlanarForward;
                ahead = pos + f.normalized * PrefetchAheadM;
            }
            // Prefetch settlement + road cells under player and ahead.
            EnqueueVisualPrefetch(world, pos);
            EnqueueVisualPrefetch(world, ahead);
            // Ask ContinentStream to tick LOD (it already budgets RequestFull).
            ContinentStream.Live?.Tick(pos);
        }

        void EnqueueVisualPrefetch(WorldId world, Vector3 pos)
        {
            var settle = StreamCellId.FromWorldPos(world, StreamCellKind.Settlement, pos, CellMeters);
            var road = StreamCellId.FromWorldPos(world, StreamCellKind.Road, pos, CellMeters);
            var nav = StreamCellId.FromWorldPos(world, StreamCellKind.NavChunk, pos, CellMeters);
            // Workers register real Steps; here we only bump desire — ContinentStream owns builds.
            if (!TryGetResident(settle, out var sb) || sb < StreamLodBand.Simulation)
                Enqueue(settle, StreamLodBand.Simulation, 10, "prefetch-settlement", () => true);
            if (!TryGetResident(road, out var rb) || rb < StreamLodBand.Visual)
                Enqueue(road, StreamLodBand.Visual, 5, "prefetch-road", () => true);
            if (!TryGetResident(nav, out var nb) || nb < StreamLodBand.Simulation)
            {
                Enqueue(nav, StreamLodBand.Simulation, 8, "prefetch-nav", () =>
                {
                    var parent = ContinentStream.Live ? ContinentStream.Live.transform : transform;
                    StreamNavChunk.Ensure(nav, parent, pos);
                    return true;
                });
            }
        }

        void DrainBudget()
        {
            if (_queue.Count == 0) return;
            _queue.Sort((a, b) => b.Priority.CompareTo(a.Priority));
            var deadline = Time.realtimeSinceStartupAsDouble + BudgetMs * 0.001;
            _jobsThisFrame = 0;
            while (_queue.Count > 0 && Time.realtimeSinceStartupAsDouble < deadline)
            {
                var job = _queue[0];
                bool done;
                try { done = job.Step(); }
                catch (Exception ex)
                {
                    Debug.LogWarning("[Concordia] WorldStream job failed " + job.Label + ": " + ex.Message);
                    done = true;
                }
                _jobsThisFrame++;
                if (done)
                {
                    _queue.RemoveAt(0);
                    MarkResident(job.Cell, job.TargetBand);
                }
                else
                {
                    // rotate so one sticky job cannot starve the queue
                    _queue.RemoveAt(0);
                    _queue.Add(job);
                    break;
                }
            }
        }

        public int PendingCount => _queue.Count;
        public int JobsLastFrame => _jobsThisFrame;
    }

    /// <summary>Host for RoadWorld.SeedStaged when ContinentStream is not live.</summary>
    public sealed class StreamSeedRunner : MonoBehaviour { }
}