using UnityEditor;
using UnityEngine;

namespace Concordia.Editor
{
    /// <summary>
    /// Aura: keep Play from aborting via Enter Play Mode Options / __Backupscenes,
    /// and force LeanPlay on 16GB so Hub can hold for stills.
    /// </summary>
    [InitializeOnLoad]
    static class AuraPlayHoldGuard
    {
        static AuraPlayHoldGuard()
        {
            EditorApplication.delayCall += Apply;
        }

        static void Apply()
        {
            if (EditorSettings.enterPlayModeOptionsEnabled
                || EditorSettings.enterPlayModeOptions != EnterPlayModeOptions.None)
            {
                EditorSettings.enterPlayModeOptionsEnabled = false;
                EditorSettings.enterPlayModeOptions = EnterPlayModeOptions.None;
                Debug.Log("[AuraPlayHoldGuard] disabled Enter Play Mode Options");
            }
            // 16GB: Force Lean so Play can hold (Zuko / Dutch rule)
            if (!EditorPrefs.GetBool("Concordia.ForceLeanPlay", false))
            {
                EditorPrefs.SetBool("Concordia.ForceLeanPlay", true);
                EditorPrefs.SetBool("Concordia.ForceFullPlay", false);
                Debug.Log("[AuraPlayHoldGuard] Force Lean ON for 16GB Play hold");
            }
        }
    }
}
