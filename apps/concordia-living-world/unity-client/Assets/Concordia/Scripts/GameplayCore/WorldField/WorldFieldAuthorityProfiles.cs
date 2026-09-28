using System;
using System.Collections.Generic;
using UnityEngine;
using Concordia.WorldSimulation;

namespace Concordia.GameplayCore.WorldField
{
    /// <summary>
    /// Canon-derived profiles. This is data and deterministic lookup only; it never
    /// creates a scene, controls rendering, or replaces the existing world authority.
    /// </summary>
    public static class WorldFieldAuthorityProfiles
    {
        static readonly Dictionary<WorldId, WorldFieldProfile> Profiles = new Dictionary<WorldId, WorldFieldProfile>();
        static readonly List<WorldFieldAnchor> Anchors = new List<WorldFieldAnchor>();
        static readonly List<WorldFieldRegionalModifier> Regions = new List<WorldFieldRegionalModifier>();
        static bool built;

        public static IReadOnlyList<WorldFieldAnchor> AllAnchors { get { EnsureBuilt(); return Anchors; } }
        public static IReadOnlyList<WorldFieldRegionalModifier> AllRegions { get { EnsureBuilt(); return Regions; } }

        public static WorldFieldProfile Get(WorldId world)
        {
            EnsureBuilt();
            WorldFieldProfile profile;
            if (Profiles.TryGetValue(world, out profile)) return profile;
            return Profiles[WorldId.Hub];
        }

        public static void EnsureBuilt()
        {
            if (built) return;
            built = true;
            Add(WorldId.Hub, "The Unburned Court", 0.70f, 0.65f, 0.70f, 0.75f, 0.78f, 0.70f, 0.55f, 0.62f, 0.90f, "court", "urban", 0.05f);
            Add(WorldId.Cyber, "The Grid", 0.10f, 1.00f, 0.84f, 1.00f, 0.28f, 0.92f, 0.66f, 0.48f, 0.72f, "infrastructure", "urban", 0.30f);
            Add(WorldId.Ruins, "Sovereign Ruins", 0.62f, 0.42f, 0.58f, 0.36f, 0.30f, 0.34f, 0.84f, 0.22f, 0.38f, "ruins", "ruins", 0.25f);
            Add(WorldId.Fantasy, "The Sundering", 1.00f, 0.05f, 0.72f, 0.48f, 0.78f, 0.66f, 0.94f, 0.58f, 0.44f, "wild", "forest", 0.40f);
            Add(WorldId.Tunya, "Tunya", 0.40f, 0.34f, 0.76f, 0.44f, 1.00f, 0.70f, 0.58f, 0.84f, 0.64f, "grove", "grassland", 0.18f);
            Add(WorldId.Frontier, "The Frontier", 0.28f, 0.46f, 0.88f, 0.52f, 0.58f, 0.96f, 0.74f, 0.62f, 0.46f, "road", "desert", 0.16f);
            Add(WorldId.Crime, "Crime World", 0.05f, 0.85f, 0.48f, 0.90f, 0.24f, 0.82f, 0.88f, 0.38f, 0.30f, "street", "urban", 0.35f);
            Add(WorldId.Superhero, "The Permanent Dawn", 0.52f, 0.64f, 0.72f, 0.76f, 0.44f, 0.86f, 0.98f, 0.72f, 0.66f, "vertical", "urban", 0.55f);
            Add(WorldId.Crucible, "The Crucible", 0.58f, 0.58f, 0.92f, 0.78f, 0.52f, 0.56f, 0.78f, 0.64f, 0.52f, "unstable", "crystalline", 0.90f);
            Add(WorldId.Sere, "Sere", 0.18f, 0.78f, 0.34f, 0.88f, 0.12f, 0.44f, 0.74f, 0.26f, 0.18f, "furnace", "industrial", 0.30f);

            foreach (WorldId world in Enum.GetValues(typeof(WorldId)))
            {
                var profile = Get(world);
                var center = world == WorldId.Hub ? Vector2.zero : global::Concordia.WorldField.CenterKm(world);
                Anchors.Add(new WorldFieldAnchor
                {
                    anchorId = "world/" + profile.stableId,
                    world = world,
                    kind = world == WorldId.Hub ? "hub" : "gate",
                    globalKm = center,
                    radiusKm = world == WorldId.Hub ? 28f : 90f,
                    weight = world == WorldId.Hub ? 1.25f : 1f,
                    magic = profile.magic,
                    technology = profile.technology,
                    link = profile.link,
                    network = profile.network,
                    ecology = profile.ecology
                });
                AddCanonAnchors(world, profile);
                AddGeographyRegions(world);
            }
        }

        static void Add(WorldId world, string name, float magic, float technology, float link, float network,
            float ecology, float mobility, float combat, float recovery, float safety, string terrain, string biome, float temporal)
        {
            Profiles[world] = new WorldFieldProfile
            {
                world = world,
                stableId = StableId(world),
                displayName = name,
                centerKm = world == WorldId.Hub ? Vector2.zero : global::Concordia.WorldField.CenterKm(world),
                radiusKm = world == WorldId.Hub ? 120f : global::Concordia.WorldField.SigmaKm,
                influenceWeight = 1f,
                magic = magic,
                technology = technology,
                link = link,
                network = network,
                ecology = ecology,
                mobility = mobility,
                combat = combat,
                recovery = recovery,
                safety = safety,
                terrainAffinity = terrain,
                biomeAffinity = biome,
                temporalSensitivity = temporal
            };
        }

        static void AddCanonAnchors(WorldId world, WorldFieldProfile profile)
        {
            var countries = WorldBook.Countries(world);
            if (countries == null) return;
            for (var i = 0; i < countries.Length; i++)
            {
                var country = countries[i];
                if (country == null) continue;
                var countryId = string.IsNullOrEmpty(country.country_id) ? "country-" + i : country.country_id;
                var capital = country.capital;
                if (capital != null && !string.IsNullOrEmpty(capital.name))
                    AddLocalAnchor(world, profile, "capital/" + countryId, "capital", capital.x, capital.z, 0.65f, 48f);
                if (country.anchors == null) continue;
                for (var a = 0; a < country.anchors.Length; a++)
                {
                    var anchor = country.anchors[a];
                    if (anchor == null) continue;
                    AddLocalAnchor(world, profile, string.IsNullOrEmpty(anchor.id) ? countryId + "/anchor-" + a : anchor.id,
                        string.IsNullOrEmpty(anchor.kind) ? "country-anchor" : anchor.kind, anchor.x, anchor.z, 0.45f, 36f);
                }
            }
        }

        static void AddLocalAnchor(WorldId world, WorldFieldProfile profile, string id, string kind, float x, float z, float weight, float radius)
        {
            var global = global::Concordia.WorldField.LocalToMegaworld(world, x, z);
            Anchors.Add(new WorldFieldAnchor
            {
                anchorId = "anchor/" + profile.stableId + "/" + StableWorldId.Normalize(id),
                world = world,
                kind = kind,
                globalKm = global,
                radiusKm = radius,
                weight = weight,
                magic = profile.magic,
                technology = profile.technology,
                link = profile.link,
                network = profile.network,
                ecology = profile.ecology
            });
        }

        static void AddGeographyRegions(WorldId world)
        {
            var profile = Get(world);
            var source = WorldGeography.Regions(world);
            if (source == null) return;
            for (var i = 0; i < source.Count; i++)
            {
                var region = source[i];
                if (region == null || region.id == null || region.bounds == null) continue;
                var global = global::Concordia.WorldField.LocalToMegaworld(world, region.bounds.center.x, region.bounds.center.y);
                Regions.Add(new WorldFieldRegionalModifier
                {
                    regionId = region.id.value,
                    world = world,
                    globalKm = global,
                    radiusKm = Mathf.Max(8f, region.bounds.outerRadius * global::Concordia.WorldField.SceneMetresToKm),
                    terrainId = region.terrainId,
                    climateId = region.climateId,
                    terrainAffinity = TerrainScore(region.terrainId, profile.terrainAffinity),
                    biomeAffinity = BiomeScore(region.climateId, profile.biomeAffinity),
                    connectivity = 0.5f,
                    magic = profile.magic - 0.5f,
                    technology = profile.technology - 0.5f,
                    link = profile.link - 0.5f,
                    network = profile.network - 0.5f,
                    ecology = profile.ecology - 0.5f
                });
            }
        }

        static float TerrainScore(string actual, string expected)
        {
            if (string.IsNullOrEmpty(actual) || string.IsNullOrEmpty(expected)) return 0.5f;
            return StableWorldId.Normalize(actual) == StableWorldId.Normalize(expected) ? 1f : 0.35f;
        }

        static float BiomeScore(string actual, string expected)
        {
            if (string.IsNullOrEmpty(actual) || string.IsNullOrEmpty(expected)) return 0.5f;
            return StableWorldId.Normalize(actual) == StableWorldId.Normalize(expected) ? 1f : 0.4f;
        }

        static string StableId(WorldId world)
        {
            return StableWorldId.Normalize(Canon.Get(world).title).Replace(" ", "-");
        }
    }
}
