using UnityEditor;
using UnityEditor.Animations;
using UnityEngine;

namespace Concordia.Editor
{
    [InitializeOnLoad]
    static class KenneyPersonSetup
    {
        const string Fbx = "Assets/Concordia/Resources/Concordia/Person/characterMedium.fbx";
        const string Idle = "Assets/Concordia/Resources/Concordia/Person/idle.fbx";
        const string Run = "Assets/Concordia/Resources/Concordia/Person/run.fbx";
        const string Jump = "Assets/Concordia/Resources/Concordia/Person/jump.fbx";
        const string Ctrl = "Assets/Concordia/Resources/Concordia/KenneyLocomotion.controller";

        static KenneyPersonSetup()
        {
            EditorApplication.delayCall += Ensure;
        }

        static void Ensure()
        {
            Configure(Fbx, true);
            Configure(Idle, false);
            Configure(Run, false);
            Configure(Jump, false);
            if (AssetDatabase.LoadAssetAtPath<AnimatorController>(Ctrl)) return;

            var idle = FirstClip(Idle);
            var run = FirstClip(Run);
            if (!idle)
            {
                Debug.LogWarning("[Concordia] Kenney idle.fbx not imported yet.");
                return;
            }
            System.IO.Directory.CreateDirectory("Assets/Concordia/Resources/Concordia");
            var ac = AnimatorController.CreateAnimatorControllerAtPath(Ctrl);
            ac.AddParameter("Speed", AnimatorControllerParameterType.Float);
            ac.AddParameter("Grounded", AnimatorControllerParameterType.Bool);
            var sm = ac.layers[0].stateMachine;
            var st = sm.AddState("Idle");
            if (run)
            {
                var blend = new BlendTree
                {
                    name = "Locomotion",
                    hideFlags = HideFlags.HideInHierarchy,
                    blendType = BlendTreeType.Simple1D,
                    blendParameter = "Speed",
                    useAutomaticThresholds = false
                };
                AssetDatabase.AddObjectToAsset(blend, ac);
                blend.AddChild(idle, 0f);
                blend.AddChild(run, 4.6f);
                st.motion = blend;
            }
            else st.motion = idle;
            sm.defaultState = st;
            EditorUtility.SetDirty(ac);
            AssetDatabase.SaveAssets();
            Debug.Log("[Concordia] Kenney person idle/run controller ready.");
        }

        static void Configure(string path, bool mesh)
        {
            var imp = AssetImporter.GetAtPath(path) as ModelImporter;
            if (!imp) return;
            bool dirty = false;
            if (imp.animationType != ModelImporterAnimationType.Generic)
            {
                imp.animationType = ModelImporterAnimationType.Generic;
                dirty = true;
            }
            if (mesh && imp.avatarSetup != ModelImporterAvatarSetup.CreateFromThisModel)
            {
                imp.avatarSetup = ModelImporterAvatarSetup.CreateFromThisModel;
                dirty = true;
            }
            if (imp.useFileScale)
            {
                imp.useFileScale = false;
                dirty = true;
            }
            if (Mathf.Abs(imp.globalScale - 0.01f) > 0.0001f)
            {
                imp.globalScale = 0.01f;
                dirty = true;
            }
            var clips = imp.defaultClipAnimations;
            if (clips != null && clips.Length > 0)
            {
                foreach (var c in clips) c.loopTime = true;
                imp.clipAnimations = clips;
                dirty = true;
            }
            if (dirty) imp.SaveAndReimport();
        }

        static AnimationClip FirstClip(string path)
        {
            foreach (var o in AssetDatabase.LoadAllAssetsAtPath(path))
            {
                var c = o as AnimationClip;
                if (c == null || c.name.Contains("__preview")) continue;
                return c;
            }
            return null;
        }
    }
}
