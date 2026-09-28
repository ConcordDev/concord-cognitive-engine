using System.Collections.Generic;
using System.Linq;
using Concordia.GameplayCore.GoldenSlice;
using NUnit.Framework;
using UnityEngine;

namespace Concordia.Tests
{
    /// <summary>
    /// Fleet expansion of the geography authority pipeline: every civilization with
    /// Canon countries drives regions, territories, settlements, and regional roads.
    /// </summary>
    public class WorldGeographyFleetTests
    {
        [SetUp]
        public void SetUp()
        {
            CityAtlas.Invalidate();
            WorldGeography.Invalidate();
        }

        static IEnumerable<WorldId> PlayableWorlds()
        {
            foreach (var id in MegaworldMap.All)
                if (id != WorldId.Hub) yield return id;
        }

        [Test]
        public void EveryWorld_HasCountriesOrHonestEmpty()
        {
            foreach (var world in PlayableWorlds())
            {
                var countries = WorldBook.Countries(world);
                Assert.IsNotNull(countries, world + " Countries() null");
                // Generated + Tunya authored — all playable civs now carry countries.json.
                Assert.Greater(countries.Length, 0, world + " missing countries.json authority");
            }
        }

        [Test]
        public void EveryWorld_CapitalsAreSpatiallyAuthored()
        {
            foreach (var world in PlayableWorlds())
            {
                var cities = CityAtlas.For(world);
                Assert.Greater(cities.Length, 0, world + " CityAtlas empty");
                var nearZero = cities.Count(c => Mathf.Abs(c.x) <= 2f && Mathf.Abs(c.z) <= 2f);
                Assert.AreEqual(0, nearZero, world + " still has near-origin capitals");
            }
        }

        [Test]
        public void EveryWorld_HasKingdomTerritoriesMatchingCountries()
        {
            WorldGeography.EnsureBuilt();
            foreach (var world in PlayableWorlds())
            {
                var countries = WorldBook.Countries(world);
                var territories = WorldGeography.Territories(world);
                Assert.AreEqual(countries.Length, territories.Count,
                    world + " territory count != country count");
                foreach (var t in territories)
                {
                    Assert.IsNotNull(t.polygon);
                    Assert.GreaterOrEqual(t.polygon.Length, 5);
                    Assert.Greater(t.radius, 1f);
                    Assert.IsFalse(string.IsNullOrEmpty(t.capitalSettlementId));
                }
            }
        }

        [Test]
        public void EveryWorld_SettlementCountMatchesCityAtlas()
        {
            WorldGeography.EnsureBuilt();
            foreach (var world in PlayableWorlds())
            {
                var cities = CityAtlas.For(world);
                var settlements = WorldGeography.Settlements(world);
                Assert.AreEqual(cities.Length, settlements.Count, world + " settlement/city drift");
                foreach (var s in settlements)
                {
                    Assert.IsNotNull(s.region);
                    Assert.IsNotNull(s.districts);
                    Assert.Greater(s.districts.Length, 0, s.id + " has no districts");
                    Assert.Greater(s.populationBaseline, 0);
                    Assert.IsFalse(string.IsNullOrEmpty(s.type));
                }
            }
        }

        [Test]
        public void EveryWorld_HasRegionalRoadsWhenMultipleSettlements()
        {
            WorldGeography.EnsureBuilt();
            foreach (var world in PlayableWorlds())
            {
                if (WorldGeography.Settlements(world).Count < 2) continue;
                var regional = WorldGeography.Routes.Count(r =>
                    r != null && r.worldA == world && r.worldB == world
                    && string.Equals(r.kind, "regional-road"));
                Assert.Greater(regional, 0, world + " missing regional roads");
            }
        }

        [Test]
        public void Tunya_AllCountryThemesProduceDifferentiatedTypes()
        {
            WorldGeography.EnsureBuilt();
            var types = new HashSet<string>();
            foreach (var s in WorldGeography.Settlements(WorldId.Tunya))
                if (s != null) types.Add(s.type);
            Assert.GreaterOrEqual(types.Count, 3, "Tunya should differentiate settlement types, got: " + string.Join(",", types));
            Assert.IsTrue(types.Contains("capital") || types.Contains("forge"),
                "expected capital or forge among: " + string.Join(",", types));
        }

        [Test]
        public void FleetValidation_Passes()
        {
            var errors = WorldGeography.Validate();
            Assert.IsEmpty(errors, string.Join("\n", errors));
        }

        [Test]
        public void SangreeSlice_StillHolds()
        {
            WorldGeography.EnsureBuilt();
            var def = WorldGeography.FindSettlement(WorldId.Tunya, new SettlementId(GoldenSliceRuntime.SettlementId));
            Assert.IsNotNull(def);
            Assert.AreEqual("tunya/region/sangree", def.region.value);
            Assert.AreEqual(-4.43f, def.localPosition.x, 0.02f);
        }
    }
}
