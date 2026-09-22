using System.IO;
using Concordia.Animation;
using UnityEditor;
using UnityEditor.Animations;
using UnityEngine;

namespace Concordia.Editor
{
    /// <summary>
    /// Import/configure skeletal clips. MP4/video is rejected. Humanoid vs Generic is explicit.
    /// </summary>
    public static class AnimationAssetPipeline
    {
        [MenuItem("Concordia/Animation/Configure Selected as Humanoid")]
        public static void ConfigureHumanoid() => ConfigureSelection(ModelImporterAnimationType.Human);

        [MenuItem("Concordia/Animation/Configure Selected as Generic")]
        public static void ConfigureGeneric() => ConfigureSelection(ModelImporterAnimationType.Generic);

        static void ConfigureSelection(ModelImporterAnimationType type)
        {
            var n = 0;
            foreach (var obj in Selection.objects)
            {
                var path = AssetDatabase.GetAssetPath(obj);
                if (string.IsNullOrEmpty(path)) continue;
                if (IsVideo(path))
                {
                    Debug.LogWarning("[Concordia] Refusing to import video as a clip: " + path);
                    continue;
                }
                if (ConfigureModel(path, type)) n++;
            }
            Debug.Log("[Concordia] Configured " + n + " model(s) as " + type + ".");
        }

        public static bool IsVideo(string path)
        {
            var ext = Path.GetExtension(path).ToLowerInvariant();
            return ext == ".mp4" || ext == ".webm" || ext == ".mov" || ext == ".m4v";
        }

        public static bool ConfigureModel(string path, ModelImporterAnimationType type)
        {
            var imp = AssetImporter.GetAtPath(path) as ModelImporter;
            if (!imp) return false;
            if (type == ModelImporterAnimationType.Human)
            {
                imp.animationType = ModelImporterAnimationType.Human;
                imp.avatarSetup = ModelImporterAvatarSetup.CreateFromThisModel;
            }
            else
            {
                imp.animationType = ModelImporterAnimationType.Generic;
                imp.avatarSetup = ModelImporterAvatarSetup.NoAvatar;
            }
            imp.SaveAndReimport();
            if (type == ModelImporterAnimationType.Human)
            {
                var avatar = AssetDatabase.LoadAssetAtPath<Avatar>(path);
                if (avatar == null || !avatar.isHuman || !avatar.isValid)
                {
                    Debug.LogWarning("[Concordia] Humanoid Avatar invalid for " + path +
                                     " — left configured but not retargetable. Use Generic for this skeleton.");
                    return false;
                }
            }
            return true;
        }

        public static AnimationClip FirstClip(string path)
        {
            foreach (var o in AssetDatabase.LoadAllAssetsAtPath(path))
            {
                var c = o as AnimationClip;
                if (c == null || c.name.Contains("__preview")) continue;
                return c;
            }
            return null;
        }

        public static void ApplyVerbSettings(AnimationClip clip, AnimationVerb verb)
        {
            if (!clip || verb == null) return;
            var so = new SerializedObject(clip);
            var loop = so.FindProperty("m_AnimationClipSettings.m_LoopTime");
            if (loop != null) loop.boolValue = verb.Loop;
            so.ApplyModifiedPropertiesWithoutUndo();
            clip.wrapMode = verb.Loop ? WrapMode.Loop : WrapMode.Once;
        }

        public static bool ControllerHasMotion(AnimatorController ac, string stateName)
        {
            if (!ac) return false;
            foreach (var st in ac.layers[0].stateMachine.states)
            {
                if (st.state.name != stateName) continue;
                return st.state.motion != null;
            }
            return false;
        }
    }
}
