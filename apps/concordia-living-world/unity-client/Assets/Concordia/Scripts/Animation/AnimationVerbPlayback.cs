using UnityEngine;

namespace Concordia.Animation
{
    /// <summary>
    /// Single call site for animator combat/locomotion verbs.
    /// Never fires a trigger whose clip is missing, reused Idle, or video-only.
    /// </summary>
    public static class AnimationVerbPlayback
    {
        public static bool CanFireAnimatorTrigger(string verbId) =>
            AnimationVerbCatalog.HasAuthoredClip(verbId);

        public static bool TrySetTrigger(Animator animator, string verbId, string parameter)
        {
            if (!animator || !animator.runtimeAnimatorController) return false;
            if (!CanFireAnimatorTrigger(verbId)) return false;
            if (!HasParam(animator, parameter, AnimatorControllerParameterType.Trigger)) return false;
            animator.SetTrigger(parameter);
            return true;
        }

        public static bool TrySetFloat(Animator animator, string parameter, float value)
        {
            if (!HasParam(animator, parameter, AnimatorControllerParameterType.Float)) return false;
            animator.SetFloat(parameter, value);
            return true;
        }

        public static bool TrySetBool(Animator animator, string parameter, bool value)
        {
            if (!HasParam(animator, parameter, AnimatorControllerParameterType.Bool)) return false;
            animator.SetBool(parameter, value);
            return true;
        }

        public static bool AvatarAllowsHumanoid(Animator animator) =>
            animator && animator.avatar && animator.avatar.isHuman && animator.avatar.isValid;

        public static AnimationRigFamily RigFor(Animator animator)
        {
            if (AvatarAllowsHumanoid(animator)) return AnimationRigFamily.Humanoid;
            return AnimationRigFamily.Generic;
        }

        public static bool HasParam(Animator animator, string name, AnimatorControllerParameterType type)
        {
            if (!animator || string.IsNullOrEmpty(name) || !animator.runtimeAnimatorController) return false;
            foreach (var p in animator.parameters)
                if (p.name == name && p.type == type) return true;
            return false;
        }
    }
}
