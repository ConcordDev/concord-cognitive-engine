using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.TestTools;
#if ENABLE_INPUT_SYSTEM
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.LowLevel;
#endif

namespace Concordia.Tests
{
    /// <summary>
    /// Deterministic visible proof for the authored L0 UAL1 slice. Drives the
    /// public runtime input/body entry points, observes the real Animator state
    /// and motion, captures the authored body, and writes a marker only after
    /// every requested beat was visible.
    /// </summary>
    public sealed class L0Ual1SequenceProofTest
    {
        const string SceneName = "ConcordiaHub";
        const string ControllerName = "ConcordiaLocomotion";
        const string ProofDirectory = "Concordia/Generated/Proof";
        const string ProofMarker = "L0_UAL1_Sequence_Proof.md";
        const float PlayerTimeout = 90f;
        const float StateTimeout = 5f;

        readonly List<Observation> observations = new List<Observation>();
        readonly List<string> evidencePaths = new List<string>();
        Camera captureCamera;
        RenderTexture renderTexture;
        ModularPerson person;
        ConcordiaPlayer player;
        LivingBody body;
        Animator animator;
        float originalHunger;
        float originalFatigue;
        Vector3 lastPosition;
        float lastYaw;

        sealed class Observation
        {
            public string label;
            public string state;
            public string detail;
            public string evidence;
        }

        [UnityTest]
        public IEnumerator L0_UAL1_VisibleSequence_UsesRealPlayerBody()
        {
            RemoveStaleMarker();
            yield return EnsureHubAndLivePlayer();
            Assert.NotNull(player, "ConcordiaPlayer.Live never became available.");
            Assert.NotNull(person, "ConcordiaPlayer.Live.person never became available.");
            Assert.True(person.HasAuthoredBody, "The live player did not expose the authored CX/Rocketbox body.");

            body = player.GetComponent<LivingBody>();
            Assert.NotNull(body, "The live player has no LivingBody component.");
            originalHunger = body.Hunger;
            originalFatigue = body.Fatigue;
            animator = FindControllerAnimator(person);
            Assert.NotNull(animator, "The live authored body has no Animator.");
            Assert.NotNull(animator.runtimeAnimatorController, "The live body Animator has no runtime controller.");
            Assert.AreEqual(ControllerName, animator.runtimeAnimatorController.name,
                "The proof body is not driven by ConcordiaLocomotion.");
            Assert.True(animator.avatar && animator.avatar.isHuman && animator.avatar.isValid,
                "The proof body Animator is not using a valid Humanoid avatar.");

            CreateCaptureCamera();
            try
            {
                yield return ObserveState("idle", "Idle", 0.55f, null);

#if !ENABLE_INPUT_SYSTEM
                Assert.Fail("ENABLE_INPUT_SYSTEM is disabled; the real ConcordiaPlayer keyboard path cannot be driven deterministically.");
#else
                Assert.NotNull(Keyboard.current, "No live Input System keyboard is available to drive the real player path.");

                // The live body needs a slower gait for the controller's authored Walk threshold;
                // these are runtime needs, not an asset or controller edit. Restore them below.
                body.Hunger = 1f;
                body.Fatigue = 1f;
                lastPosition = player.transform.position;
                SetKeys(w: true);
                yield return WaitForState("walk", "Walk");
                yield return ObserveVisible("walk", "Walk", "W held through ConcordiaPlayer.MoveAxes at the real body's needs-limited walk speed.");
                Assert.Greater(Vector3.Distance(lastPosition, player.transform.position), 0.03f,
                    "Walk state was reached but the real player did not move.");
                ReleaseKeys();

                body.Hunger = 0f;
                body.Fatigue = 0f;
                SetKeys(w: true, shift: true);
                yield return WaitForState("sprint", "Sprint");
                yield return ObserveVisible("sprint", "Sprint", "W + LeftShift held through ConcordiaPlayer.MoveAxes.");
                ReleaseKeys();

                lastYaw = player.transform.eulerAngles.y;
                SetKeys(d: true, shift: true);
                yield return new WaitForSeconds(0.55f);
                var turnState = CurrentState();
                yield return ObserveVisible("turn", turnState, "D + LeftShift changed the real player bearing by " + YawDelta(lastYaw, player.transform.eulerAngles.y).ToString("F1") + " degrees.");
                Assert.Greater(YawDelta(lastYaw, player.transform.eulerAngles.y), 8f,
                    "Turn input did not change the real player bearing.");
                ReleaseKeys();

                yield return WaitForState("stop", "Idle");
                yield return ObserveVisible("stop", "Idle", "All runtime input released; controller returned to Idle.");

                SetKeys(x: true);
                var rollElapsed = 0f;
                while (rollElapsed < StateTimeout && CurrentState() != "Dodge")
                {
                    rollElapsed += Time.unscaledDeltaTime;
                    yield return null;
                }
                ReleaseKeys();
                Assert.AreEqual("Dodge", CurrentState(), "roll never reached Animator state Dodge; last state=" + CurrentState());
                yield return ObserveVisible("roll", "Dodge", "X fired ModularPerson.Dodge through ConcordiaPlayer.");

                person.BindStyle(FightStyle.Sword);
                yield return WaitForState("sword", "SwordIdle");
                yield return ObserveVisible("sword", "SwordIdle", "ModularPerson.BindStyle(Sword) set the real Sword parameter and equipped sword.");
                Assert.True(person.sword && person.sword.activeInHierarchy, "Sword state was observed without the real held sword visible.");

                person.Hurt();
                yield return WaitForState("hit", "HitChest");
                yield return ObserveVisible("hit", "HitChest", "ModularPerson.Hurt fired the real Hit trigger.");
                ReleaseKeys();
#endif

                WriteProofMarker();
                Debug.Log("[L0 UAL1 Proof] PASS: visible idle -> walk -> sprint -> turn -> stop -> roll -> sword -> hit; marker=" + ProofMarkerPath());
            }
            finally
            {
                ReleaseKeys();
                if (body)
                {
                    body.Hunger = originalHunger;
                    body.Fatigue = originalFatigue;
                }
                DestroyCaptureCamera();
            }
        }

        IEnumerator EnsureHubAndLivePlayer()
        {
            if (SceneManager.GetActiveScene().name != SceneName)
            {
                SceneManager.LoadScene(SceneName, LoadSceneMode.Single);
                yield return null;
            }

            var elapsed = 0f;
            while (elapsed < PlayerTimeout && (!ConcordiaPlayer.Live || !ConcordiaPlayer.Live.person))
            {
                elapsed += Time.unscaledDeltaTime;
                yield return null;
            }

            player = ConcordiaPlayer.Live;
            person = player ? player.person : null;
        }

        IEnumerator WaitForState(string label, string expected)
        {
            var elapsed = 0f;
            while (elapsed < StateTimeout)
            {
                if (CurrentState() == expected) yield break;
                elapsed += Time.unscaledDeltaTime;
                yield return null;
            }
            Assert.Fail(label + " never reached Animator state " + expected + "; last state=" + CurrentState());
        }

        IEnumerator ObserveState(string label, string expected, float settleSeconds, string detail)
        {
            yield return new WaitForSeconds(settleSeconds);
            Assert.AreEqual(expected, CurrentState(), label + " did not settle in the expected Animator state.");
            yield return ObserveVisible(label, expected, detail ?? "real player settled in the requested state.");
        }

        IEnumerator ObserveVisible(string label, string expected, string detail)
        {
            yield return new WaitForEndOfFrame();
            Capture(label, detail);
            Assert.AreEqual(expected, observations[observations.Count - 1].state,
                label + " capture did not observe " + expected + ".");
        }

        string CurrentState()
        {
            if (!animator) return "None";
            var state = animator.GetCurrentAnimatorStateInfo(0);
            if (state.IsName("Idle")) return "Idle";
            if (state.IsName("Walk")) return "Walk";
            if (state.IsName("Run")) return "Run";
            if (state.IsName("Sprint")) return "Sprint";
            if (state.IsName("Dodge")) return "Dodge";
            if (state.IsName("SwordIdle")) return "SwordIdle";
            if (state.IsName("HitChest")) return "HitChest";
            if (state.IsName("LightAttack")) return "LightAttack";
            if (state.IsName("JumpStart")) return "JumpStart";
            if (state.IsName("JumpLand")) return "JumpLand";
            return "Unknown";
        }

        void Capture(string label, string detail)
        {
            AimCaptureCamera();
            var renderers = person.GetComponentsInChildren<Renderer>(true);
            var planes = GeometryUtility.CalculateFrustumPlanes(captureCamera);
            var bodyVisible = false;
            foreach (var r in renderers)
            {
                if (!r || !r.enabled || !r.gameObject.activeInHierarchy || r.bounds.size.sqrMagnitude < 0.0001f) continue;
                if (GeometryUtility.TestPlanesAABB(planes, r.bounds)) { bodyVisible = true; break; }
            }
            Assert.True(bodyVisible, label + " had no active authored body renderer inside the proof camera frustum.");

            captureCamera.Render();
            var pixels = new Texture2D(renderTexture.width, renderTexture.height, TextureFormat.RGB24, false);
            var old = RenderTexture.active;
            RenderTexture.active = renderTexture;
            pixels.ReadPixels(new Rect(0, 0, renderTexture.width, renderTexture.height), 0, 0);
            pixels.Apply(false, false);
            RenderTexture.active = old;
            var nonClear = 0;
            var data = pixels.GetPixels32();
            for (var i = 0; i < data.Length; i++)
            {
                var c = data[i];
                if (c.r < 235 || c.g < 235 || c.b < 235) nonClear++;
            }
            Assert.Greater(nonClear, 24, label + " rendered no visible pixels from the proof camera.");

            var fileName = "L0_UAL1_Sequence_" + DateTime.UtcNow.ToString("yyyyMMdd_HHmmssfff") + "_" + observations.Count + "_" + label + ".png";
            var path = Path.Combine(Application.dataPath, ProofDirectory, fileName);
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            File.WriteAllBytes(path, pixels.EncodeToPNG());
            UnityEngine.Object.Destroy(pixels);

            var assetPath = path.Replace(Application.dataPath, "Assets");
            observations.Add(new Observation { label = label, state = CurrentState(), detail = detailFor(label, detail), evidence = assetPath });
            evidencePaths.Add(assetPath);
        }

        string detailFor(string label, string detail)
        {
            if (label == "turn") return detail + " bearingDelta=" + YawDelta(lastYaw, player.transform.eulerAngles.y).ToString("F1");
            return detail + " body=" + person.name + " authored=" + person.HasAuthoredBody;
        }

        void CreateCaptureCamera()
        {
            var go = new GameObject("L0_UAL1_ProofCamera");
            go.hideFlags = HideFlags.HideAndDontSave;
            captureCamera = go.AddComponent<Camera>();
            captureCamera.clearFlags = CameraClearFlags.SolidColor;
            captureCamera.backgroundColor = Color.white;
            captureCamera.fieldOfView = 35f;
            captureCamera.nearClipPlane = 0.02f;
            captureCamera.farClipPlane = 100f;
            renderTexture = new RenderTexture(640, 640, 24, RenderTextureFormat.ARGB32);
            renderTexture.Create();
            captureCamera.targetTexture = renderTexture;
            AimCaptureCamera();
        }

        void AimCaptureCamera()
        {
            if (!captureCamera || !person) return;
            var center = person.transform.position + Vector3.up * 0.92f;
            captureCamera.transform.position = center + person.transform.forward * 3.2f + Vector3.up * 0.12f;
            captureCamera.transform.LookAt(center);
        }

        void DestroyCaptureCamera()
        {
            if (captureCamera)
            {
                captureCamera.targetTexture = null;
                UnityEngine.Object.DestroyImmediate(captureCamera.gameObject);
            }
            if (renderTexture)
            {
                renderTexture.Release();
                UnityEngine.Object.DestroyImmediate(renderTexture);
            }
            captureCamera = null;
            renderTexture = null;
        }

#if ENABLE_INPUT_SYSTEM
        static void SetKeys(bool w = false, bool a = false, bool s = false, bool d = false, bool shift = false, bool x = false)
        {
            var keyboard = Keyboard.current;
            if (keyboard == null) return;

            var keys = new List<Key>();
            if (w) keys.Add(Key.W);
            if (a) keys.Add(Key.A);
            if (s) keys.Add(Key.S);
            if (d) keys.Add(Key.D);
            if (shift) keys.Add(Key.LeftShift);
            if (x) keys.Add(Key.X);
            InputSystem.QueueStateEvent(keyboard, new KeyboardState(keys.ToArray()));
        }
#endif

        static void ReleaseKeys()
        {
#if ENABLE_INPUT_SYSTEM
            SetKeys();
#endif
        }

        static Animator FindControllerAnimator(ModularPerson root)
        {
            var all = root.GetComponentsInChildren<Animator>(true);
            foreach (var candidate in all)
                if (candidate && candidate.runtimeAnimatorController && candidate.runtimeAnimatorController.name == ControllerName)
                    return candidate;
            return all.Length > 0 ? all[0] : null;
        }

        static float YawDelta(float a, float b)
        {
            return Mathf.Abs(Mathf.DeltaAngle(a, b));
        }

        static string ProofMarkerPath() => Path.Combine(Application.dataPath, ProofDirectory, ProofMarker);

        static void RemoveStaleMarker()
        {
            var path = ProofMarkerPath();
            if (File.Exists(path)) File.Delete(path);
        }

        void WriteProofMarker()
        {
            Assert.GreaterOrEqual(observations.Count, 8, "The proof marker requires all eight visible sequence observations.");
            var lines = new List<string>
            {
                "# L0 UAL1 Visible Sequence Proof",
                "",
                "Status: PASS",
                "Observed: idle -> walk -> sprint -> turn -> stop -> roll -> sword -> hit",
                "Body: " + person.name + " (authored=" + person.HasAuthoredBody + ")",
                "Controller: Assets/Concordia/Anim/ConcordiaLocomotion.controller",
                "UAL1 usage: animation-only FBX sub-assets; CX/Rocketbox identity mesh preserved.",
                "",
                "| Beat | Animator state | Detail | Evidence |",
                "|---|---|---|---|"
            };
            foreach (var observation in observations)
                lines.Add("| " + observation.label + " | " + observation.state + " | " + observation.detail + " | " + observation.evidence + " |");
            lines.Add("");
            lines.Add("Generated by L0Ual1SequenceProofTest after rendered body visibility and state observation.");
            var path = ProofMarkerPath();
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            File.WriteAllText(path, string.Join("\n", lines));
        }
    }
}
