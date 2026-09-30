using System.Collections.Generic;

namespace Concordia.Animation
{
    /// <summary>
    /// What ConcordiaLocomotion actually plays today. Clip paths point to
    /// explicit FBX sub-assets — do not "fix" coverage by renaming a state.
    /// </summary>
    public static class AnimationLiveBindings
    {
        public const string LocomotionController =
            "Assets/Concordia/Anim/ConcordiaLocomotion.controller";

        public const string QuaterniusUalFbx =
            "Assets/Concordia/FreePacks/Quaternius/Quaternius_Universal_Animation_Library_Standard/Universal Animation Library[Standard]/Unity/UAL1_Standard.fbx";

        static string Ual(string clipName) => QuaterniusUalFbx + "::" + clipName;

        public static IReadOnlyList<AnimationLiveBinding> ConcordiaLocomotion { get; } =
            new[]
            {
                Bind("loc.idle", "Idle", "", Ual("Idle_Loop"), AnimationCoverageStatus.Real, "UAL1 Idle_Loop."),
                Bind("loc.walk", "Walk", "", Ual("Walk_Loop"), AnimationCoverageStatus.Real, "UAL1 Walk_Loop."),
                Bind("loc.run", "Run", "", Ual("Jog_Fwd_Loop"), AnimationCoverageStatus.Real, "UAL1 Jog_Fwd_Loop."),
                Bind("loc.sprint", "Sprint", "", Ual("Sprint_Loop"), AnimationCoverageStatus.Real, "UAL1 Sprint_Loop."),
                Bind("trav.jump_start", "JumpStart", "", Ual("Jump_Start"), AnimationCoverageStatus.Real, "UAL1 Jump_Start."),
                Bind("trav.jump_land", "JumpLand", "", Ual("Jump_Land"), AnimationCoverageStatus.Real, "UAL1 Jump_Land."),
                Bind("trav.dodge", "Dodge", "", Ual("Roll"), AnimationCoverageStatus.Real, "UAL1 Roll; motor retains i-frame authority."),
                Bind("combat.light", "LightAttack", "", Ual("Sword_Attack"), AnimationCoverageStatus.Real, "UAL1 Sword_Attack."),
                Bind("combat.sword.idle", "SwordIdle", "", Ual("Sword_Idle"), AnimationCoverageStatus.Real, "UAL1 Sword_Idle."),
                Bind("combat.sword.slash", "LightAttack", "", Ual("Sword_Attack"), AnimationCoverageStatus.Real, "UAL1 Sword_Attack."),
                Bind("react.hit_front", "HitChest", "", Ual("Hit_Chest"), AnimationCoverageStatus.Real, "UAL1 Hit_Chest."),
                Bind("death.front", "Death", "", Ual("Death01"), AnimationCoverageStatus.Real, "UAL1 Death01."),
            };

        /// <summary>No stale controller-state honesty traps remain in the L0 bound slice.</summary>
        public static IReadOnlyList<AnimationLiveBinding> HonestyTraps { get; } =
            new List<AnimationLiveBinding>();

        static AnimationLiveBinding Bind(string verbId, string state, string guid, string path,
            AnimationCoverageStatus status, string reason) =>
            new AnimationLiveBinding
            {
                VerbId = verbId,
                ControllerPath = LocomotionController,
                StateName = state,
                ClipGuid = guid,
                ClipPath = path,
                Status = status,
                Reason = reason
            };

        public static bool TryGet(string verbId, out AnimationLiveBinding binding)
        {
            for (var i = 0; i < ConcordiaLocomotion.Count; i++)
            {
                if (ConcordiaLocomotion[i].VerbId == verbId)
                {
                    binding = ConcordiaLocomotion[i];
                    return true;
                }
            }
            binding = null;
            return false;
        }
    }
}
