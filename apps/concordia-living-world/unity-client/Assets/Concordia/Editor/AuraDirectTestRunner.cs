using System;
using System.IO;
using System.Reflection;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEditor.TestTools.TestRunner.Api;
using UnityEngine;
using UnityEngine.TestRunner;

namespace Concordia.EditorTools
{
    public static class AuraDirectTestRunner
    {
        const string ProofPath = "Assets/Concordia/Generated/Proof/DirectTestRunner.txt";
        const string PlayProofPath = "Assets/Concordia/Generated/Proof/FocusedPlayMode.txt";

        [MenuItem("Concordia/Verification/Run Content Bind EditMode Tests Direct")]
        public static void RunContentBindEditModeTests()
        {
            var callback = new Callback("ContentBind EditMode", ProofPath);
            TestRunnerApi.RegisterTestCallback(callback, 0);

            var filter = new Filter
            {
                testMode = TestMode.EditMode,
                testNames = new[]
                {
                    "Concordia.Tests.ContentBindCatalogTests.VolumeQuestCatalog_LoadsAllAuthoredWorldBuckets",
                    "Concordia.Tests.ContentBindCatalogTests.VolumeQuestCatalog_NormalizesExistingQuestVerbs_AndPreservesCraftGap"
                }
            };

            var settings = new ExecutionSettings
            {
                filters = new[] { filter },
                runSynchronously = false
            };

            var api = ScriptableObject.CreateInstance<TestRunnerApi>();
            var guid = api.Execute(settings);
            Debug.Log("[Concordia] Direct test run started: " + guid);
        }

        [MenuItem("Concordia/Verification/Run Focused PlayMode Proofs Direct")]
        public static void RunFocusedPlayModeProofs()
        {
            RunPlayModeProof("Focused PlayMode", new[]
            {
                "Concordia.Tests.SettlementLiveBootTest.BootScene_CompilesRealSettlementGeometry_WithNoExceptions",
                "Concordia.Tests.ContinentStreamPlayModeTests.ConcordiaHubBoot_StagesContinent_AndPublishesReadyChunks",
                "Concordia.Tests.ContinentStreamPlayModeTests.ReleaseDuringFullBuild_DoesNotCommitStaleChunk"
            });
        }

        [MenuItem("Concordia/Verification/Run Settlement PlayMode Proof Direct")]
        public static void RunSettlementPlayModeProof()
        {
            RunPlayModeProof("Settlement PlayMode", new[]
            {
                "Concordia.Tests.SettlementLiveBootTest.BootScene_CompilesRealSettlementGeometry_WithNoExceptions"
            });
        }

        [MenuItem("Concordia/Verification/Run Hub Streaming PlayMode Proof Direct")]
        public static void RunHubStreamingPlayModeProof()
        {
            RunPlayModeProof("Hub Streaming PlayMode", new[]
            {
                "Concordia.Tests.ContinentStreamPlayModeTests.ConcordiaHubBoot_StagesContinent_AndPublishesReadyChunks"
            });
        }

        [MenuItem("Concordia/Verification/Run Stale Build PlayMode Proof Direct")]
        public static void RunStaleBuildPlayModeProof()
        {
            RunPlayModeProof("Stale Build PlayMode", new[]
            {
                "Concordia.Tests.ContinentStreamPlayModeTests.ReleaseDuringFullBuild_DoesNotCommitStaleChunk"
            });
        }

        static void RunPlayModeProof(string label, string[] testNames)
        {
            var callback = new Callback(label, PlayProofPath);
            TestRunnerApi.RegisterTestCallback(callback, 0);

            var filter = new Filter
            {
                testMode = TestMode.PlayMode,
                testNames = testNames
            };

            var settings = new ExecutionSettings
            {
                filters = new[] { filter },
                runSynchronously = false
            };

            var api = ScriptableObject.CreateInstance<TestRunnerApi>();
            var guid = api.Execute(settings);
            Debug.Log("[Concordia] " + label + " direct test run started: " + guid);
        }

        enum RuntimeProbeMode
        {
            HubStreaming,
            Settlement,
            StaleBuild
        }

        const string RuntimeProbeActiveKey = "Concordia.AuraDirectTestRunner.RuntimeProbeActive";
        const string RuntimeProbeModeKey = "Concordia.AuraDirectTestRunner.RuntimeProbeMode";

        static RuntimeProbeMode _runtimeProbeMode;
        static double _runtimeProbeStartedAt;
        static double _staleBuildStartedAt;
        static bool _staleBuildRequested;
        static bool _runtimeProbeFinished;

        [InitializeOnLoadMethod]
        static void RestoreRuntimeProbeAfterDomainReload()
        {
            if (!SessionState.GetBool(RuntimeProbeActiveKey, false)) return;

            _runtimeProbeMode = (RuntimeProbeMode)SessionState.GetInt(RuntimeProbeModeKey, 0);
            _runtimeProbeStartedAt = EditorApplication.timeSinceStartup;
            _staleBuildStartedAt = 0.0;
            _staleBuildRequested = false;
            _runtimeProbeFinished = false;
            EditorApplication.update -= PollRuntimeProbe;
            EditorApplication.update += PollRuntimeProbe;
        }

        [MenuItem("Concordia/Verification/Run Hub Streaming Runtime Probe")]
        public static void RunHubStreamingRuntimeProbe()
        {
            StartRuntimeProbe(RuntimeProbeMode.HubStreaming);
        }

        [MenuItem("Concordia/Verification/Run Settlement Runtime Probe")]
        public static void RunSettlementRuntimeProbe()
        {
            StartRuntimeProbe(RuntimeProbeMode.Settlement);
        }

        [MenuItem("Concordia/Verification/Run Stale Build Runtime Probe")]
        public static void RunStaleBuildRuntimeProbe()
        {
            StartRuntimeProbe(RuntimeProbeMode.StaleBuild);
        }

        static void StartRuntimeProbe(RuntimeProbeMode mode)
        {
            if (EditorApplication.isPlaying)
            {
                Debug.LogWarning("[Concordia] Runtime probe not started because Play Mode is already active.");
                return;
            }

            _runtimeProbeMode = mode;
            SessionState.SetBool(RuntimeProbeActiveKey, true);
            SessionState.SetInt(RuntimeProbeModeKey, (int)mode);
            _runtimeProbeStartedAt = EditorApplication.timeSinceStartup;
            _staleBuildStartedAt = 0.0;
            _staleBuildRequested = false;
            _runtimeProbeFinished = false;
            EditorSceneManager.OpenScene("Assets/Scenes/ConcordiaHub.unity");
            EditorApplication.update -= PollRuntimeProbe;
            EditorApplication.update += PollRuntimeProbe;
            EditorApplication.isPlaying = true;
            Debug.Log("[Concordia] Runtime probe started: " + mode);
        }

        static void PollRuntimeProbe()
        {
            if (_runtimeProbeFinished) return;
            if (!EditorApplication.isPlaying)
            {
                if (EditorApplication.isPlayingOrWillChangePlaymode) return;
                FinishRuntimeProbe("aborted: Play Mode stopped before proof completion");
                return;
            }

            var elapsed = EditorApplication.timeSinceStartup - _runtimeProbeStartedAt;
            var stream = ContinentStream.Live;
            if (stream == null)
            {
                if (elapsed >= 120.0)
                    FinishRuntimeProbe("FAIL timeout: ContinentStream.Live was never bound");
                return;
            }

            if (_runtimeProbeMode == RuntimeProbeMode.HubStreaming)
            {
                var cyberImpostor = stream.TryGetReadiness(WorldId.Cyber, out var cyberReadiness)
                    && cyberReadiness == ContinentStream.ChunkReadiness.Impostor
                    && stream.ChunkOf(WorldId.Cyber) != null;
                if (stream.IsContinentReady && stream.IsReady(WorldId.Hub) && cyberImpostor)
                {
                    FinishRuntimeProbe("PASS hub_ready=True continent_ready=True cyber_impostor=True");
                    return;
                }
            }
            else if (_runtimeProbeMode == RuntimeProbeMode.Settlement)
            {
                var chunks = 0;
                var settlements = 0;
                var buildings = 0;
                var roofs = 0;
                var transforms = UnityEngine.Object.FindObjectsByType<Transform>(FindObjectsInactive.Include);
                foreach (var transform in transforms)
                {
                    if (!transform) continue;
                    if (transform.name.StartsWith("Chunk_", StringComparison.Ordinal)) chunks++;
                    else if (transform.name.StartsWith("Settlement_", StringComparison.Ordinal)
                             || transform.name.StartsWith("SettlementStreetscape_", StringComparison.Ordinal)
                             || transform.name == "KernelLive") settlements++;
                    else if (transform.name.StartsWith("Building_", StringComparison.Ordinal)
                             || transform.name.StartsWith("LeanBuilding_", StringComparison.Ordinal)
                             || transform.name.StartsWith("KernelBuilding_", StringComparison.Ordinal)
                             || transform.name == "KernelBuilding"
                             || transform.name.StartsWith("ApproachLandmark", StringComparison.Ordinal)) buildings++;
                    else if (transform.name == "Roof" || transform.name == "ShellRoof") roofs++;
                }

                var places = UnityEngine.Object.FindObjectsByType<Concordia.BuildingPlace>(FindObjectsInactive.Include).Length;
                if (chunks > 0 && settlements > 0 && buildings > 0 && roofs > 0 && places > 0)
                {
                    FinishRuntimeProbe("PASS chunks=" + chunks + " settlements=" + settlements + " buildings=" + buildings + " roofs=" + roofs + " places=" + places);
                    return;
                }

                if (elapsed >= 120.0)
                {
                    FinishRuntimeProbe("FAIL timeout chunks=" + chunks + " settlements=" + settlements + " buildings=" + buildings + " roofs=" + roofs + " places=" + places);
                    return;
                }
            }
            else
            {
                if (!_staleBuildRequested && stream.IsContinentReady && stream.IsReady(WorldId.Hub))
                {
                    var request = typeof(ContinentStream).GetMethod("RequestFull", BindingFlags.Instance | BindingFlags.NonPublic);
                    var release = typeof(ContinentStream).GetMethod("Release", BindingFlags.Instance | BindingFlags.NonPublic);
                    if (request == null || release == null)
                    {
                        FinishRuntimeProbe("FAIL private RequestFull/Release seam missing");
                        return;
                    }

                    request.Invoke(stream, new object[] { WorldId.Cyber });
                    release.Invoke(stream, new object[] { WorldId.Cyber });
                    _staleBuildRequested = true;
                    _staleBuildStartedAt = EditorApplication.timeSinceStartup;
                    Debug.Log("[Concordia] Runtime stale-build probe requested and released Cyber");
                }

                if (_staleBuildRequested && EditorApplication.timeSinceStartup - _staleBuildStartedAt >= 8.0)
                {
                    var committed = stream.IsReady(WorldId.Cyber)
                        || (stream.TryGetReadiness(WorldId.Cyber, out var readiness)
                            && readiness == ContinentStream.ChunkReadiness.Ready);
                    FinishRuntimeProbe(committed
                        ? "FAIL released Cyber became Ready"
                        : "PASS released Cyber did not commit stale Ready state");
                    return;
                }
            }

            if (elapsed >= 120.0)
                FinishRuntimeProbe("FAIL timeout mode=" + _runtimeProbeMode + " continent_ready=" + stream.IsContinentReady + " hub_ready=" + stream.IsReady(WorldId.Hub) + " stale_requested=" + _staleBuildRequested);
        }

        static void FinishRuntimeProbe(string result)
        {
            if (_runtimeProbeFinished) return;
            _runtimeProbeFinished = true;
            SessionState.SetBool(RuntimeProbeActiveKey, false);
            EditorApplication.update -= PollRuntimeProbe;
            Directory.CreateDirectory(Path.GetDirectoryName(PlayProofPath));
            File.WriteAllText(PlayProofPath,
                "Runtime probe=" + _runtimeProbeMode + "\n" +
                "finished=" + DateTime.Now.ToString("O") + "\n" +
                "result=" + result + "\n");
            Debug.Log("[Concordia] Runtime probe finished: " + result);
            EditorApplication.isPlaying = false;
        }

        sealed class Callback : ICallbacks
        {
            readonly string _label;
            readonly string _proofPath;

            public Callback(string label, string proofPath)
            {
                _label = label;
                _proofPath = proofPath;
            }

            public void RunStarted(ITestAdaptor testsToRun)
            {
                Debug.Log("[Concordia] " + _label + " started");
            }

            public void TestStarted(ITestAdaptor test)
            {
            }

            public void TestFinished(ITestResultAdaptor result)
            {
                if (result == null) return;
                Debug.Log("[Concordia] Direct test: " + result.FullName + " => " + result.ResultState);
            }

            public void RunFinished(ITestResultAdaptor testResults)
            {
                if (testResults == null) return;

                var summary =
                    _label + "\n" +
                    "finished=" + DateTime.Now.ToString("O") + "\n" +
                    "passed=" + testResults.PassCount + " failed=" + testResults.FailCount +
                    " skipped=" + testResults.SkipCount + " inconclusive=" + testResults.InconclusiveCount + "\n" +
                    "result=" + testResults.ResultState + "\n" +
                    "message=" + (testResults.Message ?? "");

                Directory.CreateDirectory(Path.GetDirectoryName(_proofPath));
                File.WriteAllText(_proofPath, summary);
                Debug.Log("[Concordia] Direct test run finished: " + summary.Replace("\n", " | "));
            }
        }
    }
}
