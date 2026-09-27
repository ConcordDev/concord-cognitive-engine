using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// Player side of the shared-world host (World lens step 3). While a host is
    /// live for this world, the player's own locally-simulated NPCs are hidden
    /// and the HOST's NPCs are rendered instead — so every player sees the same
    /// people in the same places, whatever their device. When the host goes
    /// offline, local NPCs come back (never an empty or frozen world).
    /// Positions are the host's; this only presents them.
    /// </summary>
    public class WorldHostClient : MonoBehaviour
    {
        [Serializable] class ManifestEntity { public string id, name, kind, look; }
        [Serializable] class ManifestData { public string worldId; public bool append; public bool hostLive = true; public ManifestEntity[] entities; }
        [Serializable] class ManifestMsg { public ManifestData data; }
        [Serializable] class SnapEntity { public string id; public float x, y, z, yaw, speed; public string act; }
        [Serializable] class SnapData { public string worldId; public SnapEntity[] entities; }
        [Serializable] class SnapMsg { public SnapData data; }

        class Proxy
        {
            public GameObject go;
            public ModularPerson person;
            public Vector3 target;
            public Vector3 vel;
            public float yaw, speed;
            public bool placed;
        }

        const float HostSilenceSeconds = 8f;

        ConcordClient _client;
        readonly ConcurrentQueue<Action> _inbox = new ConcurrentQueue<Action>();
        readonly Dictionary<string, Proxy> _proxies = new Dictionary<string, Proxy>();
        readonly List<GameObject> _hiddenLocals = new List<GameObject>();
        bool _hostLive;
        float _lastHostFrame;
        float _nextRequest;

        public static bool HostLive { get; private set; }
        public static int ProxyCount { get; private set; }

        public static void Install(ConcordClient client)
        {
            if (client == null || FindAnyObjectByType<WorldHostClient>()) return;
            var go = new GameObject("WorldHostClient");
            var c = go.AddComponent<WorldHostClient>();
            c._client = client;
            client.OnEvent += c.OnKernelEvent;
        }

        // May run off the main thread — parse, then queue work for Update.
        void OnKernelEvent(string evt, string text)
        {
            if (evt == null) return;
            try
            {
                if (evt.EndsWith("world:manifest", StringComparison.Ordinal))
                {
                    var m = JsonUtility.FromJson<ManifestMsg>(text)?.data;
                    if (m != null) _inbox.Enqueue(() => ApplyManifest(m));
                }
                else if (evt.EndsWith("world:entities", StringComparison.Ordinal))
                {
                    var s = JsonUtility.FromJson<SnapMsg>(text)?.data;
                    if (s != null) _inbox.Enqueue(() => ApplySnapshot(s));
                }
                else if (evt.EndsWith("world:host-offline", StringComparison.Ordinal))
                {
                    _inbox.Enqueue(GoLocal);
                }
                else if (evt.EndsWith("world:host-online", StringComparison.Ordinal))
                {
                    _inbox.Enqueue(() => _nextRequest = 0f);
                }
            }
            catch { /* malformed frame — ignore */ }
        }

        void OnDestroy()
        {
            if (_client) _client.OnEvent -= OnKernelEvent;
        }

        bool ForThisWorld(string worldId) =>
            string.IsNullOrEmpty(worldId) || _client == null || worldId == _client.WorldId;

        void Update()
        {
            while (_inbox.TryDequeue(out var a)) { try { a(); } catch (Exception e) { Debug.LogWarning("[WorldHostClient] " + e.Message); } }

            // Ask for the current population on join (and again if a host appears).
            if (!_hostLive && _client != null && _client.Ready && Time.realtimeSinceStartup >= _nextRequest)
            {
                _nextRequest = Time.realtimeSinceStartup + 15f;
                _ = _client.SendRaw("world:manifest:request", "{\"worldId\":\"" + _client.WorldId + "\"}");
            }
            if (_hostLive && Time.realtimeSinceStartup - _lastHostFrame > HostSilenceSeconds) GoLocal();

            foreach (var p in _proxies.Values)
            {
                if (!p.go || !p.placed) continue;
                var t = p.go.transform;
                var pos = t.position;
                t.position = (p.target - pos).sqrMagnitude > 400f ? p.target : Vector3.SmoothDamp(pos, p.target, ref p.vel, 0.18f);
                t.rotation = Quaternion.Slerp(t.rotation, Quaternion.Euler(0f, p.yaw, 0f), Time.deltaTime * 8f);
                p.person?.SetGait(p.speed, true);
            }
        }

        void ApplyManifest(ManifestData m)
        {
            if (!ForThisWorld(m.worldId)) return;
            if (!m.hostLive || m.entities == null) { if (_hostLive && !m.append) GoLocal(); return; }
            if (!_hostLive) GoHosted();
            _lastHostFrame = Time.realtimeSinceStartup;
            var seen = new HashSet<string>();
            foreach (var e in m.entities)
            {
                if (e == null || string.IsNullOrEmpty(e.id)) continue;
                seen.Add(e.id);
                if (_proxies.ContainsKey(e.id)) continue;
                var p = Spawn(e);
                if (p != null) _proxies[e.id] = p;
            }
            // A full (non-append) manifest is the whole population: drop anyone gone.
            if (!m.append)
            {
                var gone = new List<string>();
                foreach (var id in _proxies.Keys) if (!seen.Contains(id)) gone.Add(id);
                foreach (var id in gone) { if (_proxies[id].go) Destroy(_proxies[id].go); _proxies.Remove(id); }
            }
            ProxyCount = _proxies.Count;
        }

        void ApplySnapshot(SnapData s)
        {
            if (!ForThisWorld(s.worldId) || s.entities == null) return;
            if (!_hostLive) { _nextRequest = 0f; return; } // positions before the manifest: ask for it
            _lastHostFrame = Time.realtimeSinceStartup;
            foreach (var e in s.entities)
            {
                if (e == null || !_proxies.TryGetValue(e.id, out var p) || !p.go) continue;
                p.target = new Vector3(e.x, e.y, e.z);
                p.yaw = e.yaw;
                p.speed = e.speed;
                if (!p.placed) { p.go.transform.position = p.target; p.placed = true; p.go.SetActive(true); }
            }
        }

        Proxy Spawn(ManifestEntity e)
        {
            try
            {
                var look = !string.IsNullOrEmpty(e.look) ? JsonUtility.FromJson<Appearance>(e.look) : Appearance.Random(e.id.GetHashCode());
                var go = new GameObject("HostNpc_" + (string.IsNullOrEmpty(e.name) ? e.id : e.name));
                go.transform.SetParent(transform, false);
                var person = go.AddComponent<ModularPerson>();
                person.Build(false, CxDress.NamedPrefabPath(look?.displayName));
                person.Apply(look);
                CxDress.EnsureGripSockets(person);
                CxDress.Person(person, look, Canon.SteelLive(ModularPerson.CastingWorld, Vector3.zero));
                if (!string.IsNullOrEmpty(e.name)) PersonLabel.Attach(go.transform, e.name, null);
                go.SetActive(false); // appears at its first real position
                return new Proxy { go = go, person = person };
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[WorldHostClient] spawn failed: " + ex.Message);
                return null;
            }
        }

        void GoHosted()
        {
            _hostLive = HostLive = true;
            _hiddenLocals.Clear();
            foreach (var n in FindObjectsByType<NpcLife>(FindObjectsInactive.Exclude))
            {
                if (!n || !n.gameObject.activeSelf) continue;
                n.gameObject.SetActive(false);
                _hiddenLocals.Add(n.gameObject);
            }
            Debug.Log("[WorldHostClient] host live — showing the shared world (" + _hiddenLocals.Count + " local NPCs hidden)");
        }

        void GoLocal()
        {
            if (!_hostLive) return;
            _hostLive = HostLive = false;
            foreach (var p in _proxies.Values) if (p.go) Destroy(p.go);
            _proxies.Clear();
            ProxyCount = 0;
            foreach (var go in _hiddenLocals) if (go) go.SetActive(true);
            _hiddenLocals.Clear();
            _nextRequest = Time.realtimeSinceStartup + 15f;
            Debug.Log("[WorldHostClient] host offline — local simulation resumed");
        }
    }
}
