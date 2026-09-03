using UnityEditor;
using UnityEngine;

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
            Debug.Log("[Concordia] Package Manager: switch the top-left dropdown to My Assets, then Download.");
        }
    }
}
