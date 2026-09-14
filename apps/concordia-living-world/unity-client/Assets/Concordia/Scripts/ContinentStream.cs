using System.Collections.Generic;
using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// W3 continent streaming. Civilizations stay in one scene. Walking does
    /// not call WorldBuilder.Build. Link gates remain the only teleport.
    /// Far chunks unload. Empty stays empty — a missing pack is not a town.
    /// Impostors stay visible from the Hub so leave-Hub is not a barren void.
    /// </summary>
    public class ContinentStream : MonoBehaviour
    {
        public const string TravelMode = "continent_stream";
        /// <summary>Full chunk when this close to a civilization present point.</summary>
        public const float StreamInM = 175f;
        /// <summary>Wider than MegaworldMap.RingMeters so Hub sees every impostor, including Sere.</summary>
        public const float StreamOutM = 360f;
        public const float L3NearM = 55f;
        public const float ChunkRadiusM = 52f;
        /// <summary>Hub chunk stays until the player is well onto a road.</summary>
        public const float HubKeepM = 125f;

        public static ContinentStream Live { get; private set; }
        public static string LastTravelKind = "boot";

        public Transform continent { get; private set; }
        WorldBuilder _builder;
        readonly Dictionary<WorldId, Transform> _chunks = new Dictionary<WorldId, Transform>();
        readonly Dictionary<WorldId, int> _lod = new Dictionary<WorldId, int>();
        Light _sun;
        bool _roadLife;

        public static int LodOf(float dist)
        {
            if (dist >= StreamOutM) return 0;
            if (dist > StreamInM) return 1;
            if (dist > L3NearM) return 2;
            return 3;
        }

        public static ContinentStream Bind(WorldBuilder builder)
        {
            if (!builder) return null;
            var stream = builder.GetComponent<ContinentStream>() ?? builder.gameObject.AddComponent<ContinentStream>();
            stream._builder = builder;
            if (!stream.enabled) stream.enabled = true;
            Live = stream;
            return stream;
        }

        void OnEnable()
        {
            Live = this;
        }

        public void Boot(WorldId start)
        {
            Live = this;
            LastTravelKind = "boot";
            EnsureContinent();
            Ensure(WorldId.Hub);
            if (start != WorldId.Hub) Ensure(start);
            // Full boot paints every civilization impostor at once — OOM on 16GB
            // Macs under Ollama thrash. LeanPlay loads impostors on Tick approach.
            if (ConcordiaHost.BootContinentImpostors)
            {
                foreach (var id in MegaworldMap.All)
                {
                    if (id == WorldId.Hub || id == start) continue;
                    EnsureImpostor(id);
                }
            }
            else
                Debug.Log("[Concordia] LeanPlay: defer continent impostors until approach");
            ApplySky(start);
        }

        public bool IsLoaded(WorldId id) => _chunks.TryGetValue(id, out var t) && t;

        public Transform ChunkOf(WorldId id) =>
            _chunks.TryGetValue(id, out var t) && t ? t : null;

        public bool InPresenter(Vector3 present)
        {
            foreach (var kv in _chunks)
            {
                if (!kv.Value) continue;
                if ((present - MegaworldMap.Present(kv.Key)).sqrMagnitude <= ChunkRadiusM * ChunkRadiusM)
                    return true;
            }
            return false;
        }

        public void Tick(Vector3 player)
        {
            // Law of the land first, and also from the body (ReceiveHere)
            // so a walked Present cannot stay Hub because Ensure hitch.
            ReceiveHere(player);

            // LeanPlay: one new far-lod per Tick, Toward first. Loading all
            // eight impostors on frame 1 froze Play (Time.time stuck at 0).
            var toward = MegaworldMap.Toward(player);
            int built = 0;
            int budget = ConcordiaHost.LeanPlay ? 1 : 8;
            foreach (var id in MegaworldMap.All)
            {
                if (id == WorldId.Hub) continue;
                try
                {
                    var d = Vector3.Distance(player, MegaworldMap.Present(id));
                    var lod = LodOf(d);
                    var have = _chunks.TryGetValue(id, out var live) && live;
                    if (lod >= 2)
                    {
                        if (have || built < budget) { Ensure(id, lod); if (!have) built++; }
                    }
                    else if (lod == 1)
                    {
                        if (have) EnsureImpostor(id);
                        else if (built < budget && (id == toward || !ConcordiaHost.LeanPlay))
                        {
                            EnsureImpostor(id);
                            built++;
                        }
                    }
                    else Release(id);
                }
                catch (System.Exception e)
                {
                    Debug.LogException(e);
                }
            }
            // Hub Ring of 8 stays. Travel to Present (~220m) used to
            // Release Hub past HubKeepM and leave one return WorldGate.
            try { Ensure(WorldId.Hub); }
            catch (System.Exception e) { Debug.LogException(e); }
            if (!_roadLife && continent)
            {
                try
                {
                    MakeWilderness();
                    _roadLife = true;
                }
                catch (System.Exception e)
                {
                    Debug.LogException(e);
                }
            }
        }

        /// <summary>
        /// The land underfoot is this stream's job — not ConcordiaGame.Update,
        /// which used to skip Tick while the creator overlay was open so you
        /// could stand in Fantasy Present with world still Hub.
        /// </summary>
        void LateUpdate()
        {
            var p = ConcordiaPlayer.Live;
            if (!p || p.creatorLocked) return;
            Tick(p.transform.position);
        }

        public void Teleport(ConcordiaPlayer player, WorldId next)
        {
            if (!player) return;
            LastTravelKind = "link_gate";
            Ensure(WorldId.Hub);
            Ensure(next);
            var spawn = MegaworldMap.Present(next);
            if (next == WorldId.Hub) spawn = Canon.Spawn;
            else spawn += new Vector3(0f, 0.12f, 2f);
            player.cc.enabled = false;
            player.transform.position = spawn;
            player.transform.rotation = Quaternion.Euler(0f, 180f, 0f);
            player.cc.enabled = true;
            if (player.cam) player.cam.yaw = Mathf.PI;
            Grounding.Snap(player.cc);
            player.world = next;
            SoftEnter(next, "link_gate");
            player.EquipWorldKit();
        }

        public Transform Ensure(WorldId id, int lod = 2)
        {
            if (_lod.TryGetValue(id, out var have) && have >= 2 && _chunks.TryGetValue(id, out var live) && live)
            {
                _lod[id] = lod < 2 ? 2 : lod;
                return live;
            }
            if (_chunks.TryGetValue(id, out var existing) && existing)
            {
                if (have >= 2) return existing;
                Release(id);
            }
            EnsureContinent();
            var chunk = _builder.BuildChunk(id, continent);
            if (!chunk) return null;
            chunk.position = MegaworldMap.Present(id);
            _chunks[id] = chunk;
            _lod[id] = lod < 2 ? 2 : lod;
            return chunk;
        }

        Transform EnsureImpostor(WorldId id)
        {
            if (_lod.TryGetValue(id, out var have) && have >= 2 && _chunks.TryGetValue(id, out var full) && full)
                return full;
            if (_lod.TryGetValue(id, out var lod) && lod == 1 && _chunks.TryGetValue(id, out var existing) && existing)
                return existing;
            if (_chunks.TryGetValue(id, out var stale) && stale) Release(id);
            EnsureContinent();
            var chunk = _builder.BuildImpostor(id, continent);
            if (!chunk) return null;
            chunk.position = MegaworldMap.Present(id);
            _chunks[id] = chunk;
            _lod[id] = 1;
            return chunk;
        }

        void Release(WorldId id)
        {
            if (!_chunks.TryGetValue(id, out var chunk) || !chunk) return;
            Object.Destroy(chunk.gameObject);
            _chunks.Remove(id);
            _lod.Remove(id);
        }

        /// <summary>
        /// Sky, kit, clock, journey stamp. Cheap. The body calls this after
        /// Move so receive does not wait on chunk Ensure. Stand() calls it
        /// so a warp without a frame still takes you.
        /// </summary>
        public void ReceiveHere(Vector3 player)
        {
            var next = Canon.InHubCourt(player)
                ? WorldId.Hub
                : MegaworldMap.RegionAt(player);
            SoftEnter(next);
            RoadWorld.TickNear(player);
        }

        /// <summary>
        /// Walk-in and debug teleports. Always writes ConcordiaPlayer.world
        /// and kit first — WorldClock matching is not enough (Editor proof:
        /// clock Fantasy, player.world still Hub, steel false).
        /// </summary>
        public void SoftEnter(WorldId id, string kind = "walk")
        {
            string journey = null;
            if (WorldClock.World != id)
            {
                if (id == WorldId.Hub)
                    journey = "You came home from " + Canon.Get(WorldClock.World).title + ".";
                else if (WorldClock.World == WorldId.Hub)
                    journey = "You left Hub for " + Canon.Get(id).title + ".";
                else
                    journey = "You crossed into " + Canon.Get(id).title + ".";
            }
            SyncActor(id);
            if (WorldClock.World == id) return;
            LastTravelKind = kind;
            WorldClock.Leave();
            WorldClock.Enter(id);
            if (!string.IsNullOrEmpty(journey))
                WorldClock.LastEvent = journey;
            try { ApplySky(id); }
            catch (System.Exception e) { Debug.LogException(e); }
            ModularPerson.CastingWorld = id;
            var player = ConcordiaPlayer.Live;
            if (player) player.world = id;
            var game = Object.FindAnyObjectByType<ConcordiaGame>();
            if (game) game.world = id;
            if (LastTravelKind != "link_gate")
            {
                var w = Canon.Get(id);
                ConcordiaHUD.Announce(w.title, w.refusal);
            }
            try { ReceiveTraveler(id); }
            catch (System.Exception e) { Debug.LogException(e); }
        }

        /// <summary>
        /// Arrival is being noticed — not a title card. Empty land stays empty.
        /// </summary>
        static void ReceiveTraveler(WorldId id)
        {
            var player = ConcordiaPlayer.Live;
            if (!player) return;
            int n = 0;
            foreach (var life in Object.FindObjectsByType<NpcLife>(FindObjectsInactive.Exclude))
            {
                if (!life) continue;
                if (Vector3.Distance(life.transform.position, player.transform.position) > 14f) continue;
                life.NoticePlayer(5f);
                n++;
            }
            if (id == WorldId.Hub && !string.IsNullOrEmpty(WorldClock.LastEvent))
                player.Notice("They still talk about: " + WorldClock.LastEvent);
            else if (n > 0)
                player.Notice(Canon.Get(id).title + " received you.");
            else if (id != WorldId.Hub)
                player.Notice(Canon.Get(id).title + " is quiet. No one here yet.");
        }

        static void SyncActor(WorldId id)
        {
            var player = ConcordiaPlayer.Live;
            if (!player)
            {
                var all = Object.FindObjectsByType<ConcordiaPlayer>(FindObjectsInactive.Include, FindObjectsSortMode.None);
                if (all != null && all.Length > 0) player = all[0];
            }
            var changed = false;
            if (player)
            {
                changed = player.world != id;
                player.world = id;
                if (changed) player.EquipWorldKit();
            }
            var game = ConcordiaGame.Live ?? Object.FindFirstObjectByType<ConcordiaGame>();
            if (game)
            {
                if (changed || game.world != id) game.NoteWorld(id);
                else game.world = id;
            }
        }

        void EnsureContinent()
        {
            if (continent) return;
            var go = GameObject.Find("Megaworld");
            continent = go ? go.transform : new GameObject("Megaworld").transform;
            continent.position = Vector3.zero;
            MakeGround();
            MakeRoads();
            MakeWilderness();
            MakeSun();
        }

        void MakeGround()
        {
            if (continent.Find("ContinentGround")) return;
            var g = GameObject.CreatePrimitive(PrimitiveType.Plane);
            g.name = "ContinentGround";
            g.transform.SetParent(continent, false);
            g.transform.localScale = Vector3.one * 72f;
            var mat = HubLook.Pbr("packed_earth", new Color(0.42f, 0.38f, 0.32f), 0.05f, 0.22f, 28f);
            var r = g.GetComponent<Renderer>();
            if (r && mat) r.sharedMaterial = mat;
        }

        void MakeRoads()
        {
            if (continent.Find("ContinentRoads")) return;
            var hold = new GameObject("ContinentRoads").transform;
            hold.SetParent(continent, false);
            foreach (var g in Canon.Gates)
            {
                var dest = MegaworldMap.Present(g.world);
                var from = dest.normalized * (Canon.RingRadius + 2f);
                var mid = (from + dest) * 0.5f;
                var len = Vector3.Distance(from, dest);
                if (len < 4f) continue;
                var road = GameObject.CreatePrimitive(PrimitiveType.Cube);
                road.name = "Road_" + g.shortName;
                road.transform.SetParent(hold, false);
                road.transform.position = mid + Vector3.up * 0.03f;
                road.transform.rotation = Quaternion.LookRotation(dest - from, Vector3.up);
                road.transform.localScale = new Vector3(3.2f, 0.06f, len);
                var mat = HubLook.Pbr("packed_earth", g.color * 0.35f, 0.08f, 0.18f, 8f);
                var rr = road.GetComponent<Renderer>();
                if (rr && mat) rr.sharedMaterial = mat;
            }
        }

        /// <summary>
        /// Rocks, hills, and road marks between the Hub ring and each
        /// civilization. Not towns. A missing pack stays a primitive.
        /// </summary>
        void MakeWilderness()
        {
            var hold = continent.Find("ContinentWilderness");
            if (!hold)
            {
                hold = new GameObject("ContinentWilderness").transform;
                hold.SetParent(continent, false);
                var earth = HubLook.Pbr("packed_earth", new Color(0.38f, 0.33f, 0.26f), 0.06f, 0.28f, 16f);
                var stone = HubLook.Pbr("stone_tiles", new Color(0.46f, 0.42f, 0.36f), 0.04f, 0.22f, 12f);
                foreach (var g in Canon.Gates)
                {
                    var dest = MegaworldMap.Present(g.world);
                    if (dest.sqrMagnitude < 4f) continue;
                    var dir = dest.normalized;
                    var side = Vector3.Cross(Vector3.up, dir);
                    var span = dest.magnitude - Canon.RingRadius - ChunkRadiusM;
                    if (span < 12f) continue;
                    int n = Mathf.Max(4, Mathf.FloorToInt(span / 16f));
                    for (int i = 0; i < n; i++)
                    {
                        float t = (i + 1f) / (n + 1f);
                        float along = Canon.RingRadius + 10f + t * span;
                        var p = dir * along;
                        int h = StemHash(g.shortName, i);
                        float off = ((h % 1000) / 1000f - 0.5f) * 14f;
                        var hill = p + side * (5.5f + off);
                        float ht = 1.6f + (h % 7) * 0.85f;
                        float w = 3.2f + (h % 5) * 0.7f;
                        if (Canon.BlocksSunderingWalk(hill, w * 0.5f)) continue;
                        var prim = (h % 3 == 0) ? PrimitiveType.Sphere : PrimitiveType.Cube;
                        HubLook.Prim(hold, prim, hill + Vector3.up * (ht * 0.45f),
                            new Vector3(w, ht, w * 0.85f), earth, "Hill_" + g.shortName + "_" + i);

                        var rockAt = p - side * (3.4f + (h % 5) * 0.6f);
                        var rock = FreePacks.Spawn(DressVocab.Rock(), hold, rockAt, (h % 360), 1.1f + (h % 4) * 0.25f, required: false);
                        if (!rock)
                            HubLook.Prim(hold, PrimitiveType.Cube, rockAt + Vector3.up * 0.35f,
                                new Vector3(1.1f, 0.7f, 0.9f), stone, "Rock_" + g.shortName + "_" + i);

                        if (i % 2 != 0) continue;
                        var left = Mathf.Max(0f, dest.magnitude - along);
                        RoadWorld.PlaceSign(hold, g, p, dir, i, left);
                    }
                }
            }
            ClearSunderingWalk(hold);
            RoadWorld.Seed(hold);
        }

        /// <summary>
        /// Scene leftovers or a skip that didn't fire still cannot sit in the
        /// +Z stride. Do not disable ContinentGround to walk past them.
        /// </summary>
        static void ClearSunderingWalk(Transform hold)
        {
            if (!hold) return;
            for (int i = hold.childCount - 1; i >= 0; i--)
            {
                var c = hold.GetChild(i);
                if (!c) continue;
                if (!c.name.StartsWith("Hill_") && !c.name.StartsWith("Rock_")) continue;
                float half = Mathf.Max(c.lossyScale.x, c.lossyScale.z) * 0.5f;
                if (Canon.BlocksSunderingWalk(c.position, half))
                    Object.DestroyImmediate(c.gameObject);
            }
        }

        static int StemHash(string s, int i)
        {
            int h = 17;
            if (!string.IsNullOrEmpty(s))
                for (int n = 0; n < s.Length; n++) h = h * 31 + s[n];
            return (h ^ (i * 7919)) & 0x7fffffff;
        }

        void MakeSun()
        {
            if (_sun) return;
            var go = new GameObject("ContinentSun");
            go.transform.SetParent(continent, false);
            go.transform.rotation = Quaternion.Euler(42f, -38f, 0f);
            _sun = go.AddComponent<Light>();
            _sun.type = LightType.Directional;
            _sun.color = new Color(1f, 0.94f, 0.82f);
            _sun.intensity = 1.18f;
            _sun.shadows = LightShadows.Soft;
        }

        void ApplySky(WorldId id)
        {
            _builder.DressChunkSky(id);
            if (_sun)
            {
                var w = Canon.Get(id);
                _sun.color = Color.Lerp(new Color(1f, 0.94f, 0.82f), w.sun, 0.45f);
            }
            if (Camera.main) Camera.main.farClipPlane = 420f;
        }

        void OnDestroy()
        {
            if (Live == this) Live = null;
        }
    }
}
