using UnityEngine;
#if UNITY_EDITOR
using UnityEditor;
#endif

namespace Concordia
{
    /// <summary>
    /// Host play policy. LeanPlay is emergency thin-mode only (menu Force Lean).
    /// Default is full Court content; melt protection is RuntimeBudget (always on),
    /// not content thinning.
    /// </summary>
    public static class ConcordiaHost
    {
        const string PrefForceLean = "Concordia.ForceLeanPlay";
        const string PrefForceFull = "Concordia.ForceFullPlay";

        /// <summary>Hub cinematic look is never thinned.</summary>
        public static bool LookLean => false;

        /// <summary>Always prefer fuller staged Court content. Force Lean is the only off-ramp.</summary>
        public static bool PreferFullContent => !LeanPlay;

        /// <summary>
        /// Emergency thin mode only. Default false — RAM auto-lean retired after Hub60 stability.
        /// Staging + RuntimeBudget carry the load; do not re-gate content behind LeanPlay.
        /// </summary>
        public static bool LeanPlay
        {
            get
            {
#if UNITY_EDITOR
                return EditorPrefs.GetBool(PrefForceLean, false);
#else
                return false;
#endif
            }
        }

        /// <summary>
        /// Always-on melt guards (NPC tick budget, SimHost cadence, Dump throttle).
        /// Independent of LeanPlay — Full Play still needs these on 16GB Editor.
        /// </summary>
        public static bool RuntimeBudget => true;

        /// <summary>
        /// Headless shared-world host (World lens step 3): this process runs the
        /// world's NPCs for everyone and publishes them through Concord
        /// (WorldHostPublisher). Set by the `-concordWorldHost` command-line flag
        /// or CONCORD_WORLD_HOST=1. Never true in a player's browser build.
        /// </summary>
        public static bool WorldHostMode
        {
            get
            {
                if (_hostMode.HasValue) return _hostMode.Value;
                bool on = false;
                try
                {
                    foreach (var a in System.Environment.GetCommandLineArgs())
                        if (a == "-concordWorldHost") on = true;
                    if (System.Environment.GetEnvironmentVariable("CONCORD_WORLD_HOST") == "1") on = true;
                }
                catch { on = false; }
                _hostMode = on;
                return on;
            }
        }
        static bool? _hostMode;

        // Full Court densities (Lean emergency uses the thin side).
        public static int CrowdWalkers => LeanPlay ? 12 : 16;
        public static int CrowdStalls => LeanPlay ? 6 : 8;
        public static int CrowdSit => LeanPlay ? 3 : 4;
        public static int GateGuards => 2;
        public static int RoadWalkers => LeanPlay ? 5 : 6;
        public static int RoadThreats => LeanPlay ? 6 : 8;
        public static int RoadDelves => LeanPlay ? 5 : 8;
        public static int RealmPeopleCap => LeanPlay ? 48 : 512;
        /// <summary>Staged Court population; lore NPCs bind up to this (authored first).</summary>
        public static int CourtPeopleCap => LeanPlay ? 48 : 256;
        public static bool BootContinentImpostors => !LeanPlay;
        public static bool AutoSpawnAgentBody => false;

        public static int LeanApplySceneCap => LeanPlay ? 413 : 520;
        public static int LeanRealizeBuildingCap => LeanPlay ? 8 : 24;
        public static int LeanCompileFrameGap => LeanPlay ? 4 : 2;
        public static int LeanNpcTicksPerFrame => 10;
        public static int FullNpcTicksPerFrame => 24;

        static int _npcBudgetFrame = -1;
        static int _npcBudgetLeft;

        public static bool AllowNpcTick()
        {
            if (!RuntimeBudget) return true;
            var f = Time.frameCount;
            if (_npcBudgetFrame != f)
            {
                _npcBudgetFrame = f;
                _npcBudgetLeft = LeanPlay ? LeanNpcTicksPerFrame : FullNpcTicksPerFrame;
            }
            if (_npcBudgetLeft <= 0) return false;
            _npcBudgetLeft--;
            return true;
        }

        public static bool AllowSimHostTick()
        {
            if (!RuntimeBudget) return true;
            var n = LeanPlay ? 64 : 16;
            return (Time.frameCount % n) == 0;
        }

#if UNITY_EDITOR
        [MenuItem("Concordia/Lean Play/Force Lean (emergency thin)")]
        static void ForceLean()
        {
            EditorPrefs.SetBool(PrefForceLean, true);
            EditorPrefs.SetBool(PrefForceFull, false);
            Debug.Log("[Concordia] Force Lean ON — emergency thin only");
        }

        [MenuItem("Concordia/Lean Play/Force Full (default content)")]
        static void ForceFull()
        {
            EditorPrefs.SetBool(PrefForceLean, false);
            EditorPrefs.SetBool(PrefForceFull, true);
            Debug.Log("[Concordia] Force Full ON — LeanPlay=" + LeanPlay + " PreferFull=" + PreferFullContent);
        }

        [MenuItem("Concordia/Lean Play/Clear Lean (full content)")]
        static void ClearLean()
        {
            EditorPrefs.SetBool(PrefForceLean, false);
            EditorPrefs.SetBool(PrefForceFull, true);
            Debug.Log("[Concordia] Lean cleared — full content. LeanPlay=" + LeanPlay);
        }
#endif
    }
}
