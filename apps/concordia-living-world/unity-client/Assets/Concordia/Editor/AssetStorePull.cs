using UnityEditor;
using UnityEngine;
using Concordia;

namespace Concordia.Editor
{
    /// <summary>
    /// Asset Store packs only download through Package Manager while signed in.
    /// UnityConnect is internal in Unity 6 — do not reference it (CS0122).
    /// </summary>
    public static class AssetStorePull
    {
        [MenuItem("Concordia/Asset Store/Open My Assets")]
        public static void OpenMyAssets()
        {
            EditorApplication.ExecuteMenuItem("Window/Package Manager");
            Debug.Log("[Concordia] Package Manager: My Assets → Download. Import into Assets/Store/ — DressVocab picks Store stems first, Kenney last. Do not vendor the 1.8GB town demo.");
        }

        [MenuItem("Concordia/Asset Store/Dump visual audit")]
        public static void DumpVisual()
        {
            FreePacks.Index();
            var text = DressVocab.Audit();
            try { System.IO.File.WriteAllText("/tmp/concordia-visual.txt", text); }
            catch { }
            Debug.Log("[Concordia]\n" + text);
        }
    }
}
