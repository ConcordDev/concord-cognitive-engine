using System.Linq;
using Concordia.Core;
using NUnit.Framework;

namespace Concordia.Tests
{
    /// <summary>C-03: the weapon class table matches the server tables it was generated from.</summary>
    public class WeaponClassDefTests
    {
        static readonly string[] Classes =
            { "sword", "greatsword", "hammer", "dagger", "spear", "axe", "shield", "staff", "bow", "pistol", "rifle", "unarmed" };

        [Test]
        public void AllTwelveClassesHaveFrames()
        {
            CollectionAssert.AreEquivalent(Classes, WeaponClassDef.All.Select(d => d.Id).ToArray());
            foreach (var d in WeaponClassDef.All)
            {
                Assert.Greater(d.StartupMs, 0, d.Id);
                Assert.Greater(d.ActiveMs, 0, d.Id);
                Assert.Greater(d.RecoveryMs, 0, d.Id);
                Assert.Greater(d.ReachMeters, 0f, d.Id);
                Assert.Greater(d.Momentum, 0f, d.Id);
            }
        }

        [Test]
        public void HeavyPerilsMatchTheServerTable()
        {
            // telegraph-peril.js: spear → thrust; axe/greatsword/hammer → sweep;
            // a committed attack with no listed token is a heavy sweep.
            Assert.AreEqual("thrust", WeaponClassDef.Get("spear").HeavyPeril);
            foreach (var id in new[] { "axe", "greatsword", "hammer", "sword", "dagger", "shield", "staff", "bow", "pistol", "rifle", "unarmed" })
                Assert.AreEqual("sweep", WeaponClassDef.Get(id).HeavyPeril, id);
            foreach (var d in WeaponClassDef.All)
                Assert.AreEqual(Hostile.CounterFor(d.HeavyPeril), d.HeavyCounter, d.Id + " counter agrees with Hostile.CounterFor");
        }

        [Test]
        public void ServerClassesAndHandednessMatchLoadout()
        {
            // loadout.js NAME_TO_CLASS has nine classes; spear, axe and unarmed are not among them.
            foreach (var id in new[] { "spear", "axe", "unarmed" })
                Assert.IsNull(WeaponClassDef.Get(id).ServerWeaponClass, id);
            Assert.AreEqual("two", WeaponClassDef.Get("greatsword").Handedness);
            Assert.AreEqual("two", WeaponClassDef.Get("hammer").Handedness);
            Assert.AreEqual("two", WeaponClassDef.Get("rifle").Handedness);
            Assert.AreEqual("two", WeaponClassDef.Get("staff").Handedness);
            Assert.AreEqual("two", WeaponClassDef.Get("bow").Handedness);
            Assert.AreEqual("left", WeaponClassDef.Get("shield").Handedness);
            Assert.AreEqual("either", WeaponClassDef.Get("dagger").Handedness);
        }

        [Test]
        public void RangedWeaponsCannotParry()
        {
            Assert.AreEqual(0, WeaponClassDef.Get("bow").ParryWindowMs);
            Assert.AreEqual(0, WeaponClassDef.Get("staff").ParryWindowMs);
        }

        [Test]
        public void ToActionDefCarriesFramesReachAndPoise()
        {
            var d = WeaponClassDef.Get("hammer");
            var a = d.ToActionDef(ActionKind.HeavyAttack);
            Assert.AreEqual(350, a.StartupMs);
            Assert.AreEqual(180, a.ActiveMs);
            Assert.AreEqual(450, a.RecoveryMs);
            Assert.AreEqual(d.ReachMeters, a.ReachMeters);
            Assert.AreEqual(d.Momentum, a.PoiseDamage);
            Assert.AreEqual(ActionKind.HeavyAttack, a.Kind);
        }
    }
}
