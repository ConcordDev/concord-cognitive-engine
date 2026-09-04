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
            Debug.Log("[Concordia] Package Manager My Assets is the account catalog — listed != imported. Download, then Import into THIS project (Assets/Store/ or leave at Assets/<Pack Name>/). DressVocab scans both; store exact/fuzzy before Kenney. Do not vendor Demo City.");
        }

        [MenuItem("Concordia/Asset Store/Dump visual audit")]
        public static void DumpVisual()
        {
            FreePacks.Reindex();
            var text = DressVocab.Audit();
            try { System.IO.File.WriteAllText("/tmp/concordia-visual.txt", text); }
            catch { }
            Debug.Log("[Concordia]\n" + text);
        }
    }
}
