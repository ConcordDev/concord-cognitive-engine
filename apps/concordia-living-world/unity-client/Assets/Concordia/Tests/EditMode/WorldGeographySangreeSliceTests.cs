using System.Linq;
using Concordia.GameplayCore.GoldenSlice;
using NUnit.Framework;
using UnityEngine;

namespace Concordia.Tests
{
    /// <summary>
    /// Pins the geography authority vertical slice: Tunya Canon capitals drive
    /// CityAtlas → WorldGeography → Sangree kingdom territory → Sandrun settlement.
    /// No Play Mode / megaworld boot — Resources JSON + static builders only.
    /// </summary>
    public class WorldGeographySangreeSliceTests
    {
        [SetUp]
        public void SetUp()
        {
            CityAtlas.Invalidate();
            WorldGeography.Invalidate();
        }

        [Test]
        public void TunyaCapitals_AreAuthoredNotRingInvented()
        {
            var cities = CityAtlas.For(WorldId.Tunya);
            Assert.Greater(cities.Length, 0, "Tunya CityAtlas empty — countries.json not loaded");
            var nearZero = cities.Count(c => Mathf.Abs(c.x) <= 2f && Mathf.Abs(c.z) <= 2f);
            Assert.AreEqual(0, nearZero, "Capitals still near origin — PlaceOnRing would invent layout");
        }

        [Test]
        public void SangreeCity_MatchesGoldenSliceSettlementIdAndCoords()
        {
            var cities = CityAtlas.For(WorldId.Tunya);
            WorldBook.CityDef sangree = null;
            foreach (var c in cities)
                if (c != null && c.id == "sandrun_sanguire") { sangree = c; break; }
            Assert.IsNotNull(sangree, "Expected CityAtlas id sandrun_sanguire (faction_id of Sangree country)");
            Assert.AreEqual(-4.43f, sangree.x, 0.02f);
            Assert.AreEqual(-65.85f, sangree.z, 0.02f);
            Assert.IsNotNull(sangree.districts);
            Assert.GreaterOrEqual(sangree.districts.Length, 3, "Sandrun controlled_districts should drive city districts");
            CollectionAssert.Contains(sangree.districts, "sandrun_forge_quarter");
        }

        [Test]
        public void SangreeRegionAndTerritory_ExistSpatially()
        {
            WorldGeography.EnsureBuilt();
            var region = WorldGeography.FindRegion(WorldId.Tunya, new RegionId("tunya/region/sangree"));
            Assert.IsNotNull(region, "tunya/region/sangree missing");
            Assert.IsNotNull(region.bounds);
            Assert.IsTrue(region.bounds.Contains(new Vector2(-4.43f, -65.85f)));

            var territory = WorldGeography.TerritoryAt(WorldId.Tunya, new Vector2(-4.43f, -65.85f));
            Assert.IsNotNull(territory);
            Assert.AreEqual("sangree", territory.countryId);
            Assert.AreEqual("sandrun_sanguire", territory.factionId);
            Assert.AreEqual(GoldenSliceRuntime.SettlementId, territory.capitalSettlementId);
            Assert.GreaterOrEqual(territory.polygon.Length, 5);
        }

        [Test]
        public void SandrunSettlement_CompilesFromGeographySpine()
        {
            WorldGeography.EnsureBuilt();
            var def = WorldGeography.FindSettlement(WorldId.Tunya,
                new SettlementId(GoldenSliceRuntime.SettlementId));
            Assert.IsNotNull(def);
            Assert.AreEqual("sandrun_sanguire", def.legacyCityId);
            Assert.AreEqual("tunya/region/sangree", def.region.value);
            Assert.AreEqual(-4.43f, def.localPosition.x, 0.02f);
            Assert.AreEqual(-65.85f, def.localPosition.y, 0.02f);
            CollectionAssert.Contains(def.districts, "sandrun_forge_quarter");
            CollectionAssert.Contains(def.services, "forge");
            Assert.AreEqual("capital", def.type);
        }

        [Test]
        public void TunyaRegionalRoads_ConnectSettlementsWithoutInternationalBorder()
        {
            WorldGeography.EnsureBuilt();
            var regional = 0;
            foreach (var route in WorldGeography.Routes)
            {
                if (route == null) continue;
                if (!string.Equals(route.kind, "regional-road")) continue;
                if (route.worldA != WorldId.Tunya || route.worldB != WorldId.Tunya) continue;
                Assert.IsNull(route.border);
                Assert.GreaterOrEqual(route.waypoints.Length, 2);
                regional++;
            }
            Assert.Greater(regional, 0, "Expected intra-Tunya regional roads between capitals");
        }

        [Test]
        public void GeographyValidation_PassesWithRegionalRoads()
        {
            var errors = WorldGeography.Validate();
            Assert.IsEmpty(errors, string.Join("\n", errors));
        }

        [Test]
        public void GoldenSliceRegionId_MatchesSangreeCountryRegion()
        {
            Assert.AreEqual("tunya/region/sangree", GoldenSliceRuntime.RegionId);
        }
    }
}
