using System.Linq;
using NUnit.Framework;

namespace Concordia.Tests
{
    /// <summary>
    /// Slice 2 — Hub CityAtlas must stop returning empty; districts match atlas § Hub.
    /// </summary>
    public class HubCityAtlasTests
    {
        [SetUp]
        public void SetUp()
        {
            CityAtlas.Invalidate();
            WorldGeography.Invalidate();
        }

        [Test]
        public void Hub_CityAtlas_IsNonEmpty()
        {
            var cities = CityAtlas.For(WorldId.Hub);
            Assert.Greater(cities.Length, 0, "CityAtlas.For(Hub) must not return empty");
        }

        [Test]
        public void Hub_Heart_HasCanonDistricts()
        {
            var cities = CityAtlas.For(WorldId.Hub);
            var hub = cities.FirstOrDefault(c => c != null && c.id == "hub");
            Assert.IsNotNull(hub, "expected authored city id=hub");
            Assert.IsNotNull(hub.districts);
            CollectionAssert.Contains(hub.districts, "council_chamber");
            CollectionAssert.Contains(hub.districts, "archive_quarter");
            CollectionAssert.Contains(hub.districts, "market_district");
            CollectionAssert.Contains(hub.districts, "warden_ring_wall");
        }

        [Test]
        public void Hub_SettlementDef_MatchesCityAtlas()
        {
            WorldGeography.EnsureBuilt();
            var cities = CityAtlas.For(WorldId.Hub);
            var settlements = WorldGeography.Settlements(WorldId.Hub);
            Assert.AreEqual(cities.Length, settlements.Count, "Hub settlement/city drift");
            var heart = settlements.FirstOrDefault(s => s != null && s.legacyCityId == "hub");
            Assert.IsNotNull(heart, "expected SettlementDef legacyCityId=hub");
            Assert.AreEqual("court", heart.type);
            Assert.GreaterOrEqual(heart.districts.Length, 4);
        }

        [Test]
        public void Hub_HasNoKingdomTerritory()
        {
            WorldGeography.EnsureBuilt();
            Assert.AreEqual(0, WorldGeography.Territories(WorldId.Hub).Count,
                "Compact forbids a Hub kingdom — territories must stay empty");
        }

        [Test]
        public void Hub_ApproachStubs_Present()
        {
            var cities = CityAtlas.For(WorldId.Hub);
            var stubs = cities.Where(c => c != null && c.status == "stub").Select(c => c.id).ToArray();
            CollectionAssert.Contains(stubs, "pinewood_crossing");
            CollectionAssert.Contains(stubs, "broken_spire");
            CollectionAssert.Contains(stubs, "upper_grove");
            CollectionAssert.Contains(stubs, "three_refusals_tavern");
        }
    }
}
