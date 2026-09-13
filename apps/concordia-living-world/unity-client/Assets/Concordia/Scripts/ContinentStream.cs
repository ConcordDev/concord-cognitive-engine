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
            foreach (var id in MegaworldMap.All)
            {
                if (id == WorldId.Hub || id == start) continue;
                EnsureImpostor(id);
            }
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
                if (id == WorldId.Hub) continue;
                var d = Vector3.Distance(player, MegaworldMap.Present(id));
                var lod = LodOf(d);
                if (lod >= 2) Ensure(id, lod);
                else if (lod == 1) EnsureImpostor(id);
                else Release(id);
            }
            if (Vector3.Distance(player, Vector3.zero) <= HubKeepM) Ensure(WorldId.Hub);
            else Release(WorldId.Hub);

            if (Canon.InHubCourt(player))
                SoftEnter(WorldId.Hub);
            else
                SoftEnter(MegaworldMap.Toward(player));
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
            player.world = next;
            SoftEnter(next);
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

        public void SoftEnter(WorldId id)
        {
            var player = ConcordiaPlayer.Live ?? Object.FindFirstObjectByType<ConcordiaPlayer>();
            var clockSame = WorldClock.World == id;
            var playerSame = !player || player.world == id;
            if (clockSame && playerSame) return;
            LastTravelKind = LastTravelKind == "link_gate" ? "link_gate" : "walk";
            if (!clockSame)
            {
                WorldClock.Leave();
                WorldClock.Enter(id);
            }
            ApplySky(id);
            ModularPerson.CastingWorld = id;
            if (player && player.world != id)
            {
                player.world = id;
                player.EquipWorldKit();
            }
            var game = ConcordiaGame.Live;
            if (game) game.world = id;
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
            if (continent.Find("ContinentWilderness")) return;
            var hold = new GameObject("ContinentWilderness").transform;
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
                    var prim = (h % 3 == 0) ? PrimitiveType.Sphere : PrimitiveType.Cube;
                    HubLook.Prim(hold, prim, hill + Vector3.up * (ht * 0.45f),
                        new Vector3(w, ht, w * 0.85f), earth, "Hill_" + g.shortName + "_" + i);

                    var rockAt = p - side * (3.4f + (h % 5) * 0.6f);
                    var rock = FreePacks.Spawn(DressVocab.Rock(), hold, rockAt, (h % 360), 1.1f + (h % 4) * 0.25f, required: false);
                    if (!rock)
                        HubLook.Prim(hold, PrimitiveType.Cube, rockAt + Vector3.up * 0.35f,
                            new Vector3(1.1f, 0.7f, 0.9f), stone, "Rock_" + g.shortName + "_" + i);

                    if (i % 2 != 0) continue;
                    var mark = p + Vector3.up * 0.08f;
                    var left = Mathf.Max(0f, dest.magnitude - along);
                    HubLook.Prim(hold, PrimitiveType.Cube, mark + Vector3.up * 0.85f,
                        new Vector3(0.22f, 1.7f, 0.22f), stone, "Mark_" + g.shortName + "_" + i);
                    var label = new GameObject("Sign_" + g.shortName + "_" + i).AddComponent<TextMesh>();
                    label.transform.SetParent(hold, false);
                    label.transform.position = mark + Vector3.up * 2.05f;
                    label.transform.rotation = Quaternion.LookRotation(-dir, Vector3.up);
                    label.text = g.shortName + "  ·  " + Mathf.RoundToInt(left) + "m";
                    label.fontSize = 36;
                    label.characterSize = 0.07f;
                    label.anchor = TextAnchor.MiddleCenter;
                    label.alignment = TextAlignment.Center;
                    label.color = Color.Lerp(g.color, Color.white, 0.35f);
                    HubLook.DressTextMesh(label);
                }
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

        void OnDisable()
        {
            if (Live == this) Live = null;
        }
    }
}
