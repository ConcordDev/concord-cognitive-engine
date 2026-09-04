using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace Concordia.Editor
{
    /// <summary>
    /// GraphicsSettings.m_CustomRenderPipeline was unset. URP Lit then draws magenta.
    /// Create a project pipeline asset and assign it once.
    /// </summary>
    [InitializeOnLoad]
    public static class ConcordiaUrpEnsure
    {
        const string Folder = "Assets/Settings";
        const string RendererPath = "Assets/Settings/URP-Renderer.asset";
        const string PipelinePath = "Assets/Settings/URP-Pipeline.asset";

        static ConcordiaUrpEnsure()
        {
            EditorApplication.delayCall += Ensure;
        }

        [MenuItem("Concordia/Ensure URP Pipeline")]
        public static void Ensure()
        {
            if (GraphicsSettings.defaultRenderPipeline is UniversalRenderPipelineAsset)
                return;
            if (!AssetDatabase.IsValidFolder(Folder))
                AssetDatabase.CreateFolder("Assets", "Settings");

            var renderer = AssetDatabase.LoadAssetAtPath<UniversalRendererData>(RendererPath);
            if (!renderer)
            {
                renderer = ScriptableObject.CreateInstance<UniversalRendererData>();
                AssetDatabase.CreateAsset(renderer, RendererPath);
            }

            var urp = AssetDatabase.LoadAssetAtPath<UniversalRenderPipelineAsset>(PipelinePath);
            if (!urp)
            {
                urp = UniversalRenderPipelineAsset.Create(renderer);
                if (!urp)
                    urp = ScriptableObject.CreateInstance<UniversalRenderPipelineAsset>();
                AssetDatabase.CreateAsset(urp, PipelinePath);
            }

            GraphicsSettings.defaultRenderPipeline = urp;
            QualitySettings.renderPipeline = urp;
            EditorUtility.SetDirty(urp);
            EditorUtility.SetDirty(renderer);
            AssetDatabase.SaveAssets();
            Debug.Log("[Concordia] URP pipeline assigned: " + PipelinePath);
        }
    }
}
