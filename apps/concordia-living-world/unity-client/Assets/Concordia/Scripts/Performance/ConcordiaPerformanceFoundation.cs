using System;
using System.Collections.Generic;
using System.IO;
using UnityEngine;

namespace Concordia
{
    [CreateAssetMenu(menuName = "Concordia/Performance/Frame Budget Profile", fileName = "ConcordiaFrameBudgetProfile")]
    public sealed class ConcordiaFrameBudgetProfile : ScriptableObject
    {
        [Header("Frame budget")]
        public int targetFrameRate = 60;
        public float cpuFrameBudgetMs = 16.67f;
        public float gpuFrameBudgetMs = 16.67f;
        public float streamingSliceBudgetMs = 3.5f;
        public int maxManagedHeapDeltaBytesPerSample = 262144;

        [Header("Benchmark capture")]
        public int warmupFrames = 180;
        public float sampleDurationSeconds = 30f;
        public int minimumMeasuredFrames = 300;
        public bool captureGpuFrameTiming = true;
        public bool showOverlay = true;
        public bool applyTargetFrameRate = false;
    }

    

    /// <summary>
    /// Additive benchmark instrumentation for the existing Concordia Hub runtime.
    /// It deliberately measures the live scene without changing renderer, streaming,
    /// look-stack, or world-authority ownership.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class ConcordiaVisualBenchmarkController : MonoBehaviour
    {
        [SerializeField] ConcordiaFrameBudgetProfile budgetProfile;
        [SerializeField] string scenarioId = "Hub_UnburnedCourt";
        [SerializeField] bool autoStart = true;

        readonly List<float> frameSamplesMs = new List<float>(4096);
        readonly FrameTiming[] timingBuffer = new FrameTiming[1];
        float startedAt;
        int warmupFramesRemaining;
        int totalFrames;
        long heapAtLastSample;
        double gpuTotalMs;
        int gpuSamples;
        bool running;
        bool completed;
        BenchmarkResult lastResult;
        string lastResultPath;

        [Serializable]
        sealed class BenchmarkResult
        {
            public string schemaVersion = "1.0";
            public string scenario;
            public string scene;
            public string capturedUtc;
            public string unityVersion;
            public string graphicsDevice;
            public string renderPipeline;
            public string qualityLevel;
            public bool leanPlay;
            public int measuredFrames;
            public float durationSeconds;
            public float averageFrameMs;
            public float p50FrameMs;
            public float p95FrameMs;
            public float p99FrameMs;
            public float worstFrameMs;
            public float averageGpuFrameMs;
            public int gpuTimingSamples;
            public long managedHeapDeltaBytes;
            public float cpuBudgetMs;
            public float gpuBudgetMs;
            public string cpuStatus;
            public string gpuStatus;
            public string overallStatus;
            public string notes;
        }

        public ConcordiaFrameBudgetProfile BudgetProfile => budgetProfile;
        public bool IsRunning => running;
        public bool HasCompleted => completed;
        public string LastResultPath => lastResultPath;

        void Start()
        {
            if (autoStart) BeginBenchmark();
        }

        public void BeginBenchmark()
        {
            var profile = budgetProfile;
            if (profile == null)
            {
                Debug.LogWarning("[Concordia] Visual benchmark has no frame budget profile; using safe defaults.");
            }

            if (profile != null && profile.applyTargetFrameRate && profile.targetFrameRate > 0)
                Application.targetFrameRate = profile.targetFrameRate;

            frameSamplesMs.Clear();
            gpuTotalMs = 0d;
            gpuSamples = 0;
            startedAt = Time.realtimeSinceStartup;
            warmupFramesRemaining = Mathf.Max(0, profile != null ? profile.warmupFrames : 180);
            totalFrames = 0;
            heapAtLastSample = GC.GetTotalMemory(false);
            running = true;
            completed = false;
            lastResult = null;
            lastResultPath = string.Empty;
            Debug.Log("[Concordia] Visual benchmark started: " + scenarioId + " (warmup=" + warmupFramesRemaining + ")");
        }

        void Update()
        {
            if (!running) return;
            totalFrames++;

            var profile = budgetProfile;
            var duration = Time.realtimeSinceStartup - startedAt;
            if (warmupFramesRemaining > 0)
            {
                warmupFramesRemaining--;
                return;
            }

            frameSamplesMs.Add(Mathf.Max(0f, Time.unscaledDeltaTime * 1000f));
            if (profile == null || profile.captureGpuFrameTiming)
                CaptureGpuTiming();

            if (profile != null && duration >= Mathf.Max(1f, profile.sampleDurationSeconds))
                FinishBenchmark();
            else if (profile == null && duration >= 30f)
                FinishBenchmark();
        }

        void CaptureGpuTiming()
        {
            try
            {
                FrameTimingManager.CaptureFrameTimings();
                var count = FrameTimingManager.GetLatestTimings(1, timingBuffer);
                if (count > 0 && timingBuffer[0].gpuFrameTime > 0.0)
                {
                    gpuTotalMs += timingBuffer[0].gpuFrameTime;
                    gpuSamples++;
                }
            }
            catch (Exception ex)
            {
                // GPU timing is hardware/API dependent; a missing sample is an honest inconclusive result.
                if (gpuSamples == 0)
                    Debug.LogWarning("[Concordia] GPU frame timing unavailable: " + ex.Message);
            }
        }

        public void FinishBenchmark()
        {
            if (!running) return;
            running = false;
            completed = true;
            if (frameSamplesMs.Count == 0)
            {
                Debug.LogWarning("[Concordia] Visual benchmark finished without measured frames.");
                return;
            }

            var sorted = new List<float>(frameSamplesMs);
            sorted.Sort();
            var duration = Mathf.Max(0.001f, Time.realtimeSinceStartup - startedAt);
            var profile = budgetProfile;
            var cpuBudget = profile != null ? profile.cpuFrameBudgetMs : 16.67f;
            var gpuBudget = profile != null ? profile.gpuFrameBudgetMs : 16.67f;
            var average = Average(frameSamplesMs);
            var p50 = Percentile(sorted, 0.50f);
            var p95 = Percentile(sorted, 0.95f);
            var p99 = Percentile(sorted, 0.99f);
            var worst = sorted[sorted.Count - 1];
            var gpuAverage = gpuSamples > 0 ? (float)(gpuTotalMs / gpuSamples) : 0f;
            var heapDelta = GC.GetTotalMemory(false) - heapAtLastSample;
            var cpuStatus = frameSamplesMs.Count < (profile != null ? profile.minimumMeasuredFrames : 300)
                ? "inconclusive-too-few-frames"
                : (p95 <= cpuBudget ? "pass" : "fail");
            var gpuStatus = gpuSamples > 0 ? (gpuAverage <= gpuBudget ? "pass" : "fail") : "inconclusive-no-gpu-timing";
            var overall = cpuStatus == "fail" || gpuStatus == "fail"
                ? "fail"
                : (cpuStatus.StartsWith("inconclusive", StringComparison.Ordinal) || gpuStatus.StartsWith("inconclusive", StringComparison.Ordinal)
                    ? "inconclusive" : "pass");

            lastResult = new BenchmarkResult
            {
                scenario = scenarioId,
                scene = UnityEngine.SceneManagement.SceneManager.GetActiveScene().path,
                capturedUtc = DateTime.UtcNow.ToString("o"),
                unityVersion = Application.unityVersion,
                graphicsDevice = SystemInfo.graphicsDeviceName,
                renderPipeline = UnityEngine.Rendering.GraphicsSettings.currentRenderPipeline
                    ? UnityEngine.Rendering.GraphicsSettings.currentRenderPipeline.name : "Built-in/none",
                qualityLevel = QualitySettings.names.Length > 0 ? QualitySettings.names[QualitySettings.GetQualityLevel()] : "unknown",
                leanPlay = ConcordiaHost.LeanPlay,
                measuredFrames = frameSamplesMs.Count,
                durationSeconds = duration,
                averageFrameMs = average,
                p50FrameMs = p50,
                p95FrameMs = p95,
                p99FrameMs = p99,
                worstFrameMs = worst,
                averageGpuFrameMs = gpuAverage,
                gpuTimingSamples = gpuSamples,
                managedHeapDeltaBytes = heapDelta,
                cpuBudgetMs = cpuBudget,
                gpuBudgetMs = gpuBudget,
                cpuStatus = cpuStatus,
                gpuStatus = gpuStatus,
                overallStatus = overall,
                notes = "CPU uses unscaled frame delta; GPU is reported only when Unity FrameTimingManager supplies samples."
            };

            try
            {
                var dir = Path.Combine(Application.persistentDataPath, "Concordia", "Performance");
                Directory.CreateDirectory(dir);
                lastResultPath = Path.Combine(dir, "latest-visual-benchmark.json");
                File.WriteAllText(lastResultPath, JsonUtility.ToJson(lastResult, true));
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Concordia] Could not persist benchmark result: " + ex.Message);
            }

            Debug.Log("[Concordia] Visual benchmark " + overall + ": p95=" + p95.ToString("F2") + "ms gpu=" +
                      (gpuSamples > 0 ? gpuAverage.ToString("F2") + "ms" : "inconclusive") +
                      " frames=" + frameSamplesMs.Count + " result=" + lastResultPath);
        }

        static float Average(List<float> values)
        {
            double sum = 0d;
            for (var i = 0; i < values.Count; i++) sum += values[i];
            return (float)(sum / Mathf.Max(1, values.Count));
        }

        static float Percentile(List<float> sorted, float percentile)
        {
            if (sorted.Count == 0) return 0f;
            var index = Mathf.Clamp(Mathf.CeilToInt((sorted.Count - 1) * percentile), 0, sorted.Count - 1);
            return sorted[index];
        }

        void OnGUI()
        {
            if (budgetProfile != null && !budgetProfile.showOverlay) return;
            if (!running && !completed) return;

            var rect = new Rect(16f, 16f, 520f, completed ? 170f : 58f);
            GUI.Box(rect, string.Empty);
            GUILayout.BeginArea(new Rect(28f, 23f, 500f, 155f));
            if (running)
            {
                GUILayout.Label("Concordia visual benchmark: " + scenarioId);
                GUILayout.Label("Warming/recording — measured frames: " + frameSamplesMs.Count);
            }
            else if (lastResult != null)
            {
                GUILayout.Label("Concordia visual benchmark: " + lastResult.overallStatus);
                GUILayout.Label("CPU p95 " + lastResult.p95FrameMs.ToString("F2") + " ms / " + lastResult.cpuBudgetMs.ToString("F2") + " ms");
                GUILayout.Label("GPU " + (lastResult.gpuTimingSamples > 0 ? lastResult.averageGpuFrameMs.ToString("F2") + " ms" : "inconclusive"));
                GUILayout.Label("Frames " + lastResult.measuredFrames + " — result persisted under Application.persistentDataPath");
            }
            GUILayout.EndArea();
        }
    }
}
