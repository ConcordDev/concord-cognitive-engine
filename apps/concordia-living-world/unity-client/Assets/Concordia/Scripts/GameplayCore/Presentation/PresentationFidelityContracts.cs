using System;
using UnityEngine;
using Concordia.GameplayCore.Movement;

namespace Concordia.GameplayCore.Presentation
{
    /// <summary>Stable, additive presentation data for each authored world.</summary>
    [Serializable]
    public struct PresentationWorldProfile
    {
        public WorldId World;
        public string BiomeKey;
        public string SurfaceKey;
        public string WeatherKey;
        public Color GroundTint;
        public Color AtmosphereTint;
        public float VegetationDensity;
        public float SurfaceVariation;
        public float ContactEvidence;
        public float ActivityDensity;
        public float CameraBreath;

        public static PresentationWorldProfile For(WorldId world)
        {
            var source = Concordia.WorldVisualProfileCatalog.For(world);
            return new PresentationWorldProfile
            {
                World = source.world,
                BiomeKey = source.biomeGrammar,
                SurfaceKey = source.surfaceKey,
                WeatherKey = source.weatherKey,
                GroundTint = source.groundTint,
                AtmosphereTint = source.atmosphereTint,
                VegetationDensity = source.vegetationDensity,
                SurfaceVariation = source.surfaceVariation,
                ContactEvidence = source.contactEvidence,
                ActivityDensity = source.activityDensity,
                CameraBreath = source.activityDensity > 0.8f ? 0.55f : 0.7f
            };
        }

        static PresentationWorldProfile Make(WorldId world, string biome, string surface, string weather, Color ground, Color atmosphere, float vegetation, float variation, float contact, float activity, float breath)
        {
            return new PresentationWorldProfile
            {
                World = world, BiomeKey = biome, SurfaceKey = surface, WeatherKey = weather,
                GroundTint = ground, AtmosphereTint = atmosphere, VegetationDensity = vegetation,
                SurfaceVariation = variation, ContactEvidence = contact, ActivityDensity = activity,
                CameraBreath = breath
            };
        }
    }

    /// <summary>Exactly the nine non-hub world profiles; Hub remains available through For().</summary>
    public static class NineWorldPresentationProfiles
    {
        public static readonly WorldId[] Worlds =
        {
            WorldId.Ruins, WorldId.Tunya, WorldId.Fantasy, WorldId.Crime, WorldId.Cyber,
            WorldId.Frontier, WorldId.Superhero, WorldId.Crucible, WorldId.Sere
        };

        public static PresentationWorldProfile Get(WorldId world) => PresentationWorldProfile.For(world);

        public static bool TryGet(WorldId world, out PresentationWorldProfile profile)
        {
            profile = PresentationWorldProfile.For(world);
            return world != WorldId.Hub;
        }
    }

    public enum PresentationEventType { Animation, Ik, Grip, Reaction, Camera, Contact, Intersection, Vfx, Audio, Activity, Weather }
    public enum PresentationContactKind { Footfall, Landing, Impact, Scrape, Intersection }
    public enum PresentationGripHand { Left, Right, Both }
    public enum PresentationReactionKind { Flinch, Stagger, Knockdown, Recover, GuardBreak, Threat }

    [Serializable]
    public struct PresentationEvent
    {
        public PresentationEventType Type;
        public string Key;
        public Vector3 Position;
        public Vector3 Direction;
        public float Intensity;
        public float Duration;
        public GameObject Source;

        public static PresentationEvent Make(PresentationEventType type, string key, Vector3 position, Vector3 direction, float intensity, float duration, GameObject source = null)
        {
            return new PresentationEvent { Type = type, Key = key ?? string.Empty, Position = position, Direction = direction, Intensity = Mathf.Max(0f, intensity), Duration = Mathf.Max(0f, duration), Source = source };
        }
    }

    [Serializable]
    public struct PresentationAnimationContract
    {
        public string State;
        public float Speed;
        public float Weight;
        public bool Grounded;
        public Vector3 Velocity;
    }

    [Serializable]
    public struct PresentationGripContract
    {
        public PresentationGripHand Hand;
        public string SocketName;
        public Transform Target;
        public float Weight;
        public bool TwoHanded;
    }

    [Serializable]
    public struct PresentationReactionContract
    {
        public PresentationReactionKind Kind;
        public Vector3 Direction;
        public float Intensity;
        public float Duration;
    }

    [Serializable]
    public struct PresentationCameraContract
    {
        public string Key;
        public Vector3 PositionOffset;
        public Vector3 EulerOffset;
        public float Intensity;
        public float Duration;
    }

    [Serializable]
    public struct PresentationVfxContract
    {
        public string Key;
        public Color Color;
        public Vector3 Position;
        public Vector3 Direction;
        public float Intensity;
        public int Count;
    }

    [Serializable]
    public struct PresentationAudioContract
    {
        public string Key;
        public Vector3 Position;
        public float Volume;
        public float Pitch;
    }

    public interface IPresentationEventSink
    {
        void OnPresentationEvent(PresentationEvent presentationEvent);
    }

    public static class PresentationEventBus
    {
        public static event Action<PresentationEvent> EventRaised;

        public static void Publish(PresentationEvent presentationEvent)
        {
            var handler = EventRaised;
            if (handler == null) return;
            try { handler(presentationEvent); }
            catch (Exception e) { Debug.LogWarning("[Concordia] Presentation event sink failed: " + e.Message); }
        }

        public static void ClearListeners() => EventRaised = null;
    }
}
