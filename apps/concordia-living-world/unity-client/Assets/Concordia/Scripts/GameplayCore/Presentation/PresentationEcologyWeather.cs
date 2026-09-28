using System;
using UnityEngine;

namespace Concordia.GameplayCore.Presentation
{
    [Serializable]
    public struct PresentationBiomeSample
    {
        public WorldId World;
        public string BiomeKey;
        public float Ecology;
        public float VegetationDensity;
        public float Moisture;
        public float Disturbance;
        public int Variant;
        public bool SupportsVegetation;
    }

    /// <summary>Read-only ecology/biome hook for world builders and vegetation spawners.</summary>
    public sealed class PresentationBiomeEcologyHook : MonoBehaviour
    {
        public WorldId world = WorldId.Hub;
        public int seed;
        [Range(0f, 2f)] public float densityMultiplier = 1f;
        public string biomeOverride;

        public void Bind(WorldId id, int stableSeed = 0)
        {
            world = id;
            seed = stableSeed;
        }

        public PresentationBiomeSample Sample(Vector3 worldPosition, string speciesKey = "vegetation")
        {
            return Evaluate(world, worldPosition, speciesKey, seed, densityMultiplier, biomeOverride);
        }

        public bool ShouldSpawn(Vector3 worldPosition, string speciesKey = "vegetation")
        {
            var sample = Sample(worldPosition, speciesKey);
            if (!sample.SupportsVegetation || sample.VegetationDensity <= 0.001f) return false;
            return PresentationSurfaceFidelity.Stable01(speciesKey + ":" + worldPosition.x.ToString("F2") + ":" + worldPosition.z.ToString("F2"), seed) <= sample.VegetationDensity;
        }

        public static PresentationBiomeSample Evaluate(WorldId id, Vector3 worldPosition, string speciesKey = "vegetation", int stableSeed = 0, float multiplier = 1f, string overrideKey = null)
        {
            var profile = PresentationWorldProfile.For(id);
            var ecology = Mathf.Clamp01(WorldClock.Ecology);
            var key = string.IsNullOrEmpty(overrideKey) ? profile.BiomeKey : overrideKey;
            var noise = Mathf.PerlinNoise(worldPosition.x * 0.027f + stableSeed * 0.001f, worldPosition.z * 0.027f + stableSeed * 0.002f);
            var disturbance = Mathf.Clamp01(1f - ecology + (1f - noise) * 0.25f);
            var density = Mathf.Clamp01(profile.VegetationDensity * ecology * Mathf.Lerp(0.62f, 1.2f, noise) * Mathf.Max(0f, multiplier));
            var moist = Mathf.Clamp01((noise * 0.72f) + (id == WorldId.Tunya ? 0.3f : id == WorldId.Frontier ? -0.16f : 0f));
            var canGrow = profile.VegetationDensity > 0.03f && !string.Equals(key, "neon_urban", StringComparison.OrdinalIgnoreCase) && !string.Equals(key, "industrial_crucible", StringComparison.OrdinalIgnoreCase);
            return new PresentationBiomeSample
            {
                World = id, BiomeKey = key, Ecology = ecology, VegetationDensity = canGrow ? density : density * 0.12f,
                Moisture = moist, Disturbance = disturbance, Variant = PresentationSurfaceFidelity.VariantIndex(speciesKey + ":" + key, 8, stableSeed), SupportsVegetation = canGrow
            };
        }
    }

    [Serializable]
    public struct PresentationWeatherResponse
    {
        public string Weather;
        public Vector3 Wind;
        public Color AtmosphereTint;
        public float FogMultiplier;
        public float Visibility;
        public float Precipitation;
        public float Turbulence;
    }

    /// <summary>Weather response hook that extends WorldClock/WorldBreath without creating another weather system.</summary>
    public sealed class PresentationWeatherAtmosphereHook : MonoBehaviour
    {
        public WorldId world = WorldId.Hub;
        public bool followWorldClock = true;
        [Range(0f, 2f)] public float responseMultiplier = 1f;

        public void Bind(WorldId id)
        {
            world = id;
        }

        public PresentationWeatherResponse Read()
        {
            return Evaluate(world, followWorldClock ? WorldClock.Weather : PresentationWorldProfile.For(world).WeatherKey, responseMultiplier);
        }

        public void ApplyToParticles(ParticleSystem particles)
        {
            if (!particles) return;
            var response = Read();
            var weather = response.Weather;
            var main = particles.main;
            var emission = particles.emission;
            var velocity = particles.velocityOverLifetime;
            main.startColor = response.AtmosphereTint;
            main.startLifetime = weather == "fog" || weather == "smog" ? 8f : weather == "rain" || weather == "storm" ? 1.6f : 4f;
            main.startSpeed = weather == "rain" || weather == "storm" ? 16f : Mathf.Max(0.2f, response.Turbulence * 2f);
            main.startSize = weather == "fog" || weather == "smog" ? 0.32f : weather == "snow" || weather == "ash" ? 0.12f : 0.08f;
            emission.rateOverTime = response.Precipitation * 160f;
            velocity.enabled = true;
            velocity.x = response.Wind.x;
            velocity.y = weather == "rain" || weather == "storm" ? -12f : response.Wind.y;
            velocity.z = response.Wind.z;
            if (emission.rateOverTime.constant > 0.01f && !particles.isPlaying) particles.Play();
            if (emission.rateOverTime.constant <= 0.01f && particles.isPlaying) particles.Stop(true, ParticleSystemStopBehavior.StopEmitting);
        }

        public static PresentationWeatherResponse Evaluate(WorldId id, string weather, float multiplier = 1f)
        {
            var profile = PresentationWorldProfile.For(id);
            var key = string.IsNullOrEmpty(weather) ? profile.WeatherKey : weather.ToLowerInvariant();
            var wind = WorldBreath.Wind * Mathf.Max(0f, multiplier);
            var fog = 1f;
            var visibility = 1f;
            var precipitation = 0f;
            var turbulence = Mathf.Clamp01(wind.magnitude / 4f);
            var tint = profile.AtmosphereTint;
            if (key == "rain" || key == "storm")
            {
                fog = key == "storm" ? 1.45f : 1.18f; visibility = 0.72f; precipitation = key == "storm" ? 1f : 0.78f;
                tint = Color.Lerp(tint, new Color(0.46f, 0.62f, 0.9f), 0.3f);
            }
            else if (key == "ash" || key == "snow")
            {
                fog = 1.25f; visibility = 0.78f; precipitation = 0.52f;
                tint = Color.Lerp(tint, new Color(0.82f, 0.82f, 0.78f), 0.24f);
            }
            else if (key == "fog" || key == "smog")
            {
                fog = 1.75f; visibility = 0.46f; precipitation = 0.12f;
                tint = Color.Lerp(tint, new Color(0.60f, 0.58f, 0.68f), 0.3f);
            }
            else if (key == "wind" || key == "grove")
            {
                fog = 0.92f; visibility = 0.94f; precipitation = 0.16f;
            }
            return new PresentationWeatherResponse { Weather = key, Wind = wind, AtmosphereTint = tint, FogMultiplier = fog, Visibility = visibility, Precipitation = precipitation, Turbulence = turbulence };
        }
    }
}
