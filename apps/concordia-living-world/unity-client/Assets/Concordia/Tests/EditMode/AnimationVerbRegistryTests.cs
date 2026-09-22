using System.Collections.Generic;
using System.IO;
using Concordia;
using Concordia.Animation;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.Animations;
using UnityEngine;

namespace Concordia.Tests
{
    public class AnimationVerbRegistryTests
    {
        [Test]
        public void EveryVerbHasIdDomainFamilyAndRig()
        {
            Assert.Greater(AnimationVerbCatalog.All.Count, 200);
            var seen = new HashSet<string>();
            foreach (var v in AnimationVerbCatalog.All)
            {
                Assert.False(string.IsNullOrEmpty(v.Id), "empty id");
                Assert.False(string.IsNullOrEmpty(v.Domain), v.Id);
                Assert.False(string.IsNullOrEmpty(v.Family), v.Id);
                Assert.True(seen.Add(v.Id), "duplicate " + v.Id);
            }
        }

        [Test]
        public void L0BoundStatesAreReal()
        {
            Assert.AreEqual(AnimationCoverageStatus.Real, AnimationVerbCatalog.StatusOf("loc.idle"));
            Assert.AreEqual(AnimationCoverageStatus.Real, AnimationVerbCatalog.StatusOf("loc.walk"));
            Assert.AreEqual(AnimationCoverageStatus.Real, AnimationVerbCatalog.StatusOf("loc.run"));
            Assert.AreEqual(AnimationCoverageStatus.Real, AnimationVerbCatalog.StatusOf("loc.sprint"));
            Assert.AreEqual(AnimationCoverageStatus.Real, AnimationVerbCatalog.StatusOf("trav.dodge"));
            Assert.AreEqual(AnimationCoverageStatus.Real, AnimationVerbCatalog.StatusOf("trav.jump_land"));
            Assert.True(AnimationVerbPlayback.CanFireAnimatorTrigger("trav.dodge"));
            Assert.AreEqual(AnimationCoverageStatus.Missing, AnimationVerbCatalog.StatusOf("trav.dodge_roll"));
        }

        [Test]
        public void L0AttackAndReactionStatesAreAuthored()
        {
            Assert.AreEqual(AnimationCoverageStatus.Real, AnimationVerbCatalog.StatusOf("combat.light"));
            Assert.AreEqual(AnimationCoverageStatus.Procedural, AnimationVerbCatalog.StatusOf("combat.heavy"));
            Assert.AreEqual(AnimationCoverageStatus.Real, AnimationVerbCatalog.StatusOf("combat.sword.slash"));
            Assert.AreEqual(AnimationCoverageStatus.Real, AnimationVerbCatalog.StatusOf("react.hit_front"));
            Assert.AreEqual(AnimationCoverageStatus.Real, AnimationVerbCatalog.StatusOf("death.front"));
            Assert.AreEqual(0, AnimationLiveBindings.HonestyTraps.Count);
        }

        [Test]
        public void ConcordiaLocomotionBindsUAL1StatesAndTransitions()
        {
            var controller = AssetDatabase.LoadAssetAtPath<AnimatorController>(AnimationLiveBindings.LocomotionController);
            Assert.NotNull(controller);
            var states = controller.layers[0].stateMachine.states;
            AssertMotion(states, "Idle", "Idle_Loop");
            AssertMotion(states, "Walk", "Walk_Loop");
            AssertMotion(states, "Run", "Jog_Fwd_Loop");
            AssertMotion(states, "Sprint", "Sprint_Loop");
            AssertMotion(states, "JumpStart", "Jump_Start");
            AssertMotion(states, "JumpLand", "Jump_Land");
            AssertMotion(states, "Dodge", "Roll");
            AssertMotion(states, "LightAttack", "Sword_Attack");
            AssertMotion(states, "SwordIdle", "Sword_Idle");
            AssertMotion(states, "HitChest", "Hit_Chest");
            AssertMotion(states, "Death", "Death01");
            AssertAnyStateCondition(controller, "LightAttack", "Attack");
            AssertAnyStateCondition(controller, "HitChest", "Hit");
            AssertAnyStateCondition(controller, "Death", "Death");
        }

        [Test]
        public void CreaturesAreGeneric_HumanoidLocomotionIsHumanoid()
        {
            Assert.True(AnimationVerbCatalog.TryGet("quad.walk", out var wolf));
            Assert.AreEqual(AnimationRigFamily.Generic, wolf.Rig);
            Assert.True(AnimationVerbCatalog.TryGet("serpent.slither", out var snake));
            Assert.AreEqual(AnimationRigFamily.Generic, snake.Rig);
            Assert.True(AnimationVerbCatalog.TryGet("loc.walk", out var walk));
            Assert.AreEqual(AnimationRigFamily.Humanoid, walk.Rig);
            Assert.True(AnimationVerbCatalog.TryGet("hyb.naga.slither", out var naga));
            Assert.AreEqual(AnimationRigFamily.Generic, naga.Rig);
        }

        [Test]
        public void RuntimeValidatorAcceptsL0AuthoredBindings()
        {
            var findings = AnimationRuntimeValidator.ValidateVerbPlaybackContract();
            Assert.IsEmpty(findings);
        }

        [Test]
        public void CoverageReportHasNoL0HonestyFailures()
        {
            var report = AnimationCoverage.Build();
            Assert.IsEmpty(report.HonestyFailures, string.Join("\n", report.HonestyFailures));
            var dash = AnimationCoverage.FormatDashboard(report);
            StringAssert.Contains("CONCORDIA ANIMATION COVERAGE", dash);
            StringAssert.Contains("trav.dodge", dash);
            StringAssert.DoesNotContain("WalkTurnSharp", dash);
        }

        [Test]
        public void DodgePulsePeaksThenRecovers()
        {
            Assert.Greater(CombatMotion.DodgePulse(0.3f), 0.8f);
            Assert.Less(CombatMotion.DodgePulse(1f), 0.05f);
            Assert.AreEqual(0.38f, CombatMotion.DodgeDuration);
        }

        static void AssertMotion(AnimatorStateInfo[] unused, string stateName, string clipName)
        {
        }

        static void AssertMotion(ChildAnimatorState[] states, string stateName, string clipName)
        {
            for (var i = 0; i < states.Length; i++)
            {
                if (states[i].state.name != stateName) continue;
                Assert.NotNull(states[i].state.motion, stateName + " has no motion");
                Assert.AreEqual(clipName, states[i].state.motion.name, stateName);
                return;
            }
            Assert.Fail("Missing state " + stateName);
        }

        static void AssertAnyStateCondition(AnimatorController controller, string destinationName, string parameter)
        {
            var sm = controller.layers[0].stateMachine;
            for (var i = 0; i < sm.anyStateTransitions.Length; i++)
            {
                var transition = sm.anyStateTransitions[i];
                if (!transition.destinationState || transition.destinationState.name != destinationName) continue;
                for (var j = 0; j < transition.conditions.Length; j++)
                    if (transition.conditions[j].parameter == parameter) return;
            }
            Assert.Fail("Missing AnyState -> " + destinationName + " condition " + parameter);
        }

        static int Count(string s, string token)
        {
            var n = 0;
            var i = 0;
            while ((i = s.IndexOf(token, i, System.StringComparison.Ordinal)) >= 0)
            {
                n++;
                i += token.Length;
            }
            return n;
        }

        static string SprintGuidIn(string yaml)
        {
            var idx = yaml.IndexOf("m_Name: Sprint", System.StringComparison.Ordinal);
            Assert.Greater(idx, 0);
            var motion = yaml.IndexOf("m_Motion:", idx, System.StringComparison.Ordinal);
            var guid = yaml.IndexOf("guid: ", motion, System.StringComparison.Ordinal);
            return yaml.Substring(guid + 6, 32);
        }

    }
}
