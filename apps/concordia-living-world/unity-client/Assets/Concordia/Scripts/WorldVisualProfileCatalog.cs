using System;
using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// The single data-driven visual grammar layer for Concordia's ten continents.
    /// It controls presentation vocabulary only; WorldBuilder, ContinentStream,
    /// WorldGeography, persistence, and gameplay remain authoritative elsewhere.
    /// </summary>
    public static class WorldVisualProfileCatalog
    {
        public static WorldVisualProfileSpec For(WorldId world)
        {
            switch (world)
            {
                case WorldId.Ruins:
                    return Make(world, "Sovereign Ruins", "ruins", "classical-archive", "overgrown-classical", "functioning-archive", "ash", "ash_soil", new Color(0.34f, 0.30f, 0.26f), new Color(0.34f, 0.31f, 0.29f), 0.28f, 0.34f, 0.85f, 0.32f, 3.4f, new[] { "column-large", "crypt-small", "altar-stone", "cliff_large_stone" }, new[] { "column-large", "crypt-small", "altar-stone" }, new[] { "ash", "fog", "ruin" }, "marble limestone moss glyphs archives", "classical stone archive streets", "functioning glyph infrastructure", "L0 impostor archive silhouette; L1 ruin cluster; L2 staged archive chunk; L3 interactive archive; L4 glyph inspection", "Assets/Concordia/Materials/Masters/Concordia_Master_RuinsArchiveStone.mat");
                case WorldId.Tunya:
                    return Make(world, "Tunya", "tunya", "multi-biome-ark-continent", "country-driven", "ark-remnant-waterways", "grove", "grove_moss", new Color(0.25f, 0.42f, 0.20f), new Color(0.45f, 0.62f, 0.42f), 0.92f, 0.32f, 0.78f, 0.86f, 1.8f, new[] { "tree_1", "grass01", "crops_cornStageD", "bridge_wood" }, new[] { "tree_1", "grass01", "bridge_wood" }, new[] { "grove", "wind", "rain", "snow", "ash" }, "country-specific Masond Asbir Aekon Fluxom Nil Sangree grammars", "ark remnants cliff desert glacier harbor grove fire-clan ecosystems", "country and settlement simulation remains canonical", "L0 continent silhouette; L1 country cluster; L2 staged settlement; L3 authored country hero; L4 interaction/provenance", "Assets/Concordia/Materials/Masters/Concordia_Master_ObsidianAshForgeStone.mat");
                case WorldId.Fantasy:
                    return Make(world, "The Sundering", "sundering", "high-fantasy", "ancient-forest-mountain", "magical-ecosystem", "wind", "stone_tiles", new Color(0.46f, 0.38f, 0.30f), new Color(0.62f, 0.42f, 0.34f), 0.72f, 0.28f, 0.9f, 0.78f, 2.8f, new[] { "tree_1", "hedge-large", "banner-red", "tower-square-base" }, new[] { "tree_1", "hedge-large", "tower-square-base" }, new[] { "wind", "rain", "snow", "fog" }, "ancient forests ravines alpine stone roads roots runes", "House Voss Wildwood Circle dragon holds Thornwood", "environmental magic is physically grounded and sparse", "L0 mountain silhouette; L1 forest valley; L2 staged hold; L3 magic landmark; L4 spell/ecology interaction", "Assets/Concordia/Materials/Masters/Concordia_Master_RootCurseOrganic.mat");
                case WorldId.Crime:
                    return Make(world, "Iron Coast", "iron-coast", "noir-modern", "brick-concrete-river-city", "industrial-crime-life", "rain", "wet_asphalt", new Color(0.20f, 0.18f, 0.19f), new Color(0.22f, 0.18f, 0.22f), 0.18f, 0.46f, 1.1f, 0.95f, 2.2f, new[] { "dumpster", "barrel", "detail-awning", "lampRoundFloor" }, new[] { "dumpster", "barrel", "detail-awning" }, new[] { "rain", "smog", "fog" }, "brick warehouses concrete apartments docks overpasses river fog", "Iron Rose Estate Dockside Warehouses River Market", "ordinary places conceal extraordinary criminal infrastructure", "L0 skyline/river silhouette; L1 block cluster; L2 staged district; L3 evidence landmark; L4 crime interaction", "Assets/Concordia/Materials/Masters/Concordia_Master_WetCourtStone.mat");
                case WorldId.Cyber:
                    return Make(world, "The Grid", "grid", "neon-megacity", "wet-infrastructure", "surveillance-network", "smog", "neon_grid", new Color(0.12f, 0.14f, 0.22f), new Color(0.24f, 0.16f, 0.38f), 0.12f, 0.32f, 0.7f, 0.92f, 8f, new[] { "building-skyscraper-a", "detail-overhang-wide", "corridor_end", "lampRoundFloor" }, new[] { "building-skyscraper-a", "detail-overhang-wide", "corridor_end" }, new[] { "smog", "rain", "fog" }, "wet pavement elevated rail cables service corridors neon haze", "Mainframe Under-District Neon Arc Glitch Chapel", "network infrastructure and blackout contrast drive identity", "L0 skyline silhouette; L1 megastructure cluster; L2 staged urban cell; L3 network landmark; L4 terminal/AR interaction", "Assets/Concordia/Materials/Masters/Concordia_Master_FrontierWeatheredMetal.mat");
                case WorldId.Frontier:
                    return Make(world, "The Frontier", "frontier", "peer-mesh-frontier", "human-scale-wilderness", "relay-infrastructure", "wind", "packed_earth", new Color(0.55f, 0.39f, 0.22f), new Color(0.68f, 0.52f, 0.32f), 0.38f, 0.38f, 1.0f, 0.58f, 1.4f, new[] { "palm-detailed-bend", "palm-straight", "cart", "campfire_stones" }, new[] { "cart", "campfire_stones", "bridge_wood" }, new[] { "wind", "rain", "fog" }, "small settlements wilderness relay poles cairns handmade bridges", "Walker Paths courier stations repair yards relay gates", "civilization disappears into wilderness", "L0 terrain/relay silhouette; L1 settlement cluster; L2 staged frontier cell; L3 mesh gate; L4 courier/relay interaction", "Assets/Concordia/Materials/Masters/Concordia_Master_FrontierWeatheredMetal.mat");
                case WorldId.Superhero:
                    return Make(world, "Aegis", "aegis", "superhero-metropolis", "glass-steel-arterial", "biological-civic", "clear", "concrete_floor", new Color(0.46f, 0.46f, 0.50f), new Color(0.38f, 0.48f, 0.64f), 0.24f, 0.18f, 0.7f, 0.88f, 7f, new[] { "building-skyscraper-a", "building-type-a", "lampRoundFloor", "banner-red" }, new[] { "building-skyscraper-a", "building-type-a", "lampRoundFloor" }, new[] { "clear", "rain", "smog" }, "glass steel concrete transit parks rooftops clinics", "Kane Tower Bronx Arterials Low-Rent Grid Public Neural Clinics", "superhuman biology is integrated into ordinary civic life", "L0 skyline silhouette; L1 tower district; L2 staged arterial; L3 Kane landmark; L4 civic/biological interaction", "Assets/Concordia/Materials/Masters/Concordia_Master_FrontierWeatheredMetal.mat");
                case WorldId.Crucible:
                    return Make(world, "The Crucible", "crucible", "unstable-drift", "impossible-geology", "spatial-contradiction", "storm", "metal_plate", new Color(0.25f, 0.28f, 0.31f), new Color(0.28f, 0.34f, 0.40f), 0.14f, 0.58f, 1.25f, 0.66f, 3.6f, new[] { "detail-crystal-large", "tower-hexagon-mid", "cliff_stone", "rocks-large" }, new[] { "detail-crystal-large", "cliff_stone", "rocks-large" }, new[] { "storm", "fog", "wind" }, "folded terrain floating fragments spatial seams broken weather", "Ember Gate Slip Gate Veil Gate Seven Doors Rifts", "macro drift generates contradiction; heroes remain readable", "L0 impossible horizon; L1 drift cluster; L2 staged contradiction cell; L3 gate landmark; L4 drift interaction", "Assets/Concordia/Materials/Masters/Concordia_Master_RuinsArchiveStone.mat");
                case WorldId.Sere:
                    return Make(world, "Sere", "sere", "exhausted-earth", "industrial-collapse", "extraction-infrastructure", "fog", "wet_asphalt", new Color(0.28f, 0.23f, 0.19f), new Color(0.32f, 0.28f, 0.26f), 0.22f, 0.44f, 1.05f, 0.74f, 3.2f, new[] { "building-type-h", "dumpster", "barrel", "cliff_large_rock" }, new[] { "building-type-h", "dumpster", "barrel" }, new[] { "fog", "smog", "rain", "wind" }, "old capital spire city furnace belt breadlands flooded lowland extraction", "First Launch Cradle Furnace Belt River Delta Drowned Provinces", "Earth worn thin by extraction; evidence remains unresolved", "L0 industrial skyline; L1 infrastructure cluster; L2 staged extraction cell; L3 launch/extraction landmark; L4 evidence interaction", "Assets/Concordia/Materials/Masters/Concordia_Master_RuinsArchiveStone.mat");
                default:
                    return Make(world, "The Unburned Court", "hub", "civic-fantasy-capital", "wet-civic-stone", "four-power-civic-life", "clear", "cobblestone_square", new Color(0.46f, 0.44f, 0.40f), new Color(0.32f, 0.50f, 0.52f), 0.62f, 0.2f, 0.8f, 0.82f, 2.5f, new[] { "tree_1", "grass01", "stone_tiles" }, new[] { "stone_tiles", "tree_1", "grass01" }, new[] { "clear", "rain", "fog" }, "dressed civic stone concentric walls arcades archive market forest", "Council Chamber Archive Quarter Market District Warden ring-wall", "occupied credible political heart with layered repairs", "L0 civic skyline; L1 wall/gate cluster; L2 staged court; L3 Court hero shot; L4 civic interaction", "Assets/Concordia/Materials/Masters/Concordia_Master_WetCourtStone.mat");
            }
        }

        public static WorldVisualProfileSpec ForTunyaCountry(string countryId)
        {
            var key = (countryId ?? string.Empty).Trim().ToLowerInvariant();
            if (key.Contains("masond")) return Country("masond", "Masond", "cliff-arrival", "cliff", "sandstone", "wind", new Color(0.48f, 0.34f, 0.22f), new Color(0.58f, 0.46f, 0.32f), new[] { "coastal_cliff_01", "bridge_wood", "stone_tiles" }, "Bandiagara-like cliff terraces, ark arrival, vertical streets and river works");
            if (key.Contains("asbir")) return Country("asbir", "Asbir", "buried-archive", "desert", "sandstone", "dust", new Color(0.63f, 0.45f, 0.25f), new Color(0.72f, 0.52f, 0.32f), new[] { "sand_rocks_small_01", "large_sandstone_blocks", "stone_tiles" }, "dunes, buried archive, dry wadis, salt and preserved vaults");
            if (key.Contains("aekon")) return Country("aekon", "Aekon", "glacial-ark", "glacier", "snow", "snow", new Color(0.42f, 0.58f, 0.68f), new Color(0.56f, 0.72f, 0.82f), new[] { "cliff_large_stone", "stone_tiles", "rocks-large" }, "ice oath, long winter, glacier holds and exposed ark remains");
            if (key.Contains("fluxom")) return Country("fluxom", "Fluxom", "dye-harbor", "wet-industrial", "factory_wall", "rain", new Color(0.20f, 0.28f, 0.30f), new Color(0.30f, 0.46f, 0.48f), new[] { "modular_factory_facade", "modular_industrial_pipes_01", "industrial_storage_cart" }, "dye economy, harbor collapse, canals, sanitation and refugee flow");
            if (key == "nil" || key.Contains("nil")) return Country("nil", "Nil", "listening-grove", "old-growth", "grove_moss", "grove", new Color(0.16f, 0.32f, 0.18f), new Color(0.28f, 0.52f, 0.34f), new[] { "root_cluster_01", "tree_1", "grass01" }, "ancient untouched grove, refusal field, roots and protected memory");
            if (key.Contains("sangree") || key.Contains("sandrun")) return Country("sangree", "Sangree", "fire-forge", "volcanic", "ash_soil", "ash", new Color(0.24f, 0.12f, 0.09f), new Color(0.56f, 0.18f, 0.08f), new[] { "campfire_stones", "large_sandstone_blocks", "cliff_large_stone" }, "fire-bloodline homeland, blackened stone, ore routes and heavy craft");
            return For(WorldId.Tunya);
        }

        public static WorldVisualProfileSpec ForCountry(WorldBook.Country country)
        {
            return country == null ? For(WorldId.Tunya) : ForTunyaCountry(country.country_id + " " + country.name + " " + country.theme);
        }

        public static string SurfaceStem(WorldId world, string kind)
        {
            var profile = For(world);
            var key = (kind ?? string.Empty).ToLowerInvariant();
            if (key.Contains("farm")) return profile.surfaceStems.Length > 0 ? profile.surfaceStems[0] : null;
            if (key.Contains("resource")) return profile.surfaceStems.Length > 1 ? profile.surfaceStems[1] : null;
            if (key.Contains("ruin")) return profile.surfaceStems.Length > 2 ? profile.surfaceStems[2] : null;
            if (key.Contains("settlement") || key.Contains("district")) return profile.surfaceStems.Length > 1 ? profile.surfaceStems[1] : null;
            return null;
        }

        public static float BiomeHeight(WorldId world, int index)
        {
            var profile = For(world);
            if (world == WorldId.Cyber || world == WorldId.Superhero) return profile.basePropHeight + (index % 4) * 2.4f;
            if (world == WorldId.Ruins || world == WorldId.Crucible) return profile.basePropHeight + (index % 4) * 0.9f;
            return profile.basePropHeight + (index % 5) * 0.6f;
        }

        public static Color BiomeColor(WorldId world, string climate)
        {
            var profile = For(world);
            var key = (climate ?? string.Empty).ToLowerInvariant();
            if (key.Contains("ice") || key.Contains("cold")) return Color.Lerp(profile.groundTint, Color.cyan, 0.32f);
            if (key.Contains("desert") || key.Contains("hot")) return Color.Lerp(profile.groundTint, new Color(0.85f, 0.56f, 0.22f), 0.34f);
            if (key.Contains("storm") || key.Contains("wind")) return Color.Lerp(profile.groundTint, Color.white, 0.2f);
            if (key.Contains("neon") || key.Contains("urban")) return Color.Lerp(profile.groundTint, new Color(0.45f, 0.12f, 0.8f), 0.36f);
            return Color.Lerp(profile.groundTint, profile.atmosphereTint, 0.16f);
        }

        public static void Stamp(Transform root, WorldId world)
        {
            if (!root) return;
            var profile = For(world);
            var marker = root.GetComponent<WorldVisualProfileMarker>() ?? root.gameObject.AddComponent<WorldVisualProfileMarker>();
            marker.Bind(profile);
        }

        static WorldVisualProfileSpec Country(string id, string name, string architecture, string biome, string surface, string weather, Color ground, Color atmosphere, string[] stems, string description)
        {
            var profile = Make(WorldId.Tunya, "Tunya", "tunya-" + id, architecture, biome, surface, "country-waterways", weather, ground, atmosphere, 0.62f, 0.3f, 0.9f, 0.7f, 2f, stems, stems, new[] { weather, "wind", "fog" }, architecture + " " + description, name, "country-driven Tunya profile", "L0 macro terrain; L1 country cluster; L2 staged settlement; L3 country hero; L4 country interaction", "Assets/Concordia/Materials/Masters/Concordia_Master_ObsidianAshForgeStone.mat");
            profile.countryId = id;
            profile.countryName = name;
            return profile;
        }

        static WorldVisualProfileSpec Make(WorldId world, string bibleName, string profileKey, string architecture, string biome, string surface, string water, string weather, Color ground, Color atmosphere, float vegetation, float variation, float contact, float activity, float baseHeight, string[] stems, string[] surfaceStems, string[] weatherKeys, string architectureDescription, string landmarkDescription, string waterDescription, string lodPolicy, string masterMaterialPath)
        {
            return new WorldVisualProfileSpec
            {
                world = world,
                bibleName = bibleName,
                profileKey = profileKey,
                architectureGrammar = architecture,
                biomeGrammar = biome,
                surfaceKey = surface,
                waterGrammar = water,
                weatherKey = weather,
                masterMaterialPath = masterMaterialPath,
                groundTint = ground,
                atmosphereTint = atmosphere,
                vegetationDensity = vegetation,
                surfaceVariation = variation,
                contactEvidence = contact,
                activityDensity = activity,
                basePropHeight = baseHeight,
                biomeStems = stems ?? new string[0],
                surfaceStems = surfaceStems ?? new string[0],
                weatherKeys = weatherKeys ?? new string[0],
                architectureDescription = architectureDescription,
                landmarkDescription = landmarkDescription,
                waterDescription = waterDescription,
                lodPolicy = lodPolicy,
                countryId = string.Empty,
                countryName = string.Empty
            };
        }
    }

    [Serializable]
    public sealed class WorldVisualProfileSpec
    {
        public WorldId world;
        public string bibleName;
        public string profileKey;
        public string countryId;
        public string countryName;
        public string architectureGrammar;
        public string biomeGrammar;
        public string surfaceKey;
        public string waterGrammar;
        public string weatherKey;
        public string masterMaterialPath;
        public string architectureDescription;
        public string landmarkDescription;
        public string waterDescription;
        public string lodPolicy;
        public Color groundTint;
        public Color atmosphereTint;
        public float vegetationDensity;
        public float surfaceVariation;
        public float contactEvidence;
        public float activityDensity;
        public float basePropHeight;
        public string[] biomeStems = new string[0];
        public string[] surfaceStems = new string[0];
        public string[] weatherKeys = new string[0];
    }

    [DisallowMultipleComponent]
    public sealed class WorldVisualProfileMarker : MonoBehaviour
    {
        public string bibleName;
        public string profileKey;
        public string countryId;
        public string architectureGrammar;
        public string biomeGrammar;
        public string surfaceKey;
        public string waterGrammar;
        public string weatherKey;
        public string masterMaterialPath;
        public string lodPolicy;
        public float vegetationDensity;
        public float activityDensity;
        public Color groundTint;
        public Color atmosphereTint;

        public void Bind(WorldVisualProfileSpec profile)
        {
            if (profile == null) return;
            bibleName = profile.bibleName;
            profileKey = profile.profileKey;
            countryId = profile.countryId;
            architectureGrammar = profile.architectureGrammar;
            biomeGrammar = profile.biomeGrammar;
            surfaceKey = profile.surfaceKey;
            waterGrammar = profile.waterGrammar;
            weatherKey = profile.weatherKey;
            masterMaterialPath = profile.masterMaterialPath;
            lodPolicy = profile.lodPolicy;
            vegetationDensity = profile.vegetationDensity;
            activityDensity = profile.activityDensity;
            groundTint = profile.groundTint;
            atmosphereTint = profile.atmosphereTint;
        }
    }
}
