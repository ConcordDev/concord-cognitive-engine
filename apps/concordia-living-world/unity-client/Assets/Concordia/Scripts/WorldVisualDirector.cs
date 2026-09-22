using System;
using System.Collections.Generic;
using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// Shared visual pass for geography, authored anchors, biome dressing, and
    /// weather. It uses the project's imported packs instead of placeholder
    /// geometry wherever a matching stem exists.
    /// </summary>
    public static class WorldVisualDirector
    {
        public static void EnsureContinent(Transform continent)
        {
            if (!continent) return;
            if (!continent.Find("ContinentalFidelity"))
            {
                var root = new GameObject("ContinentalFidelity").transform;
                root.SetParent(continent, false);
                BuildBorderAccents(root);
                BuildRouteLanterns(root);
            }

            var weather = continent.GetComponent<WorldWeatherFx>() ?? continent.gameObject.AddComponent<WorldWeatherFx>();
            weather.Bind(continent);
        }

        public static System.Collections.IEnumerator EnsureContinentStaged(Transform continent)
        {
            if (!continent) yield break;
            var root = continent.Find("ContinentalFidelity");
            if (!root)
            {
                root = new GameObject("ContinentalFidelity").transform;
                root.SetParent(continent, false);

                foreach (var border in WorldGeography.Borders)
                {
                    if (border == null) continue;
                    var at = new Vector3(border.globalPosition.x, 0.08f, border.globalPosition.y);
                    HubLook.Lantern(root, at);
                    yield return null;
                }

                int n = 0;
                foreach (var route in WorldGeography.Routes)
                {
                    if (route == null || route.waypoints == null || route.waypoints.Length < 2)
                        continue;
                    for (int i = 1; i < route.waypoints.Length - 1; i++)
                    {
                        if (n++ > 40) break;
                        var p = route.waypoints[i];
                        HubLook.Lantern(root, new Vector3(p.x, 0.08f, p.y));
                        yield return null;
                    }
                    if (n > 40) break;
                }
            }

            var weather = continent.GetComponent<WorldWeatherFx>() ?? continent.gameObject.AddComponent<WorldWeatherFx>();
            weather.Bind(continent);
            yield return null;
        }


public static void BuildChunk(Transform chunk, WorldId world)
        {
            if (!chunk || chunk.Find("VisualFidelity")) return;
            var root = new GameObject("VisualFidelity").transform;
            root.SetParent(chunk, false);
            WorldGeography.EnsureBuilt();
            WorldVisualProfileCatalog.Stamp(root, world);
            BuildRegionBoundaries(root, world);
            WorldHeroCatalog.BindImmediate(root, world);
            BuildBiomeDressing(root, world);
            BuildSurfaceAging(root, world);
            WorldWaterSurface.Build(root, world);
            BuildCountryAnchors(root, world);
            BuildTunyaCountryDressing(root, world);
            BuildSettlementLanterns(root, world);
        }

public static System.Collections.IEnumerator BuildChunkStaged(Transform chunk, WorldId world)
        {
            if (!chunk || chunk.Find("VisualFidelity")) yield break;
            var root = new GameObject("VisualFidelity").transform;
            root.SetParent(chunk, false);
            WorldGeography.EnsureBuilt();
            WorldVisualProfileCatalog.Stamp(root, world);
            BuildRegionBoundaries(root, world);
            yield return WorldHeroCatalog.BindStaged(root, world);
            BuildBiomeDressing(root, world);
            yield return null;
            BuildSurfaceAging(root, world);
            WorldWaterSurface.Build(root, world);
            yield return null;
            BuildCountryAnchors(root, world);
            BuildTunyaCountryDressing(root, world);
            yield return null;
            BuildSettlementLanterns(root, world);
            yield return null;
        }

        static void BuildBorderAccents(Transform root)
        {
            foreach (var border in WorldGeography.Borders)
            {
                if (border == null) continue;
                var at = new Vector3(border.globalPosition.x, 0.08f, border.globalPosition.y);
                HubLook.Lantern(root, at);
            }
        }

        static void BuildRouteLanterns(Transform root)
        {
            int n = 0;
            foreach (var route in WorldGeography.Routes)
            {
                if (route == null || route.waypoints == null || route.waypoints.Length < 2) continue;
                for (int i = 1; i < route.waypoints.Length - 1; i++)
                {
                    if (n++ > 40) return;
                    var p = route.waypoints[i];
                    HubLook.Lantern(root, new Vector3(p.x, 0.08f, p.y));
                }
            }
        }

        static void BuildRegionBoundaries(Transform root, WorldId world)
        {
            foreach (var region in WorldGeography.Regions(world))
            {
                if (region == null || region.bounds == null) continue;
                var color = BiomeColor(world, region.climateId);
                var material = HubLook.Lit(new Color(color.r, color.g, color.b, 0.78f), 0.02f, 0.18f);
                var bounds = region.bounds;
                if (bounds.shape == GeoShape.Ring && bounds.innerRadius > 1f)
                    Ring(root, region.id.value + "_inner", bounds.center, bounds.innerRadius, material, 28);
                if (bounds.outerRadius > 1f)
                    Ring(root, region.id.value + "_outer", bounds.center, bounds.outerRadius, material, 28);
            }
        }

        static void Ring(Transform root, string key, Vector2 center, float radius, Material material, int segments)
        {
            for (int i = 0; i < segments; i++)
            {
                var a = i / (float)segments * Mathf.PI * 2f;
                var b = (i + 1) / (float)segments * Mathf.PI * 2f;
                var pa = new Vector3(center.x + Mathf.Cos(a) * radius, 0.045f, center.y + Mathf.Sin(a) * radius);
                var pb = new Vector3(center.x + Mathf.Cos(b) * radius, 0.045f, center.y + Mathf.Sin(b) * radius);
                var delta = pb - pa;
                delta.y = 0f;
                var slab = GameObject.CreatePrimitive(PrimitiveType.Cube);
                slab.name = "RegionBoundary_" + key + "_" + i;
                slab.transform.SetParent(root, false);
                slab.transform.position = (pa + pb) * 0.5f;
                slab.transform.rotation = Quaternion.LookRotation(delta.normalized, Vector3.up);
                slab.transform.localScale = new Vector3(0.12f, 0.045f, delta.magnitude + 0.18f);
                var renderer = slab.GetComponent<Renderer>();
                if (renderer) renderer.sharedMaterial = material;
                var collider = slab.GetComponent<Collider>();
                if (collider) UnityEngine.Object.Destroy(collider);
            }
        }

static void BuildBiomeDressing(Transform root, WorldId world)
        {
            var profile = WorldVisualProfileCatalog.For(world);
            var stems = profile.biomeStems;
            if (stems == null || stems.Length == 0) return;
            var count = Mathf.Clamp(Mathf.RoundToInt(18f * Mathf.Clamp01(profile.vegetationDensity)), 4, 18);
            for (int i = 0; i < count; i++)
            {
                var h = StableHash(world + ":biome:" + i);
                var a = (h % 360) * Mathf.Deg2Rad;
                var r = 34f + (h % 88);
                var pos = new Vector3(Mathf.Cos(a) * r, 0f, Mathf.Sin(a) * r);
                if (Canon.BlocksSunderingWalk(pos, 1.2f)) continue;
                var stem = stems[i % stems.Length];
                var go = FreePacks.Spawn(stem, root, pos, h % 360, WorldVisualProfileCatalog.BiomeHeight(world, i), required: false, byHeight: false);
                if (!go) continue;
                go.name = "BiomeProp_" + profile.profileKey + "_" + i;
                var marker = go.GetComponent<WorldVisualProfileMarker>() ?? go.AddComponent<WorldVisualProfileMarker>();
                marker.Bind(profile);
            }
        }

        static void BuildSurfaceAging(Transform root, WorldId world)
        {
            var aging = new GameObject("SurfaceAging").transform;
            aging.SetParent(root, false);
            var places = WorldGeography.Places(world);
            for (int i = 0; i < places.Count; i++)
            {
                var place = places[i];
                if (place == null) continue;
                var stem = SurfaceStem(world, place.kind);
                if (string.IsNullOrEmpty(stem)) continue;

                var seed = StableHash(place.id != null ? place.id.value : world + ":place:" + i);
                var offset = new Vector3(
                    ((seed % 17) - 8) * 0.7f,
                    0f,
                    (((seed / 17) % 17) - 8) * 0.7f);
                var at = new Vector3(place.localPosition.x, 0f, place.localPosition.y) + offset;
                if (Canon.BlocksSunderingWalk(at, 1.2f)) continue;

                var go = FreePacks.Spawn(stem, aging, at, seed % 360,
                    SurfaceScale(world, place.kind, seed), required: false, byHeight: false);
                if (!go) continue;
                go.name = "SurfaceEvidence_" + world + "_" + i;
                FreePacks.StripColliders(go);
                HubLook.GroundInLight(go);
            }
        }

static string SurfaceStem(WorldId world, string kind)
        {
            var profileStem = WorldVisualProfileCatalog.SurfaceStem(world, kind);
            if (!string.IsNullOrEmpty(profileStem)) return profileStem;
            var key = (kind ?? "").ToLowerInvariant();
            if (key.Contains("ruin")) return world == WorldId.Crime ? "dumpster" : DressVocab.Rock();
            if (key.Contains("settlement") || key.Contains("district"))
                return world == WorldId.Frontier || world == WorldId.Tunya ? DressVocab.Cart() : DressVocab.Crate();
            return null;
        }

        static float SurfaceScale(WorldId world, string kind, int seed)
        {
            var key = (kind ?? "").ToLowerInvariant();
            if (key.Contains("farm")) return 0.8f + (seed % 5) * 0.08f;
            if (key.Contains("resource") || key.Contains("ruin")) return 0.7f + (seed % 4) * 0.12f;
            return world == WorldId.Cyber || world == WorldId.Superhero ? 1.15f : 0.95f;
        }

static void BuildCountryAnchors(Transform root, WorldId world)
        {
            foreach (var country in WorldBook.Countries(world))
            {
                if (country == null || country.anchors == null) continue;
                var profile = world == WorldId.Tunya ? WorldVisualProfileCatalog.ForCountry(country) : WorldVisualProfileCatalog.For(world);
                foreach (var anchor in country.anchors)
                {
                    if (anchor == null || string.IsNullOrEmpty(anchor.id)) continue;
                    var at = new Vector3(anchor.x, 0.05f, anchor.z);
                    var color = Color.Lerp(profile.groundTint, profile.atmosphereTint, 0.35f);
                    var marker = HubLook.Prim(root, PrimitiveType.Cylinder, at + Vector3.up * 0.55f,
                        new Vector3(0.36f, 1.1f, 0.36f), HubLook.Lit(color, 0.12f, 0.3f),
                        "CountryAnchor_" + Slug(anchor.id), false);
                    if (!marker) continue;
                    var profileMarker = marker.GetComponent<WorldVisualProfileMarker>() ?? marker.AddComponent<WorldVisualProfileMarker>();
                    profileMarker.Bind(profile);
                    var stone = marker.AddComponent<LoreStone>();
                    stone.title = string.IsNullOrEmpty(anchor.name) ? country.name : anchor.name;
                    stone.text = country.name + "\n" + (anchor.kind ?? "anchor") +
                        "\n" + (country.theme ?? "") + "\n" + profile.bibleName +
                        "\narchitecture=" + profile.architectureGrammar +
                        "\nbiome=" + profile.biomeGrammar;
                }
            }
        }

static void BuildTunyaCountryDressing(Transform root, WorldId world)
        {
            if (world != WorldId.Tunya) return;
            foreach (var country in WorldBook.Countries(world))
            {
                if (country == null) continue;
                var profile = WorldVisualProfileCatalog.ForCountry(country);
                if (profile.biomeStems == null || profile.biomeStems.Length == 0) continue;
                var origin = Vector3.zero;
                if (country.anchors != null && country.anchors.Length > 0 && country.anchors[0] != null)
                    origin = new Vector3(country.anchors[0].x, 0f, country.anchors[0].z);
                else if (country.capital != null)
                    origin = new Vector3(country.capital.x, 0f, country.capital.z);
                var count = Mathf.Min(2, profile.biomeStems.Length);
                for (var i = 0; i < count; i++)
                {
                    var seed = StableHash(profile.profileKey + ":country:" + i);
                    var offset = new Vector3((seed % 11) - 5f, 0f, ((seed / 11) % 11) - 5f) * 1.8f;
                    var at = origin + offset;
                    if (Canon.BlocksSunderingWalk(at, 1.2f)) continue;
                    var go = FreePacks.Spawn(profile.biomeStems[i], root, at, seed % 360, 0.9f + (i * 0.25f), required: false, byHeight: false);
                    if (!go) continue;
                    go.name = "CountryProfile_" + Slug(country.country_id) + "_" + i;
                    FreePacks.StripColliders(go);
                    HubLook.GroundInLight(go);
                    var marker = go.GetComponent<WorldVisualProfileMarker>() ?? go.AddComponent<WorldVisualProfileMarker>();
                    marker.Bind(profile);
                }
            }
        }


        static void BuildSettlementLanterns(Transform root, WorldId world)
        {
            int i = 0;
            foreach (var settlement in WorldGeography.Settlements(world))
            {
                if (settlement == null) continue;
                var p = new Vector3(settlement.localPosition.x, 0.08f, settlement.localPosition.y);
                HubLook.Lantern(root, p);
                i++;
            }
        }

        static string[] BiomeStems(WorldId world)
        {
            switch (world)
            {
                case WorldId.Ruins: return new[] { "column-large", "crypt-small", "altar-stone", "cliff_large_stone" };
                case WorldId.Tunya: return new[] { "tree_1", "grass01", "crops_cornStageD", "bridge_wood" };
                case WorldId.Fantasy: return new[] { "tree_1", "hedge-large", "banner-red", "tower-square-base" };
                case WorldId.Crime: return new[] { "dumpster", "barrel", "detail-awning", "lampRoundFloor" };
                case WorldId.Cyber: return new[] { "building-skyscraper-a", "detail-overhang-wide", "corridor_end", "lampRoundFloor" };
                case WorldId.Frontier: return new[] { "palm-detailed-bend", "palm-straight", "cart", "campfire_stones" };
                case WorldId.Superhero: return new[] { "building-skyscraper-a", "building-type-a", "lampRoundFloor", "banner-red" };
                case WorldId.Sere: return new[] { "building-type-h", "dumpster", "barrel", "cliff_large_rock" };
                case WorldId.Crucible: return new[] { "detail-crystal-large", "tower-hexagon-mid", "cliff_stone", "rocks-large" };
                default: return new[] { "tree_1", "grass01", "stone_tiles" };
            }
        }

static float BiomeHeight(WorldId world, int i)
        {
            return WorldVisualProfileCatalog.BiomeHeight(world, i);
        }

static Color BiomeColor(WorldId world, string climate)
        {
            return WorldVisualProfileCatalog.BiomeColor(world, climate);
        }

        static Color CountryColor(WorldBook.Country country)
        {
            if (country != null && !string.IsNullOrEmpty(country.theme))
            {
                var h = StableHash(country.theme) % 360;
                return Color.HSVToRGB(h / 360f, 0.55f, 0.9f);
            }
            return Color.white;
        }

        static string Slug(string raw) => string.IsNullOrEmpty(raw) ? "anchor" : raw.Trim().ToLowerInvariant().Replace(' ', '_').Replace('/', '_');

        static int StableHash(string text)
        {
            unchecked
            {
                int hash = 23;
                if (!string.IsNullOrEmpty(text))
                    for (int i = 0; i < text.Length; i++) hash = hash * 31 + text[i];
                return hash & 0x7fffffff;
            }
        }
    }

    public sealed class WorldWeatherFx : MonoBehaviour
    {
        Transform _root;
        ParticleSystem _particles;
        ParticleSystemRenderer _renderer;
        string _lastWeather;
        float _nextApply;

        public void Bind(Transform root)
        {
            if (root) _root = root;
            EnsureParticles();
            Apply(true);
        }

        void Start()
        {
            if (!_root) _root = transform;
            EnsureParticles();
            Apply(true);
        }

        void Update()
        {
            if (Time.unscaledTime < _nextApply) return;
            _nextApply = Time.unscaledTime + 2.0f;
            Apply(false);
        }

        void EnsureParticles()
        {
            if (_particles || !_root) return;
            var go = new GameObject("RegionalWeather");
            go.transform.SetParent(_root, false);
            go.transform.localPosition = new Vector3(0f, 24f, 0f);
            _particles = go.AddComponent<ParticleSystem>();
            _renderer = go.GetComponent<ParticleSystemRenderer>();
            var main = _particles.main;
            main.loop = true;
            main.maxParticles = 650;
            main.startLifetime = 2.4f;
            main.startSpeed = 8f;
            main.startSize = 0.08f;
            main.simulationSpace = ParticleSystemSimulationSpace.World;
            var emission = _particles.emission;
            emission.rateOverTime = 0f;
            var shape = _particles.shape;
            shape.shapeType = ParticleSystemShapeType.Box;
            shape.scale = new Vector3(180f, 0.2f, 180f);
            var velocity = _particles.velocityOverLifetime;
            velocity.enabled = true;
            velocity.space = ParticleSystemSimulationSpace.World;
            _renderer.renderMode = ParticleSystemRenderMode.Billboard;
            _renderer.material = HubLook.ParticleMat(Color.white, false);
        }

void Apply(bool force)
        {
            if (!_particles) return;
            var profile = WorldVisualProfileCatalog.For(WorldClock.World);
            var clockWeather = (WorldClock.Weather ?? "clear").ToLowerInvariant();
            var weather = clockWeather == "clear" && !string.IsNullOrEmpty(profile.weatherKey) ? profile.weatherKey.ToLowerInvariant() : clockWeather;
            if (!force && weather == _lastWeather) return;
            _lastWeather = weather;
            var main = _particles.main;
            var emission = _particles.emission;
            var velocity = _particles.velocityOverLifetime;
            float rate = 0f;
            float life = 2.4f;
            float speed = 8f;
            float size = 0.08f;
            Color color = new Color(1f, 1f, 1f, 0.6f);
            if (weather == "rain" || weather == "storm")
            {
                rate = 180f; life = 1.5f; speed = 18f; size = 0.045f; color = new Color(0.52f, 0.7f, 1f, 0.5f);
            }
            else if (weather == "ash" || weather == "snow")
            {
                rate = 85f; life = 4.8f; speed = 3.2f; size = 0.13f; color = new Color(0.86f, 0.82f, 0.74f, 0.68f);
            }
            else if (weather == "smog" || weather == "fog" || weather == "dust")
            {
                rate = 18f; life = 8f; speed = 0.6f; size = 0.36f; color = new Color(0.62f, 0.58f, 0.7f, 0.14f);
            }
            else if (weather == "grove" || weather == "wind")
            {
                rate = 26f; life = 5.2f; speed = 2.1f; size = 0.12f; color = new Color(0.74f, 1f, 0.55f, 0.46f);
            }
            color = Color.Lerp(color, profile.atmosphereTint, 0.28f);
            emission.rateOverTime = rate;
            main.startLifetime = life;
            main.startSpeed = speed;
            main.startSize = size;
            _renderer.material = HubLook.ParticleMat(color, weather == "grove" || weather == "neon");
            var dir = Wind(weather);
            velocity.x = new ParticleSystem.MinMaxCurve(dir.x);
            velocity.y = new ParticleSystem.MinMaxCurve(weather == "rain" || weather == "storm" ? -12f : dir.y);
            velocity.z = new ParticleSystem.MinMaxCurve(dir.z);
            if (rate > 0f && !_particles.isPlaying) _particles.Play();
            if (rate <= 0f && _particles.isPlaying) _particles.Stop(true, ParticleSystemStopBehavior.StopEmitting);
        }

        static Vector3 Wind(string weather)
        {
            var angle = WorldClock.World == WorldId.Cyber ? 0.2f : WorldClock.World == WorldId.Frontier ? 1.4f : 0.65f;
            if (weather == "storm" || weather == "wind") angle += 0.8f;
            return new Vector3(Mathf.Cos(angle) * 2.4f, 0f, Mathf.Sin(angle) * 2.4f);
        }
    }

    public sealed class CreatureVisualProfile : MonoBehaviour
    {
        bool _applied;
        string _species;

        public static void Apply(GameObject go, CreatureCard card, WorldDef world)
        {
            if (!go || card == null) return;
            var profile = go.GetComponent<CreatureVisualProfile>() ?? go.AddComponent<CreatureVisualProfile>();
            profile.Render(card, world);
        }

        void Render(CreatureCard card, WorldDef world)
        {
            if (_applied && string.Equals(_species, card.speciesId, StringComparison.OrdinalIgnoreCase)) return;
            _applied = true;
            _species = card.speciesId;
            var seed = StableHash(card.id ?? card.speciesId);
            var hue = (seed % 360) / 360f;
            var tint = Color.HSVToRGB(hue, 0.18f, 0.94f);
            if (world != null) tint = Color.Lerp(tint, world.ground, 0.18f);
            var block = new MaterialPropertyBlock();
            foreach (var renderer in GetComponentsInChildren<Renderer>(true))
            {
                if (!renderer) continue;
                renderer.GetPropertyBlock(block);
                if (renderer.sharedMaterial && renderer.sharedMaterial.HasProperty("_BaseColor")) block.SetColor("_BaseColor", tint);
                else if (renderer.sharedMaterial && renderer.sharedMaterial.HasProperty("_Color")) block.SetColor("_Color", tint);
                if (card.predator && renderer.sharedMaterial && renderer.sharedMaterial.HasProperty("_EmissionColor"))
                    block.SetColor("_EmissionColor", Color.Lerp(tint, Color.red, 0.25f) * 0.16f);
                renderer.SetPropertyBlock(block);
            }
            var scale = 0.92f + (seed % 17) * 0.01f;
            transform.localScale *= scale;
        }

        static int StableHash(string text)
        {
            unchecked
            {
                int hash = 17;
                if (!string.IsNullOrEmpty(text))
                    for (int i = 0; i < text.Length; i++) hash = hash * 31 + text[i];
                return hash & 0x7fffffff;
            }
        }
    }

    public sealed class CharacterVisualProfile : MonoBehaviour
    {
        bool _built;

        public static void Apply(GameObject go, WorldId world, Appearance look)
        {
            if (!go) return;
            var profile = go.GetComponent<CharacterVisualProfile>() ?? go.AddComponent<CharacterVisualProfile>();
            profile.Build(world, look);
            var person = go.GetComponentInChildren<ModularPerson>() ?? go.GetComponent<ModularPerson>();
            if (person)
                CxDress.Person(person, look, Canon.SteelLive(world, go.transform.position));
            HubLook.GroundInLight(go);
        }

        void Build(WorldId world, Appearance look)
        {
            if (_built) return;
            _built = true;
            var accent = new GameObject("WorldAccent").transform;
            accent.SetParent(transform, false);
            accent.localPosition = new Vector3(0f, 1.28f, -0.08f);
            accent.localRotation = Quaternion.Euler(90f, 0f, 0f);
            var color = Canon.Get(world).sun;
            var badge = HubLook.Prim(accent, PrimitiveType.Quad, Vector3.zero,
                new Vector3(0.16f, 0.16f, 0.16f), HubLook.Emit(color, world == WorldId.Cyber ? 1.5f : 0.35f),
                "WorldBadge", false);
            if (badge) badge.transform.localScale = new Vector3(0.24f, 0.24f, 0.24f);
            if (world == WorldId.Cyber || world == WorldId.Superhero)
            {
                var light = accent.gameObject.AddComponent<Light>();
                light.type = LightType.Point;
                light.color = color;
                light.intensity = world == WorldId.Cyber ? 0.45f : 0.18f;
                light.range = 2.2f;
                light.shadows = LightShadows.None;
            }
        }
    }
}
