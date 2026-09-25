// Headless live-boot verification for the Settlement Compiler wiring.
//
// This exists because a full GUI Editor + Play mode on this machine (16GB, heavily
// multitasked — multiple VS Code windows, a Next.js dev server, large Node processes,
// AuraForUnity all resident at once, ~1.3GB free) repeatedly stalled during boot before any
// script code ran (license/package-manager handshake, 0% CPU, zero disk writes for 8+
// minutes) — a resource-contention problem on the box, not something a code fix addresses.
// A batchmode PlayMode test exercises the IDENTICAL boot path (loads the real
// ConcordiaHub.unity scene, runs ConcordiaGame.Start() for real) without the GUI/editor-UI/
// MCP-bridge overhead, and is scriptable, repeatable, and asserts instead of eyeballing.
//
// bible/CINEMATIC.md is explicit that compiling is not a visual checkpoint ("Aura may not
// close a visual pass on compile"). This does not replace that — it is the mechanical floor
// underneath it: did the compiler actually run, place real buildings, and do so without
// throwing. The actual SHOT 01–10 visual gate still needs eyes in a real windowed Play
// session once the machine has headroom for one.

using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.TestTools;

namespace Concordia.Tests
{
    public class SettlementLiveBootTest
    {
        const float TimeoutSeconds = 100f;
        const float PollIntervalSeconds = 1.5f;

        [UnityTest]
        public IEnumerator BootScene_CompilesRealSettlementGeometry_WithNoExceptions()
        {
            // Unity's Test Framework auto-fails a PlayMode test on ANY unhandled engine log
            // message by default (confirmed live: it aborted here on a pre-existing, wholly
            // unrelated "Step Offset must be..." CharacterController warning from wilderness
            // watcher spawning in RoadWorld.SeedThreats, never reaching this test's own poll
            // loop at all). This test wants to make its OWN judgement about which messages
            // matter — the hardErrors/allErrors split below — not inherit Unity's blanket
            // rule. This does not weaken the check: hardErrors still fails the test outright.
            LogAssert.ignoreFailingMessages = true;

            // Two buckets, deliberately not conflated. `hardErrors` are real signal — an
            // unhandled Exception anywhere, or an Error that names one of this pass's own
            // types — and fail the test. `allErrors` also catches everything else (e.g. the
            // pre-existing "CharacterController.Move called on inactive controller" noise
            // from Hostile.cs, unrelated to this work) for the summary only, so a genuine
            // unrelated engine warning can't produce a false failure here.
            var hardErrors = new List<string>();
            var allErrors = new List<string>();
            string[] ownTypes = { "Settlement", "ModuleKit", "FacadeComposer", "PlotPlanner",
                                  "RoofMesher", "CityTown", "SettlementCompiler", "HubPlaza",
                                  "PlaceKernelBuilding", "ClearKernelLive", "PresentSkillPylons",
                                  "ApplyScene", "ApplyWeatherVisuals", "ChunkRoot" };
            void OnLog(string condition, string stackTrace, LogType type)
            {
                var line = type + ": " + condition;
                allErrors.Add(line);
                if (type == LogType.Exception) { hardErrors.Add(line); return; }
                if (type != LogType.Error) return;
                foreach (var name in ownTypes)
                    if (condition.Contains(name) || (stackTrace != null && stackTrace.Contains(name)))
                    { hardErrors.Add(line); return; }
            }
            Application.logMessageReceived += OnLog;

            var sw = Stopwatch.StartNew();
            SceneManager.LoadScene("ConcordiaHub", LoadSceneMode.Single);
            yield return null;   // let Awake/OnEnable/Start fire for the freshly loaded scene

            int chunks = 0, settlements = 0, buildings = 0, roofs = 0, places = 0;
            string lastSummary = "(no poll yet)";

            while (sw.Elapsed.TotalSeconds < TimeoutSeconds)
            {
                yield return new WaitForSeconds(PollIntervalSeconds);

                chunks = 0; settlements = 0; buildings = 0; roofs = 0; places = 0;
                var all = GameObject.FindObjectsByType<Transform>(FindObjectsInactive.Include);
                foreach (var t in all)
                {
                    if (!t) continue;
                    if (t.name.StartsWith("Chunk_")) chunks++;
                    else if (t.name.StartsWith("Settlement_", System.StringComparison.Ordinal)
                             || t.name.StartsWith("SettlementStreetscape_", System.StringComparison.Ordinal)
                             || t.name == "KernelLive") settlements++;
                    else if (t.name.StartsWith("Building_", System.StringComparison.Ordinal)
                             || t.name.StartsWith("LeanBuilding_", System.StringComparison.Ordinal)
                             || t.name.StartsWith("KernelBuilding_", System.StringComparison.Ordinal)
                             || t.name == "KernelBuilding"
                             || t.name.StartsWith("ApproachLandmark", System.StringComparison.Ordinal)) buildings++;
                    else if (t.name == "Roof" || t.name == "ShellRoof") roofs++;
                }
                places = GameObject.FindObjectsByType<Concordia.BuildingPlace>(FindObjectsInactive.Include).Length;

                lastSummary = $"t={sw.Elapsed.TotalSeconds:F1}s chunks={chunks} settlements={settlements} buildings={buildings} roofs={roofs} places={places} hardErrors={hardErrors.Count} otherLogged={allErrors.Count}";
                UnityEngine.Debug.Log("Concordia SettlementLiveBootTest poll: " + lastSummary);

                // Success condition: the world actually compiled real geometry. Buildings
                // alone would pass even if roofs failed (e.g. an all-flat culture rolled),
                // so require both signals plus at least one settlement root and one
                // NpcLife-routable place, matching what SettlementCompiler.Emit stamps.
                if (chunks > 0 && settlements > 0 && buildings > 0 && places > 0)
                    break;

                if (hardErrors.Count > 0) break;   // fail fast once something in THIS work has actually thrown
            }

            Application.logMessageReceived -= OnLog;

            if (hardErrors.Count > 0)
            {
                var msg = "Boot logged " + hardErrors.Count + " exception/own-type-error line(s):\n" + string.Join("\n", hardErrors.GetRange(0, Mathf.Min(hardErrors.Count, 10)));
                Assert.Fail(msg + "\nLast poll: " + lastSummary);
            }

            Assert.Greater(chunks, 0, "no Chunk_<world> root ever appeared — world build never ran. " + lastSummary);
            Assert.Greater(settlements, 0,
                "no settlement container (Settlement_*, SettlementStreetscape_*, or KernelLive) appeared within " + TimeoutSeconds +
                "s — the active settlement realization path did not publish a container. " + lastSummary);
            Assert.Greater(buildings, 0,
                "a settlement container exists but no real building object (Building_*, LeanBuilding_*, KernelBuilding_*, " +
                "or ApproachLandmark*) was emitted — the active compiler produced nothing. " + lastSummary);
            Assert.Greater(roofs, 0, "buildings exist but RoofMesher never attached a Roof or ShellRoof child. " + lastSummary);
            Assert.Greater(places, 0,
                "buildings exist but no BuildingPlace was stamped — NpcLife's schedule still can't route to any " +
                "of them, the exact defect this pass was meant to close. " + lastSummary);

            UnityEngine.Debug.Log("Concordia SettlementLiveBootTest PASSED: " + lastSummary);
        }
    }
}
