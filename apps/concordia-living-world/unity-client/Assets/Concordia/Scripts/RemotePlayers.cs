using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Text;
using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// Other players in the shared world. The server already tracks every
    /// player and broadcasts `city:positions` (~10 Hz); until this component
    /// the Unity client ignored that feed, so everyone played alone. Each
    /// remote player is a real ModularPerson dressed in THEIR account
    /// character (appearance.game_characters_for), named, smoothed between
    /// updates, animated from real speed, and removed when their updates stop.
    /// Presentation only — positions stay server-authoritative.
    /// </summary>
    public class RemotePlayers : MonoBehaviour
    {
        [Serializable] class PosUser { public string userId; public float x, y, z; }
        [Serializable] class PosData { public string cityId; public PosUser[] users; }
        [Serializable] class PosMsg { public PosData data; }
        [Serializable] class CharRow { public string userId; public string username; public bool hasCharacter; public Appearance character; }
        [Serializable] class CharList { public bool ok; public CharRow[] list; }

        class Remote
        {
            public GameObject go;
            public ModularPerson person;
            public PersonLabel label;
            public Vector3 target;
            public Vector3 vel;
            public float lastSeen;
            public bool styled;
        }

        const float StaleSeconds = 6f;
        const int MaxRemotes = 48;
        const float SnapDistanceSq = 20f * 20f;

        static RemotePlayers _live;
        public static int Count => _live ? _live._remotes.Count : 0;

        readonly ConcurrentQueue<PosData> _inbox = new ConcurrentQueue<PosData>();
        readonly Dictionary<string, Remote> _remotes = new Dictionary<string, Remote>();
        readonly Dictionary<string, CharRow> _chars = new Dictionary<string, CharRow>();
        readonly HashSet<string> _charRequested = new HashSet<string>();
        readonly List<string> _dead = new List<string>();
        ConcordClient _client;
        bool _fetching;

        public static void Install(ConcordClient client)
        {
            if (_live || client == null) return;
            var go = new GameObject("RemotePlayers");
            _live = go.AddComponent<RemotePlayers>();
            _live._client = client;
            client.OnEvent += _live.OnKernelEvent;
        }

        // May run off the main thread (native socket loop) — parse and queue only.
        void OnKernelEvent(string evt, string text)
        {
            if (evt == null || !evt.EndsWith("city:positions", StringComparison.Ordinal)) return;
            try
            {
                var msg = JsonUtility.FromJson<PosMsg>(text);
                if (msg?.data?.users != null) _inbox.Enqueue(msg.data);
            }
            catch { /* malformed frame — ignore */ }
        }

        void OnDestroy()
        {
            if (_client) _client.OnEvent -= OnKernelEvent;
            if (_live == this) _live = null;
        }

        void Update()
        {
            var self = _client ? _client.UserId : "";
            var world = _client ? _client.WorldId : "";
            while (_inbox.TryDequeue(out var d))
            {
                if (!string.IsNullOrEmpty(world) && !string.IsNullOrEmpty(d.cityId) && d.cityId != world) continue;
                foreach (var u in d.users)
                {
                    if (u == null || string.IsNullOrEmpty(u.userId) || u.userId == self) continue;
                    if (!_remotes.TryGetValue(u.userId, out var r))
                    {
                        if (_remotes.Count >= MaxRemotes) continue;
                        r = Spawn(u);
                        if (r == null) continue;
                        _remotes[u.userId] = r;
                    }
                    r.target = new Vector3(u.x, u.y, u.z);
                    r.lastSeen = Time.time;
                }
            }

            if (!_fetching) RequestMissingCharacters();

            _dead.Clear();
            foreach (var kv in _remotes)
            {
                var r = kv.Value;
                if (!r.go || Time.time - r.lastSeen > StaleSeconds)
                {
                    if (r.go) Destroy(r.go);
                    _dead.Add(kv.Key);
                    continue;
                }
                var t = r.go.transform;
                var pos = t.position;
                Vector3 next = (r.target - pos).sqrMagnitude > SnapDistanceSq
                    ? r.target
                    : Vector3.SmoothDamp(pos, r.target, ref r.vel, 0.12f);
                var step = next - pos;
                step.y = 0f;
                var speed = step.magnitude / Mathf.Max(Time.deltaTime, 1e-4f);
                t.position = next;
                if (step.sqrMagnitude > 1e-6f)
                    t.rotation = Quaternion.Slerp(t.rotation, Quaternion.LookRotation(step.normalized), Time.deltaTime * 10f);
                r.person?.SetGait(speed, true);
                if (!r.styled && _chars.TryGetValue(kv.Key, out var row)) Style(r, row);
            }
            foreach (var k in _dead) _remotes.Remove(k);
        }

        Remote Spawn(PosUser u)
        {
            try
            {
                var pos = new Vector3(u.x, u.y, u.z);
                var go = new GameObject("Player_" + u.userId);
                go.transform.SetParent(transform, false);
                go.transform.position = pos;
                var person = go.AddComponent<ModularPerson>();
                var look = Appearance.Random(u.userId.GetHashCode());
                person.Build(false, null);
                person.Apply(look);
                CxDress.EnsureGripSockets(person);
                CxDress.Person(person, look, Canon.SteelLive(ModularPerson.CastingWorld, pos));
                var label = PersonLabel.Attach(go.transform, "Traveler", "player");
                return new Remote { go = go, person = person, label = label, target = pos, lastSeen = Time.time };
            }
            catch (Exception e)
            {
                Debug.LogWarning("[RemotePlayers] spawn failed: " + e.Message);
                return null;
            }
        }

        void Style(Remote r, CharRow row)
        {
            r.styled = true;
            var name = row.hasCharacter && row.character != null && !string.IsNullOrEmpty(row.character.displayName)
                ? row.character.displayName
                : (string.IsNullOrEmpty(row.username) ? "Traveler" : row.username);
            if (r.go) r.go.name = "Player_" + name;
            if (r.go) r.label = PersonLabel.Attach(r.go.transform, name, "player"); // re-applies the existing nameplate
            if (row.hasCharacter && row.character != null && r.person) r.person.Apply(row.character);
        }

        async void RequestMissingCharacters()
        {
            if (_client == null || !_client.Connected) return;
            var ids = new List<string>();
            foreach (var id in _remotes.Keys)
                if (!_charRequested.Contains(id)) ids.Add(id);
            if (ids.Count == 0) return;
            _fetching = true;
            foreach (var id in ids) _charRequested.Add(id);
            try
            {
                var sb = new StringBuilder("{\"userIds\":[");
                for (int i = 0; i < ids.Count; i++)
                {
                    if (i > 0) sb.Append(',');
                    sb.Append('"').Append(ids[i].Replace("\\", "").Replace("\"", "")).Append('"');
                }
                sb.Append("]}");
                var json = await _client.LensRunAwait("appearance", "game_characters_for", sb.ToString(), 6000);
                if (string.IsNullOrEmpty(json)) { foreach (var id in ids) _charRequested.Remove(id); return; }
                var parsed = JsonUtility.FromJson<CharList>(json);
                if (parsed?.list == null) return;
                foreach (var row in parsed.list)
                    if (row != null && !string.IsNullOrEmpty(row.userId)) _chars[row.userId] = row;
            }
            catch { /* next frame retries anything not requested */ }
            finally { _fetching = false; }
        }
    }
}
