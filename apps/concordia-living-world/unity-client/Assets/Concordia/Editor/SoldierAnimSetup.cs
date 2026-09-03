using UnityEditor;
using UnityEditor.Animations;
using UnityEngine;

namespace Concordia.Editor
{
    [InitializeOnLoad]
    static class SoldierAnimSetup
    {
        const string Glb = "Assets/Concordia/Models/humans/Soldier.glb";
        const string Ctrl = "Assets/Concordia/Anim/SoldierLocomotion.controller";

        static SoldierAnimSetup()
        {
            EditorApplication.delayCall += Ensure;
        }

        static void Ensure()
        {
            if (AssetDatabase.LoadAssetAtPath<AnimatorController>(Ctrl))
            {
                var res = "Assets/Concordia/Resources/Concordia/SoldierLocomotion.controller";
                if (!AssetDatabase.LoadAssetAtPath<AnimatorController>(res))
                    AssetDatabase.CopyAsset(Ctrl, res);
                return;
            }
            AnimationClip idle = null, walk = null, run = null;
            foreach (var o in AssetDatabase.LoadAllAssetsAtPath(Glb))
            {
                var c = o as AnimationClip;
                if (c == null || c.name.Contains("__preview")) continue;
                if (c.name == "Idle") idle = c;
                else if (c.name == "Walk") walk = c;
                else if (c.name == "Run") run = c;
            }
            if (!idle || !walk || !run)
            {
                Debug.LogWarning("[Concordia] Soldier.glb clips not imported yet (Idle/Walk/Run).");
                return;
            }
            System.IO.Directory.CreateDirectory("Assets/Concordia/Anim");
            var ac = AnimatorController.CreateAnimatorControllerAtPath(Ctrl);
            ac.AddParameter("Speed", AnimatorControllerParameterType.Float);
            ac.AddParameter("Grounded", AnimatorControllerParameterType.Bool);
            var sm = ac.layers[0].stateMachine;
            var st = sm.AddState("Locomotion");
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
            blend.AddChild(walk, 2.4f);
            blend.AddChild(run, 6.2f);
            st.motion = blend;
            sm.defaultState = st;
            EditorUtility.SetDirty(ac);
            AssetDatabase.SaveAssets();
            var resCopy = "Assets/Concordia/Resources/Concordia/SoldierLocomotion.controller";
            if (!AssetDatabase.LoadAssetAtPath<AnimatorController>(resCopy))
                AssetDatabase.CopyAsset(Ctrl, resCopy);
            Debug.Log("[Concordia] Soldier Idle/Walk/Run controller ready.");
        }
    }
}
