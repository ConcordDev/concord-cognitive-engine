using NUnit.Framework;
using UnityEngine;
using Concordia;

namespace Concordia.Tests
{
    public class LoreNpcBinderTests
    {
        [Test]
        public void Warlord_GetsHighSparks_AndUniqueWeapon_FromAppearance()
        {
            var person = new WorldBook.Person
            {
                id = "test_warlord_kael",
                name = "Kael",
                title = "Warlord of the Sandrun",
                archetype = "warlord",
                appearance = "Tall muscled figure with a greatsword and braided dark hair",
                faction_id = "sandrun_sanguire",
                quest_giver = true
            };
            var fac = new WorldBook.Faction
            {
                id = "sandrun_sanguire",
                name = "Sandrun Sanguire",
                visual = new WorldBook.Visual
                {
                    primary_color = "#8B1A1A",
                    architecture_style = "obsidian spire",
                    preferred_weapon_archetypes = new[] { "greatsword", "shield" }
                }
            };
            var kit = LoreNpcBinder.Build(WorldId.Tunya, person, fac, 3);
            Assert.GreaterOrEqual(kit.Sparks, 100);
            Assert.IsFalse(string.IsNullOrEmpty(kit.PrimaryWeapon), "warlord should carry a weapon stem");
            // Lore text says greatsword — MapWeapon may resolve to a Kenney/CX pack alias.
            Assert.That(kit.PrimaryWeapon.ToLowerInvariant(),
                Does.Contain("great").Or.Contain("sword").Or.Contain("estoc").Or.Contain("katana"));
            Assert.That(kit.InventoryId, Does.Contain("test_warlord_kael"));
            Assert.That(kit.InventoryItems, Does.Contain("quest writ"));
            Assert.That(kit.InventoryItems, Does.Contain("keepsake/test_warlord_kael"));
            Assert.Greater(kit.Look.height, 1.05f);
            Assert.AreEqual(5, kit.Look.hairStyle); // braid
        }

        [Test]
        public void Merchant_GetsTradeInventory_AndBag()
        {
            var person = new WorldBook.Person
            {
                id = "test_trader_mira",
                name = "Mira",
                archetype = "trader",
                appearance = "Compact traveler with a satchel",
                title = "Ring merchant"
            };
            var kit = LoreNpcBinder.Build(WorldId.Hub, person, null, 1);
            Assert.GreaterOrEqual(kit.Sparks, 60);
            Assert.AreEqual("bag", kit.BackGear);
            Assert.That(kit.InventoryItems, Does.Contain("trade seal"));
        }

        [Test]
        public void Healer_GetsModestSparks_NoShieldBias()
        {
            var person = new WorldBook.Person
            {
                id = "test_healer_orin",
                name = "Orin",
                archetype = "healer",
                appearance = "Slight scholar with a staff"
            };
            var kit = LoreNpcBinder.Build(WorldId.Fantasy, person, null, 2);
            Assert.Less(kit.Sparks, 100);
            Assert.That(kit.PrimaryWeapon, Does.Contain("staff").IgnoreCase);
            Assert.IsNull(kit.Offhand);
        }
    }
}
