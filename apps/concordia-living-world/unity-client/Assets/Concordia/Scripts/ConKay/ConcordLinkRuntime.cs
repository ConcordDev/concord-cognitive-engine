using System;
using System.Collections.Generic;
using UnityEngine;
using Concordia.GameplayCore;

namespace Concordia.ConKay
{
    public enum ConcordSystemVisibility
    {
        Known,
        Observed,
        Inferred,
        Recorded,
        Rumored,
        FactionSupplied,
        PlayerDiscovered,
        Canonical,
        Hidden,
        Unknown
    }

    [Serializable]
    public sealed class ConcordSystemAccessProfile
    {
        public string viewerId = "player";
        public string role = "player";
        public int knowledgeLevel = 3;
        public bool canInspectWorldField = true;
        public bool canInspectProvenance = true;
        public bool canInspectConsequences = true;
        public bool canInspectHidden = false;

        public static ConcordSystemAccessProfile Player(string id = "player")
        {
            return new ConcordSystemAccessProfile
            {
                viewerId = string.IsNullOrEmpty(id) ? "player" : id,
                role = "player",
                knowledgeLevel = 3,
                canInspectWorldField = true,
                canInspectProvenance = true,
                canInspectConsequences = true
            };
        }

        public static ConcordSystemAccessProfile Npc(string id, string npcRole)
        {
            return new ConcordSystemAccessProfile
            {
                viewerId = string.IsNullOrEmpty(id) ? "npc" : id,
                role = string.IsNullOrEmpty(npcRole) ? "npc" : npcRole,
                knowledgeLevel = 1,
                canInspectWorldField = true,
                canInspectProvenance = false,
                canInspectConsequences = false
            };
        }
    }

    [Serializable]
    public sealed class ConcordSystemFact
    {
        public string key;
        public string value;
        public string source;
        public ConcordSystemVisibility visibility;
        public float confidence;

        public ConcordSystemFact() { }

        public ConcordSystemFact(string key, string value, string source,
            ConcordSystemVisibility visibility = ConcordSystemVisibility.Recorded, float confidence = 1f)
        {
            this.key = key ?? string.Empty;
            this.value = value ?? string.Empty;
            this.source = source ?? string.Empty;
            this.visibility = visibility;
            this.confidence = Mathf.Clamp01(confidence);
        }
    }

    [Serializable]
    public sealed class ConcordSystemEventRecord
    {
        public string eventId;
        public string channel;
        public string kind;
        public string title;
        public string detail;
        public string sourceId;
        public string targetId;
        public string actionId;
        public string world;
        public float value;
        public float time;
        public ConcordSystemVisibility visibility;

        public ConcordSystemEventRecord() { }

        public ConcordSystemEventRecord(string eventId, string channel, string kind, string title, string detail,
            string sourceId, string targetId, string actionId, string world, float value, float time,
            ConcordSystemVisibility visibility)
        {
            this.eventId = eventId ?? string.Empty;
            this.channel = channel ?? string.Empty;
            this.kind = kind ?? string.Empty;
            this.title = title ?? string.Empty;
            this.detail = detail ?? string.Empty;
            this.sourceId = sourceId ?? string.Empty;
            this.targetId = targetId ?? string.Empty;
            this.actionId = actionId ?? string.Empty;
            this.world = world ?? string.Empty;
            this.value = value;
            this.time = time;
            this.visibility = visibility;
        }
    }

    [Serializable]
    public sealed class ConcordSystemNotification
    {
        public string title;
        public string detail;
        public string source;
        public float duration;
        public ConcordSystemVisibility visibility;

        public ConcordSystemNotification() { }

        public ConcordSystemNotification(string title, string detail, string source,
            float duration = 3.2f, ConcordSystemVisibility visibility = ConcordSystemVisibility.Recorded)
        {
            this.title = title ?? string.Empty;
            this.detail = detail ?? string.Empty;
            this.source = source ?? string.Empty;
            this.duration = duration;
            this.visibility = visibility;
        }
    }

    [Serializable]
    public sealed class ConcordSystemSnapshot
    {
        public string viewerId;
        public string viewerRole;
        public string title;
        public string stableId;
        public string why;
        public string authority;
        public string confidence;
        public Vector3 worldPosition;
        public readonly List<ConcordSystemFact> facts = new List<ConcordSystemFact>();
        public readonly List<ConcordSystemEventRecord> events = new List<ConcordSystemEventRecord>();
        public readonly List<ConKayChainLink> provenance = new List<ConKayChainLink>();

        public void Fact(string key, string value, string source,
            ConcordSystemVisibility visibility = ConcordSystemVisibility.Recorded, float confidence = 1f)
        {
            facts.Add(new ConcordSystemFact(key, value, source, visibility, confidence));
        }
    }

    /// <summary>
    /// Concord Link is the authoritative read/event spine for system projections. It does not
    /// mutate gameplay state; GameplayCoreBridge and the existing domain services remain the
    /// authorities. ConKay consumes the projections produced here.
    /// </summary>
    public sealed class ConcordLinkRuntime
    {
        readonly List<ConcordSystemEventRecord> _events = new List<ConcordSystemEventRecord>();
        readonly Queue<ConcordSystemNotification> _notifications = new Queue<ConcordSystemNotification>();
        GameplayCoreBridge _bridge;
        ConKayRuntimeSource _source;
        ConcordSystemAccessProfile _playerProfile = ConcordSystemAccessProfile.Player();

        public GameplayCoreBridge Bridge => _bridge;
        public IConKayRuntimeSource Source => _source;
        public ConcordSystemAccessProfile PlayerProfile => _playerProfile;
        public IReadOnlyList<ConcordSystemEventRecord> Events => _events;
        public int EventCount => _events.Count;

        public void Bind(GameplayCoreBridge bridge)
        {
            _bridge = bridge;
            _source = bridge == null ? new ConKayRuntimeSource() : new ConKayRuntimeSource(bridge);
        }

        public void Emit(string channel, string kind, string title, string detail,
            string sourceId = null, string targetId = null, string actionId = null, float value = 0f,
            ConcordSystemVisibility visibility = ConcordSystemVisibility.Recorded)
        {
            var player = _bridge != null ? _bridge.Player : ConcordiaPlayer.Live;
            var world = player != null ? player.world.ToString() : WorldId.Hub.ToString();
            var id = string.Join("/", channel ?? "system", kind ?? "event", _events.Count.ToString());
            var record = new ConcordSystemEventRecord(id, channel, kind, title, detail, sourceId, targetId, actionId, world, value, Time.unscaledTime, visibility);
            _events.Add(record);
            while (_events.Count > 64) _events.RemoveAt(0);
            _notifications.Enqueue(new ConcordSystemNotification(title, detail, "Concord Link / " + (channel ?? "system"), 3.2f, visibility));
            while (_notifications.Count > 8) _notifications.Dequeue();
        }

        public bool TryDequeueNotification(out ConcordSystemNotification notification)
        {
            if (_notifications.Count == 0)
            {
                notification = null;
                return false;
            }
            notification = _notifications.Dequeue();
            return notification != null;
        }

        public ConcordSystemSnapshot InspectPlayer()
        {
            var player = _bridge != null ? _bridge.Player : ConcordiaPlayer.Live;
            var snapshot = NewSnapshot(_playerProfile, "PLAYER SYSTEM", "player", "ConcordiaPlayer + Concord Link");
            if (player == null)
            {
                snapshot.why = "No player actor is currently bound to Concord Link.";
                snapshot.confidence = "unknown";
                return snapshot;
            }

            snapshot.stableId = "player";
            snapshot.worldPosition = player.transform.position;
            snapshot.why = "The player projection is assembled from live actor state, WorldField, gameplay-core diagnostics, and recorded consequences.";
            snapshot.confidence = "confirmed";
            snapshot.Fact("world", player.world.ToString(), "ConcordiaPlayer.world", ConcordSystemVisibility.Known);
            snapshot.Fact("position", player.transform.position.ToString("F1"), "ConcordiaPlayer.transform", ConcordSystemVisibility.Observed);
            snapshot.Fact("health", player.hp.ToString("0.0"), "ConcordiaPlayer.hp", ConcordSystemVisibility.Observed);
            snapshot.Fact("stamina", player.stamina.ToString("0.0"), "ConcordiaPlayer.stamina", ConcordSystemVisibility.Observed);
            snapshot.Fact("poise", player.poise.ToString("0.0"), "ConcordiaPlayer.poise", ConcordSystemVisibility.Observed);
            snapshot.Fact("equipped", string.IsNullOrEmpty(player.kitWeapon) ? "none" : player.kitWeapon, "ConcordiaPlayer.kitWeapon", ConcordSystemVisibility.Known);

            if (_bridge != null)
            {
                snapshot.Fact("bridge", _bridge.RuntimeDiagnostics ?? "live", "GameplayCoreBridge.RuntimeDiagnostics", ConcordSystemVisibility.Recorded);
                snapshot.Fact("save", _bridge.LastSaveSucceeded ? "ok" : "pending", "GameplayCoreBridge.LastSaveSucceeded", ConcordSystemVisibility.Recorded);
                snapshot.Fact("consequences", ConcordiaPersistence.ConsequenceCount().ToString(), "ConcordiaPersistenceService", ConcordSystemVisibility.Recorded);
            }

            var field = WorldField.At(player.world, player.transform.position, "athletics", player.world);
            snapshot.Fact("dominantField", field.dominant, "WorldField.Sample.dominant", ConcordSystemVisibility.Observed);
            snapshot.Fact("fieldMultiplier", field.multiplier.ToString("0.00"), "WorldField.Sample.multiplier", ConcordSystemVisibility.Inferred, 0.95f);
            snapshot.Fact("fieldWhy", field.because, "WorldField.Sample.because", ConcordSystemVisibility.Inferred, 0.95f);
            snapshot.events.AddRange(VisibleEvents(_playerProfile, "player"));
            return snapshot;
        }

        public ConcordSystemSnapshot InspectTarget(GameObject target, Vector3 worldPoint, ConcordSystemAccessProfile profile = null)
        {
            var effective = profile ?? _playerProfile;
            var raw = _source != null ? _source.InspectTarget(target, worldPoint) : ConKayInspectionSnapshot.Empty(ConKayInspectionKind.None, "Unknown", "ConKay source is unavailable.", "Concord Link");
            return FromConKay(raw, effective);
        }

        public ConcordSystemSnapshot InspectWorldField(Vector3 worldPoint, ConcordSystemAccessProfile profile = null)
        {
            var effective = profile ?? _playerProfile;
            var raw = _source != null ? _source.InspectWorldField(worldPoint) : ConKayInspectionSnapshot.Empty(ConKayInspectionKind.WorldField, "World Field", "ConKay source is unavailable.", "Concord Link");
            return FromConKay(raw, effective);
        }

        public ConcordSystemSnapshot InspectGoldenSlice(string recordId, ConcordSystemAccessProfile profile = null)
        {
            var effective = profile ?? _playerProfile;
            var raw = _source != null ? _source.InspectGoldenSlice(recordId) : ConKayInspectionSnapshot.Empty(ConKayInspectionKind.GoldenSlice, "Golden Slice", "ConKay source is unavailable.", "Concord Link");
            return FromConKay(raw, effective);
        }

        public ConcordSystemSnapshot InspectFor(GameObject viewer, GameObject target, Vector3 worldPoint)
        {
            var profile = BuildProfile(viewer);
            return InspectTarget(target, worldPoint, profile);
        }

        public ConcordSystemAccessProfile BuildProfile(GameObject viewer)
        {
            if (viewer == null) return _playerProfile;
            var npc = viewer.GetComponentInParent<GuestNpc>();
            if (npc != null)
            {
                var id = string.IsNullOrEmpty(npc.personId) ? npc.name : npc.personId;
                var role = npc.def == null ? "npc" : npc.def.title;
                return ConcordSystemAccessProfile.Npc(id, role);
            }
            return _playerProfile;
        }

        ConcordSystemSnapshot FromConKay(ConKayInspectionSnapshot raw, ConcordSystemAccessProfile profile)
        {
            var snapshot = NewSnapshot(profile, raw == null ? "SYSTEM" : raw.title, raw == null ? string.Empty : raw.stableId, raw == null ? "Concord Link" : raw.authority);
            if (raw == null)
            {
                snapshot.why = "No projection was produced.";
                snapshot.confidence = "unknown";
                return snapshot;
            }
            snapshot.worldPosition = raw.worldPosition;
            snapshot.why = raw.why;
            snapshot.confidence = raw.authoritativeRecordFound ? "confirmed" : "observed only";
            for (var i = 0; i < raw.facts.Count; i++)
            {
                var fact = raw.facts[i];
                if (fact == null) continue;
                var visibility = profile.knowledgeLevel >= 2 ? ConcordSystemVisibility.Recorded : ConcordSystemVisibility.Observed;
                snapshot.Fact(fact.key, fact.value, fact.source, visibility, raw.authoritativeRecordFound ? 1f : 0.6f);
            }
            if (profile.canInspectProvenance)
                for (var i = 0; i < raw.chain.Count; i++) if (raw.chain[i] != null) snapshot.provenance.Add(raw.chain[i]);
            if (profile.canInspectConsequences)
                snapshot.events.AddRange(VisibleEvents(profile, raw.stableId));
            if (!profile.canInspectProvenance) snapshot.Fact("provenance", "restricted", "ConcordSystemAccessProfile", ConcordSystemVisibility.Hidden, 0.5f);
            if (!profile.canInspectConsequences) snapshot.Fact("consequences", "restricted", "ConcordSystemAccessProfile", ConcordSystemVisibility.Hidden, 0.5f);
            return snapshot;
        }

        ConcordSystemSnapshot NewSnapshot(ConcordSystemAccessProfile profile, string title, string stableId, string authority)
        {
            return new ConcordSystemSnapshot
            {
                viewerId = profile == null ? "player" : profile.viewerId,
                viewerRole = profile == null ? "player" : profile.role,
                title = title ?? "SYSTEM",
                stableId = stableId ?? string.Empty,
                authority = authority ?? "Concord Link",
                confidence = "observed"
            };
        }

        List<ConcordSystemEventRecord> VisibleEvents(ConcordSystemAccessProfile profile, string subjectId)
        {
            var result = new List<ConcordSystemEventRecord>();
            for (var i = 0; i < _events.Count; i++)
            {
                var item = _events[i];
                if (item == null) continue;
                if (item.visibility == ConcordSystemVisibility.Hidden && (profile == null || !profile.canInspectHidden)) continue;
                if (!string.IsNullOrEmpty(subjectId) && !string.Equals(subjectId, "player", StringComparison.OrdinalIgnoreCase)
                    && !string.Equals(subjectId, item.sourceId, StringComparison.OrdinalIgnoreCase)
                    && !string.Equals(subjectId, item.targetId, StringComparison.OrdinalIgnoreCase)) continue;
                result.Add(item);
            }
            var start = Mathf.Max(0, result.Count - 6);
            if (start == 0) return result;
            return result.GetRange(start, result.Count - start);
        }
    }

    static class ConcordiaPersistence
    {
        public static int ConsequenceCount()
        {
            return Concordia.GameplayCore.Persistence.ConcordiaPersistenceService.RecordedEvents == null
                ? 0
                : Concordia.GameplayCore.Persistence.ConcordiaPersistenceService.RecordedEvents.Count;
        }
    }
}
