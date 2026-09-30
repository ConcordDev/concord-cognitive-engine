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
            var existing = AssetDatabase.LoadAssetAtPath<AnimatorController>(Ctrl);
            if (existing)
            {
                var res = "Assets/Concordia/Resources/Concordia/SoldierLocomotion.controller";
                if (!AssetDatabase.LoadAssetAtPath<AnimatorController>(res))
                    AssetDatabase.CopyAsset(Ctrl, res);
                EnsureCombatOverlay(existing);
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
            EnsureCombatOverlay(ac);
            Debug.Log("[Concordia] Soldier Idle/Walk/Run controller ready.");
        }

        const string UnarmedStrike =
            "Assets/ExplosiveLLC/RPG Character Mecanim Animation Pack FREE/Animations/Unarmed/RPG-Character@Unarmed-Attack-R1.FBX";

        static void EnsureCombatOverlay(AnimatorController ac)
        {
            if (!ac) return;
            bool hasAttack = false;
            foreach (var p in ac.parameters)
                if (p.name == "Attack") hasAttack = true;
            if (!hasAttack) ac.AddParameter("Attack", AnimatorControllerParameterType.Trigger);

            var sm = ac.layers[0].stateMachine;
            foreach (var st in sm.states)
                if (st.state.name == "Strike") return;

            AnimationClip clip = null;
            foreach (var o in AssetDatabase.LoadAllAssetsAtPath(UnarmedStrike))
            {
                var c = o as AnimationClip;
                if (c == null || c.name.Contains("__preview")) continue;
                clip = c;
                break;
            }
            if (!clip) return;
            var strike = sm.AddState("Strike");
            strike.motion = clip;
            var any = sm.AddAnyStateTransition(strike);
            any.AddCondition(AnimatorConditionMode.If, 0, "Attack");
            any.hasExitTime = false;
            any.duration = 0.08f;
            var back = strike.AddTransition(sm.defaultState);
            back.hasExitTime = true;
            back.exitTime = 0.82f;
            back.duration = 0.12f;
            EditorUtility.SetDirty(ac);
            AssetDatabase.SaveAssets();
        }
    }
}
