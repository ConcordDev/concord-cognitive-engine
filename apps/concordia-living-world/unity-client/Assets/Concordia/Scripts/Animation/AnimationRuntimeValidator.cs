using System.Collections.Generic;
using UnityEngine;

namespace Concordia.Animation
{
    /// <summary>Play-mode checks. Does not treat a trigger or empty state as a clip.</summary>
    public static class AnimationRuntimeValidator
    {
        public struct Finding
        {
            public string Code;
            public string Detail;
        }

        public static List<Finding> ValidateAnimator(Animator animator, string expectedControllerHint = null)
        {
            var findings = new List<Finding>();
            if (!animator)
            {
                findings.Add(F("no_animator", "No Animator on the body."));
                return findings;
            }
            if (!animator.runtimeAnimatorController)
                findings.Add(F("no_controller", "Animator has no controller."));
            else if (!string.IsNullOrEmpty(expectedControllerHint) &&
                     animator.runtimeAnimatorController.name.IndexOf(expectedControllerHint, System.StringComparison.OrdinalIgnoreCase) < 0)
                findings.Add(F("controller_mismatch", "Expected " + expectedControllerHint + ", got " + animator.runtimeAnimatorController.name));

            if (animator.avatar == null)
                findings.Add(F("no_avatar", "No Avatar. Humanoid retargeting is unavailable."));
            else if (animator.avatar.isHuman && !animator.avatar.isValid)
                findings.Add(F("invalid_humanoid", "Humanoid Avatar is invalid — do not retarget onto this body."));

            if (!AnimationVerbCatalog.HasAuthoredClip("trav.dodge"))
                findings.Add(F("dodge_not_authored", "Dodge is not backed by the bound UAL1 Roll clip."));
            if (!AnimationVerbCatalog.HasAuthoredClip("combat.light"))
                findings.Add(F("light_not_authored", "Light attack is not backed by the bound UAL1 Sword_Attack clip."));
            return findings;
        }

        public static List<Finding> ValidateVerbPlaybackContract()
        {
            var findings = new List<Finding>();
            if (AnimationVerbCatalog.StatusOf("trav.dodge") != AnimationCoverageStatus.Real)
                findings.Add(F("dodge_not_real", "Dodge must resolve to the UAL1 Roll clip."));
            if (AnimationVerbCatalog.StatusOf("combat.light") != AnimationCoverageStatus.Real)
                findings.Add(F("light_not_real", "Light attack must resolve to the UAL1 Sword_Attack clip."));
            if (AnimationVerbCatalog.StatusOf("loc.sprint") != AnimationCoverageStatus.Real)
                findings.Add(F("sprint_not_real", "Sprint must resolve to the UAL1 Sprint_Loop clip."));
            if (AnimationVerbCatalog.StatusOf("trav.jump_land") != AnimationCoverageStatus.Real)
                findings.Add(F("jump_land_not_real", "JumpLand must resolve to the UAL1 Jump_Land clip."));
            if (AnimationVerbCatalog.StatusOf("react.hit_front") != AnimationCoverageStatus.Real)
                findings.Add(F("hit_not_real", "Front hit must resolve to the UAL1 Hit_Chest clip."));
            return findings;
        }

        static Finding F(string code, string detail) => new Finding { Code = code, Detail = detail };
    }
}
