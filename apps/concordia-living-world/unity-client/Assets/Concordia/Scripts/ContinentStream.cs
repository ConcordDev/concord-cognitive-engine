using System.Collections.Generic;
using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// W3 continent streaming. Civilizations stay in one scene. Walking does
    /// not call WorldBuilder.Build. Link gates remain the only teleport.
    /// Far chunks unload. Empty stays empty — a missing pack is not a town.
    /// </summary>
    public class ContinentStream : MonoBehaviour
    {
        public const string TravelMode = "continent_stream";
        public const float StreamInM = 95f;
        public const float StreamOutM = 145f;
        public const float ChunkRadiusM = 52f;

        public static ContinentStream Live { get; private set; }
        public static string LastTravelKind = "boot";

        public Transform continent { get; private set; }
        WorldBuilder _builder;
        readonly Dictionary<WorldId, Transform> _chunks = new Dictionary<WorldId, Transform>();
        Light _sun;

        public static ContinentStream Bind(WorldBuilder builder)
        {
            if (!builder) return null;
            var stream = builder.GetComponent<ContinentStream>() ?? builder.gameObject.AddComponent<ContinentStream>();
            stream._builder = builder;
            Live = stream;
            return stream;
        }

        public void Boot(WorldId start)
        {
            Live = this;
            LastTravelKind = "boot";
            EnsureContinent();
            Ensure(WorldId.Hub);
            if (start != WorldId.Hub) Ensure(start);
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
            foreach (var id in MegaworldMap.All)
            {
                var d = Vector3.Distance(player, MegaworldMap.Present(id));
                if (d <= StreamInM) Ensure(id);
                else if (d >= StreamOutM && id != WorldId.Hub) Release(id);
            }
            if (Vector3.Distance(player, Vector3.zero) >= StreamOutM)
                Release(WorldId.Hub);

            var near = MegaworldMap.Nearest(player);
            var dist = Vector3.Distance(player, MegaworldMap.Present(near));
            if (dist <= ChunkRadiusM + 8f && WorldClock.World != near && IsLoaded(near))
                SoftEnter(near);
        }

        public void Teleport(ConcordiaPlayer player, WorldId next)
        {
            if (!player) return;
            LastTravelKind = "link_gate";
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
            SoftEnter(next);
            player.world = next;
            player.EquipWorldKit();
        }

        public Transform Ensure(WorldId id)
        {
            if (_chunks.TryGetValue(id, out var existing) && existing)
                return existing;
            EnsureContinent();
            var chunk = _builder.BuildChunk(id, continent);
            if (!chunk) return null;
            chunk.position = MegaworldMap.Present(id);
            _chunks[id] = chunk;
            return chunk;
        }

        void Release(WorldId id)
        {
            if (!_chunks.TryGetValue(id, out var chunk) || !chunk) return;
            Object.Destroy(chunk.gameObject);
            _chunks.Remove(id);
        }

        void SoftEnter(WorldId id)
        {
            if (WorldClock.World == id) return;
            LastTravelKind = LastTravelKind == "link_gate" ? "link_gate" : "walk";
            WorldClock.Leave();
            WorldClock.Enter(id);
            ApplySky(id);
            ModularPerson.CastingWorld = id;
            if (LastTravelKind != "link_gate")
            {
                var w = Canon.Get(id);
                ConcordiaHUD.Announce(w.title, w.refusal);
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
            MakeSun();
        }

        void MakeGround()
        {
            if (continent.Find("ContinentGround")) return;
            var g = GameObject.CreatePrimitive(PrimitiveType.Plane);
            g.name = "ContinentGround";
            g.transform.SetParent(continent, false);
            g.transform.localScale = Vector3.one * 62f;
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
        }

        void OnDisable()
        {
            if (Live == this) Live = null;
        }
    }
}
