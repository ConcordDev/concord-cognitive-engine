using Concordia.Core;
using NUnit.Framework;
using UnityEngine;

namespace Concordia.Tests
{
    public class CinematicFeelTests
    {
        [Test]
        public void BeatFor_MapsHitResolverOutcomes_NotASecondTelegraph()
        {
            Assert.AreEqual("parry", CombatFeel.BeatFor(DefenseOutcome.Parried));
            Assert.AreEqual("dodge", CombatFeel.BeatFor(DefenseOutcome.Dodged));
            Assert.AreEqual("block", CombatFeel.BeatFor(DefenseOutcome.Blocked));
            Assert.AreEqual("guardbreak", CombatFeel.BeatFor(DefenseOutcome.GuardBroken));
            Assert.AreEqual("hit", CombatFeel.BeatFor(DefenseOutcome.Hit));
            Assert.AreEqual("miss", CombatFeel.BeatFor(DefenseOutcome.OutOfRange));
        }

        [Test]
        public void Punch_ParryAndHeavyAreStrongerThanDodge()
        {
            Assert.Greater(ChaseCamera.StrengthFor("parry"), ChaseCamera.StrengthFor("dodge"));
            Assert.Greater(ChaseCamera.StrengthFor("heavy"), ChaseCamera.StrengthFor("hit"));
            Assert.Greater(ChaseCamera.FovFor("heavy"), 0f);
            Assert.Less(ChaseCamera.FovFor("dodge"), 0f);
        }

        [Test]
        public void Present_ParryDoesNotNeedDamageToBeABeat()
        {
            var r = new HitResult { Outcome = DefenseOutcome.Parried, DamageDealt = 0f };
            Assert.AreEqual("parry", CombatFeel.BeatFor(r.Outcome));
            Assert.AreEqual(0f, r.DamageDealt);
        }
    }
}
