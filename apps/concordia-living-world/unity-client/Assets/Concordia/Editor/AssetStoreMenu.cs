using UnityEditor;
using UnityEngine;

namespace Concordia.Editor
{
    public static class AssetStoreMenu
    {
        [MenuItem("Concordia/Asset Store/Open Hub")]
        public static void OpenHub() => Application.OpenURL("https://assetstore.unity.com/");

        [MenuItem("Concordia/Asset Store/Free — Human Basic Motions")]
        public static void Motions() => Application.OpenURL("https://assetstore.unity.com/packages/3d/animations/human-basic-motions-free-156063");

        [MenuItem("Concordia/Asset Store/Free — GanzSe Modular Fantasy")]
        public static void GanzSe() => Application.OpenURL("https://assetstore.unity.com/packages/3d/characters/humanoids/fantasy/ganzse-free-modular-character-fantasy-low-poly-pack-321521");

        [MenuItem("Concordia/Asset Store/Free — Creative Characters Animated")]
        public static void CreativeChars() => Application.OpenURL("https://assetstore.unity.com/packages/3d/characters/humanoids/creative-characters-free-animated-pack-304841");

        [MenuItem("Concordia/Asset Store/Free filter (3D $0)")]
        public static void Free3d() => Application.OpenURL("https://assetstore.unity.com/3d?price=0-0");

        [MenuItem("Concordia/Ping Kenney CC0 packs")]
        public static void PingKenney()
        {
            var o = AssetDatabase.LoadAssetAtPath<Object>("Assets/Concordia/Models/kenney-free/nature-kit/tree_oak.glb");
            if (o) { EditorGUIUtility.PingObject(o); Selection.activeObject = o; }
            Debug.Log("Kenney CC0 packs live under Assets/Concordia/Models/kenney-free/ (~1757 GLBs). Press Play.");
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
