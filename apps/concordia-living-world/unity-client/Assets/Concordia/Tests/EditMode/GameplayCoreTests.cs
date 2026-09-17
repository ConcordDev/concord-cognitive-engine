// Contract tests for the Concordia gameplay core (directive §30).
//
// These assert STATE TRANSITIONS, not that code compiles. Each one pins a rule the rest of the
// game is allowed to depend on — the combat loop's phase order, the defense grammar's precedence,
// poise-driven stagger escalation, and input buffering.
//
// The Unity client had zero test coverage before this file; §30 explicitly rejects "compilation
// as proof" and "looks wired" as proof.

using Concordia.Core;
using NUnit.Framework;
using UnityEngine;

namespace Concordia.Tests
{
    public class ActorStateTests
    {
        [Test]
        public void Hit_WithoutBreakingPoise_IsOnlyAFlinch()
        {
            var a = new ActorState();
            var tier = a.ApplyHit(10f, 20f);

            Assert.AreEqual(StaggerTier.Flinch, tier);
            Assert.AreEqual(90f, a.Health, 0.001f);
            Assert.AreEqual(80f, a.Poise, 0.001f);
            Assert.IsFalse(a.IsDowned);
        }

        [Test]
        public void BreakingPoise_EscalatesBeyondFlinch_AndResetsTheBar()
        {
            var a = new ActorState();
            a.ApplyHit(0f, 90f);                 // poise down to 10
            var tier = a.ApplyHit(5f, 30f);      // overshoots the break

            Assert.AreNotEqual(StaggerTier.Flinch, tier);
            Assert.AreNotEqual(StaggerTier.None, tier);
            Assert.AreEqual(a.MaxPoise, a.Poise, 0.001f, "a break should consume then reset poise");
        }

        [Test]
        public void DamageAloneNeverStaggers()
        {
            var a = new ActorState();
            var tier = a.ApplyHit(75f, 0f);

            Assert.AreEqual(StaggerTier.None, tier, "stagger must come from poise, not raw damage");
            Assert.AreEqual(25f, a.Health, 0.001f);
        }

        [Test]
        public void Stamina_CannotBeOverspent()
        {
            var a = new ActorState { Stamina = 10f };

            Assert.IsFalse(a.TrySpendStamina(25f), "overspend must fail, not go negative");
            Assert.AreEqual(10f, a.Stamina, 0.001f);
            Assert.IsTrue(a.TrySpendStamina(10f));
            Assert.AreEqual(0f, a.Stamina, 0.001f);
        }

        [Test]
        public void Poise_DoesNotRegenerateDuringSustainedPressure()
        {
            var a = new ActorState { PoiseRegenDelaySeconds = 1.0f };
            a.ApplyHit(0f, 40f);
            var afterHit = a.Poise;

            a.Tick(0.5f);   // still inside the delay
            Assert.AreEqual(afterHit, a.Poise, 0.001f);

            a.Tick(1.0f);   // past it
            Assert.Greater(a.Poise, afterHit);
        }

        [Test]
        public void Health_ClampsAtZero_AndMarksDead()
        {
            var a = new ActorState();
            a.ApplyHit(500f, 0f);

            Assert.AreEqual(0f, a.Health, 0.001f);
            Assert.IsFalse(a.IsAlive);
        }
    }

    public class ActionRunnerTests
    {
        static ActionDef Light() => new ActionDef
        {
            Id = "light",
            Kind = ActionKind.LightAttack,
            StartupMs = 100,
            ActiveMs = 50,
            RecoveryMs = 150,
            StaminaCost = 10f,
            Damage = 12f,
            PoiseDamage = 20f
        };

        [Test]
        public void Action_WalksStartupThenActiveThenRecoveryThenIdle()
        {
            var actor = new ActorState();
            var r = new ActionRunner();

            Assert.IsTrue(r.TryBegin(Light(), actor));
            Assert.AreEqual(ActionPhase.Startup, r.Phase);

            r.Tick(100, actor);
            Assert.AreEqual(ActionPhase.Active, r.Phase);
            Assert.IsTrue(r.JustBecameActive, "the hit frame must be detectable exactly once");

            r.Tick(50, actor);
            Assert.AreEqual(ActionPhase.Recovery, r.Phase);
            Assert.IsFalse(r.JustBecameActive);

            r.Tick(150, actor);
            Assert.AreEqual(ActionPhase.Idle, r.Phase);
        }

        [Test]
        public void Action_IsRejectedWithoutStamina()
        {
            var actor = new ActorState { Stamina = 2f };
            var r = new ActionRunner();

            Assert.IsFalse(r.TryBegin(Light(), actor), "must fail honestly, not start a free action");
            Assert.AreEqual(ActionPhase.Idle, r.Phase);
            Assert.AreEqual(2f, actor.Stamina, 0.001f, "a rejected action must not consume stamina");
        }

        [Test]
        public void SecondAction_CannotInterruptStartup()
        {
            var actor = new ActorState();
            var r = new ActionRunner();
            r.TryBegin(Light(), actor);
            r.Tick(20, actor);

            Assert.IsFalse(r.TryBegin(Light(), actor), "startup must not be cancellable into itself");
        }

        [Test]
        public void BufferedInput_FiresWhenTheActionFrees_Up()
        {
            var actor = new ActorState();
            var r = new ActionRunner();
            r.TryBegin(Light(), actor);
            r.Tick(120, actor);                       // mid-active

            Assert.IsTrue(r.Buffer(Light(), actor), "should queue, not start immediately");

            r.Tick(200, actor);                       // run out the rest of the action
            Assert.AreNotEqual(ActionPhase.Idle, r.Phase, "buffered action should have started");
        }

        [Test]
        public void BufferedInput_ExpiresIfTheWindowPasses()
        {
            var actor = new ActorState();
            var r = new ActionRunner { BufferWindowMs = 100 };
            r.TryBegin(Light(), actor);
            r.Tick(10, actor);
            r.Buffer(Light(), actor);

            r.Tick(150, actor);   // buffer ages out before the action frees up
            r.Tick(200, actor);   // action completes

            Assert.AreEqual(ActionPhase.Idle, r.Phase, "a stale buffered input must not fire late");
        }

        [Test]
        public void IFrames_AreActiveOnlyInsideTheirWindow()
        {
            var actor = new ActorState();
            var r = new ActionRunner();
            var dodge = new ActionDef
            {
                Id = "dodge", Kind = ActionKind.Dodge,
                StartupMs = 40, ActiveMs = 120, RecoveryMs = 140,
                IFrameStartMs = 40, IFrameEndMs = 140
            };

            r.TryBegin(dodge, actor);
            Assert.IsFalse(r.IsInvulnerable, "not invulnerable before the window");

            r.Tick(50, actor);
            Assert.IsTrue(r.IsInvulnerable);

            r.Tick(120, actor);
            Assert.IsFalse(r.IsInvulnerable, "invulnerability must end, not persist through recovery");
        }
    }

    public class HitResolverTests
    {
        static ActionDef Guard() => new ActionDef
        {
            Id = "block", Kind = ActionKind.Block,
            StartupMs = 0, ActiveMs = 1000, RecoveryMs = 100
        };

        static ActionDef ParryDef() => new ActionDef
        {
            Id = "parry", Kind = ActionKind.Parry,
            StartupMs = 0, ActiveMs = 200, RecoveryMs = 200,
            ParryStartMs = 0, ParryEndMs = 120
        };

        static AttackContext Swing(float dmg = 30f, float poise = 40f, float dist = 1f, float reach = 2f)
            => new AttackContext
            {
                Damage = dmg, PoiseDamage = poise,
                DistanceMeters = dist, ReachMeters = reach, Impulse = 10f
            };

        [Test]
        public void OutOfReach_IsNotAHit_AndNotABlock()
        {
            var d = new ActorState();
            var r = HitResolver.Resolve(Swing(dist: 5f, reach: 2f), d, new ActionRunner());

            Assert.AreEqual(DefenseOutcome.OutOfRange, r.Outcome);
            Assert.AreEqual(0f, r.DamageDealt, 0.001f);
            Assert.AreEqual(100f, d.Health, 0.001f);
        }

        [Test]
        public void IFrames_BeatEverything_AndCostNoHealth()
        {
            var d = new ActorState();
            var run = new ActionRunner();
            run.TryBegin(new ActionDef
            {
                Id = "dodge", Kind = ActionKind.Dodge,
                StartupMs = 0, ActiveMs = 200, RecoveryMs = 100,
                IFrameStartMs = 0, IFrameEndMs = 150
            }, d);

            var r = HitResolver.Resolve(Swing(), d, run);

            Assert.AreEqual(DefenseOutcome.Dodged, r.Outcome);
            Assert.AreEqual(100f, d.Health, 0.001f);
        }

        [Test]
        public void Parry_DeflectsAndOpensACounter()
        {
            var d = new ActorState();
            var run = new ActionRunner();
            run.TryBegin(ParryDef(), d);

            var r = HitResolver.Resolve(Swing(), d, run);

            Assert.AreEqual(DefenseOutcome.Parried, r.Outcome);
            Assert.AreEqual(100f, d.Health, 0.001f);
            Assert.IsTrue(r.CounterOpening, "a parry must be rewarded with a punish window");
        }

        [Test]
        public void Parry_WindowCloses_AndTheHitLands()
        {
            var d = new ActorState();
            var run = new ActionRunner();
            run.TryBegin(ParryDef(), d);
            run.Tick(150, d);                   // past ParryEndMs

            var r = HitResolver.Resolve(Swing(), d, run);

            Assert.AreEqual(DefenseOutcome.Hit, r.Outcome, "late parry must not be rewarded");
            Assert.Less(d.Health, 100f);
        }

        [Test]
        public void Block_CostsStamina_AndLetsChipDamageThrough()
        {
            var d = new ActorState();
            var run = new ActionRunner();
            run.TryBegin(Guard(), d);

            var atk = Swing(dmg: 40f, poise: 40f);
            var r = HitResolver.Resolve(atk, d, run);

            Assert.AreEqual(DefenseOutcome.Blocked, r.Outcome);
            Assert.Greater(r.StaminaDrained, 0f, "blocking must cost stamina");
            Assert.Greater(r.DamageDealt, 0f, "chip damage should get through");
            Assert.Less(r.DamageDealt, atk.Damage, "but far less than an unblocked hit");
            Assert.AreEqual(StaggerTier.None, r.Stagger, "a held block absorbs poise pressure");
        }

        [Test]
        public void Block_BreaksWhenStaminaCannotPayForIt()
        {
            var d = new ActorState { Stamina = 1f };
            var run = new ActionRunner();
            run.TryBegin(Guard(), d);

            var atk = Swing(dmg: 40f, poise: 60f);
            var r = HitResolver.Resolve(atk, d, run);

            Assert.AreEqual(DefenseOutcome.GuardBroken, r.Outcome);
            Assert.AreEqual(atk.Damage, r.DamageDealt, 0.001f, "a broken guard takes the full hit");
            Assert.AreEqual(0f, d.Stamina, 0.001f);
        }

        [Test]
        public void UndefendedHit_AppliesFullDamageAndPoise()
        {
            var d = new ActorState();
            var atk = Swing(dmg: 25f, poise: 30f);

            var r = HitResolver.Resolve(atk, d, new ActionRunner());

            Assert.AreEqual(DefenseOutcome.Hit, r.Outcome);
            Assert.AreEqual(25f, r.DamageDealt, 0.001f);
            Assert.AreEqual(75f, d.Health, 0.001f);
            Assert.AreEqual(StaggerTier.Flinch, r.Stagger);
        }

        [Test]
        public void DeadDefender_TakesNoFurtherResolution()
        {
            var d = new ActorState();
            d.ApplyHit(999f, 0f);

            var r = HitResolver.Resolve(Swing(), d, new ActionRunner());

            Assert.AreEqual(0f, r.DamageDealt, 0.001f);
            Assert.AreEqual(0f, d.Health, 0.001f);
        }
    }

    public class LiveStrikeWindowTests
    {
        [Test]
        public void StrikeWindows_BecomeActiveAtCombatMotionDelay()
        {
            global::Concordia.CombatMotion.StrikeWindows(false, global::Concordia.FightStyle.Karate, out var start, out var active, out var rec, out var cancel);
            Assert.AreEqual(Mathf.RoundToInt(global::Concordia.CombatMotion.Delay(false, global::Concordia.FightStyle.Karate) * 1000f), start);
            Assert.Greater(cancel, start + active, "ComboOpen must land in recovery so CanAct matches the old _slashUntil gate");

            var actor = new ActorState();
            var r = new ActionRunner();
            var def = new ActionDef
            {
                Kind = ActionKind.LightAttack,
                StartupMs = start,
                ActiveMs = active,
                RecoveryMs = rec,
                CancelAfterMs = cancel
            };
            Assert.IsTrue(r.TryBegin(def, actor));
            r.Tick(Mathf.Max(0, start - 1), actor);
            Assert.AreEqual(ActionPhase.Startup, r.Phase);
            Assert.IsFalse(r.JustBecameActive);

            r.Tick(1, actor);
            Assert.AreEqual(ActionPhase.Active, r.Phase);
            Assert.IsTrue(r.JustBecameActive, "HitScan fires on JustBecameActive = CombatMotion.Delay");
        }
    }
}
