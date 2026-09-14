using UnityEngine;
#if UNITY_EDITOR
using UnityEditor;
#endif

namespace Concordia
{
    /// <summary>
    /// Host machine budget for Play Hub. 16GB Macs die when Hub boots ~50+
    /// ModularPersons while Ollama/node still hold several GB. LeanPlay thins
    /// crowd/impostors/AgentBody auto-spawn so the Editor can hold Play for QA.
    /// </summary>
    public static class ConcordiaHost
    {
        const string PrefForceLean = "Concordia.ForceLeanPlay";
        const string PrefForceFull = "Concordia.ForceFullPlay";

        /// <summary>True when this machine should thin Hub boot (≤18GB RAM or forced).</summary>
        public static bool LeanPlay
        {
            get
            {
#if UNITY_EDITOR
                if (EditorPrefs.GetBool(PrefForceFull, false)) return false;
                if (EditorPrefs.GetBool(PrefForceLean, false)) return true;
#endif
                // systemMemorySize is MB. 16GB machines report ~16384; leave headroom.
                return SystemInfo.systemMemorySize > 0 && SystemInfo.systemMemorySize <= 18432;
            }
        }

        public static int CrowdWalkers => LeanPlay ? 4 : 16;
        public static int CrowdStalls => LeanPlay ? 2 : 8;
        public static int CrowdSit => LeanPlay ? 1 : 4;
        public static int GateGuards => LeanPlay ? 0 : 2;
        /// <summary>Wander guests on the Ring roads. Thin on purpose — not a fake city.</summary>
        public static int RoadWalkers => LeanPlay ? 2 : 6;
        public static int RealmPeopleCap => LeanPlay ? 8 : 64;
        public static bool BootContinentImpostors => !LeanPlay;
        public static bool AutoSpawnAgentBody => !LeanPlay;

#if UNITY_EDITOR
        [MenuItem("Concordia/Lean Play/Force Lean (this Editor)")]
        static void ForceLean()
        {
            EditorPrefs.SetBool(PrefForceLean, true);
            EditorPrefs.SetBool(PrefForceFull, false);
            Debug.Log("[Concordia] Force Lean Play ON — thin crowd/impostors/AgentBody auto-spawn");
        }

        [MenuItem("Concordia/Lean Play/Force Full (this Editor)")]
        static void ForceFull()
        {
            EditorPrefs.SetBool(PrefForceLean, false);
            EditorPrefs.SetBool(PrefForceFull, true);
            Debug.Log("[Concordia] Force Full Play ON — ignore 16GB lean budget");
        }

        [MenuItem("Concordia/Lean Play/Auto (detect RAM)")]
        static void AutoDetect()
        {
            EditorPrefs.SetBool(PrefForceLean, false);
            EditorPrefs.SetBool(PrefForceFull, false);
            Debug.Log("[Concordia] Lean Play auto — LeanPlay=" + LeanPlay
                + " systemMemoryMB=" + SystemInfo.systemMemorySize);
        }
#endif
    }
}
