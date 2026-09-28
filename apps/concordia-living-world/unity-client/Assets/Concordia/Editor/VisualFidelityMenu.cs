using UnityEditor;
using UnityEngine;

namespace Concordia.Editor
{
    public static class VisualFidelityMenu
    {
        [MenuItem("Concordia/Visual Fidelity/Dump Shot Gate")]
        public static void DumpShotGate()
        {
            var dump = VisualFidelity.Dump();
            Debug.Log("[Concordia] Visual fidelity dump " + dump);
            var shots = string.Join("\n", VisualFidelity.Shots);
            EditorUtility.DisplayDialog(
                "Visual fidelity — shot gate",
                "Compile is not a pass.\n\n" + dump + "\n\n" + shots + "\n\nSpec: " + VisualFidelity.Spec,
                "Got it");
        }
    }
}
