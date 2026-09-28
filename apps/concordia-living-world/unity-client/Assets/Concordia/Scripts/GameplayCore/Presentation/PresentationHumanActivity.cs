using System;
using UnityEngine;

namespace Concordia.GameplayCore.Presentation
{
    [Serializable]
    public struct PresentationActivityEvidence
    {
        public string ActorId;
        public string Activity;
        public string FactionId;
        public Vector3 Position;
        public float Intensity;
        public float Lifetime;
        public bool IsPublic;
        public GameObject Source;
    }

    /// <summary>Small, engine-neutral contract for visible human activity and lived-in evidence.</summary>
    public sealed class PresentationHumanActivityEvidence : MonoBehaviour, IPresentationEventSink
    {
        public string actorId;
        public string factionId;
        public bool publicActivity = true;
        [Range(0f, 2f)] public float intensity = 1f;
        public bool forwardToWorldClock;
        float _lastRecord;

        void OnEnable() => PresentationEventBus.EventRaised += OnPresentationEvent;
        void OnDisable() => PresentationEventBus.EventRaised -= OnPresentationEvent;

        public void Bind(string id, string faction = null)
        {
            actorId = id;
            factionId = faction;
        }

        public void Record(string activity, float strength = -1f, string key = null)
        {
            if (string.IsNullOrEmpty(activity)) return;
            var now = Time.unscaledTime;
            if (now - _lastRecord < 0.08f) return;
            _lastRecord = now;
            var evidence = new PresentationActivityEvidence
            {
                ActorId = string.IsNullOrEmpty(actorId) ? gameObject.name : actorId,
                Activity = activity,
                FactionId = factionId,
                Position = transform.position,
                Intensity = Mathf.Max(0f, strength < 0f ? intensity : strength),
                Lifetime = 8f,
                IsPublic = publicActivity,
                Source = gameObject
            };
            if (forwardToWorldClock) WorldClock.NoteAct(evidence.ActorId + " " + activity);
            PresentationEventBus.Publish(PresentationEvent.Make(PresentationEventType.Activity, string.IsNullOrEmpty(key) ? activity : key, evidence.Position, transform.forward, evidence.Intensity, evidence.Lifetime, gameObject));
        }

        public void RecordCurrentWorldActivity()
        {
            if (!string.IsNullOrEmpty(WorldClock.NearbyAct)) Record(WorldClock.NearbyAct, 0.45f, "world_activity");
        }

        public void OnPresentationEvent(PresentationEvent presentationEvent)
        {
            // Contract receiver intentionally does not spawn geometry. Existing NPC/prop systems
            // may listen and supply authored markers, audio, or VFX when available.
        }

        public static void Publish(string activity, Vector3 position, float strength = 1f, GameObject source = null, string actorId = null)
        {
            if (string.IsNullOrEmpty(activity)) return;
            PresentationEventBus.Publish(PresentationEvent.Make(PresentationEventType.Activity, activity, position, Vector3.up, strength, 8f, source));
        }

        public static bool TryReadWorldActivity(out string activity)
        {
            activity = WorldClock.NearbyAct;
            return !string.IsNullOrEmpty(activity);
        }
    }
}
