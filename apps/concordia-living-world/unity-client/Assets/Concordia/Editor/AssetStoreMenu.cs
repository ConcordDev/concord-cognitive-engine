using UnityEditor;
using UnityEngine;

namespace Concordia.Editor
{
    /// <summary>
    /// Opens the owned My Assets catalog — not a wishlist of packs this
    /// account does not have (Slavic Village, Distant Lands, Kyle, …).
    /// </summary>
    public static class AssetStoreMenu
    {
        [MenuItem("Concordia/Asset Store/Open Hub")]
        public static void OpenHub() => Application.OpenURL("https://assetstore.unity.com/");

        [MenuItem("Concordia/Asset Store/Owned — Mega Fantasy Props (87811)")]
        public static void MegaFantasy() => Application.OpenURL("https://assetstore.unity.com/packages/3d/props/mega-fantasy-props-pack-87811");

        [MenuItem("Concordia/Asset Store/Owned — Modular Kit (85732)")]
        public static void Modular() => Application.OpenURL("https://assetstore.unity.com/packages/3d/environments/3d-free-modular-kit-85732");

        [MenuItem("Concordia/Asset Store/Owned — Fantasy Forest (35361)")]
        public static void Forest() => Application.OpenURL("https://assetstore.unity.com/packages/3d/environments/fantasy/fantasy-forest-environment-free-demo-35361");

        [MenuItem("Concordia/Asset Store/Owned — Skybox Extended (107400)")]
        public static void Skybox() => Application.OpenURL("https://assetstore.unity.com/packages/vfx/shaders/free-skybox-extended-shader-107400");

        [MenuItem("Concordia/Asset Store/Owned — Human Basic Motions (154271)")]
        public static void Motions() => Application.OpenURL("https://assetstore.unity.com/packages/3d/animations/human-basic-motions-free-154271");

        [MenuItem("Concordia/Asset Store/Owned — Particle Pack (127325)")]
        public static void Particles() => Application.OpenURL("https://assetstore.unity.com/packages/vfx/particles/particle-pack-127325");

        [MenuItem("Concordia/Asset Store/Owned — EasyRoads3D (987)")]
        public static void Roads() => Application.OpenURL("https://assetstore.unity.com/packages/tools/terrain/easyroads3d-free-v3-987");

        [MenuItem("Concordia/Asset Store/Owned — Starter Assets URP (267961, reference)")]
        public static void Starter() => Application.OpenURL("https://assetstore.unity.com/packages/essentials/starter-assets-character-controllers-urp-267961");

        [MenuItem("Concordia/Asset Store/Free filter (3D $0)")]
        public static void Free3d() => Application.OpenURL("https://assetstore.unity.com/3d?price=0-0");

        [MenuItem("Concordia/Ping Kenney CC0 packs")]
        public static void PingKenney()
        {
            var o = AssetDatabase.LoadAssetAtPath<Object>("Assets/Concordia/Models/kenney-free/nature-kit/tree_oak.glb");
            if (o) { EditorGUIUtility.PingObject(o); Selection.activeObject = o; }
            Debug.Log("Kenney CC0 packs live under Assets/Concordia/Models/kenney-free/. Store packs win when imported.");
        }

        [MenuItem("Concordia/Ping imported GLBs")]
        public static void PingModels()
        {
            var o = AssetDatabase.LoadAssetAtPath<Object>("Assets/Concordia/Models/world-lens/building/tavern.glb");
            if (o) { EditorGUIUtility.PingObject(o); Selection.activeObject = o; }
            Debug.Log("World-lens + living-world GLBs are under Assets/Concordia/Models/. Press Play on ConcordiaHub.");
        }
    }
}
