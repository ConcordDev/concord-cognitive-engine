using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// Places owned-pack dressing (Mega Fantasy, 3DForge, forest/rocks).
    /// Unity Get Started robots/stars/stairs stay out of the world.
    /// </summary>
    public static class StoreDress
    {
        const string WallLit =
            "Assets/3DForge/Fantasy_Interiors/Villages_&_Towns/Prefabs/Props/Lighting/WallMounted/fi_vil_light_candle_wall02_lit_b.prefab";
        const string StandLit =
            "Assets/3DForge/Fantasy_Interiors/Villages_&_Towns/Prefabs/Props/Lighting/Standing/fi_vil_light_candle_holder04_lit.prefab";

        public static void Hub(Transform root)
        {
            foreach (var g in Canon.Gates)
            {
                var dir = new Vector3(Mathf.Cos(g.angle), 0f, Mathf.Sin(g.angle));
                var side = Vector3.Cross(Vector3.up, dir).normalized;
                var baseP = dir * Canon.RingRadius;
                Place(WallLit, root, baseP + side * 4.4f + Vector3.up * 2.4f + dir * -0.6f, -g.angle * Mathf.Rad2Deg, 1.5f);
                Place(WallLit, root, baseP - side * 4.4f + Vector3.up * 2.4f + dir * -0.6f, -g.angle * Mathf.Rad2Deg, 1.5f);
            }
            Place(StandLit, root, new Vector3(0f, 0f, 0f), 0f, 1.7f);
            FreePacks.Spawn(DressVocab.Well(), root, new Vector3(-8.4f, 0f, 6.2f), 20f, 1.6f, required: false);
            FreePacks.Spawn(DressVocab.Cart(), root, new Vector3(9.2f, 0f, -5.4f), -35f, 2.1f, required: false);
            FreePacks.Spawn(DressVocab.Tree(WorldId.Hub), root, new Vector3(-14f, 0f, 11f), 12f, 9f, required: false);
            FreePacks.Spawn(DressVocab.Tree(WorldId.Hub), root, new Vector3(13.4f, 0f, 12.2f), -28f, 8.2f, required: false);
            FreePacks.Spawn(DressVocab.Rock(), root, new Vector3(-11.2f, 0f, -8.6f), 40f, 1.3f, required: false);
        }

        public static void Realm(Transform root, WorldDef w)
        {
            FreePacks.Spawn(DressVocab.House(w.id), root, new Vector3(-6.2f, 0f, 5.4f), 25f, 5.2f, required: false);
            FreePacks.Spawn(DressVocab.Tower(w.id), root, new Vector3(7.4f, 0f, 6.2f), -20f, 6.5f, required: false);
            FreePacks.Spawn(DressVocab.Tree(w.id), root, new Vector3(-3.2f, 0f, -4.4f), 40f, 8f, required: false);
            FreePacks.Spawn(DressVocab.Tree(w.id), root, new Vector3(5.6f, 0f, -6.1f), -15f, 7.2f, required: false);
            FreePacks.Spawn(DressVocab.Prop(w.id), root, new Vector3(2.4f, 0f, 4.8f), 15f, 0.9f, required: false);
            FreePacks.Spawn(DressVocab.Rock(), root, new Vector3(4.2f, 0f, -3.2f), 10f, 1.1f, required: false);
            HubLook.Lantern(root, new Vector3(0.8f, 0f, 2.2f));
            if (w.id == WorldId.Frontier)
                FreePacks.Spawn(DressVocab.Cart(), root, new Vector3(0f, 0f, 10f), 12f, 2.2f, required: false);
            if (w.id == WorldId.Crime)
            {
                FreePacks.Spawn(DressVocab.Crate(), root, new Vector3(-4.2f, 0f, 3.1f), 8f, 0.9f, required: false);
                FreePacks.Spawn(DressVocab.Crate(), root, new Vector3(-3.4f, 0f, 3.8f), -20f, 0.8f, required: false);
            }
        }

        public static void QuestMark(Transform root, Vector3 boardTop)
        {
            Place(StandLit, root, boardTop, 0f, 1.1f);
        }

        public static GameObject Place(string path, Transform parent, Vector3 pos, float yawDeg, float height)
        {
            var go = FreePacks.Prefab(path, parent, pos, yawDeg);
            if (!go) return null;
            StripPlayable(go);
            if (height > 0.01f) FreePacks.FitHeight(go, height);
            FreePacks.Sit(go, pos);
            FreePacks.PaintIfBlank(go, path);
            return go;
        }

        static void StripPlayable(GameObject go)
        {
            foreach (var cam in go.GetComponentsInChildren<Camera>(true))
                cam.enabled = false;
            foreach (var lis in go.GetComponentsInChildren<AudioListener>(true))
                Object.Destroy(lis);
            foreach (var cc in go.GetComponentsInChildren<CharacterController>(true))
                Object.Destroy(cc);
            foreach (var mb in go.GetComponentsInChildren<MonoBehaviour>(true))
            {
                if (!mb) continue;
                var n = mb.GetType().Name;
                if (n.IndexOf("Controller", System.StringComparison.OrdinalIgnoreCase) >= 0
                    || n.IndexOf("Starter", System.StringComparison.OrdinalIgnoreCase) >= 0
                    || n == "Player" || n.Contains("ThirdPerson"))
                    Object.Destroy(mb);
            }
        }
    }
}
