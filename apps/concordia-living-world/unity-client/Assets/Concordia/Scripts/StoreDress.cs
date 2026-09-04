using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// Places Get Started / Unity Asset Store prefabs that actually live in this project:
    /// Prefabs (PlayerRobot, Stairs, Wall_Light, Collectible_Star, Moving_Platform),
    /// TimmyRobot, SourceFiles models. No Synty/POLYGON pack is imported here.
    /// </summary>
    public static class StoreDress
    {
        const string LightsL = "Assets/Prefabs/Wall_Light_Left.prefab";
        const string LightsR = "Assets/Prefabs/Wall_Light_Right.prefab";
        const string Stairs = "Assets/Prefabs/Stairs.prefab";
        const string Star = "Assets/Prefabs/Collectible_Star.prefab";
        const string Robot = "Assets/Prefabs/PlayerRobot.prefab";
        const string Platform = "Assets/Prefabs/Moving_Platform.prefab";
        const string Timmy = "Assets/SourceFiles/TimmyRobot/Models/TimmyRobot.fbx";
        const string StairMesh = "Assets/SourceFiles/Models/Stairs_650_400_300_Mesh.fbx";
        const string Hollow = "Assets/SourceFiles/Models/CubeHollow.fbx";
        const string Box = "Assets/SourceFiles/Models/Box_350x250x300_Mesh.fbx";

        public static void Hub(Transform root)
        {
            foreach (var g in Canon.Gates)
            {
                var dir = new Vector3(Mathf.Cos(g.angle), 0f, Mathf.Sin(g.angle));
                var side = Vector3.Cross(Vector3.up, dir).normalized;
                var baseP = dir * Canon.RingRadius;
                Place(LightsL, root, baseP + side * 4.4f + Vector3.up * 4.6f + dir * -0.8f, -g.angle * Mathf.Rad2Deg, 0.9f);
                Place(LightsR, root, baseP - side * 4.4f + Vector3.up * 4.6f + dir * -0.8f, -g.angle * Mathf.Rad2Deg, 0.9f);
            }
            Place(Star, root, new Vector3(0f, 7.4f, 0f), 0f, 0.55f);
        }

        public static void Realm(Transform root, WorldDef w)
        {
            Place(Stairs, root, new Vector3(0f, 0f, -10.4f), 180f, 0);
            Place(StairMesh, root, new Vector3(3.2f, 0f, -10.4f), 180f, 2.4f);
            Place(Hollow, root, new Vector3(-4.5f, 0f, 6f), 25f, 2.2f);
            Place(Box, root, new Vector3(5.2f, 0f, 5.4f), -20f, 1.6f);

            if (w.id == WorldId.Cyber || w.id == WorldId.Crucible)
            {
                var bot = Place(Robot, root, new Vector3(-6f, 0f, 4f), 140f, 1.75f);
                if (bot) bot.name = "StoreRobot";
                var tim = Place(Timmy, root, new Vector3(6.4f, 0f, 3.2f), -40f, 1.7f);
                if (tim) tim.name = "Timmy";
            }
            if (w.id == WorldId.Crucible || w.id == WorldId.Frontier)
                Place(Platform, root, new Vector3(0f, 0.2f, 10f), 0f, 0);
            if (w.id == WorldId.Fantasy || w.id == WorldId.Superhero)
                Place(Star, root, new Vector3(0f, 4.2f, 8f), 0f, 0.7f);
        }

        public static void QuestMark(Transform root, Vector3 boardTop)
        {
            Place(Star, root, boardTop + Vector3.up * 0.85f, 0f, 0.45f);
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
