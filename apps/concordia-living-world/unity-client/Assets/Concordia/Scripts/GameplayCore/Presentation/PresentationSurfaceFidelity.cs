using System;
using UnityEngine;
using UnityEngine.Rendering;

namespace Concordia.GameplayCore.Presentation
{
    [Serializable]
    public struct PresentationMaterialVariation
    {
        public Color Tint;
        public float Roughness;
        public float Metallic;
        public float Wetness;
        public float Emission;

        public static PresentationMaterialVariation Default => new PresentationMaterialVariation
        {
            Tint = Color.white, Roughness = 0.5f, Metallic = 0f, Wetness = 0f, Emission = 0f
        };
    }

    [Serializable]
    public struct PresentationTerrainSample
    {
        public float Height;
        public float Wetness;
        public float Breakup;
        public int Variant;
    }

    [Serializable]
    public struct PresentationContactEvidenceData
    {
        public PresentationContactKind Kind;
        public Vector3 Position;
        public Vector3 Normal;
        public float Strength;
        public float Penetration;
        public string SurfaceId;
        public GameObject Source;
    }

    /// <summary>
    /// Deterministic, property-block-only surface fidelity. It never replaces a material or renderer.
    /// </summary>
    public static class PresentationSurfaceFidelity
    {
        public static int StableSeed(string key, int seed = 0)
        {
            unchecked
            {
                var hash = 486187739 + seed;
                if (!string.IsNullOrEmpty(key))
                    for (var i = 0; i < key.Length; i++) hash = hash * 16777619 ^ key[i];
                return hash & 0x7fffffff;
            }
        }

        public static float Stable01(string key, int seed = 0)
        {
            return (StableSeed(key, seed) % 10000) / 9999f;
        }

        public static int VariantIndex(string key, int variantCount, int seed = 0)
        {
            return variantCount <= 0 ? 0 : StableSeed(key, seed) % variantCount;
        }

        public static int ApplySurfaceAging(GameObject root, WorldId world, string surfaceKey, float age01, int seed = 0)
        {
            if (!root) return 0;
            var profile = PresentationWorldProfile.For(world);
            var key = string.IsNullOrEmpty(surfaceKey) ? profile.SurfaceKey : surfaceKey;
            var count = 0;
            var renderers = root.GetComponentsInChildren<Renderer>(true);
            for (var i = 0; i < renderers.Length; i++)
            {
                var renderer = renderers[i];
                if (!renderer) continue;
                var variation = PresentationMaterialVariation.Default;
                variation.Tint = Color.Lerp(Color.white, profile.GroundTint, Mathf.Clamp01(age01) * 0.28f);
                variation.Roughness = Mathf.Clamp01(0.34f + profile.SurfaceVariation * 0.35f + Mathf.Repeat(Stable01(key + ":rough:" + i, seed), 0.18f));
                variation.Metallic = Mathf.Clamp01((key.IndexOf("metal", StringComparison.OrdinalIgnoreCase) >= 0 ? 0.45f : 0.04f) + profile.SurfaceVariation * 0.08f);
                variation.Wetness = Mathf.Clamp01((WorldClock.Weather ?? string.Empty).IndexOf("rain", StringComparison.OrdinalIgnoreCase) >= 0 ? 0.55f : 0.08f);
                ApplyMaterialBreakup(renderer, key + ":" + i, variation, seed);
                count++;
            }
            return count;
        }

        public static bool ApplyMaterialBreakup(Renderer renderer, string stableKey, PresentationMaterialVariation variation, int seed = 0)
        {
            if (!renderer || !renderer.sharedMaterial) return false;
            var material = renderer.sharedMaterial;
            var noise = 0.82f + Stable01(stableKey, seed) * 0.36f;
            var tint = variation.Tint * noise;
            var block = new MaterialPropertyBlock();
            renderer.GetPropertyBlock(block);
            if (material.HasProperty("_BaseColor")) block.SetColor("_BaseColor", tint);
            if (material.HasProperty("_Color")) block.SetColor("_Color", tint);
            if (material.HasProperty("_Metallic")) block.SetFloat("_Metallic", Mathf.Clamp01(variation.Metallic + (noise - 1f) * 0.08f));
            if (material.HasProperty("_Smoothness")) block.SetFloat("_Smoothness", Mathf.Clamp01(1f - variation.Roughness + variation.Wetness * 0.18f));
            if (material.HasProperty("_Roughness")) block.SetFloat("_Roughness", Mathf.Clamp01(variation.Roughness - variation.Wetness * 0.12f));
            if (variation.Emission > 0f && material.HasProperty("_EmissionColor")) block.SetColor("_EmissionColor", tint * variation.Emission);
            renderer.SetPropertyBlock(block);
            return true;
        }

        public static PresentationTerrainSample EvaluateTerrain(Terrain terrain, Vector3 worldPosition, WorldId world, int seed = 0)
        {
            var profile = PresentationWorldProfile.For(world);
            var local = terrain ? terrain.transform.InverseTransformPoint(worldPosition) : worldPosition;
            var noise = Mathf.PerlinNoise(local.x * 0.031f + seed * 0.001f, local.z * 0.031f + seed * 0.002f);
            return new PresentationTerrainSample
            {
                Height = terrain ? terrain.SampleHeight(worldPosition) : worldPosition.y,
                Wetness = Mathf.Clamp01(noise * 0.55f + ((WorldClock.Weather ?? string.Empty).IndexOf("rain", StringComparison.OrdinalIgnoreCase) >= 0 ? 0.45f : 0f)),
                Breakup = Mathf.Clamp01(profile.SurfaceVariation * Mathf.Lerp(0.7f, 1.3f, noise)),
                Variant = VariantIndex(profile.SurfaceKey + ":terrain:" + Mathf.FloorToInt(local.x) + ":" + Mathf.FloorToInt(local.z), 8, seed)
            };
        }

        public static void ApplyContactMaterialEvidence(Renderer renderer, float strength, Color accent)
        {
            if (!renderer || !renderer.sharedMaterial) return;
            var material = renderer.sharedMaterial;
            var block = new MaterialPropertyBlock();
            renderer.GetPropertyBlock(block);
            if (material.HasProperty("_BaseColor"))
                block.SetColor("_BaseColor", Color.Lerp(Color.white, accent, Mathf.Clamp01(strength) * 0.22f));
            if (material.HasProperty("_Color"))
                block.SetColor("_Color", Color.Lerp(Color.white, accent, Mathf.Clamp01(strength) * 0.22f));
            renderer.SetPropertyBlock(block);
        }
    }

    /// <summary>Optional component for builders that want deterministic aging without owning a look stack.</summary>
    public sealed class PresentationSurfaceAger : MonoBehaviour
    {
        public WorldId world = WorldId.Hub;
        public string surfaceKey;
        [Range(0f, 1f)] public float age = 0.35f;
        public int seed;
        public bool applyOnEnable = true;

        void OnEnable()
        {
            if (applyOnEnable) Apply();
        }

        public int Apply()
        {
            return PresentationSurfaceFidelity.ApplySurfaceAging(gameObject, world, surfaceKey, age, seed);
        }
    }

    /// <summary>Terrain sampling hook for builders that own their TerrainData/material application.</summary>
    public sealed class PresentationTerrainAgingHook : MonoBehaviour
    {
        public Terrain terrain;
        public WorldId world = WorldId.Hub;
        public int seed;

        void Awake()
        {
            if (!terrain) terrain = GetComponent<Terrain>();
        }

        public PresentationTerrainSample Sample(Vector3 worldPosition)
        {
            return PresentationSurfaceFidelity.EvaluateTerrain(terrain, worldPosition, world, seed);
        }
    }

    /// <summary>Intersection/contact evidence contract. Visual receivers may listen to the event bus.</summary>
    public sealed class PresentationContactEvidence : MonoBehaviour, IPresentationEventSink
    {
        public bool emitParticles;
        public ParticleSystem particleSystem;
        public string surfaceId = "default";
        ParticleSystem _particles;

        void OnEnable() => PresentationEventBus.EventRaised += OnPresentationEvent;
        void OnDisable() => PresentationEventBus.EventRaised -= OnPresentationEvent;

        public void Bind(string id, ParticleSystem receiver = null)
        {
            surfaceId = string.IsNullOrEmpty(id) ? "default" : id;
            particleSystem = receiver;
        }

        public void Record(PresentationContactEvidenceData evidence)
        {
            if (string.IsNullOrEmpty(evidence.SurfaceId)) evidence.SurfaceId = surfaceId;
            if (!evidence.Source) evidence.Source = gameObject;
            PresentationEventBus.Publish(PresentationEvent.Make(
                evidence.Kind == PresentationContactKind.Intersection ? PresentationEventType.Intersection : PresentationEventType.Contact,
                evidence.SurfaceId + ":" + evidence.Kind, evidence.Position, evidence.Normal, evidence.Strength, 0.35f, evidence.Source));
        }

        public void OnPresentationEvent(PresentationEvent presentationEvent)
        {
            if (!emitParticles || presentationEvent.Type != PresentationEventType.Contact && presentationEvent.Type != PresentationEventType.Intersection) return;
            if (_particles == null) _particles = particleSystem ? particleSystem : GetComponentInChildren<ParticleSystem>();
            if (!_particles) return;
            _particles.transform.position = presentationEvent.Position;
            _particles.transform.rotation = presentationEvent.Direction.sqrMagnitude > 0.001f ? Quaternion.LookRotation(presentationEvent.Direction) : Quaternion.identity;
            _particles.Emit(Mathf.Clamp(Mathf.RoundToInt(2f + presentationEvent.Intensity * 8f), 1, 16));
        }

        public static void RecordGroundContact(GameObject source, Vector3 position, Vector3 normal, string surfaceId, float strength = 1f, PresentationContactKind kind = PresentationContactKind.Footfall)
        {
            var data = new PresentationContactEvidenceData { Kind = kind, Position = position, Normal = normal.sqrMagnitude > 0.001f ? normal.normalized : Vector3.up, Strength = Mathf.Max(0f, strength), SurfaceId = surfaceId, Source = source };
            PresentationEventBus.Publish(PresentationEvent.Make(PresentationEventType.Contact, (surfaceId ?? "default") + ":" + kind, data.Position, data.Normal, data.Strength, 0.35f, source));
        }

        public static bool TryEvaluateIntersection(Collider first, Collider second, out PresentationContactEvidenceData evidence, string surfaceId = "default")
        {
            evidence = default(PresentationContactEvidenceData);
            if (!first || !second || first == second || !first.enabled || !second.enabled) return false;
            Vector3 direction;
            float distance;
            if (!Physics.ComputePenetration(first, first.transform.position, first.transform.rotation, second, second.transform.position, second.transform.rotation, out direction, out distance)) return false;
            var point = first.bounds.ClosestPoint(second.bounds.center);
            evidence = new PresentationContactEvidenceData
            {
                Kind = PresentationContactKind.Intersection,
                Position = point,
                Normal = direction.sqrMagnitude > 0.001f ? direction.normalized : Vector3.up,
                Strength = Mathf.Clamp01(distance),
                Penetration = distance,
                SurfaceId = string.IsNullOrEmpty(surfaceId) ? "default" : surfaceId,
                Source = first.gameObject
            };
            PresentationEventBus.Publish(PresentationEvent.Make(PresentationEventType.Intersection, evidence.SurfaceId, point, evidence.Normal, evidence.Strength, 0.4f, evidence.Source));
            return true;
        }
    }
}
