using UnityEngine;

namespace Concordia
{
    [CreateAssetMenu(menuName = "Concordia/Performance/Renderer Audit", fileName = "ConcordiaRenderPerformanceAudit")]
    public sealed class ConcordiaRenderPerformanceAudit : ScriptableObject
    {
        [Header("Evidence identity")]
        public string schemaVersion = "1.0";
        public string auditId = "concordia-urp-performance-foundation-audited-state";
        public string auditTimestampUtc = "Source: user-supplied audited project state; capture timestamp not available.";
        public string unityVersion = "Unity 6 live Editor; exact patch version not returned by audit tools.";
        public string installedUrpPackage = "com.unity.render-pipelines.universal 17.5.0 (installed package list)";
        public string manifestUrpRequest = "com.unity.render-pipelines.universal 17.3.0 (Packages/manifest.json); version alignment remains inconclusive.";
        public string activePipelineAsset = "Assets/Settings/URP-Pipeline.asset";
        public string activeRendererAsset = "Assets/Settings/URP-Renderer.asset";
        public string benchmarkScene = "Assets/Concordia/Generated/Performance/ConcordiaVisualBenchmark.unity";
        public string frameBudgetProfile = "Assets/Concordia/Generated/Performance/ConcordiaFrameBudgetProfile.asset";

        [Header("Feature status evidence")]
        [TextArea(8, 40)]
        public string featureStatusJson;
        [TextArea(4, 20)]
        public string inconclusiveItemsJson;
        [TextArea(4, 20)]
        public string protectedArchitectureJson;

        [Header("Measurement contract")]
        public string measuredRuntimeStatus = "inconclusive-until-play-run";
        public string latestBenchmarkResult = "No valid Play-mode result captured yet.";
        public int targetFrameRate = 60;
        public float cpuFrameBudgetMs = 16.67f;
        public float gpuFrameBudgetMs = 16.67f;
        public float streamingSliceBudgetMs = 3.5f;
    }
}
