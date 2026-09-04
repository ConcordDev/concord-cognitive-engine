using UnityEditor;
using UnityEngine;

namespace Concordia.Editor
{
    public static class AssetStoreMenu
    {
        [MenuItem("Concordia/Asset Store/Open Hub")]
        public static void OpenHub() => Application.OpenURL("https://assetstore.unity.com/");

        [MenuItem("Concordia/Asset Store/01 Slavic Medieval Village (167010)")]
        public static void Slavic() => Application.OpenURL("https://assetstore.unity.com/packages/3d/environments/fantasy/slavic-medieval-village-free-modular-environment-kit-167010");

        [MenuItem("Concordia/Asset Store/02 Medieval Fantasy Town demo (280621, ~1.8GB hero only)")]
        public static void FantasyTown() => Application.OpenURL("https://assetstore.unity.com/packages/3d/environments/fantasy/medieval-fantasy-town-village-environment-demo-scenes-280621");

        [MenuItem("Concordia/Asset Store/03 Medieval Fortification (free filter)")]
        public static void Fort() => Application.OpenURL("https://assetstore.unity.com/search?q=Medieval%20Fortification&orderBy=1&price=0-0");

        [MenuItem("Concordia/Asset Store/04 URP Tree Models (253340)")]
        public static void UrpTrees() => Application.OpenURL("https://assetstore.unity.com/packages/3d/vegetation/trees/urp-tree-models-253340");

        [MenuItem("Concordia/Asset Store/05 Point Grass Renderer (207854)")]
        public static void PointGrass() => Application.OpenURL("https://assetstore.unity.com/packages/3d/vegetation/point-grass-renderer-207854");

        [MenuItem("Concordia/Asset Store/06 Low Poly Trees (free filter)")]
        public static void LowPolyVeg() => Application.OpenURL("https://assetstore.unity.com/search?q=Low%20Poly%20Trees%20and%20Vegetation&orderBy=1&price=0-0");

        [MenuItem("Concordia/Asset Store/07 Mountain Stylized Fantasy (307488)")]
        public static void Mountain() => Application.OpenURL("https://assetstore.unity.com/packages/3d/environments/landscapes/mountain-stylized-fantasy-environment-307488");

        [MenuItem("Concordia/Asset Store/08 Human Melee Animations FREE (165785)")]
        public static void Melee() => Application.OpenURL("https://assetstore.unity.com/packages/3d/animations/human-melee-animations-free-165785");

        [MenuItem("Concordia/Asset Store/09 Distant Lands Free Characters (178123)")]
        public static void DistantLands() => Application.OpenURL("https://assetstore.unity.com/packages/3d/characters/distant-lands-free-characters-178123");

        [MenuItem("Concordia/Asset Store/10 Robot Kyle URP (4696)")]
        public static void Kyle() => Application.OpenURL("https://assetstore.unity.com/packages/3d/characters/robots/robot-kyle-urp-4696");

        [MenuItem("Concordia/Asset Store/11 Sci-Fi Lab Kit (324212)")]
        public static void SciFiLab() => Application.OpenURL("https://assetstore.unity.com/packages/3d/environments/sci-fi/sci-fi-lab-kit-modular-stylized-low-poly-environment-assets-324212");

        [MenuItem("Concordia/Asset Store/12 Fake Interiors FREE (104029)")]
        public static void FakeInt() => Application.OpenURL("https://assetstore.unity.com/packages/vfx/shaders/fake-interiors-free-104029");

        [MenuItem("Concordia/Asset Store/13 MapMagic 2 (165180)")]
        public static void MapMagic() => Application.OpenURL("https://assetstore.unity.com/packages/tools/terrain/mapmagic-2-165180");

        [MenuItem("Concordia/Asset Store/14 Starter Assets ThirdPerson (196526, reference)")]
        public static void Starter() => Application.OpenURL("https://assetstore.unity.com/packages/essentials/starter-assets-thirdperson-updates-in-new-charactercontroller-pa-196526");

        [MenuItem("Concordia/Asset Store/15 Particle Pack (127325)")]
        public static void Particles() => Application.OpenURL("https://assetstore.unity.com/packages/vfx/particles/particle-pack-127325");

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
