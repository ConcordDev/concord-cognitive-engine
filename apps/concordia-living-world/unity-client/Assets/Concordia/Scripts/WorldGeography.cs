using System;
using System.Collections.Generic;
using System.Text;
using UnityEngine;

namespace Concordia
{
    [Serializable]
    public sealed class RegionId : IEquatable<RegionId>
    {
        public string value;

        public RegionId() { }
        public RegionId(string raw) { value = Normalize(raw); }
        public bool IsValid => !string.IsNullOrEmpty(value);
        public override string ToString() => value ?? string.Empty;
        public override int GetHashCode() => StringComparer.OrdinalIgnoreCase.GetHashCode(value ?? string.Empty);
        public override bool Equals(object obj) => Equals(obj as RegionId);
        public bool Equals(RegionId other) => other != null && string.Equals(value, other.value, StringComparison.OrdinalIgnoreCase);
        public static bool operator ==(RegionId a, RegionId b) => ReferenceEquals(a, b) || (a?.Equals(b) ?? false);
        public static bool operator !=(RegionId a, RegionId b) => !(a == b);
        public static string Normalize(string raw) => string.IsNullOrEmpty(raw) ? string.Empty : raw.Trim().ToLowerInvariant().Replace(' ', '-');
    }

    [Serializable]
    public sealed class SettlementId : IEquatable<SettlementId>
    {
        public string value;

        public SettlementId() { }
        public SettlementId(string raw) { value = Normalize(raw); }
        public bool IsValid => !string.IsNullOrEmpty(value);
        public override string ToString() => value ?? string.Empty;
        public override int GetHashCode() => StringComparer.OrdinalIgnoreCase.GetHashCode(value ?? string.Empty);
        public override bool Equals(object obj) => Equals(obj as SettlementId);
        public bool Equals(SettlementId other) => other != null && string.Equals(value, other.value, StringComparison.OrdinalIgnoreCase);
        public static bool operator ==(SettlementId a, SettlementId b) => ReferenceEquals(a, b) || (a?.Equals(b) ?? false);
        public static bool operator !=(SettlementId a, SettlementId b) => !(a == b);
        public static string Normalize(string raw) => string.IsNullOrEmpty(raw) ? string.Empty : raw.Trim().ToLowerInvariant().Replace(' ', '-');
    }

    [Serializable]
    public sealed class PlaceId : IEquatable<PlaceId>
    {
        public string value;

        public PlaceId() { }
        public PlaceId(string raw) { value = Normalize(raw); }
        public bool IsValid => !string.IsNullOrEmpty(value);
        public override string ToString() => value ?? string.Empty;
        public override int GetHashCode() => StringComparer.OrdinalIgnoreCase.GetHashCode(value ?? string.Empty);
        public override bool Equals(object obj) => Equals(obj as PlaceId);
        public bool Equals(PlaceId other) => other != null && string.Equals(value, other.value, StringComparison.OrdinalIgnoreCase);
        public static bool operator ==(PlaceId a, PlaceId b) => ReferenceEquals(a, b) || (a?.Equals(b) ?? false);
        public static bool operator !=(PlaceId a, PlaceId b) => !(a == b);
        public static string Normalize(string raw) => string.IsNullOrEmpty(raw) ? string.Empty : raw.Trim().ToLowerInvariant().Replace(' ', '-');
    }

    [Serializable]
    public sealed class BorderId : IEquatable<BorderId>
    {
        public string value;

        public BorderId() { }
        public BorderId(string raw) { value = Normalize(raw); }
        public bool IsValid => !string.IsNullOrEmpty(value);
        public override string ToString() => value ?? string.Empty;
        public override int GetHashCode() => StringComparer.OrdinalIgnoreCase.GetHashCode(value ?? string.Empty);
        public override bool Equals(object obj) => Equals(obj as BorderId);
        public bool Equals(BorderId other) => other != null && string.Equals(value, other.value, StringComparison.OrdinalIgnoreCase);
        public static bool operator ==(BorderId a, BorderId b) => ReferenceEquals(a, b) || (a?.Equals(b) ?? false);
        public static bool operator !=(BorderId a, BorderId b) => !(a == b);
        public static string Normalize(string raw) => string.IsNullOrEmpty(raw) ? string.Empty : raw.Trim().ToLowerInvariant().Replace(' ', '-');
    }

    [Serializable]
    public sealed class TradeRouteId : IEquatable<TradeRouteId>
    {
        public string value;

        public TradeRouteId() { }
        public TradeRouteId(string raw) { value = Normalize(raw); }
        public bool IsValid => !string.IsNullOrEmpty(value);
        public override string ToString() => value ?? string.Empty;
        public override int GetHashCode() => StringComparer.OrdinalIgnoreCase.GetHashCode(value ?? string.Empty);
        public override bool Equals(object obj) => Equals(obj as TradeRouteId);
        public bool Equals(TradeRouteId other) => other != null && string.Equals(value, other.value, StringComparison.OrdinalIgnoreCase);
        public static bool operator ==(TradeRouteId a, TradeRouteId b) => ReferenceEquals(a, b) || (a?.Equals(b) ?? false);
        public static bool operator !=(TradeRouteId a, TradeRouteId b) => !(a == b);
        public static string Normalize(string raw) => string.IsNullOrEmpty(raw) ? string.Empty : raw.Trim().ToLowerInvariant().Replace(' ', '-');
    }

    public enum GeoShape
    {
        Circle,
        Ring
    }

    [Serializable]
    public class GeoBounds
    {
        public GeoShape shape;
        public Vector2 center;
        public float innerRadius;
        public float outerRadius;

        public bool Contains(Vector2 local)
        {
            var distance = Vector2.Distance(center, local);
            if (shape == GeoShape.Ring)
                return distance >= innerRadius && distance <= outerRadius;
            return distance <= outerRadius;
        }
    }

    [Serializable]
    public class RegionDef
    {
        public RegionId id;
        public WorldId world;
        public string name;
        public GeoBounds bounds;
        public string terrainId;
        public string climateId;
        public int seed;
        public string[] settlementIds;
        public string[] wildernessPlaceIds;
        public string[] resourcePlaceIds;
        public string[] roadIds;
        public string[] tradeRouteIds;
        public string[] politicalEntityIds;
        public string[] factionIds;
    }

    [Serializable]
    public class SettlementDef
    {
        public SettlementId id;
        public WorldId world;
        public RegionId region;
        public string legacyCityId;
        public string name;
        public string type;
        public Vector2 localPosition;
        public int populationBaseline;
        public string factionId;
        public string politicalEntityId;
        public string[] districts;
        public string[] placeIds;
        public string[] roadIds;
        public string[] tradeRouteIds;
        public string[] services;
    }

    [Serializable]
    public class PlaceDef
    {
        public PlaceId id;
        public WorldId world;
        public RegionId region;
        public SettlementId settlement;
        public bool wilderness;
        public string name;
        public string kind;
        public Vector2 localPosition;
        public string[] tags;
    }

    [Serializable]
    public class BorderDef
    {
        public BorderId id;
        public WorldId worldA;
        public WorldId worldB;
        public RegionId regionA;
        public RegionId regionB;
        public Vector2 globalPosition;
        public Vector2[] crossingPoints;
        public float width = 8f;
        public string controllingFactionId;
        public float tariffRate = 0.05f;
        public string[] checkpointInfo;
        public string[] guardRoles;
        public string[] legalRequirements;
        public string status = "open";
        public bool physical = true;
    }

    [Serializable]
    public class TradeRouteDef
    {
        public TradeRouteId id;
        public WorldId worldA;
        public WorldId worldB;
        public RegionId regionA;
        public RegionId regionB;
        public SettlementId settlementA;
        public SettlementId settlementB;
        public BorderId border;
        public Vector2[] waypoints;
        public float width = 4.2f;
        public string kind = "road";
        public string[] tags;
        public bool physical = true;
    }

    /// <summary>
    /// Spatial kingdom footprint derived from authored Country capital + territory_radius.
    /// Not a painted rectangle — a deterministic disc/polygon around the capital.
    /// </summary>
    [Serializable]
    public class KingdomTerritoryDef
    {
        public string countryId;
        public string name;
        public WorldId world;
        public string factionId;
        public Vector2 center;
        public float radius = 22f;
        public Vector2[] polygon;
        public string capitalSettlementId;
        public string theme;
        public RegionId regionId;

        public bool Contains(Vector2 local) =>
            Vector2.Distance(center, local) <= radius;
    }

    /// <summary>
    /// Geographic definitions and queries layered over the existing Canon,
    /// CityAtlas, ContinentStream, and MegaworldMap systems. This is static
    /// structure only; mutable state remains in WorldSliceRec.
    /// </summary>
    public static class WorldGeography
    {
        static readonly Dictionary<WorldId, List<RegionDef>> RegionsByWorld = new Dictionary<WorldId, List<RegionDef>>();
        static readonly Dictionary<WorldId, List<SettlementDef>> SettlementsByWorld = new Dictionary<WorldId, List<SettlementDef>>();
        static readonly Dictionary<WorldId, List<PlaceDef>> PlacesByWorld = new Dictionary<WorldId, List<PlaceDef>>();
        static readonly Dictionary<WorldId, List<KingdomTerritoryDef>> TerritoriesByWorld = new Dictionary<WorldId, List<KingdomTerritoryDef>>();
        static readonly List<BorderDef> BordersList = new List<BorderDef>();
        static readonly List<TradeRouteDef> RoutesList = new List<TradeRouteDef>();
        static bool _built;
        static bool _reported;

        public static IReadOnlyList<BorderDef> Borders
        {
            get { EnsureBuilt(); return BordersList; }
        }

        public static IReadOnlyList<TradeRouteDef> Routes
        {
            get { EnsureBuilt(); return RoutesList; }
        }

        public static IReadOnlyList<KingdomTerritoryDef> Territories(WorldId world)
        {
            EnsureBuilt();
            return TerritoriesByWorld.TryGetValue(world, out var list) ? list : Array.Empty<KingdomTerritoryDef>();
        }

        /// <summary>Clear static geography so CityAtlas / Canon edits rebuild cleanly.</summary>
        public static void Invalidate()
        {
            _built = false;
            _reported = false;
            RegionsByWorld.Clear();
            SettlementsByWorld.Clear();
            PlacesByWorld.Clear();
            TerritoriesByWorld.Clear();
            BordersList.Clear();
            RoutesList.Clear();
        }

        public static void EnsureBuilt()
        {
            if (_built) return;
            Build();
        }

        public static IReadOnlyList<RegionDef> Regions(WorldId world)
        {
            EnsureBuilt();
            return RegionsByWorld.TryGetValue(world, out var list) ? list : Array.Empty<RegionDef>();
        }

        public static IReadOnlyList<SettlementDef> Settlements(WorldId world)
        {
            EnsureBuilt();
            return SettlementsByWorld.TryGetValue(world, out var list) ? list : Array.Empty<SettlementDef>();
        }

        public static IReadOnlyList<PlaceDef> Places(WorldId world)
        {
            EnsureBuilt();
            return PlacesByWorld.TryGetValue(world, out var list) ? list : Array.Empty<PlaceDef>();
        }

        public static RegionDef FindRegion(WorldId world, RegionId id)
        {
            if (id == null) return null;
            foreach (var region in Regions(world))
                if (region != null && region.id == id) return region;
            return null;
        }

        public static SettlementDef FindSettlement(WorldId world, SettlementId id)
        {
            if (id == null) return null;
            foreach (var settlement in Settlements(world))
                if (settlement != null && settlement.id == id) return settlement;
            return null;
        }

        public static PlaceDef FindPlace(WorldId world, PlaceId id)
        {
            if (id == null) return null;
            foreach (var place in Places(world))
                if (place != null && place.id == id) return place;
            return null;
        }

        public static BorderDef FindBorder(BorderId id)
        {
            if (id == null) return null;
            EnsureBuilt();
            foreach (var border in BordersList)
                if (border != null && border.id == id) return border;
            return null;
        }

        public static TradeRouteDef FindRoute(TradeRouteId id)
        {
            if (id == null) return null;
            EnsureBuilt();
            foreach (var route in RoutesList)
                if (route != null && route.id == id) return route;
            return null;
        }

        public static TradeRouteDef RouteBetween(WorldId a, WorldId b)
        {
            EnsureBuilt();
            foreach (var route in RoutesList)
            {
                if (route == null) continue;
                if ((route.worldA == a && route.worldB == b) || (route.worldA == b && route.worldB == a))
                    return route;
            }
            return null;
        }

        public static RegionDef RegionAt(WorldId world, Vector2 local)
        {
            var regions = Regions(world);
            RegionDef best = null;
            float bestDistance = float.PositiveInfinity;
            foreach (var region in regions)
            {
                if (region == null || region.bounds == null || !region.bounds.Contains(local)) continue;
                var distance = Vector2.Distance(region.bounds.center, local);
                if (distance < bestDistance)
                {
                    best = region;
                    bestDistance = distance;
                }
            }
            return best;
        }

        public static WorldId CountryAt(Vector3 present)
        {
            EnsureBuilt();
            foreach (var world in MegaworldMap.All)
            {
                if (world == WorldId.Hub) continue;
                if ((present - MegaworldMap.Present(world)).sqrMagnitude <= MegaworldMap.ArriveM * MegaworldMap.ArriveM)
                    return world;
            }

            var p = new Vector2(present.x, present.z);
            foreach (var route in RoutesList)
            {
                if (route == null || route.waypoints == null || route.waypoints.Length < 2) continue;
                for (int i = 0; i < route.waypoints.Length - 1; i++)
                {
                    float t;
                    var closest = ClosestPoint(p, route.waypoints[i], route.waypoints[i + 1], out t);
                    if (Vector2.Distance(p, closest) > route.width + 8f) continue;
                    var globalT = (i + t) / (route.waypoints.Length - 1f);
                    return globalT < 0.5f ? route.worldA : route.worldB;
                }
            }

            return MegaworldMap.LegacyCountryAt(present);
        }

        public static RegionDef RegionAt(Vector3 present, out WorldId world)
        {
            world = CountryAt(present);
            if (world == WorldId.Hub) return Regions(world).Count > 0 ? Regions(world)[0] : null;
            var local = new Vector2(present.x, present.z) - new Vector2(MegaworldMap.Present(world).x, MegaworldMap.Present(world).z);
            return RegionAt(world, local);
        }

        public static Vector3 Global(WorldId world, Vector2 local)
        {
            var center = MegaworldMap.Present(world);
            return center + new Vector3(local.x, 0f, local.y);
        }

        public static float TariffFor(BorderId borderId, WorldId from, WorldId to)
        {
            var border = FindBorder(borderId);
            if (border != null && border.tariffRate >= 0f) return border.tariffRate;
            var route = RouteBetween(from, to);
            var routeBorder = route != null ? FindBorder(route.border) : null;
            return routeBorder != null ? routeBorder.tariffRate : CrossRing.RingTariff;
        }

        public static void EnsurePersistence(WorldSliceRec slice, WorldId world)
        {
            if (slice == null) return;
            EnsureBuilt();
            var regions = new List<RegionSliceRec>();
            if (slice.regions != null)
                foreach (var state in slice.regions)
                    if (state != null && !string.IsNullOrEmpty(state.regionId)) regions.Add(state);
            foreach (var region in Regions(world))
            {
                if (region == null || region.id == null) continue;
                bool exists = false;
                foreach (var state in regions)
                    if (string.Equals(state.regionId, region.id.value, StringComparison.OrdinalIgnoreCase)) { exists = true; break; }
                if (exists) continue;
                regions.Add(new RegionSliceRec
                {
                    regionId = region.id.value,
                    discovered = world == WorldId.Hub && region.id.value == Id(world, "court"),
                    ecology = 0.7f,
                    activity = 0.5f,
                    controlFactionId = FirstFaction(world)
                });
            }
            slice.regions = regions.ToArray();

            var settlements = new List<SettlementSliceRec>();
            if (slice.settlements != null)
                foreach (var state in slice.settlements)
                    if (state != null && !string.IsNullOrEmpty(state.settlementId)) settlements.Add(state);
            foreach (var settlement in Settlements(world))
            {
                if (settlement == null || settlement.id == null) continue;
                bool exists = false;
                foreach (var state in settlements)
                    if (string.Equals(state.settlementId, settlement.id.value, StringComparison.OrdinalIgnoreCase)) { exists = true; break; }
                if (exists) continue;
                settlements.Add(new SettlementSliceRec
                {
                    settlementId = settlement.id.value,
                    population = settlement.populationBaseline,
                    prices = 1f,
                    controlFactionId = settlement.factionId ?? FirstFaction(world),
                    incidentsCsv = "",
                    constructionCsv = "",
                    activitiesCsv = ""
                });
            }
            slice.settlements = settlements.ToArray();
        }

        public static void RecordBorderCrossing(BorderId id, WorldId from, WorldId to, string mode)
        {
            if (id == null || from == to) return;
            var all = WorldMemory.All();
            var row = id.value + "|" + from + "|" + to + "|" + (mode ?? "physical") + "|" + WorldClock.Day + ":" + Mathf.FloorToInt(WorldClock.Hour);
            var csv = all.borderCrossingsCsv ?? string.Empty;
            if (csv.Contains(id.value + "|" + from + "|" + to + "|")) return;
            all.borderCrossingsCsv = string.IsNullOrEmpty(csv) ? row : csv + ";" + row;
            WorldClock.PushFeed("border", "Crossed the border into " + Canon.Get(to).title + ".");
        }

        public static string ValidationReport()
        {
            var errors = Validate();
            if (errors.Length == 0) return "World geography validation passed.";
            var sb = new StringBuilder("World geography validation found " + errors.Length + " issue(s):\n");
            foreach (var error in errors) sb.AppendLine("- " + error);
            return sb.ToString();
        }

        public static string[] Validate()
        {
            EnsureBuilt();
            var errors = new List<string>();
            foreach (var world in MegaworldMap.All)
            {
                var regionIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (var region in Regions(world))
                {
                    if (region == null || region.id == null || !region.id.IsValid) { errors.Add(world + " has a region without a valid id"); continue; }
                    if (!regionIds.Add(region.id.value)) errors.Add("duplicate region id " + region.id.value);
                    if (region.world != world) errors.Add("region " + region.id.value + " has wrong parent world");
                }

                var settlementIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (var settlement in Settlements(world))
                {
                    if (settlement == null || settlement.id == null || !settlement.id.IsValid) { errors.Add(world + " has a settlement without a valid id"); continue; }
                    if (!settlementIds.Add(settlement.id.value)) errors.Add("duplicate settlement id " + settlement.id.value);
                    if (settlement.world != world) errors.Add("settlement " + settlement.id.value + " has wrong parent world");
                    if (FindRegion(world, settlement.region) == null) errors.Add("settlement " + settlement.id.value + " references a missing region");
                }

                var placeIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (var place in Places(world))
                {
                    if (place == null || place.id == null || !place.id.IsValid) { errors.Add(world + " has a place without a valid id"); continue; }
                    if (!placeIds.Add(place.id.value)) errors.Add("duplicate place id " + place.id.value);
                    if (place.world != world) errors.Add("place " + place.id.value + " has wrong parent world");
                    if (FindRegion(world, place.region) == null) errors.Add("place " + place.id.value + " references a missing region");
                    if (!place.wilderness && FindSettlement(world, place.settlement) == null) errors.Add("place " + place.id.value + " references a missing settlement");
                }
            }

            var borderIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var border in BordersList)
            {
                if (border == null || border.id == null || !border.id.IsValid) { errors.Add("border without a valid id"); continue; }
                if (!borderIds.Add(border.id.value)) errors.Add("duplicate border id " + border.id.value);
                if (border.worldA == border.worldB) errors.Add("border " + border.id.value + " has identical endpoints");
                if (border.crossingPoints == null || border.crossingPoints.Length == 0) errors.Add("border " + border.id.value + " has no crossing point");
            }

            var routeIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var route in RoutesList)
            {
                if (route == null || route.id == null || !route.id.IsValid) { errors.Add("trade route without a valid id"); continue; }
                if (!routeIds.Add(route.id.value)) errors.Add("duplicate trade route id " + route.id.value);
                var regional = string.Equals(route.kind, "regional-road", StringComparison.OrdinalIgnoreCase);
                if (!regional && route.worldA == route.worldB) errors.Add("route " + route.id.value + " has identical endpoints");
                if (route.waypoints == null || route.waypoints.Length < 2) errors.Add("route " + route.id.value + " is disconnected");
                if (!regional && FindBorder(route.border) == null) errors.Add("route " + route.id.value + " references a missing border");
            }
            return errors.ToArray();
        }

        public static void ReportValidationOnce()
        {
            if (_reported) return;
            _reported = true;
            var errors = Validate();
            if (errors.Length == 0) Debug.Log("[Concordia] World geography validation passed.");
            else foreach (var error in errors) Debug.LogWarning("[Concordia] Geography: " + error);
        }

        static void Build()
        {
            _built = true;
            RegionsByWorld.Clear();
            SettlementsByWorld.Clear();
            PlacesByWorld.Clear();
            TerritoriesByWorld.Clear();
            BordersList.Clear();
            RoutesList.Clear();

            foreach (var world in MegaworldMap.All)
            {
                BuildRegions(world);
                BuildTerritories(world);
                BuildSettlements(world);
                BuildPlaces(world);
            }
            BuildBordersAndRoutes();
            foreach (var world in MegaworldMap.All)
            {
                if (world == WorldId.Hub) continue;
                BuildRegionalRoadLinks(world);
            }
        }

        static void BuildRegions(WorldId world)
        {
            var list = new List<RegionDef>();
            if (world == WorldId.Hub)
            {
                // Compact city-state geography — Court core, metro districts, outer approaches.
                // No kingdom territory (BuildTerritories already returns empty for Hub).
                list.Add(MakeRegion(world, "court", "The Unburned Court", GeoShape.Circle, Vector2.zero, 0f, 40f));
                list.Add(MakeRegion(world, "metro", "Hub Metro", GeoShape.Ring, Vector2.zero, 40f, 72f));
                list.Add(MakeRegion(world, "approaches", "Hub Approaches", GeoShape.Ring, Vector2.zero, 72f, 120f));
            }
            else
            {
                var countries = WorldBook.Countries(world);
                if (countries != null && countries.Length > 0)
                {
                    // Authoritative geography: one region per Country capital footprint.
                    foreach (var country in countries)
                    {
                        if (country == null || string.IsNullOrEmpty(country.country_id)) continue;
                        var center = CountryCenter(country);
                        var radius = country.territory_radius > 1f ? country.territory_radius : 22f;
                        var regionKey = RegionKeyForCountry(country);
                        var region = MakeRegion(world, regionKey,
                            country.name + " Region", GeoShape.Circle, center, 0f, radius);
                        region.factionIds = string.IsNullOrEmpty(country.faction_id)
                            ? region.factionIds
                            : new[] { country.faction_id };
                        region.politicalEntityIds = region.factionIds;
                        region.terrainId = WorldBook.Folder(world) + ":terrain:" + regionKey
                            + ":" + (country.theme ?? "country");
                        region.climateId = ClimateTagCountry(world, country);
                        list.Add(region);
                    }
                    list.Add(MakeRegion(world, "wilds", Canon.Get(world).title + " Wilds",
                        GeoShape.Ring, Vector2.zero, 90f, 126f));
                }
                else
                {
                    list.Add(MakeRegion(world, "heartland", Canon.Get(world).title + " Heartland", GeoShape.Circle, Vector2.zero, 0f, 34f));
                    list.Add(MakeRegion(world, "march", Canon.Get(world).title + " March", GeoShape.Ring, Vector2.zero, 34f, 76f));
                    list.Add(MakeRegion(world, "wilds", Canon.Get(world).title + " Wilds", GeoShape.Ring, Vector2.zero, 76f, 126f));
                }
            }
            RegionsByWorld[world] = list;
        }

        /// <summary>
        /// Tunya uses human country slugs (sangree). Generated country files use faction ids
        /// as country_id — RegionId must stay path-safe and match SettlementDef region links.
        /// </summary>
        static string RegionKeyForCountry(WorldBook.Country country)
        {
            if (country == null) return "unknown";
            // Prefer short Tunya-style country_id when it is not identical to a long faction slug
            // that already embeds world context; country_id is the authority either way.
            return CountryId.Normalize(country.country_id);
        }

        static class CountryId
        {
            public static string Normalize(string raw) =>
                string.IsNullOrEmpty(raw) ? "unknown" : raw.Trim().ToLowerInvariant().Replace(' ', '-');
        }

        static void BuildTerritories(WorldId world)
        {
            var list = new List<KingdomTerritoryDef>();
            if (world == WorldId.Hub)
            {
                TerritoriesByWorld[world] = list;
                return;
            }
            foreach (var country in WorldBook.Countries(world))
            {
                if (country == null || string.IsNullOrEmpty(country.country_id)) continue;
                var center = CountryCenter(country);
                var radius = country.territory_radius > 1f ? country.territory_radius : 22f;
                var settlementKey = !string.IsNullOrEmpty(country.faction_id)
                    ? country.faction_id : country.country_id;
                var regionKey = RegionKeyForCountry(country);
                list.Add(new KingdomTerritoryDef
                {
                    countryId = country.country_id,
                    name = country.name,
                    world = world,
                    factionId = country.faction_id,
                    center = center,
                    radius = radius,
                    polygon = RegularPolygon(center, radius, 10),
                    capitalSettlementId = "settlement/" + WorldBook.Folder(world) + "/" + settlementKey,
                    theme = country.theme,
                    regionId = new RegionId(Id(world, regionKey))
                });
            }
            TerritoriesByWorld[world] = list;
        }

        public static KingdomTerritoryDef TerritoryAt(WorldId world, Vector2 local)
        {
            EnsureBuilt();
            KingdomTerritoryDef best = null;
            float bestD = float.PositiveInfinity;
            foreach (var t in Territories(world))
            {
                if (t == null || !t.Contains(local)) continue;
                var d = Vector2.Distance(t.center, local);
                if (d < bestD) { bestD = d; best = t; }
            }
            return best;
        }

        static Vector2 CountryCenter(WorldBook.Country country)
        {
            if (country?.capital != null && (Mathf.Abs(country.capital.x) > 2f || Mathf.Abs(country.capital.z) > 2f))
                return new Vector2(country.capital.x, country.capital.z);
            if (country?.anchors != null)
            {
                foreach (var a in country.anchors)
                {
                    if (a == null) continue;
                    if (Mathf.Abs(a.x) > 2f || Mathf.Abs(a.z) > 2f)
                        return new Vector2(a.x, a.z);
                }
            }
            return Vector2.zero;
        }

        static string ClimateTagCountry(WorldId world, WorldBook.Country country)
        {
            if (country?.climate == null)
                return WorldBook.Folder(world) + ":climate:" + country?.country_id;
            return WorldBook.Folder(world) + ":climate:" + country.country_id
                + ":temp=" + country.climate.temperature.ToString("0.0")
                + ":humidity=" + country.climate.humidity.ToString("0.0")
                + ":air=" + country.climate.airQuality.ToString("0.00")
                + ":wind=" + (country.climate.wind ?? "still");
        }

        static Vector2[] RegularPolygon(Vector2 center, float radius, int sides)
        {
            var pts = new Vector2[Mathf.Max(5, sides)];
            for (int i = 0; i < pts.Length; i++)
            {
                var a = i / (float)pts.Length * Mathf.PI * 2f;
                pts[i] = center + new Vector2(Mathf.Cos(a), Mathf.Sin(a)) * radius;
            }
            return pts;
        }

        static void BuildSettlements(WorldId world)
        {
            var list = new List<SettlementDef>();
            // Hub: CityAtlas.For(Hub) is authored cities.json (Compact city-state).
            // Prior early-return with a lone hub-court row left CityTown with nothing to build.
            if (world == WorldId.Hub)
            {
                var hubCities = CityAtlas.For(world);
                for (int i = 0; i < hubCities.Length; i++)
                {
                    var city = hubCities[i];
                    if (city == null || string.IsNullOrEmpty(city.id)) continue;
                    var local = new Vector2(city.x, city.z);
                    var region = RegionAt(world, local) ?? (Regions(world).Count > 0 ? Regions(world)[0] : null);
                    var isHeart = string.Equals(city.id, "hub", StringComparison.OrdinalIgnoreCase);
                    var type = isHeart ? "court"
                        : string.Equals(city.status, "stub", StringComparison.OrdinalIgnoreCase) ? "village"
                        : SettlementTypeFor(world, city, i == 0);
                    var pop = isHeart
                        ? Mathf.Max(Canon.HubGuests.Length * 4, ConcordiaHost.CourtPeopleCap)
                        : Mathf.Clamp(28 + (city.districts?.Length ?? 1) * 8, 20, 60);
                    list.Add(new SettlementDef
                    {
                        id = new SettlementId("settlement/" + WorldBook.Folder(world) + "/" + city.id),
                        world = world,
                        region = region != null ? region.id : new RegionId(Id(world, "court")),
                        legacyCityId = city.id,
                        name = city.name,
                        type = type,
                        localPosition = local,
                        populationBaseline = pop,
                        factionId = string.IsNullOrEmpty(city.factionId) ? "concordant_assembly" : city.factionId,
                        politicalEntityId = city.factionId,
                        districts = city.districts ?? Array.Empty<string>(),
                        services = isHeart
                            ? new[] { "arena", "embassy", "archive", "market", "watch", "gathering" }
                            : ServicesFor(world, city, type)
                    });
                    if (region != null)
                    {
                        var ids = new List<string>(region.settlementIds ?? Array.Empty<string>());
                        var sid = "settlement/" + WorldBook.Folder(world) + "/" + city.id;
                        if (!ids.Contains(sid)) ids.Add(sid);
                        region.settlementIds = ids.ToArray();
                    }
                }
                SettlementsByWorld[world] = list;
                return;
            }

            var people = WorldBook.People(world);
            var cities = CityAtlas.For(world);
            for (int i = 0; i < cities.Length; i++)
            {
                var city = cities[i];
                if (city == null) continue;
                var local = new Vector2(city.x, city.z);
                var territory = TerritoryAt(world, local);
                var region = territory != null
                    ? FindRegion(world, territory.regionId)
                    : (RegionAt(world, local) ?? (Regions(world).Count > 1 ? Regions(world)[0] : null));
                var isCapital = territory != null && string.Equals(
                    territory.capitalSettlementId,
                    "settlement/" + WorldBook.Folder(world) + "/" + city.id,
                    StringComparison.OrdinalIgnoreCase);
                var type = SettlementTypeFor(world, city, isCapital || i == 0);
                var pop = PopulationFor(world, city, type, people.Length, cities.Length);
                list.Add(new SettlementDef
                {
                    id = new SettlementId("settlement/" + WorldBook.Folder(world) + "/" + (string.IsNullOrEmpty(city.id) ? "settlement-" + i : city.id)),
                    world = world,
                    region = region != null ? region.id : new RegionId(Id(world, "wilds")),
                    legacyCityId = city.id,
                    name = city.name,
                    type = type,
                    localPosition = local,
                    populationBaseline = pop,
                    factionId = city.factionId,
                    politicalEntityId = city.factionId,
                    districts = city.districts ?? Array.Empty<string>(),
                    services = ServicesFor(world, city, type)
                });
                if (region != null)
                {
                    var ids = new List<string>(region.settlementIds ?? Array.Empty<string>());
                    var sid = "settlement/" + WorldBook.Folder(world) + "/" + city.id;
                    if (!ids.Contains(sid)) ids.Add(sid);
                    region.settlementIds = ids.ToArray();
                }
            }
            if (list.Count == 0)
            {
                var region = Regions(world).Count > 0 ? Regions(world)[0] : null;
                if (region != null)
                {
                    list.Add(new SettlementDef
                    {
                        id = new SettlementId("settlement/" + WorldBook.Folder(world) + "/arrival"),
                        world = world,
                        region = region.id,
                        legacyCityId = "arrival",
                        name = Canon.Get(world).title + " Arrival",
                        type = "arrival",
                        localPosition = new Vector2(0f, 0f),
                        populationBaseline = Mathf.Max(50, people.Length),
                        factionId = FirstFaction(world),
                        services = new[] { "road", "gathering" }
                    });
                }
            }
            SettlementsByWorld[world] = list;
        }

        static string SettlementTypeFor(WorldId world, WorldBook.CityDef city, bool isCapital)
        {
            if (city == null) return "settlement";
            var country = FindCountryForCity(world, city);
            var theme = (country?.theme ?? "").ToLowerInvariant();
            var key = ((city.id ?? "") + " " + (city.name ?? "") + " " + (city.description ?? "") + " " + theme).ToLowerInvariant();
            if (theme.Contains("fire") || theme.Contains("volcanic") || key.Contains("forge") || key.Contains("sangree") || key.Contains("sandrun"))
                return isCapital ? "capital" : "forge";
            if (theme.Contains("harbor") || theme.Contains("dye") || theme.Contains("coastal") || key.Contains("dock") || key.Contains("port") || key.Contains("fluxom"))
                return "port";
            if (theme.Contains("desert") || theme.Contains("arid") || key.Contains("mine") || key.Contains("ore") || key.Contains("asbir"))
                return "mining";
            if (theme.Contains("glacier") || theme.Contains("ice") || theme.Contains("highland_frost") || key.Contains("aekon") || key.Contains("vessine"))
                return isCapital ? "capital" : "hold";
            if (theme.Contains("grove") || theme.Contains("old-growth") || theme.Contains("woodland") || key.Contains("nil") || key.Contains("corre"))
                return "village";
            if (theme.Contains("industrial") || theme.Contains("brick") || theme.Contains("neon") || theme.Contains("glass-steel"))
                return isCapital ? "capital" : "borough";
            if (theme.Contains("ruin") || theme.Contains("archive") || key.Contains("ruin"))
                return "archive";
            if (theme.Contains("isle") || theme.Contains("island"))
                return "port";
            if (isCapital) return "capital";
            var districts = city.districts?.Length ?? 0;
            if (districts <= 1) return "village";
            if (districts >= 4) return "town";
            return "settlement";
        }

        static WorldBook.Country FindCountryForCity(WorldId world, WorldBook.CityDef city)
        {
            if (city == null) return null;
            foreach (var c in WorldBook.Countries(world))
            {
                if (c == null) continue;
                if (!string.IsNullOrEmpty(city.factionId) &&
                    string.Equals(c.faction_id, city.factionId, StringComparison.OrdinalIgnoreCase))
                    return c;
                if (string.Equals(c.country_id, city.id, StringComparison.OrdinalIgnoreCase))
                    return c;
                if (string.Equals(c.faction_id, city.id, StringComparison.OrdinalIgnoreCase))
                    return c;
            }
            return null;
        }

        static int PopulationFor(WorldId world, WorldBook.CityDef city, string type, int peopleCount, int cityCount)
        {
            var basePop = Mathf.Max(40, peopleCount * Mathf.Max(1, 3 / Mathf.Max(1, cityCount)));
            var districts = city?.districts?.Length ?? 1;
            var mult = type switch
            {
                "capital" => 2.4f,
                "borough" => 2.0f,
                "town" => 1.6f,
                "port" => 1.5f,
                "forge" => 1.4f,
                "mining" => 1.2f,
                "hold" => 1.3f,
                "archive" => 1.1f,
                "village" => 0.7f,
                _ => 1.0f
            };
            return Mathf.Clamp(Mathf.RoundToInt(basePop * mult * (0.85f + districts * 0.12f)), 30, 900);
        }

        static string[] ServicesFor(WorldId world, WorldBook.CityDef city, string type)
        {
            switch (type)
            {
                case "capital":
                    if (city != null && ((city.id ?? "").IndexOf("sandrun", StringComparison.OrdinalIgnoreCase) >= 0
                        || (city.name ?? "").IndexOf("Forge", StringComparison.OrdinalIgnoreCase) >= 0
                        || (city.id ?? "").IndexOf("sangree", StringComparison.OrdinalIgnoreCase) >= 0))
                        return new[] { "forge", "market", "road", "watch", "tavern" };
                    return new[] { "market", "road", "archive", "gathering", "watch", "tavern" };
                case "borough":
                    return new[] { "market", "road", "warehouse", "watch", "tavern" };
                case "town":
                    return new[] { "market", "road", "gathering", "watch" };
                case "forge":
                case "mining":
                    return new[] { "forge", "market", "road", "watch" };
                case "port":
                    return new[] { "dock", "market", "road", "warehouse", "tavern" };
                case "hold":
                    return new[] { "watch", "archive", "road", "gathering" };
                case "archive":
                    return new[] { "archive", "road", "gathering" };
                case "village":
                    return new[] { "gathering", "road", "farm" };
                default:
                    return new[] { "market", "road", "gathering" };
            }
        }

        /// <summary>
        /// Intra-civilization roads between nearest capitals — first-class geography
        /// under WorldGeography, not LeanPlay slabs.
        /// </summary>
        static void BuildRegionalRoadLinks(WorldId world)
        {
            var settlements = Settlements(world);
            if (settlements == null || settlements.Count < 2) return;
            var linked = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            for (int i = 0; i < settlements.Count; i++)
            {
                var a = settlements[i];
                if (a == null || a.id == null) continue;
                SettlementDef n1 = null, n2 = null;
                float d1 = float.PositiveInfinity, d2 = float.PositiveInfinity;
                for (int j = 0; j < settlements.Count; j++)
                {
                    if (i == j) continue;
                    var b = settlements[j];
                    if (b == null) continue;
                    var d = Vector2.Distance(a.localPosition, b.localPosition);
                    if (d < d1) { d2 = d1; n2 = n1; d1 = d; n1 = b; }
                    else if (d < d2) { d2 = d; n2 = b; }
                }
                TryAddLocalRoad(world, a, n1, linked);
                TryAddLocalRoad(world, a, n2, linked);
            }
        }

        static void TryAddLocalRoad(WorldId world, SettlementDef a, SettlementDef b, HashSet<string> linked)
        {
            if (a == null || b == null || a.id == null || b.id == null) return;
            var key = string.Compare(a.id.value, b.id.value, StringComparison.OrdinalIgnoreCase) < 0
                ? a.id.value + "|" + b.id.value
                : b.id.value + "|" + a.id.value;
            if (!linked.Add(key)) return;
            var ga = Global(world, a.localPosition);
            var gb = Global(world, b.localPosition);
            var start = new Vector2(ga.x, ga.z);
            var end = new Vector2(gb.x, gb.z);
            var mid = Vector2.Lerp(start, end, 0.5f);
            var routeId = new TradeRouteId("route/" + WorldBook.Folder(world) + "/local/"
                + SettlementId.Normalize(a.legacyCityId) + "/" + SettlementId.Normalize(b.legacyCityId));
            var route = new TradeRouteDef
            {
                id = routeId,
                worldA = world,
                worldB = world,
                regionA = a.region,
                regionB = b.region,
                settlementA = a.id,
                settlementB = b.id,
                border = null,
                waypoints = new[] { start, mid, end },
                width = 3.2f,
                kind = "regional-road",
                tags = new[] { "road", "trade", "regional", "physical" },
                physical = true
            };
            RoutesList.Add(route);
            var aIds = new List<string>(a.roadIds ?? Array.Empty<string>()) { route.id.value };
            a.roadIds = aIds.ToArray();
            var bIds = new List<string>(b.roadIds ?? Array.Empty<string>()) { route.id.value };
            b.roadIds = bIds.ToArray();
            a.tradeRouteIds = MergeIds(a.tradeRouteIds, route.id.value);
            b.tradeRouteIds = MergeIds(b.tradeRouteIds, route.id.value);
        }

        static string[] MergeIds(string[] existing, string id)
        {
            var list = new List<string>(existing ?? Array.Empty<string>());
            if (!list.Contains(id)) list.Add(id);
            return list.ToArray();
        }

        static void BuildPlaces(WorldId world)
        {
            var list = new List<PlaceDef>();
            var settlements = Settlements(world);
            foreach (var settlement in settlements)
            {
                if (settlement == null) continue;
                var ids = new List<string>();
                var center = new PlaceDef
                {
                    id = new PlaceId("place/" + settlement.id.value + "/center"),
                    world = world,
                    region = settlement.region,
                    settlement = settlement.id,
                    wilderness = false,
                    name = settlement.name + " center",
                    kind = "settlement-center",
                    localPosition = settlement.localPosition,
                    tags = new[] { "settlement", settlement.type }
                };
                list.Add(center);
                ids.Add(center.id.value);
                var districts = settlement.districts ?? Array.Empty<string>();
                for (int i = 0; i < districts.Length; i++)
                {
                    var district = districts[i];
                    if (string.IsNullOrEmpty(district)) continue;
                    var offset = DeterministicOffset(settlement.id.value + ":" + district, 8f + i * 2f);
                    var place = new PlaceDef
                    {
                        id = new PlaceId("place/" + settlement.id.value + "/district/" + PlaceId.Normalize(district)),
                        world = world,
                        region = settlement.region,
                        settlement = settlement.id,
                        wilderness = false,
                        name = CityAtlas.Titleize(district),
                        kind = "district",
                        localPosition = settlement.localPosition + offset,
                        tags = new[] { "district", district }
                    };
                    list.Add(place);
                    ids.Add(place.id.value);
                }
                settlement.placeIds = ids.ToArray();
            }

            if (world != WorldId.Hub)
            {
                var wild = FindRegion(world, new RegionId(Id(world, "wilds")));
                AddWildernessPlace(list, world, wild, "farm", "Outer farm", new Vector2(-92f, 22f));
                AddWildernessPlace(list, world, wild, "resource", "Regional resource site", new Vector2(88f, -24f));
                AddWildernessPlace(list, world, wild, "ruin", "Roadside ruin", new Vector2(14f, 104f));
            }
            PlacesByWorld[world] = list;
        }

        static void BuildBordersAndRoutes()
        {
            var ring = new[]
            {
                WorldId.Cyber, WorldId.Ruins, WorldId.Fantasy, WorldId.Tunya,
                WorldId.Frontier, WorldId.Crime, WorldId.Superhero, WorldId.Crucible
            };
            for (int i = 0; i < ring.Length; i++)
            {
                var a = ring[i];
                var b = ring[(i + 1) % ring.Length];
                AddRoute(a, b, i);
            }
            AddRoute(WorldId.Crime, WorldId.Sere, ring.Length + 1);
        }

        static void AddRoute(WorldId a, WorldId b, int index)
        {
            var from = MegaworldMap.Present(a);
            var to = MegaworldMap.Present(b);
            var start = new Vector2(from.x, from.z);
            var end = new Vector2(to.x, to.z);
            var mid = Vector2.Lerp(start, end, 0.5f);
            var borderId = new BorderId("border/" + WorldBook.Folder(a) + "/" + WorldBook.Folder(b));
            var routeId = new TradeRouteId("route/" + WorldBook.Folder(a) + "/" + WorldBook.Folder(b));
            var disputed = IsDisputed(a, b);
            var border = new BorderDef
            {
                id = borderId,
                worldA = a,
                worldB = b,
                regionA = new RegionId(Id(a, "wilds")),
                regionB = new RegionId(Id(b, "wilds")),
                globalPosition = mid,
                crossingPoints = new[] { mid },
                width = 10f,
                controllingFactionId = FirstFaction(a),
                tariffRate = disputed ? 0.12f : CrossRing.RingTariff,
                checkpointInfo = disputed
                    ? new[] { "disputed checkpoint", "inspection", "border arbitration" }
                    : new[] { "physical checkpoint", "inspection", "roadside marker" },
                guardRoles = disputed
                    ? new[] { "border guard", "inspector", "arbitrator" }
                    : new[] { "border guard", "inspector", "road watch" },
                legalRequirements = disputed
                    ? new[] { "declare cargo", "carry a valid crossing writ" }
                    : new[] { "declare cargo", "respect local law" },
                status = disputed ? "disputed" : "open",
                physical = true
            };
            BordersList.Add(border);
            var settlementA = NearestSettlement(a, Vector2.zero);
            var settlementB = NearestSettlement(b, Vector2.zero);
            var route = new TradeRouteDef
            {
                id = routeId,
                worldA = a,
                worldB = b,
                regionA = border.regionA,
                regionB = border.regionB,
                settlementA = settlementA != null ? settlementA.id : null,
                settlementB = settlementB != null ? settlementB.id : null,
                border = border.id,
                waypoints = new[] { start, mid, end },
                width = 4.2f,
                kind = "international-road",
                tags = new[] { "road", "trade", "border", "physical" },
                physical = true
            };
            RoutesList.Add(route);
            AttachRoute(a, route);
            AttachRoute(b, route);
        }

        static void AttachRoute(WorldId world, TradeRouteDef route)
        {
            foreach (var settlement in Settlements(world))
            {
                if (settlement == null) continue;
                var global = Global(world, settlement.localPosition);
                var routePoint = ClosestPoint(new Vector2(global.x, global.z), route.waypoints[0], route.waypoints[route.waypoints.Length - 1], out _);
                if (Vector2.Distance(new Vector2(global.x, global.z), routePoint) > 92f) continue;
                var ids = new List<string>(settlement.tradeRouteIds ?? Array.Empty<string>());
                if (!ids.Contains(route.id.value)) ids.Add(route.id.value);
                settlement.tradeRouteIds = ids.ToArray();
            }
            foreach (var region in Regions(world))
            {
                if (region == null) continue;
                var ids = new List<string>(region.tradeRouteIds ?? Array.Empty<string>());
                if (!ids.Contains(route.id.value)) ids.Add(route.id.value);
                region.tradeRouteIds = ids.ToArray();
            }
        }

        static void AddWildernessPlace(List<PlaceDef> list, WorldId world, RegionDef region, string kind, string name, Vector2 local)
        {
            if (region == null) return;
            var place = new PlaceDef
            {
                id = new PlaceId("place/" + WorldBook.Folder(world) + "/wild/" + kind),
                world = world,
                region = region.id,
                settlement = null,
                wilderness = true,
                name = name,
                kind = kind,
                localPosition = local,
                tags = new[] { "wilderness", kind }
            };
            list.Add(place);
            var target = kind == "farm" ? region.wildernessPlaceIds : region.resourcePlaceIds;
            var ids = new List<string>(target ?? Array.Empty<string>()) { place.id.value };
            if (kind == "farm" || kind == "ruin") region.wildernessPlaceIds = ids.ToArray();
            else region.resourcePlaceIds = ids.ToArray();
        }

        static RegionDef MakeRegion(WorldId world, string key, string name, GeoShape shape, Vector2 center, float inner, float outer)
        {
            return new RegionDef
            {
                id = new RegionId(Id(world, key)),
                world = world,
                name = name,
                bounds = new GeoBounds { shape = shape, center = center, innerRadius = inner, outerRadius = outer },
                terrainId = WorldBook.Folder(world) + ":terrain:" + key,
                climateId = ClimateTag(world, key),
                seed = StableHash(WorldBook.Folder(world) + ":region:" + key),
                settlementIds = Array.Empty<string>(),
                wildernessPlaceIds = Array.Empty<string>(),
                resourcePlaceIds = Array.Empty<string>(),
                roadIds = Array.Empty<string>(),
                tradeRouteIds = Array.Empty<string>(),
                politicalEntityIds = Array.Empty<string>(),
                factionIds = new[] { FirstFaction(world) }
            };
        }

        static SettlementDef NearestSettlement(WorldId world, Vector2 local)
        {
            SettlementDef best = null;
            float bestD = float.PositiveInfinity;
            foreach (var settlement in Settlements(world))
            {
                if (settlement == null) continue;
                var d = Vector2.Distance(local, settlement.localPosition);
                if (d < bestD) { bestD = d; best = settlement; }
            }
            return best;
        }

        static string ClimateTag(WorldId world, string regionKey)
        {
            var countries = WorldBook.Countries(world);
            foreach (var country in countries)
            {
                if (country == null || country.climate == null) continue;
                return WorldBook.Folder(world) + ":climate:" + regionKey
                    + ":temp=" + country.climate.temperature.ToString("0.0")
                    + ":humidity=" + country.climate.humidity.ToString("0.0")
                    + ":air=" + country.climate.airQuality.ToString("0.00")
                    + ":wind=" + (country.climate.wind ?? "still");
            }
            return WorldBook.Folder(world) + ":climate:" + regionKey;
        }

        static bool IsDisputed(WorldId a, WorldId b)
        {
            var bIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var country in WorldBook.Countries(b))
                if (country != null && !string.IsNullOrEmpty(country.country_id)) bIds.Add(country.country_id);
            if (bIds.Count == 0) return false;
            foreach (var country in WorldBook.Countries(a))
            {
                if (country == null || country.disputed_border == null) continue;
                foreach (var disputed in country.disputed_border)
                    if (!string.IsNullOrEmpty(disputed) && bIds.Contains(disputed)) return true;
            }
            return false;
        }

        static string FirstFaction(WorldId world)
        {
            var factions = WorldBook.Factions(world);
            if (factions != null)
                foreach (var faction in factions)
                    if (faction != null && !string.IsNullOrEmpty(faction.id)) return faction.id;
            return world == WorldId.Hub ? "concordant-watch" : WorldBook.Folder(world);
        }

        static string Id(WorldId world, string suffix) => WorldBook.Folder(world) + "/region/" + suffix;

        static Vector2 DeterministicOffset(string key, float radius)
        {
            var h = StableHash(key);
            var angle = (h % 360) * Mathf.Deg2Rad;
            return new Vector2(Mathf.Cos(angle), Mathf.Sin(angle)) * radius;
        }

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

        static Vector2 ClosestPoint(Vector2 p, Vector2 a, Vector2 b, out float t)
        {
            var ab = b - a;
            var denom = Vector2.Dot(ab, ab);
            t = denom > 0.0001f ? Mathf.Clamp01(Vector2.Dot(p - a, ab) / denom) : 0f;
            return a + ab * t;
        }
    }
}
