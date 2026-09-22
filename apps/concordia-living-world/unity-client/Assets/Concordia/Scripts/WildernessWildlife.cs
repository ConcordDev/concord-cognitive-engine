using System.Collections.Generic;
using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// SLICE 7 — LeanPlay wildlife outside Hub metro. Data rows are the source of
    /// truth; ≤ few live Quaternius/Fauna bodies rematerialize near the player
    /// (same data≠GameObject rule as StreamNpcSim). Far/medium stay as records.
    /// </summary>
    public static class WildernessWildlife
    {
        public sealed class Record
        {
            public string Id;
            public string Kind; // fox | wolf | bird
            public Vector3 Pos;
            public float Yaw;
            public GameObject Body;
        }

        static readonly List<Record> _all = new List<Record>(32);
        static float _tickAt;
        static Transform _hold;

        public static int SeedCount => _all.Count;
        public static int LiveCount
        {
            get
            {
                int n = 0;
                for (int i = 0; i < _all.Count; i++)
                {
                    var r = _all[i];
                    if (r != null && r.Body && r.Body.activeInHierarchy) n++;
                }
                return n;
            }
        }

        public static int LiveCap => ConcordiaHost.LeanPlay ? 3 : 6;
        public static float RematRangeM => ConcordiaHost.LeanPlay ? 32f : 48f;
        public static float CollapseRangeM => RematRangeM + 18f;

        public static void Clear()
        {
            for (int i = 0; i < _all.Count; i++)
            {
                var r = _all[i];
                if (r?.Body)
                {
                    if (Application.isPlaying) Object.Destroy(r.Body);
                    else Object.DestroyImmediate(r.Body);
                }
            }
            _all.Clear();
            if (_hold)
            {
                if (Application.isPlaying) Object.Destroy(_hold.gameObject);
                else Object.DestroyImmediate(_hold.gameObject);
                _hold = null;
            }
        }

        /// <summary>Seed data-only fauna at wilderness cluster positions. Idempotent per Ensure force.</summary>
        public static int Seed(IReadOnlyList<Vector3> sites)
        {
            Clear();
            if (sites == null || sites.Count == 0) return 0;
            EnsureHold();
            string[] kinds = { "fox", "wolf", "bird", "fox", "bird", "wolf", "bird", "fox" };
            int n = ConcordiaHost.LeanPlay
                ? Mathf.Min(12, sites.Count)
                : Mathf.Min(18, sites.Count);
            for (int i = 0; i < n; i++)
            {
                var p = sites[i % sites.Count];
                // Slight scatter so animals aren't glued to tree trunks.
                float ang = i * 1.7f;
                p += new Vector3(Mathf.Cos(ang) * 2.4f, 0f, Mathf.Sin(ang) * 2.4f);
                _all.Add(new Record
                {
                    Id = "wild-fauna-" + i,
                    Kind = kinds[i % kinds.Length],
                    Pos = p,
                    Yaw = i * 47f
                });
            }
            Debug.Log("[Concordia] WildernessWildlife seed=" + _all.Count + " live=0");
            return _all.Count;
        }

        public static void Tick(float now)
        {
            if (_all.Count == 0) return;
            if (now < _tickAt) return;
            _tickAt = now + 0.55f;

            var player = ConcordiaPlayer.Live;
            Vector3 focus = player ? player.transform.position : Vector3.zero;
            float remat2 = RematRangeM * RematRangeM;
            float collapse2 = CollapseRangeM * CollapseRangeM;

            // Collapse far live bodies first (free cap).
            for (int i = 0; i < _all.Count; i++)
            {
                var r = _all[i];
                if (r == null || !r.Body) continue;
                if ((r.Body.transform.position - focus).sqrMagnitude > collapse2)
                    Collapse(r);
            }

            if (!player) return;
            int live = LiveCount;
            for (int i = 0; i < _all.Count && live < LiveCap; i++)
            {
                var r = _all[i];
                if (r == null || (r.Body && r.Body.activeInHierarchy)) continue;
                if ((r.Pos - focus).sqrMagnitude > remat2) continue;
                if (TryRematerialize(r)) live++;
            }
        }

        /// <summary>Still-proof: force a few live animals near a camera focus.</summary>
        public static int RematerializeNear(Vector3 focus, float radius = 40f, int maxSpawn = 3)
        {
            int spawned = 0;
            float r2 = radius * radius;
            for (int i = 0; i < _all.Count && spawned < maxSpawn; i++)
            {
                var r = _all[i];
                if (r == null) continue;
                if ((r.Pos - focus).sqrMagnitude > r2) continue;
                if (r.Body && r.Body.activeInHierarchy) { spawned++; continue; }
                if (LiveCount >= LiveCap && spawned == 0)
                {
                    // Free one far body so stills can show wildlife.
                    for (int j = 0; j < _all.Count; j++)
                    {
                        var o = _all[j];
                        if (o?.Body && o.Body.activeInHierarchy
                            && (o.Pos - focus).sqrMagnitude > r2)
                        {
                            Collapse(o);
                            break;
                        }
                    }
                }
                if (LiveCount >= LiveCap) break;
                if (TryRematerialize(r)) spawned++;
            }
            Debug.Log("[Concordia] WildernessWildlife seed=" + _all.Count
                      + " live=" + LiveCount + " rematNear=" + spawned);
            return spawned;
        }

        static bool TryRematerialize(Record r)
        {
            if (r == null) return false;
            if (r.Body && r.Body.activeInHierarchy) return true;
            if (LiveCount >= LiveCap) return false;
            EnsureHold();
            var world = Canon.Get(WorldId.Hub);
            GameObject go = null;
            if (r.Kind == "bird")
            {
                var bird = DressVocab.Bird();
                if (string.IsNullOrEmpty(bird)) bird = FreePacks.HasStem("bird") ? "bird"
                    : (FreePacks.HasStem("Eagle") ? "Eagle" : null);
                if (!string.IsNullOrEmpty(bird))
                {
                    go = CreatureCompiler.Compile(_hold, new CreatureCard
                    {
                        id = r.Id,
                        speciesId = bird,
                        topology = "winged_biped",
                        generation = 0,
                        fly = true,
                        lifestyle = "omnivore",
                    }, r.Pos, world);
                    if (go)
                    {
                        var orbit = go.GetComponent<FlockOrbit>() ?? go.AddComponent<FlockOrbit>();
                        orbit.radius = 6f + (r.Id.GetHashCode() & 7);
                        orbit.height = 4.5f + (r.Id.GetHashCode() & 3);
                    }
                }
            }
            else
            {
                go = CreatureCompiler.FromKind(_hold, r.Kind, r.Pos, world);
            }
            if (!go) return false;
            go.name = "WildFauna_" + r.Kind + "_" + r.Id;
            go.transform.rotation = Quaternion.Euler(0f, r.Yaw, 0f);
            FreePacks.Sit(go, r.Pos);
            FreePacks.PaintIfBlank(go);
            r.Body = go;
            r.Pos = go.transform.position;
            return true;
        }

        static void Collapse(Record r)
        {
            if (r == null || !r.Body) return;
            r.Pos = r.Body.transform.position;
            if (Application.isPlaying) Object.Destroy(r.Body);
            else Object.DestroyImmediate(r.Body);
            r.Body = null;
        }

        static void EnsureHold()
        {
            if (_hold) return;
            var existing = GameObject.Find("WildernessWildlifeHold");
            if (existing) { _hold = existing.transform; return; }
            var go = new GameObject("WildernessWildlifeHold");
            var mega = GameObject.Find("Megaworld");
            if (mega) go.transform.SetParent(mega.transform, false);
            _hold = go.transform;
        }
    }
}
