using System;
using System.Collections.Generic;

namespace Concordia.Animation
{
    /// <summary>
    /// Authoritative animation grammar. Every clip, overlay, or gap maps to a verb.
    /// Coverage is computed from live bindings — never from wishful state names.
    /// </summary>
    public static partial class AnimationVerbCatalog
    {
        static readonly List<AnimationVerb> Verbs = new List<AnimationVerb>(640);
        static readonly Dictionary<string, AnimationVerb> ById = new Dictionary<string, AnimationVerb>(640);
        static bool Built;

        public static IReadOnlyList<AnimationVerb> All
        {
            get { Ensure(); return Verbs; }
        }

        public static bool TryGet(string id, out AnimationVerb verb)
        {
            Ensure();
            return ById.TryGetValue(id, out verb);
        }

        public static AnimationCoverageStatus StatusOf(string id)
        {
            if (!TryGet(id, out var verb))
            {
                if (AnimationLiveBindings.TryGet(id, out var orphan)) return orphan.Status;
                return AnimationCoverageStatus.Missing;
            }
            // Overlay verbs are procedural even if a controller state reuses the wrong clip.
            if (verb.Source == AnimationSource.Procedural || verb.Source == AnimationSource.ProceduralLayer)
                return AnimationCoverageStatus.Procedural;
            if (AnimationLiveBindings.TryGet(id, out var live)) return live.Status;
            if (verb.Source == AnimationSource.Missing) return AnimationCoverageStatus.Missing;
            return AnimationCoverageStatus.Missing;
        }

        public static bool HasAuthoredClip(string id) =>
            StatusOf(id) == AnimationCoverageStatus.Real;

        static void Ensure()
        {
            if (Built) return;
            Built = true;
            RegisterHumanoid();
            RegisterCreatures();
            for (var i = 0; i < Verbs.Count; i++)
            {
                var v = Verbs[i];
                if (string.IsNullOrEmpty(v.Id))
                    throw new InvalidOperationException("Animation verb missing id.");
                if (ById.ContainsKey(v.Id))
                    throw new InvalidOperationException("Duplicate animation verb: " + v.Id);
                ById.Add(v.Id, v);
            }
        }

        static void V(string id, string domain, string family, AnimationRigFamily rig, AnimationSource source,
            string actor = "humanoid", bool loop = false, bool rootMotion = false, bool interruptible = true,
            string direction = null, string intensity = null, string weapon = null, string loco = null,
            string evt = null, string notes = null)
        {
            Verbs.Add(new AnimationVerb
            {
                Id = id,
                Domain = domain,
                Family = family,
                ActorType = actor,
                Rig = rig,
                Source = source,
                Loop = loop,
                RootMotion = rootMotion,
                Interruptible = interruptible,
                Direction = direction,
                Intensity = intensity,
                WeaponType = weapon,
                LocomotionState = loco,
                GameplayEvent = evt,
                Notes = notes
            });
        }

        static AnimationSource Missing => AnimationSource.Missing;
        static AnimationSource Proc => AnimationSource.Procedural;
        static AnimationSource Layer => AnimationSource.ProceduralLayer;
        static AnimationSource Auth => AnimationSource.Authored;
        static AnimationRigFamily Hum => AnimationRigFamily.Humanoid;
        static AnimationRigFamily Gen => AnimationRigFamily.Generic;
    }
}
