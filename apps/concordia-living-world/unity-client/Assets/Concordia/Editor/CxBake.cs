#if UNITY_EDITOR
using System.IO;
using UnityEditor;
using UnityEngine;

namespace Concordia.Editor
{
    /// <summary>
    /// Copies the skinned Humanoid FBX into Generated/Rig, bakes dress/grip
    /// prefabs, and makes CX_ plates addressable as URP materials.
    /// Photoreal plates stay albedo; the skeleton is Rocketbox Bip01.
    /// </summary>
    public static class CxBake
    {
        const string Rig = "Assets/Concordia/Generated/Rig";
        const string Prefabs = "Assets/Concordia/Generated/Prefabs";
        const string SrcMale = "Assets/Concordia/Models/humans/rocketbox/Male_Adult_01/Male_Adult_01.fbx";
        const string SrcFemale = "Assets/Concordia/Models/humans/rocketbox/Female_Adult_01/Female_Adult_01.fbx";

        [MenuItem("Concordia/Bake CX Humanoid Prefabs")]
        public static void MenuBake() => Ensure(true);

        public static void Ensure(bool log)
        {
            Folder("Assets/Concordia/Generated");
            Folder(Rig);
            Folder(Prefabs);
            CopyHumanoid(SrcMale, Rig + "/CX_Humanoid_Male.fbx");
            CopyHumanoid(SrcFemale, Rig + "/CX_Humanoid_Female.fbx");
            CopyFolderTextures("Assets/Concordia/Models/humans/rocketbox/Male_Adult_01/Textures", Rig + "/MaleTextures");
            CopyFolderTextures("Assets/Concordia/Models/humans/rocketbox/Female_Adult_01/Textures", Rig + "/FemaleTextures");
            AssetDatabase.Refresh();
            BakePrefab("CX_Humanoid_Male", Rig + "/CX_Humanoid_Male.fbx");
            BakePrefab("CX_Humanoid_Female", Rig + "/CX_Humanoid_Female.fbx");
            BakeWeapon("CX_Weapon_Longsword", "longsword");
            BakeWeapon("CX_Weapon_Hatchet", "hatchet");
            BakeMount();
            if (log) Debug.Log("Concordia CX bake: humanoid FBX + grip prefabs in " + Prefabs);
        }

        static void Folder(string path)
        {
            if (AssetDatabase.IsValidFolder(path)) return;
            var parent = Path.GetDirectoryName(path).Replace("\\", "/");
            var name = Path.GetFileName(path);
            if (!AssetDatabase.IsValidFolder(parent)) Folder(parent);
            AssetDatabase.CreateFolder(parent, name);
        }

        static void CopyHumanoid(string src, string dst)
        {
            if (!File.Exists(Abs(src))) return;
            var dstAbs = Abs(dst);
            Directory.CreateDirectory(Path.GetDirectoryName(dstAbs));
            if (File.Exists(dstAbs)) return;
            File.Copy(Abs(src), dstAbs, false);
        }

        static void CopyFolderTextures(string src, string dst)
        {
            if (!AssetDatabase.IsValidFolder(src)) return;
            Folder(dst);
            foreach (var guid in AssetDatabase.FindAssets("t:Texture", new[] { src }))
            {
                var p = AssetDatabase.GUIDToAssetPath(guid);
                var name = Path.GetFileName(p);
                var target = dst + "/" + name;
                if (File.Exists(Abs(target))) continue;
                AssetDatabase.CopyAsset(p, target);
            }
        }

        static void BakePrefab(string name, string fbxPath)
        {
            var model = AssetDatabase.LoadAssetAtPath<GameObject>(fbxPath);
            if (!model) return;
            var instance = Object.Instantiate(model);
            instance.name = name;
            var right = FindNamed(instance.transform, "Bip01 R Hand", "RightHand", "mixamorig:RightHand");
            var left = FindNamed(instance.transform, "Bip01 L Hand", "LeftHand", "mixamorig:LeftHand");
            if (right && !right.Find("CX_Grip_R"))
            {
                var g = new GameObject("CX_Grip_R");
                g.transform.SetParent(right, false);
            }
            if (left && !left.Find("CX_Grip_L"))
            {
                var g = new GameObject("CX_Grip_L");
                g.transform.SetParent(left, false);
            }
            var hip = FindNamed(instance.transform, "Bip01 Pelvis", "Hips", "mixamorig:Hips");
            if (hip && !hip.Find("CX_Seat"))
            {
                var seat = new GameObject("CX_Seat");
                seat.transform.SetParent(hip, false);
                seat.transform.localPosition = new Vector3(0f, 0.08f, 0f);
            }
            var path = Prefabs + "/" + name + ".prefab";
            PrefabUtility.SaveAsPrefabAsset(instance, path);
            Object.DestroyImmediate(instance);
        }

        static void BakeWeapon(string name, string stem)
        {
            var mesh = FreePacks.Mesh(stem) ?? FreePacks.Mesh("longsword") ?? FreePacks.Mesh("Sword16");
            GameObject go;
            if (mesh)
            {
                go = Object.Instantiate(mesh);
                go.name = name;
                foreach (var c in go.GetComponentsInChildren<Collider>()) Object.DestroyImmediate(c);
                FreePacks.PaintIfBlank(go);
            }
            else
            {
                go = CxDress.HeldWeapon(stem);
                go.name = name;
            }
            var grip = new GameObject("CX_Grip");
            grip.transform.SetParent(go.transform, false);
            var path = Prefabs + "/" + name + ".prefab";
            PrefabUtility.SaveAsPrefabAsset(go, path);
            Object.DestroyImmediate(go);
        }

        static void BakeMount()
        {
            var mesh = FreePacks.Mesh("Horse")
                       ?? FreePacks.Mesh("horse")
                       ?? FreePacks.Mesh("Horse_A");
            if (!mesh) return;
            var go = Object.Instantiate(mesh);
            go.name = "CX_Mount_Horse";
            var hips = FindNamed(go.transform, "Hips", "Spine", "Body", "Root");
            if (hips && !hips.Find("CX_Seat"))
            {
                var seat = new GameObject("CX_Seat");
                seat.transform.SetParent(hips, false);
                seat.transform.localPosition = new Vector3(0f, 0.12f, 0f);
            }
            PrefabUtility.SaveAsPrefabAsset(go, Prefabs + "/CX_Mount_Horse.prefab");
            Object.DestroyImmediate(go);
        }

        static Transform FindNamed(Transform root, params string[] names)
        {
            foreach (var t in root.GetComponentsInChildren<Transform>(true))
            {
                if (!t) continue;
                foreach (var n in names)
                    if (string.Equals(t.name, n, System.StringComparison.OrdinalIgnoreCase))
                        return t;
            }
            return null;
        }

        static string Abs(string assetPath) =>
            Path.GetFullPath(Path.Combine(Application.dataPath, "..", assetPath));
    }
}
#endif
