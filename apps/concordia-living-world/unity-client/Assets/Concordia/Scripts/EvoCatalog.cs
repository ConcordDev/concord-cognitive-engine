using UnityEngine;
#if UNITY_EDITOR
using UnityEditor;
#endif

namespace Concordia
{
    /// <summary>
    /// Mesh IDs match world-lens / evo-asset bare filenames (source=concordia).
    /// </summary>
    public static class EvoCatalog
    {
        public const string Root = "Assets/Concordia/Models/";
        public const string KenneyFree = Root + "kenney-free/";

        public static readonly string Tavern = Root + "world-lens/building/tavern.glb";
        public static readonly string Forge = Root + "world-lens/building/forge.glb";
        public static readonly string Archive = Root + "world-lens/building/archive.glb";
        public static readonly string Market = Root + "world-lens/building/market.glb";
        public static readonly string Tower = Root + "world-lens/building/tower.glb";
        public static readonly string SmallA = Root + "world-lens/building/kenney_city/models/building-small-a.glb";
        public static readonly string SmallB = Root + "world-lens/building/kenney_city/models/building-small-b.glb";
        public static readonly string SmallC = Root + "world-lens/building/kenney_city/models/building-small-c.glb";
        public static readonly string SmallD = Root + "world-lens/building/kenney_city/models/building-small-d.glb";
        public static readonly string Garage = Root + "world-lens/building/kenney_city/models/building-garage.glb";
        public static readonly string Road = Root + "world-lens/building/kenney_city/models/road-straight.glb";
        public static readonly string Grass = Root + "world-lens/building/kenney_city/models/grass.glb";
        public static readonly string Trees = Root + "world-lens/building/kenney_city/models/grass-trees.glb";
        public static readonly string Oak = Root + "living/kenney/tree_oak.glb";
        public static readonly string TreeDefault = Root + "living/kenney/tree_default.glb";
        public static readonly string Longsword = Root + "world-lens/weapon/longsword.glb";
        public static readonly string ArenaSword = Root + "world-lens/kenney/basic_scene/sample/Mini Arena/Models/GLB format/weapon-sword.glb";
        public static readonly string ArenaGate = Root + "world-lens/kenney/basic_scene/sample/Mini Arena/Models/GLB format/wall-gate.glb";
        public static readonly string ArenaStatue = Root + "world-lens/kenney/basic_scene/sample/Mini Arena/Models/GLB format/statue.glb";
        public static readonly string Soldier = Root + "living/Soldier.glb";

        public static GameObject Spawn(string path, Transform parent, Vector3 pos, Quaternion rot, float scale = 1f, float height = 0f)
        {
            var prefab = Load(path);
            GameObject go;
            if (prefab != null)
            {
                go = Object.Instantiate(prefab, parent);
                go.name = System.IO.Path.GetFileNameWithoutExtension(path);
            }
            else
            {
                go = GameObject.CreatePrimitive(PrimitiveType.Cube);
                go.name = "Missing_" + System.IO.Path.GetFileNameWithoutExtension(path);
                go.transform.SetParent(parent, false);
                go.transform.localScale = Vector3.one * 2f;
            }
            go.transform.SetParent(parent, true);
            go.transform.rotation = rot;
            if (Mathf.Abs(scale - 1f) > 0.01f)
                go.transform.localScale *= scale;
            if (height > 0.01f) FreePacks.FitHeight(go, height);
            FreePacks.Sit(go, pos);
            FreePacks.MakeWalkable(go);
            return go;
        }

        public static GameObject Load(string path)
        {
            var stem = System.IO.Path.GetFileNameWithoutExtension(path);
            var kit = FreePacks.Mesh(stem);
            if (kit) return kit;
#if UNITY_EDITOR
            var go = AssetDatabase.LoadAssetAtPath<GameObject>(path);
            if (go) return go;
#endif
            return Resources.Load<GameObject>("Concordia/" + stem);
        }
    }
}
