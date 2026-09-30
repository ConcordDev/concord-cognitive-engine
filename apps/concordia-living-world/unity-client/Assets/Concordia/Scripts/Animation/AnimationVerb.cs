using System;
using System.Collections.Generic;

namespace Concordia.Animation
{
    /// <summary>
    /// Unity Mecanim families. Humanoid clips retarget only with a valid Avatar.
    /// Generic clips stay skeleton-specific. Never force a quadruped through Humanoid.
    /// </summary>
    public enum AnimationRigFamily
    {
        Humanoid,
        Generic
    }

    /// <summary>How the verb is produced. Video/MP4 is never Authored.</summary>
    public enum AnimationSource
    {
        Authored,
        Procedural,
        ProceduralLayer,
        Missing
    }

    /// <summary>
    /// Honest coverage. Reused means a clip from another verb is standing in.
    /// VideoReference is Imagine/motion-ref only — not a Mecanim clip.
    /// </summary>
    public enum AnimationCoverageStatus
    {
        Real,
        Procedural,
        Reused,
        Missing,
        VideoReference
    }

    [Serializable]
    public sealed class AnimationVerb
    {
        public string Id;
        public string Domain;
        public string Family;
        public string ActorType;
        public AnimationRigFamily Rig;
        public AnimationSource Source;
        public bool Loop;
        public bool RootMotion;
        public bool Interruptible = true;
        public string Direction;
        public string Intensity;
        public string WeaponType;
        public string LocomotionState;
        public string GameplayEvent;
        public string Notes;
        public float BlendIn = 0.08f;
        public float BlendOut = 0.12f;
        public float HitNormalizedTime = -1f;
        public float RecoveryNormalizedTime = -1f;
    }

    [Serializable]
    public sealed class AnimationLiveBinding
    {
        public string VerbId;
        public string ControllerPath;
        public string StateName;
        public string ClipGuid;
        public string ClipPath;
        public AnimationCoverageStatus Status;
        public string Reason;
    }

    [Serializable]
    public sealed class AnimationCoverageSlice
    {
        public string Name;
        public int Total;
        public int Real;
        public int Procedural;
        public int Reused;
        public int Missing;
        public int VideoReference;
        public float PercentRealOrProcedural;
    }

    [Serializable]
    public sealed class AnimationCoverageReport
    {
        public string GeneratedAt;
        public int VerbCount;
        public List<AnimationCoverageSlice> Slices = new List<AnimationCoverageSlice>();
        public List<AnimationVerbCoverageRow> Rows = new List<AnimationVerbCoverageRow>();
        public List<string> HonestyFailures = new List<string>();
    }

    [Serializable]
    public sealed class AnimationVerbCoverageRow
    {
        public string VerbId;
        public string Domain;
        public string Family;
        public string Rig;
        public string Status;
        public string Source;
        public string ClipGuid;
        public string ClipPath;
        public string Reason;
    }
}
