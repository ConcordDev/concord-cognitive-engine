using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
#if UNITY_EDITOR
using UnityEditor;
#endif

namespace Concordia
{
    /// <summary>
    /// URP look for the Unburned Court: warm skylight vs cool portals.
    /// Stay on URP — HDRP would drop Kenney/glTFast materials.
    /// Cinematic completion is bible/CINEMATIC.md — this class is the live look stack, not a second renderer.
    /// </summary>
    public static class HubLook
    {
        static bool _loggedCourtBannerMiss;
        // zuko-play-abort-fix 2026-09-19
        static Shader _lit, _unlit, _particles;
        static Material _litTemplate;

        public static void Apply(Camera cam, WorldId world)
        {
            EnsurePipeline();
            if (cam)
            {
                cam.allowHDR = true;
                cam.allowMSAA = false;
                cam.nearClipPlane = 0.11f;
                cam.farClipPlane = ContinentStream.Live || world == WorldId.Hub ? 420f : 280f;
                var data = cam.GetUniversalAdditionalCameraData();
                if (data)
                {
                    data.renderPostProcessing = true;
                    data.renderShadows = true;
                    data.antialiasing = AntialiasingMode.TemporalAntiAliasing;
                    data.antialiasingQuality = AntialiasingQuality.High;
                }
            }

            var urp = QualitySettings.renderPipeline as UniversalRenderPipelineAsset;
            bool lean = ConcordiaHost.LookLean;
            if (urp)
            {
                urp.shadowDistance = world == WorldId.Hub ? 180f : (lean ? 70f : 110f);
                urp.msaaSampleCount = 1;
                urp.maxAdditionalLightsCount = world == WorldId.Hub ? 8 : (lean ? 4 : 8);
                urp.colorGradingMode = ColorGradingMode.HighDynamicRange;
                urp.colorGradingLutSize = 64;
                urp.supportsCameraDepthTexture = true;
                urp.supportsCameraOpaqueTexture = true;
            }
            TryEnableSsao();
            // Hub shafts from HubVolumeFogFeature were washing the Court white — keep off.
            if (world == WorldId.Hub)
                DisableVolumeFogFeature();
            else
                TryEnableVolumeFog();
            QualitySettings.shadowDistance = world == WorldId.Hub ? 220f : (lean ? 90f : 140f);
            QualitySettings.shadowCascades = 4;
            QualitySettings.shadows = (UnityEngine.ShadowQuality)2;
            QualitySettings.anisotropicFiltering = AnisotropicFiltering.ForceEnable;
            QualitySettings.antiAliasing = 0;

            var volGo = GameObject.Find("GlobalVolume");
            if (!volGo) volGo = new GameObject("GlobalVolume");
            var vol = volGo.GetComponent<Volume>() ?? volGo.AddComponent<Volume>();
            vol.isGlobal = true;
            vol.priority = 10;
            if (!vol.profile) vol.profile = ScriptableObject.CreateInstance<VolumeProfile>();
            var profile = vol.profile;

            Grade(world, out var bloomI, out var bloomT, out var exposure, out var contrast, out var sat, out var vigI, out var temp, out var sky, out var eq, out var ground);

            if (!profile.TryGet(out Tonemapping tm)) tm = profile.Add<Tonemapping>(true);
            tm.active = true;
            tm.mode.Override(TonemappingMode.ACES);

            if (!profile.TryGet(out Bloom bloom)) bloom = profile.Add<Bloom>(true);
            bloom.active = true;
            bloom.intensity.Override(bloomI);
            bloom.threshold.Override(bloomT);
            bloom.scatter.Override(world == WorldId.Hub ? 0.78f : 0.72f);

            if (!profile.TryGet(out ColorAdjustments color)) color = profile.Add<ColorAdjustments>(true);
            color.active = true;
            color.postExposure.Override(exposure);
            color.contrast.Override(contrast);
            color.saturation.Override(sat);

            if (!profile.TryGet(out Vignette vig)) vig = profile.Add<Vignette>(true);
            vig.active = true;
            vig.intensity.Override(vigI);
            vig.smoothness.Override(0.52f);
            vig.color.Override(ground * 0.6f);

            if (!profile.TryGet(out WhiteBalance wb)) wb = profile.Add<WhiteBalance>(true);
            wb.active = true;
            wb.temperature.Override(temp);

            if (!profile.TryGet(out FilmGrain grain)) grain = profile.Add<FilmGrain>(true);
            grain.active = true;
            grain.intensity.Override(world == WorldId.Hub ? 0.16f : world == WorldId.Crime || world == WorldId.Ruins ? 0.22f : 0.1f);
            grain.response.Override(0.75f);

            if (!profile.TryGet(out ChromaticAberration ca)) ca = profile.Add<ChromaticAberration>(true);
            ca.active = true;
            ca.intensity.Override(world == WorldId.Cyber || world == WorldId.Crucible ? 0.12f : 0.04f);

            if (!profile.TryGet(out DepthOfField dof)) dof = profile.Add<DepthOfField>(true);
            dof.active = world == WorldId.Hub || !lean;
            dof.mode.Override(DepthOfFieldMode.Gaussian);
            dof.gaussianStart.Override(world == WorldId.Hub ? 14f : 16f);
            dof.gaussianEnd.Override(world == WorldId.Hub ? 48f : 48f);
            dof.gaussianMaxRadius.Override(world == WorldId.Hub ? 1.15f : (lean ? 0.4f : 1.05f));

            if (!profile.TryGet(out ShadowsMidtonesHighlights smh)) smh = profile.Add<ShadowsMidtonesHighlights>(true);
            smh.active = true;
            if (world == WorldId.Hub)
            {
                smh.shadows.Override(new Vector4(0.86f, 1.04f, 1.14f, lean ? -0.03f : -0.06f));
                smh.midtones.Override(new Vector4(1.02f, 1.0f, 0.96f, 0.02f));
                smh.highlights.Override(new Vector4(1.10f, 1.02f, 0.90f, 0.06f));
            }
            else
            {
                smh.shadows.Override(new Vector4(1f, 1.02f, 1.08f, lean ? -0.02f : -0.05f));
                smh.midtones.Override(new Vector4(1.02f, 1f, 0.98f, 0.02f));
                smh.highlights.Override(new Vector4(1.04f, 1.01f, 0.96f, 0.04f));
            }

            if (!profile.TryGet(out LiftGammaGain lgg)) lgg = profile.Add<LiftGammaGain>(true);
            lgg.active = true;
            if (world == WorldId.Hub)
            {
                lgg.lift.Override(new Vector4(0.98f, 1.02f, 1.08f, 0.03f));
                lgg.gamma.Override(new Vector4(1f, 1.01f, 1.02f, 0f));
                lgg.gain.Override(new Vector4(1.04f, 1.0f, 0.94f, lean ? 0.03f : 0.06f));
            }
            else
            {
                lgg.lift.Override(new Vector4(1.01f, 1.01f, 1.04f, 0.02f));
                lgg.gamma.Override(new Vector4(1f, 1f, 1f, 0f));
                lgg.gain.Override(new Vector4(1.03f, 1.0f, 0.97f, lean ? 0.02f : 0.05f));
            }

            RenderSettings.ambientMode = AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = sky;
            RenderSettings.ambientEquatorColor = eq;
            RenderSettings.ambientGroundColor = ground;
            // Key + fog carry the scene — default ambient=1 was grey soup.
            RenderSettings.ambientIntensity = world == WorldId.Hub ? 0.22f : 0.55f;
            RenderSettings.reflectionIntensity = world == WorldId.Hub ? 1.15f : 0.88f;
            RenderSettings.defaultReflectionMode = DefaultReflectionMode.Skybox;
            DynamicGI.UpdateEnvironment();
            PlaceProbe(world == WorldId.Hub ? 120f : 95f);
            ApplyHour(world, WorldClock.Hour);
            WorldBreath.Ensure(world, cam);
            BindSun();
            EnsureCourtRig(world);
            LightPeople();
            PushVolume();
        }

        public static bool VolumeFogLive { get; private set; }

        static float _openFog = -1f;
        static float _openExp;
        static bool _haveOpenExp;
        static bool _interior;

        public static void LiveFog(float density)
        {
            _openFog = Mathf.Max(0f, density);
            RenderSettings.fogDensity = _interior ? _openFog * 0.28f : _openFog;
            PushVolume();
        }

        /// <summary>
        /// Interior vs plaza: drop distant haze, keep the room lamp as the key.
        /// Fake-window LOD is not this path — BuildingInterior walk-in / E is.
        /// </summary>
        public static void ApplyInterior(bool inside)
        {
            if (_openFog < 0f) _openFog = RenderSettings.fogDensity;
            if (_interior == inside) return;
            _interior = inside;
            LiveFog(_openFog);
            var volGo = GameObject.Find("GlobalVolume");
            var vol = volGo ? volGo.GetComponent<Volume>() : null;
            var profile = vol && vol.profile ? vol.profile : null;
            if (profile && profile.TryGet(out ColorAdjustments color))
            {
                if (!_haveOpenExp)
                {
                    _openExp = color.postExposure.value;
                    _haveOpenExp = true;
                }
                color.postExposure.Override(inside ? _openExp - 0.18f : _openExp);
            }
            if (profile && profile.TryGet(out DepthOfField dof))
                dof.active = !inside;
        }

        public static bool InteriorLit => _interior;

        /// <summary>
        /// Characters belong in the same sun as the plaza. Cast + receive, URP Lit.
        /// </summary>
        public static int GroundInLight(GameObject go)
        {
            if (!go) return 0;
            int n = UpgradeStandardOn(go);
            foreach (var r in go.GetComponentsInChildren<Renderer>(true))
            {
                if (!r) continue;
                r.shadowCastingMode = ShadowCastingMode.On;
                r.receiveShadows = true;
                n++;
            }
            return n;
        }

        static void BindSun()
        {
            if (RenderSettings.sun && RenderSettings.sun.enabled && RenderSettings.sun.type == LightType.Directional)
                return;
            var lights = Object.FindObjectsByType<Light>(FindObjectsInactive.Exclude, FindObjectsSortMode.None);
            Light sun = null;
            for (int i = 0; i < lights.Length; i++)
            {
                var l = lights[i];
                if (!l || !l.enabled || l.type != LightType.Directional) continue;
                if (l.name == "Fill" || l.name == "Rim") continue;
                if (l.name == "Sun") { sun = l; break; }
                if (l.name.IndexOf("sun", System.StringComparison.OrdinalIgnoreCase) >= 0) { sun = l; continue; }
                if (sun == null) sun = l;
            }
            if (sun) RenderSettings.sun = sun;
        }

        static void LightPeople()
        {
            var people = Object.FindObjectsByType<ModularPerson>(FindObjectsInactive.Exclude, FindObjectsSortMode.None);
            for (int i = 0; i < people.Length; i++)
                GroundInLight(people[i].gameObject);
        }

        /// <summary>
        /// Hub day vs night must be unmistakable. Night is moonlight + lamps,
        /// not noon-minus-UI. Called from WorldClock every sky tick.
        /// </summary>
        public static void ApplyHour(WorldId world, float hour)
        {
            float sun01 = Sun01(hour);
            float night = 1f - sun01;
            var volGo = GameObject.Find("GlobalVolume");
            var vol = volGo ? volGo.GetComponent<Volume>() : null;
            var profile = vol && vol.profile ? vol.profile : null;
            if (profile && profile.TryGet(out ColorAdjustments color))
            {
                // Hub: never slam histogram left. Night still readable (moon key + lamps).
                float dayExp = world == WorldId.Hub ? -0.35f : 0.08f;
                float nightExp = world == WorldId.Hub ? -0.65f : -0.55f;
                color.postExposure.Override(Mathf.Lerp(nightExp, dayExp, sun01));
                color.contrast.Override(Mathf.Lerp(14f, 12f, sun01));
                color.saturation.Override(Mathf.Lerp(4f, 10f, sun01));
            }
            if (profile && profile.TryGet(out Vignette vig))
                vig.intensity.Override(Mathf.Lerp(0.22f, world == WorldId.Hub ? 0.12f : 0.28f, sun01));

            if (world == WorldId.Hub)
            {
                // Low ambient — key + fog + lamps carry. Cool shadows / warm highlights via SMH.
                RenderSettings.ambientSkyColor = Color.Lerp(new Color(0.04f, 0.06f, 0.10f), new Color(0.22f, 0.28f, 0.34f), sun01);
                RenderSettings.ambientEquatorColor = Color.Lerp(new Color(0.03f, 0.03f, 0.04f), new Color(0.18f, 0.16f, 0.14f), sun01);
                RenderSettings.ambientGroundColor = Color.Lerp(new Color(0.02f, 0.02f, 0.02f), new Color(0.08f, 0.08f, 0.07f), sun01);
                RenderSettings.ambientIntensity = 0.12f + 0.18f * sun01;
                RenderSettings.reflectionIntensity = 0.55f + 0.55f * sun01;
                // Lit fog (matches key), not a dark wash.
                // North-star teal mist, muted (the saturated 0.35,0.62,0.68 turned every
                // distant building into a flat teal cut-out); matches EnsureCourtAtmosphere.
                var fogDay = new Color(0.50f, 0.60f, 0.64f);
                var fogNight = new Color(0.16f, 0.24f, 0.28f);
                RenderSettings.fogColor = Color.Lerp(fogNight, fogDay, sun01);
                LiveFog(0.006f + 0.004f * night);
                TryHdrSky(world);
            }

            var sky = RenderSettings.skybox;
            if (sky && sky.HasProperty("_Exposure") && world != WorldId.Hub)
            {
                sky.SetFloat("_Exposure", Mathf.Lerp(0.16f, 0.62f, sun01));
            }

            var lights = Object.FindObjectsByType<Light>(FindObjectsInactive.Include);

            // Pick the sun BEFORE the loop.
            //
            // This used to match only `name == "Sun"`, and the final else-branch below disabled
            // every other directional light. The scene's actual lights are named "Directional
            // Light" (Unity's default) and "ContinentSun" — neither matched, so BOTH were disabled
            // on every sky tick and the world had no directional light at all. That is why a 14:43
            // afternoon rendered nearly black and every surface looked flat: ambient-only lighting
            // produces no directional shading, no shadows and no specular, which hides normal and
            // metallic/smoothness maps completely. Textures were never the problem.
            //
            // Preference order: exact "Sun" -> any directional whose name contains "sun" -> the
            // brightest directional present. Never leave the world with zero suns.
            Light sun = null;
            for (int i = 0; i < lights.Length; i++)
            {
                var l = lights[i];
                if (!l || l.type != LightType.Directional) continue;
                if (l.name == "Fill" || l.name == "Rim") continue;
                if (l.name == "Sun") { sun = l; break; }
                if (l.name.IndexOf("sun", System.StringComparison.OrdinalIgnoreCase) >= 0) { sun = l; continue; }
                if (sun == null) sun = l;
            }

            for (int i = 0; i < lights.Length; i++)
            {
                var l = lights[i];
                if (!l) continue;
                if (l.type == LightType.Directional && l == sun)
                {
                    l.enabled = true;
                    l.gameObject.SetActive(true);
                    // Warm key (~3800–4500K day); cool moon at night but still a real key.
                    l.color = Color.Lerp(new Color(0.55f, 0.62f, 0.85f), new Color(1f, 0.86f, 0.68f), sun01);
                    l.intensity = world == WorldId.Hub
                        ? 0.12f + 0.28f * sun01
                        : 0.08f + 0.9f * sun01;
                    l.shadows = LightShadows.Soft;
                    l.shadowStrength = 0.9f;
                    float pitch = Mathf.Lerp(18f, 48f, sun01);
                    l.transform.rotation = Quaternion.Euler(pitch, l.transform.eulerAngles.y, 0f);
                    RenderSettings.sun = l;
                }
                else if (l.type == LightType.Directional && l.name == "Fill")
                {
                    l.enabled = true;
                    l.gameObject.SetActive(true);
                    l.color = Color.Lerp(new Color(0.35f, 0.45f, 0.65f), new Color(0.75f, 0.82f, 0.95f), sun01);
                    l.intensity = world == WorldId.Hub ? 0.06f + 0.10f * sun01 : 0.04f + 0.22f * sun01;
                    l.shadows = LightShadows.None;
                }
                else if (l.type == LightType.Directional && l.name == "Rim")
                {
                    l.enabled = true;
                    l.gameObject.SetActive(true);
                    l.color = Color.Lerp(new Color(0.45f, 0.55f, 0.80f), new Color(1f, 0.92f, 0.78f), sun01);
                    l.intensity = world == WorldId.Hub ? 0.08f + 0.12f * sun01 : 0.1f;
                    l.shadows = LightShadows.None;
                }
                else if (l.type == LightType.Directional)
                {
                    l.intensity = 0f;
                    l.enabled = false;
                }
                else if (l.type == LightType.Point && (l.name == "CourtLamp" || l.name == "MonumentLight" || l.name == "Lantern" || l.name.Contains("Lantern")))
                    l.intensity = Mathf.Lerp(1.2f, 0.35f, sun01);
            }
        }

        public static float Sun01(float hour)
        {
            if (hour >= 6f && hour <= 20f)
            {
                float t = (hour - 6f) / 14f;
                return Mathf.Sin(t * Mathf.PI);
            }
            return 0f;
        }

        static void Grade(WorldId world,
            out float bloomI, out float bloomT, out float exposure, out float contrast, out float sat, out float vigI, out float temp,
            out Color sky, out Color eq, out Color ground)
        {
            switch (world)
            {
                case WorldId.Hub:
                    // Exposure first: stop cave underexposure. Warm WB matches key (~3800–4500K).
                    bloomI = 0.02f; bloomT = 1.6f; exposure = -0.55f; contrast = 12f; sat = 2f; vigI = 0.2f; temp = 4f;
                    sky = new Color(0.18f, 0.22f, 0.28f); eq = new Color(0.12f, 0.11f, 0.10f); ground = new Color(0.05f, 0.05f, 0.05f); break;
                case WorldId.Ruins:
                    bloomI = 0.28f; bloomT = 0.72f; exposure = 0.08f; contrast = 16f; sat = 4f; vigI = 0.4f; temp = -8f;
                    sky = new Color(0.55f, 0.52f, 0.48f); eq = new Color(0.32f, 0.26f, 0.20f); ground = new Color(0.10f, 0.08f, 0.06f); break;
                case WorldId.Tunya:
                    bloomI = 0.45f; bloomT = 0.68f; exposure = 0.28f; contrast = 14f; sat = 20f; vigI = 0.22f; temp = 8f;
                    sky = new Color(0.72f, 0.88f, 0.70f); eq = new Color(0.38f, 0.48f, 0.22f); ground = new Color(0.12f, 0.14f, 0.06f); break;
                case WorldId.Fantasy:
                    bloomI = 0.55f; bloomT = 0.64f; exposure = 0.18f; contrast = 20f; sat = 16f; vigI = 0.34f; temp = 12f;
                    sky = new Color(0.95f, 0.62f, 0.38f); eq = new Color(0.28f, 0.22f, 0.32f); ground = new Color(0.08f, 0.06f, 0.10f); break;
                case WorldId.Crime:
                    bloomI = 0.35f; bloomT = 0.7f; exposure = -0.05f; contrast = 24f; sat = 8f; vigI = 0.42f; temp = -4f;
                    sky = new Color(0.22f, 0.18f, 0.28f); eq = new Color(0.28f, 0.16f, 0.12f); ground = new Color(0.06f, 0.04f, 0.04f); break;
                case WorldId.Cyber:
                    bloomI = 0.9f; bloomT = 0.5f; exposure = 0.12f; contrast = 26f; sat = 22f; vigI = 0.38f; temp = -18f;
                    sky = new Color(0.35f, 0.12f, 0.48f); eq = new Color(0.08f, 0.28f, 0.32f); ground = new Color(0.04f, 0.05f, 0.10f); break;
                case WorldId.Frontier:
                    bloomI = 0.4f; bloomT = 0.66f; exposure = 0.35f; contrast = 12f; sat = 14f; vigI = 0.2f; temp = 28f;
                    sky = new Color(1f, 0.90f, 0.62f); eq = new Color(0.62f, 0.48f, 0.28f); ground = new Color(0.22f, 0.16f, 0.08f); break;
                case WorldId.Superhero:
                    bloomI = 0.7f; bloomT = 0.55f; exposure = 0.32f; contrast = 18f; sat = 12f; vigI = 0.26f; temp = 10f;
                    sky = new Color(1f, 0.72f, 0.48f); eq = new Color(0.28f, 0.34f, 0.52f); ground = new Color(0.10f, 0.10f, 0.14f); break;
                case WorldId.Sere:
                    bloomI = 0.22f; bloomT = 0.78f; exposure = -0.18f; contrast = 18f; sat = -6f; vigI = 0.44f; temp = 6f;
                    sky = new Color(0.38f, 0.32f, 0.24f); eq = new Color(0.28f, 0.20f, 0.12f); ground = new Color(0.08f, 0.06f, 0.04f); break;
                default:
                    bloomI = 0.6f; bloomT = 0.52f; exposure = 0.15f; contrast = 20f; sat = 18f; vigI = 0.36f; temp = -12f;
                    sky = new Color(0.20f, 0.85f, 0.78f); eq = new Color(0.10f, 0.28f, 0.32f); ground = new Color(0.04f, 0.10f, 0.12f); break;
            }
        }

        static void PlaceProbe(float size)
        {
            var go = GameObject.Find("EnvProbe");
            if (!go) go = new GameObject("EnvProbe");
            if (!go.TryGetComponent(out ReflectionProbe probe))
                probe = go.AddComponent<ReflectionProbe>();
            probe.mode = UnityEngine.Rendering.ReflectionProbeMode.Realtime;
            probe.refreshMode = ReflectionProbeRefreshMode.ViaScripting;
            probe.timeSlicingMode = ReflectionProbeTimeSlicingMode.AllFacesAtOnce;
            probe.size = new Vector3(size, size * 0.7f, size);
            probe.center = Vector3.up * 8f;
            probe.resolution = ConcordiaHost.LookLean ? 128 : 256;
            probe.intensity = 1.15f;
            probe.boxProjection = true;
            probe.RenderProbe();
        }

        public static Light MakeSun(Transform parent, Color color, float intensity, Vector3 euler)
        {
            var sun = new GameObject("Sun");
            sun.transform.SetParent(parent, false);
            sun.transform.rotation = Quaternion.Euler(euler);
            var light = sun.AddComponent<Light>();
            light.type = LightType.Directional;
            light.color = color;
            light.intensity = intensity;
            light.shadows = LightShadows.Soft;
            light.shadowStrength = 0.92f;
            light.shadowBias = 0.04f;
            light.shadowNormalBias = 0.4f;
            light.shadowResolution = LightShadowResolution.VeryHigh;
            var fill = new GameObject("Fill");
            fill.transform.SetParent(parent, false);
            fill.transform.rotation = Quaternion.Euler(euler + new Vector3(12f, 180f, 0));
            var fl = fill.AddComponent<Light>();
            fl.type = LightType.Directional;
            fl.color = Color.Lerp(color, new Color(0.7f, 0.8f, 0.95f), 0.45f);
            fl.intensity = intensity * 0.42f;
            fl.shadows = LightShadows.None;
            var rim = new GameObject("Rim");
            rim.transform.SetParent(parent, false);
            rim.transform.rotation = Quaternion.Euler(euler + new Vector3(-8f, 140f, 0));
            var rl = rim.AddComponent<Light>();
            rl.type = LightType.Directional;
            rl.color = Color.Lerp(color, Color.white, 0.2f);
            rl.intensity = intensity * 0.55f;
            rl.shadows = LightShadows.None;
            RenderSettings.sun = light;
            return light;
        }

        public static Light Point(Transform parent, string n, Vector3 pos, Color c, float intensity, float range, bool shadows = false)
        {
            var go = new GameObject(n);
            go.transform.SetParent(parent, false);
            go.transform.position = pos;
            var l = go.AddComponent<Light>();
            l.type = LightType.Point;
            l.color = c;
            l.intensity = intensity;
            l.range = range;
            l.shadows = shadows ? LightShadows.Soft : LightShadows.None;
            return l;
        }

        public static void Lantern(Transform parent, Vector3 pos)
        {
            var mesh = FreePacks.SpawnStore("lantern", parent, pos, 0, 1.35f, required: false)
                       ?? FreePacks.SpawnStore("wooden_lantern_01", parent, pos, 0, 1.35f, required: false)
                       ?? FreePacks.SpawnStore("Lantern_01", parent, pos, 0, 1.2f, required: false);
            if (!mesh)
            {
                var glow = GameObject.CreatePrimitive(PrimitiveType.Sphere);
                glow.name = "LampGlow";
                glow.transform.SetParent(parent, false);
                glow.transform.position = pos + Vector3.up * 1.55f;
                glow.transform.localScale = Vector3.one * 0.08f;
                Object.Destroy(glow.GetComponent<Collider>());
                var gr = glow.GetComponent<Renderer>();
                if (gr)
                {
                    gr.sharedMaterial = UnlitAlpha(new Color(0.55f, 0.95f, 1f, 0.55f));
                    gr.shadowCastingMode = ShadowCastingMode.Off;
                }
            }
            HubLook.Point(parent, "CourtLamp", pos + Vector3.up * 1.65f, new Color(0.55f, 0.82f, 0.95f), 0.55f, 8f, false);
        }

        /// <summary>Was additive mesh cones — washed Hub white. No-op; strip leftovers.</summary>
        public static void Shaft(Transform parent, Vector3 pos, Vector3 dir, Color c, float length = 14f)
        {
            // Intentionally empty for Hub readability. Call StripLightShafts after plaza dress.
        }

        public static void StripLightShafts()
        {
            var all = Object.FindObjectsByType<Transform>(FindObjectsInactive.Include);
            for (var i = 0; i < all.Length; i++)
            {
                var tr = all[i];
                if (!tr || tr.name != "LightShaft") continue;
                Object.Destroy(tr.gameObject);
            }
        }

        public static void StoneDress(GameObject go)
        {
            if (!go) return;
            var stone = Pbr("cobblestone_square", Color.white, 0.06f, 0.28f, 3.2f);
            foreach (var r in go.GetComponentsInChildren<Renderer>(true))
            {
                if (!r || !r.sharedMaterial) continue;
                var n = r.sharedMaterial.name ?? "";
                if (n.StartsWith("PH_wet") || n.StartsWith("PH_HDR")) continue;
                r.sharedMaterial = stone;
            }
        }

        public static Material GroundMat(WorldId world, Color tint)
        {
            var path = world switch
            {
                WorldId.Hub => "Assets/Materials/Material_GrassFlowers.mat",
                WorldId.Ruins => "Assets/Materials/Material_Moon.mat",
                WorldId.Cyber => "Assets/Materials/Material_Circuits.mat",
                WorldId.Frontier => "Assets/Materials/Material_SandWavey.mat",
                WorldId.Crime => "Assets/Materials/Material_HexagonPurple.mat",
                WorldId.Tunya => "Assets/Materials/Material_Grass.mat",
                WorldId.Fantasy => "Assets/Materials/Material_Runes.mat",
                WorldId.Superhero => "Assets/Materials/Material_HexagonBlue.mat",
                _ => "Assets/Materials/Material_Stars.mat"
            };
            var store = FreePacks.Load<Material>(path);
            if (store) return store;
            var m = Lit(tint, 0.02f, 0.18f);
            var tex = NoiseTile(tint, Color.Lerp(tint, Color.black, 0.28f), 96);
            if (m.HasProperty("_BaseMap")) m.SetTexture("_BaseMap", tex);
            if (m.HasProperty("_MainTex")) m.SetTexture("_MainTex", tex);
            return m;
        }

        public static Texture2D NoiseTile(Color a, Color b, int n)
        {
            var tex = new Texture2D(n, n, TextureFormat.RGBA32, true);
            tex.wrapMode = TextureWrapMode.Repeat;
            tex.filterMode = FilterMode.Bilinear;
            for (int y = 0; y < n; y++)
            for (int x = 0; x < n; x++)
            {
                float g = Mathf.PerlinNoise(x * 0.11f, y * 0.11f);
                float g2 = Mathf.PerlinNoise(x * 0.37f + 8f, y * 0.37f);
                var c = Color.Lerp(a, b, g * 0.65f + g2 * 0.35f);
                tex.SetPixel(x, y, c);
            }
            tex.Apply();
            return tex;
        }

        public static Material Lit(Color c, float metallic = 0.06f, float smooth = 0.26f)
        {
            EnsureShaders();
            var m = new Material(_lit != null ? _lit : Shader.Find("Sprites/Default"));
            m.color = c;
            if (m.HasProperty("_BaseColor")) m.SetColor("_BaseColor", c);
            if (m.HasProperty("_Color")) m.SetColor("_Color", c);
            if (m.HasProperty("_Metallic")) m.SetFloat("_Metallic", metallic);
            if (m.HasProperty("_Smoothness")) m.SetFloat("_Smoothness", smooth);
            return m;
        }

        public static bool IsBlankAlbedo(Texture tex)
        {
            if (!tex) return true;
            var n = tex.name ?? "";
            return tex == Texture2D.whiteTexture
                   || n == "UnityWhite"
                   || n == "Default-Particle"
                   || n.IndexOf("Internal-White", System.StringComparison.OrdinalIgnoreCase) >= 0;
        }

        public static Texture FirstAlbedo(Material src)
        {
            if (!src) return null;
            string[] names =
            {
                "baseColorTexture", "_baseColorTexture", "_BaseMap", "_MainTex",
                "_BaseColorMap", "_Diffuse", "diffuseTexture", "colormap"
            };
            for (int i = 0; i < names.Length; i++)
            {
                if (!src.HasProperty(names[i])) continue;
                var t = src.GetTexture(names[i]);
                if (!IsBlankAlbedo(t)) return t;
            }
            if (!src.shader) return null;
            int n = src.shader.GetPropertyCount();
            for (int i = 0; i < n; i++)
            {
                if (src.shader.GetPropertyType(i) != ShaderPropertyType.Texture) continue;
                var p = src.shader.GetPropertyName(i);
                var t = src.GetTexture(p);
                if (IsBlankAlbedo(t)) continue;
                var pl = (p ?? "").ToLowerInvariant();
                if (pl.Contains("lightmap") || pl.Contains("shadow") || pl.Contains("unity_")) continue;
                if (pl.Contains("base") || pl.Contains("albedo") || pl.Contains("diffuse")
                    || pl.Contains("color") || pl.Contains("main") || pl.Contains("col"))
                    return t;
            }
            return null;
        }

        public static Color FirstColor(Material src, Color fallback)
        {
            if (!src) return fallback;
            string[] names = { "baseColorFactor", "_BaseColor", "_Color", "baseColor" };
            for (int i = 0; i < names.Length; i++)
            {
                if (!src.HasProperty(names[i])) continue;
                return src.GetColor(names[i]);
            }
            if (src.HasProperty("_Color"))
            {
                var legacy = src.GetColor("_Color");
                return legacy.a > 0.01f ? legacy : fallback;
            }
            return fallback;
        }

        public static Texture FirstNormal(Material src)
        {
            if (!src) return null;
            string[] names = { "normalTexture", "_BumpMap", "_NormalMap", "normal" };
            for (int i = 0; i < names.Length; i++)
            {
                if (!src.HasProperty(names[i])) continue;
                var t = src.GetTexture(names[i]);
                if (t) return t;
            }
            return null;
        }

        // Poly Haven CC0 kit: Assets/Concordia/PolyHaven/Textures/<stem>/<stem>_<map>_2k.jpg
        // Maps shipped per set: _diffuse_ (sRGB), _nor_gl_ (normal), _arm_ (AO/Rough/Metal, linear),
        // _displacement_. Import settings are enforced by Concordia.EditorTools.PolyHavenPipeline.
        static readonly Dictionary<string, Material> _pbrCache = new Dictionary<string, Material>();

        // ---- Stem resolution ------------------------------------------------------------------
        // The world builders ask for SEMANTIC surfaces ("stone_tiles", "wet_asphalt", "ash_soil").
        // Poly Haven ships CONCRETE set names ("cobblestone_floor_13", "asphalt_floor",
        // "brown_mud_dry"). Before this, every one of those semantic names missed an exact-path
        // lookup and Pbr() silently returned an untextured flat tint — which is why 13.5GB of
        // imported CC0 material was on disk, correctly imported, and visible nowhere.
        //
        // Resolution order: exact set -> hand-authored semantic alias -> prefix match against the
        // real library (so "metal_plate" finds "metal_plate_02" without anyone maintaining it).
        static readonly Dictionary<string, string> StemAliases = new Dictionary<string, string>
        {
            { "stone_tiles",    "patterned_cobblestone_02" },
            { "court_cobble",   "patterned_cobblestone_02" },
            { "engraved_stone", "patterned_cobblestone_02" },
            { "wet_asphalt",    "asphalt_floor" },
            { "ash_soil",       "brown_mud_dry" },
            { "grove_moss",     "forrest_ground_03" },
            { "neon_grid",      "blue_floor_tiles_01" },
            { "packed_earth",   "aerial_mud_1" },
            { "concrete_floor", "anti_slip_concrete" },
            { "metal_plate",    "metal_plate_02" },
            { "grass",          "aerial_grass_rock" },
            { "dirt",           "brown_mud_02" },
            { "sand",           "aerial_sand" },
            { "gravel",         "bicolour_gravel" },
            { "pebble_grit",    "pebble_embedded_pavement" },
            { "rock_ground",    "rock_ground" },
            { "snow",           "asphalt_snow" },
            { "brick",          "brick_floor" },
            { "wall",           "concrete_wall_009" },
            { "road",           "asphalt_02" },
        };

        static List<string> _stemIndex;

        static List<string> StemIndex()
        {
            if (_stemIndex != null) return _stemIndex;
            _stemIndex = new List<string>();
#if UNITY_EDITOR
            const string root = "Assets/Concordia/PolyHaven/Textures";
            if (AssetDatabase.IsValidFolder(root))
                foreach (var sub in AssetDatabase.GetSubFolders(root))
                    _stemIndex.Add(sub.Substring(sub.LastIndexOf('/') + 1));
#endif
            return _stemIndex;
        }

        /// Maps a requested surface name onto a set that actually exists on disk.
        public static string ResolveStem(string stem)
        {
            if (string.IsNullOrEmpty(stem)) return stem;
            if (LoadPbrTex(stem, "_diffuse_2k") != null) return stem;

            if (StemAliases.TryGetValue(stem, out var alias) &&
                LoadPbrTex(alias, "_diffuse_2k") != null)
                return alias;

            var idx = StemIndex();
            for (int i = 0; i < idx.Count; i++)
                if (idx[i].StartsWith(stem, System.StringComparison.OrdinalIgnoreCase))
                    return idx[i];

            // Last resort: any set whose name contains the request (e.g. "moss" -> "brick_moss_001").
            for (int i = 0; i < idx.Count; i++)
                if (idx[i].IndexOf(stem, System.StringComparison.OrdinalIgnoreCase) >= 0)
                    return idx[i];

            return stem;   // genuine miss — caller still gets an honest flat tint
        }

        public static Material Pbr(string requested, Color tint, float metallic = 0.08f, float smooth = 0.28f, float tile = 8f)
        {
            var stem = ResolveStem(requested);
            var key = stem + "|" + tile.ToString("F2");
            if (_pbrCache.TryGetValue(key, out var cached) && cached) return cached;

            var m = Lit(tint, metallic, smooth);
            var diff = LoadPbrTex(stem, "_diffuse_2k");
            var nrm = LoadPbrTex(stem, "_nor_gl_2k");

            if (diff)
            {
                // Textured surfaces must not be double-tinted by the flat fallback colour.
                if (m.HasProperty("_BaseColor")) m.SetColor("_BaseColor", Color.white);
                if (m.HasProperty("_Color")) m.SetColor("_Color", Color.white);
                if (m.HasProperty("_BaseMap")) { m.SetTexture("_BaseMap", diff); m.SetTextureScale("_BaseMap", Vector2.one * tile); }
                if (m.HasProperty("_MainTex")) { m.SetTexture("_MainTex", diff); m.SetTextureScale("_MainTex", Vector2.one * tile); }
            }
            if (nrm)
            {
                if (m.HasProperty("_BumpMap")) m.SetTexture("_BumpMap", nrm);
                m.EnableKeyword("_NORMALMAP");
                m.SetTextureScale("_BumpMap", Vector2.one * tile);
                if (m.HasProperty("_BumpScale")) m.SetFloat("_BumpScale", 1.0f);
            }

            // ARM -> real metallic/smoothness/occlusion response. Without this the surface has
            // correct albedo and normals but a flat, uniform material response.
            var armSrc = LoadPbrTex(stem, "_arm_2k");
            var packed = RepackArm(stem, armSrc);
            if (packed)
            {
                if (m.HasProperty("_MetallicGlossMap"))
                {
                    m.SetTexture("_MetallicGlossMap", packed);
                    m.SetTextureScale("_MetallicGlossMap", Vector2.one * tile);
                    m.EnableKeyword("_METALLICSPECGLOSSMAP");
                    // URP does `specGloss.a *= _Smoothness`, so the multiplier must be 1 for the
                    // packed alpha to survive as the authored smoothness.
                    if (m.HasProperty("_Smoothness")) m.SetFloat("_Smoothness", 1f);
                    if (m.HasProperty("_Metallic")) m.SetFloat("_Metallic", 1f);
                }
                if (m.HasProperty("_OcclusionMap"))
                {
                    m.SetTexture("_OcclusionMap", packed);
                    m.SetTextureScale("_OcclusionMap", Vector2.one * tile);
                    m.EnableKeyword("_OCCLUSIONMAP");
                    if (m.HasProperty("_OcclusionStrength")) m.SetFloat("_OcclusionStrength", 1f);
                }
            }

            m.name = "PH_" + stem;
            _pbrCache[key] = m;
            return m;
        }

        /// <summary>
        /// Wet Court stone: CX cobble albedo when present, Poly Haven cobble
        /// normals underneath, high smoothness. cobblestone_floor_13 is dirt
        /// between stones — that was the tire-mud Hub ground.
        /// </summary>
        public static Material WetStone(string requested = "patterned_cobblestone_02", float tile = 5.5f)
        {
            var stem = ResolveStem(string.IsNullOrEmpty(requested) ? "patterned_cobblestone_02" : requested);
            var key = "wet|" + stem + "|" + tile.ToString("F2");
            if (_pbrCache.TryGetValue(key, out var cached) && cached) return cached;

            // Dark wet stone — plate reads engraved slate, not blown white cobble.
            var m = new Material(Pbr(stem, new Color(0.38f, 0.40f, 0.42f), 0.02f, 0.32f, tile));
            var cx = LoadCourtCobble();
            if (cx)
            {
                if (m.HasProperty("_BaseMap")) { m.SetTexture("_BaseMap", cx); m.SetTextureScale("_BaseMap", Vector2.one * tile); }
                if (m.HasProperty("_MainTex")) { m.SetTexture("_MainTex", cx); m.SetTextureScale("_MainTex", Vector2.one * tile); }
                if (m.HasProperty("_BaseColor")) m.SetColor("_BaseColor", new Color(0.45f, 0.46f, 0.48f));
            }
            else if (m.HasProperty("_BaseColor"))
                m.SetColor("_BaseColor", new Color(0.40f, 0.42f, 0.44f));

            m.DisableKeyword("_METALLICSPECGLOSSMAP");
            if (m.HasProperty("_MetallicGlossMap")) m.SetTexture("_MetallicGlossMap", null);
            // Damp sheen only — high smoothness was clipping WetCourt white.
            if (m.HasProperty("_Smoothness")) m.SetFloat("_Smoothness", 0.34f);
            if (m.HasProperty("_Metallic")) m.SetFloat("_Metallic", 0.02f);
            if (m.HasProperty("_BumpScale")) m.SetFloat("_BumpScale", 1.15f);
            m.name = "PH_wet_" + stem;
            _pbrCache[key] = m;
            return m;
        }

        static Texture LoadCourtCobble()
        {
            var res = Resources.Load<Texture2D>("Concordia/Generated/P2/Tiles/CX_Tile_CourtCobble");
            if (res) return res;
            return BuildAssets.Load<Texture>("Assets/Concordia/Generated/P2/Tiles/CX_Tile_CourtCobble.jpg");
        }

        /// True when the Poly Haven set actually resolves — lets callers fall back to flat colour
        /// honestly instead of rendering an untextured surface that pretends to be dressed.
        public static bool HasPbrSet(string stem) => LoadPbrTex(ResolveStem(stem), "_diffuse_2k") != null;

        static readonly Dictionary<string, Texture2D> _armCache = new Dictionary<string, Texture2D>();
        static Material _armRepackMat;

        /// Repacks a Poly Haven ARM map into URP's expected channel layout on the GPU.
        /// See Shaders/ArmRepack.shader for the channel contract. Returns one texture usable as
        /// BOTH _MetallicGlossMap (.r/.a) and _OcclusionMap (.g) — their channels don't overlap.
        ///
        /// Done as a Graphics.Blit rather than CPU GetPixels so the source texture does not need
        /// "Read/Write Enabled" (which would double its memory) and so the work happens on the GPU.
        /// Cached per stem; the readback is one-time per set.
        static Texture2D RepackArm(string stem, Texture arm)
        {
            if (arm == null) return null;
            if (_armCache.TryGetValue(stem, out var cached) && cached) return cached;

            if (_armRepackMat == null)
            {
                var sh = Shader.Find("Hidden/Concordia/ArmRepack");
                if (sh == null) return null;          // honest miss — caller keeps flat smoothness
                _armRepackMat = new Material(sh) { hideFlags = HideFlags.HideAndDontSave };
            }

            int w = arm.width, h = arm.height;
            var rt = RenderTexture.GetTemporary(w, h, 0, RenderTextureFormat.ARGB32, RenderTextureReadWrite.Linear);
            var prev = RenderTexture.active;
            try
            {
                Graphics.Blit(arm, rt, _armRepackMat);
                RenderTexture.active = rt;

                // Linear, mip-mapped: this carries material response data, not colour.
                var outTex = new Texture2D(w, h, TextureFormat.RGBA32, true, true)
                {
                    name = stem + "_MetalSmoothAO",
                    wrapMode = TextureWrapMode.Repeat
                };
                outTex.ReadPixels(new Rect(0, 0, w, h), 0, 0, false);
                outTex.Apply(true, true);             // makeNoLongerReadable: free the CPU copy
                _armCache[stem] = outTex;
                return outTex;
            }
            finally
            {
                RenderTexture.active = prev;
                RenderTexture.ReleaseTemporary(rt);
            }
        }

        // TODO(ship): editor-only resolution. A player build needs these under Resources/ or
        // Addressables; AssetDatabase does not exist at runtime.
        static Texture LoadPbrTex(string stem, string suffix)
        {
            const string root = "Assets/Concordia/PolyHaven/Textures/";
            string[] exts = { ".jpg", ".png" };
            for (int i = 0; i < exts.Length; i++)
            {
                var t = BuildAssets.Load<Texture>(root + stem + "/" + stem + suffix + exts[i]);
                if (t) return t;
            }
            // Legacy flat layout kept for older non-Poly-Haven packs.
            for (int i = 0; i < exts.Length; i++)
            {
                var t = BuildAssets.Load<Texture>("Assets/Concordia/Models/polyhaven/" + stem + suffix + exts[i]);
                if (t) return t;
            }
            return null;
        }


        /// <summary>
        /// Court cinematic rig: Fill+Rim keys, local fog punch lights, red accent banners,
        /// wet puddle discs, hero rim spotlight.
        /// </summary>
        public static void EnsureCourtRig(WorldId world)
        {
            if (world != WorldId.Hub) return;
            var root = GameObject.Find("CourtLookRig");
            if (!root) root = new GameObject("CourtLookRig");
            EnsureFillRim(root.transform);
            EnsureLocalFog(root.transform);
            EnsureCourtTreeCanopy(root.transform);
            ForceSitCourtHeroTree();
            EnsureAccentBanners(root.transform);
            EnsurePuddles(root.transform);
            // SLICE 2b — uneven relief, puddles, grit/rocks, sidewalks on district roads.
            CourtGroundDress.Ensure();
            EnsureSoulLanterns(root.transform);
            EnsureHeroRim(root.transform);
            EnsureCourtAtmosphere(root.transform);
            EnsureCourtPlateCleanup(root.transform);
            // SLICE 1 — mesh hills north/out of Court (idempotent; Megaworld may boot later).
            var mega = GameObject.Find("Megaworld");
            if (mega) CourtWalkableHorizon.Ensure(mega.transform);
            else CourtWalkableHorizon.SoftenSkyband();
            CourtGroundDress.SoftenHorizonLand();
            // Do NOT StripLightShafts here — that only deletes leftover white "LightShaft"
            // mesh cones. CourtWarmShaft accents use a different name and must survive.
            // VolumeFogFeature stays off (wash); teal fog + warm key faked below.
            // Readable dusk if clock is deep night — temple still needs a key.
            if (WorldClock.Hour < 6f || WorldClock.Hour > 20.5f)
            {
                WorldClock.Hour = 16.2f; // soft late day, not golden blast
                ApplyHour(world, WorldClock.Hour);
            }
        }

        static void EnsureFillRim(Transform parent)
        {
            Light FindOrMake(string name, Vector3 euler, Color color, float intensity)
            {
                var go = GameObject.Find(name);
                if (!go)
                {
                    go = new GameObject(name);
                    go.transform.SetParent(parent, false);
                    go.AddComponent<Light>();
                }
                go.transform.rotation = Quaternion.Euler(euler);
                var l = go.GetComponent<Light>();
                l.type = LightType.Directional;
                l.color = color;
                l.intensity = intensity;
                l.shadows = LightShadows.None;
                l.enabled = true;
                go.SetActive(true);
                return l;
            }
            var sun = RenderSettings.sun;
            var yaw = sun ? sun.transform.eulerAngles.y : -38f;
            FindOrMake("Fill", new Vector3(28f, yaw + 180f, 0f), new Color(0.55f, 0.62f, 0.75f), 0.10f);
            FindOrMake("Rim", new Vector3(12f, yaw + 145f, 0f), new Color(0.9f, 0.85f, 0.75f), 0.12f);
        }

        static void EnsureLocalFog(Transform parent)
        {
            var go = GameObject.Find("CourtLocalFog");
            if (!go)
            {
                go = new GameObject("CourtLocalFog");
                go.transform.SetParent(parent, false);
                go.transform.position = new Vector3(0f, 4f, 0f);
                go.transform.localScale = new Vector3(48f, 14f, 48f);
            }
            // Punch shafts were the white beams / tan wash — disable for readable Court.
            DisableNamedLight("TempleMouthPunch");
            DisableNamedLight("CourtLanternPunchA");
            DisableNamedLight("CourtLanternPunchB");
            // Mild teal-biased volumetrics (feature stays off); density kept Hub-readable.
            Shader.SetGlobalFloat("_CxVolDensity", 0.0045f);
            Shader.SetGlobalFloat("_CxVolHeight", 0.55f);
            Shader.SetGlobalFloat("_CxVolSun", 0.22f);
            Shader.SetGlobalColor("_CxVolColor", new Color(0.32f, 0.58f, 0.66f, 1f));
            Shader.SetGlobalColor("_CxVolSunColor", new Color(1f, 0.82f, 0.55f, 1f));
        }

        /// <summary>
        /// Teal fog + warm gold key without white LightShaft mesh cones.
        /// VolumeFogFeature stays disabled — low-density shader globals only.
        /// </summary>

        static void EnsureCourtPlateCleanup(Transform parent)
        {
            var tree = GameObject.Find("CourtHeroTree");
            var origin = tree ? tree.transform.position : (parent ? parent.position : Vector3.zero);
            foreach (var r in Object.FindObjectsByType<Renderer>(FindObjectsSortMode.None))
            {
                if (!r || !r.gameObject.activeInHierarchy) continue;
                var n = r.gameObject.name;
                if (n.StartsWith("Court", System.StringComparison.Ordinal)) continue;
                // SLICE 2b road bands — Cube prims must survive even if briefly misnamed.
                if (n.StartsWith("Sidewalk", System.StringComparison.Ordinal) ||
                    n.StartsWith("Curb", System.StringComparison.Ordinal) ||
                    n == "RoadDeck" || n == "Street" || n == "StreetBand" ||
                    n == CourtGroundDress.DemoRoadName) continue;
                if (r.transform.parent &&
                    (r.transform.parent.name == CourtGroundDress.DemoRoadName ||
                     r.transform.parent.name.StartsWith("StreetBand", System.StringComparison.Ordinal) ||
                     r.transform.parent.name.StartsWith("SettlementRoads_", System.StringComparison.Ordinal)))
                    continue;
                // SLICE 1 walkable horizon — also spare if parented under CourtWalkableHorizon
                // with a non-Court child name (defensive; children are CourtWalk*/CourtApproach*).
                if (r.transform.parent && r.transform.parent.name == CourtWalkableHorizon.RootName) continue;
                if (n.IndexOf("Banner", System.StringComparison.OrdinalIgnoreCase) >= 0) continue;
                if (n.IndexOf("HeroTree", System.StringComparison.OrdinalIgnoreCase) >= 0) continue;
                if (n.IndexOf("WetStone", System.StringComparison.OrdinalIgnoreCase) >= 0) continue;
                if (n.IndexOf("Cobble", System.StringComparison.OrdinalIgnoreCase) >= 0) continue;
                if (n.IndexOf("Lantern", System.StringComparison.OrdinalIgnoreCase) >= 0) continue;
                // SLICE 6 — continent Present geography uses Plane/Capsule/Cube prims at RingMeters.
                // Do NOT plate-scrub them (was SetActive(false) out to 260m → empty still B).
                if (n.StartsWith("FarPad", System.StringComparison.Ordinal)
                    || n.StartsWith("FarHill_", System.StringComparison.Ordinal)
                    || n.StartsWith("FarMass_", System.StringComparison.Ordinal)
                    || n.StartsWith("FarSilhouette_", System.StringComparison.Ordinal)
                    || n.StartsWith("FarGeography_", System.StringComparison.Ordinal)
                    || n.StartsWith("HubWild", System.StringComparison.Ordinal)
                    || n == HubWilderness.RootName)
                    continue;
                bool underFarGeo = false;
                for (var pt = r.transform; pt != null; pt = pt.parent)
                {
                    var pn = pt.name ?? "";
                    if (pn.StartsWith("FarGeography_", System.StringComparison.Ordinal)
                        || pn == HubWilderness.RootName
                        || pn.StartsWith("HubWild", System.StringComparison.Ordinal))
                    { underFarGeo = true; break; }
                }
                if (underFarGeo) continue;
                var nl = n.ToLowerInvariant();
                bool primish =
                    n.StartsWith("Cube") || n.StartsWith("Sphere") || n.StartsWith("Capsule") ||
                    n.StartsWith("Cylinder") || n.StartsWith("Plane") || n.StartsWith("Cone") ||
                    n.StartsWith("Pyramid") || n.StartsWith("pCube") || n.StartsWith("pSphere") ||
                    n.StartsWith("pCone") || n.StartsWith("pPyramid") || n.StartsWith("Prim") ||
                    n.StartsWith("Hill_") || n.StartsWith("Mark_") ||
                    nl.StartsWith("rock_small") || nl.Contains("rock_smalla") ||
                    nl.Contains("pyramid") || nl.Contains("cone") || nl.Contains("prim") ||
                    nl.Contains("placeholder") || nl.Contains("impostor") || nl.Contains("leanmarker") ||
                    nl.Contains("debugdraw") || nl.Contains("gizmo");
                if (!primish)
                {
                    var mf = r.GetComponent<MeshFilter>();
                    if (mf && mf.sharedMesh != null)
                    {
                        var mn = mf.sharedMesh.name;
                        var mnl = mn.ToLowerInvariant();
                        if (mn == "Cube" || mn == "Sphere" || mn == "Capsule" || mn == "Cylinder" ||
                            mn == "Cone" || mn == "Pyramid" || mn == "Plane" ||
                            mnl.Contains("pyramid") || mnl.Contains("cone") ||
                            mnl.Contains("rock_small") || mnl.Contains("rocksmalla") ||
                            mnl.Contains("impostor") || mnl.Contains("placeholder") ||
                            // Low-vert FreePack pyramids often keep custom mesh names
                            (mf.sharedMesh.vertexCount <= 48 && (mnl.Contains("poly") || mnl.Contains("pyr") ||
                             mnl == "cube" || mnl == "sphere" || mnl.Contains("prism") || mnl.Contains("wedge"))))
                            primish = true;
                    }
                }
                if (!primish) continue;
                // Plate frustum: plaza + horizon clutter (~180m).
                if ((r.bounds.center - origin).sqrMagnitude > 260f * 260f) continue;
                r.enabled = false;
                r.gameObject.SetActive(false);
            }
        }

        static void EnsureCourtAtmosphere(Transform parent)
        {
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.ExponentialSquared;
            // Muted blue-grey haze. At the old saturated teal (0.35,0.62,0.68) and
            // exp2 density 0.027, everything 30 m out was half fog and 50 m out
            // ~84% — the Court's buildings read as flat teal cut-outs (look
            // captures, 2026-09-30). 0.013 keeps ~70% visibility at 50 m while far
            // HDRI peaks (150 m+) still melt behind CourtHorizonMask.
            var haze = new Color(0.50f, 0.60f, 0.64f);
            RenderSettings.fogColor = haze;
            // RenderSettings fog, NOT HubVolumeFog (washes Court white).
            if (_openFog < 0f || _openFog > 0.020f) LiveFog(0.013f);
            else LiveFog(Mathf.Clamp(_openFog, 0.010f, 0.016f));
            CourtWalkableHorizon.SoftenSkyband();

            var sun = RenderSettings.sun;
            if (sun && sun.type == LightType.Directional)
            {
                sun.color = new Color(1f, 0.84f, 0.62f); // warm gold key
                if (sun.intensity < 0.28f) sun.intensity = 0.32f;
                sun.shadows = LightShadows.Soft;
            }

            // Soft warm point accents — NOT named LightShaft (StripLightShafts-safe).
            EnsurePunchLight(parent, "CourtWarmShaft_A", new Vector3(-4f, 18f, 8f),
                new Color(1f, 0.78f, 0.48f), 3.2f, 40f);
            EnsurePunchLight(parent, "CourtWarmShaft_B", new Vector3(5f, 16f, 12f),
                new Color(1f, 0.72f, 0.42f), 2.8f, 36f);
            EnsurePunchLight(parent, "CourtWarmShaft_C", new Vector3(0f, 22f, 6f),
                new Color(1f, 0.88f, 0.55f), 2.4f, 44f);
            EnsureGodRaySpots(parent);

            Shader.SetGlobalFloat("_CxVolDensity", 0.012f);
            Shader.SetGlobalFloat("_CxVolSun", 0.55f);
            Shader.SetGlobalColor("_CxVolColor", new Color(0.32f, 0.58f, 0.66f, 1f));
            Shader.SetGlobalColor("_CxVolSunColor", new Color(1f, 0.82f, 0.55f, 1f));
            // Leave HubVolumeFog feature disabled — globals alone avoid the white wash.
            VolumeFogLive = false;
        }

        static void DisableNamedLight(string name)
        {
            var go = GameObject.Find(name);
            if (!go) return;
            var l = go.GetComponent<Light>();
            if (l) { l.enabled = false; l.intensity = 0f; }
            go.SetActive(false);
        }


        static void EnsureGodRaySpots(Transform parent)
        {
            var specs = new (string name, Vector3 pos, Quaternion rot)[]
            {
                ("CourtGodSpot_A", new Vector3(-3f, 28f, 14f), Quaternion.Euler(75f, 20f, 0f)),
                ("CourtGodSpot_B", new Vector3(4f, 26f, 20f), Quaternion.Euler(70f, -25f, 0f)),
                ("CourtGodSpot_C", new Vector3(0f, 30f, 12f), Quaternion.Euler(80f, 5f, 0f))
            };
            foreach (var s in specs)
            {
                var go = GameObject.Find(s.name);
                if (!go)
                {
                    go = new GameObject(s.name);
                    go.transform.SetParent(parent, false);
                    go.AddComponent<Light>();
                }
                go.transform.position = s.pos;
                go.transform.rotation = s.rot;
                var l = go.GetComponent<Light>();
                l.type = LightType.Spot;
                l.color = new Color(1f, 0.78f, 0.42f);
                l.intensity = 7.5f;
                l.range = 56f;
                l.spotAngle = 28f;
                l.shadows = LightShadows.Soft;
                l.enabled = true;
            }
        }

        static void EnsurePunchLight(Transform parent, string name, Vector3 pos, Color c, float intensity, float range)
        {
            var go = GameObject.Find(name);
            if (!go)
            {
                go = new GameObject(name);
                go.transform.SetParent(parent, false);
                go.AddComponent<Light>();
            }
            go.transform.position = pos;
            var l = go.GetComponent<Light>();
            l.type = LightType.Point;
            l.color = c;
            l.intensity = intensity;
            l.range = range;
            l.shadows = LightShadows.None;
            l.enabled = true;
        }

static float PlazaDeckY()
        {
            return VisibleCourtDeckY(0f, 18f);
        }

        /// Deck Y under a world XZ — raycast the *visible* WetCourt/plaza mesh, not HubPlaza AABB max
        /// (AABB max was over-lifting the trunk so lobes floated above wet tiles).
        static float VisibleCourtDeckY(float x, float z)
        {
            var origin = new Vector3(x, 80f, z);
            var hits = Physics.RaycastAll(origin, Vector3.down, 120f);
            System.Array.Sort(hits, (a, b) => a.distance.CompareTo(b.distance));
            string[] prefer = { "wetcourt", "wet_court", "courtdeck", "courtground", "hubplaza", "plazadeck", "courtplaza" };
            foreach (var h in hits)
            {
                if (!h.collider) continue;
                var n = h.collider.name.ToLowerInvariant();
                var rn = h.collider.transform.root ? h.collider.transform.root.name.ToLowerInvariant() : "";
                for (int i = 0; i < prefer.Length; i++)
                    if (n.Contains(prefer[i]) || rn.Contains(prefer[i]))
                        return h.point.y;
            }
            if (hits.Length > 0) return hits[0].point.y;
            // Renderer fallback: nearest WetCourt-ish max.y under this XZ (not global HubPlaza max).
            string[] names = { "WetCourt", "CourtGround", "CourtPlaza", "PlazaDeck", "HubPlaza" };
            float best = float.NegativeInfinity;
            float bestDist = float.PositiveInfinity;
            foreach (var nm in names)
            {
                var go = GameObject.Find(nm);
                if (!go) continue;
                foreach (var r in go.GetComponentsInChildren<Renderer>(true))
                {
                    if (!r) continue;
                    var b = r.bounds;
                    float dx = Mathf.Max(0f, Mathf.Abs(x - b.center.x) - b.extents.x);
                    float dz = Mathf.Max(0f, Mathf.Abs(z - b.center.z) - b.extents.z);
                    float d = dx * dx + dz * dz;
                    if (d < bestDist) { bestDist = d; best = b.max.y; }
                }
            }
            if (!float.IsNegativeInfinity(best)) return best;
            return 0f;
        }

        /// Sit tree on plaza deck and lift so trunk flare / root ball clears tiles.
        /// NOTE: FreePacks.Sit aborts when |dy|>12 — a 40m hero tree needs ~29m lift, so we Sit ourselves.
        static void SitCourtTreeOnPlaza(GameObject tree)
        {
            if (!tree) return;
            float plazaY = PlazaDeckY();
            // Prefer TRUNK submesh foot — PolyHaven jacaranda/island trees hang foliage
            // meters BELOW the bark flare. Sitting on full AABB.min.y parks leaf tips on
            // the deck and leaves the trunk floating (reads as "buried / only canopy").
            if (!TrySitByTrunkSubmesh(tree, plazaY))
            {
                var rb = EncapsulateRenderers(tree);
                if (rb.size.sqrMagnitude < 1e-6f) return;
                float deckY = VisibleCourtDeckY(rb.center.x, rb.center.z);
                float targetMinY = deckY + 0.03f;
                tree.transform.position += new Vector3(0f - rb.center.x, targetMinY - rb.min.y, 18f - rb.center.z);
            }
        }

        static Bounds EncapsulateRenderers(GameObject tree)
        {
            var rb = new Bounds(tree.transform.position, Vector3.zero);
            bool any = false;
            foreach (var r in tree.GetComponentsInChildren<Renderer>(true))
            {
                if (!r || !r.enabled) continue;
                if (!any) { rb = r.bounds; any = true; }
                else rb.Encapsulate(r.bounds);
            }
            return any ? rb : new Bounds(tree.transform.position, Vector3.zero);
        }

        /// Pick bark/trunk submesh. island_tree_03: 0=diff(bark), 1=leaves, 2=branches.
        /// Jacaranda often names trunk/bark explicitly. Never treat leaves/branches as trunk foot.
        static int ResolveTrunkSubmesh(Material[] mats, int subMeshCount)
        {
            if (mats == null || subMeshCount <= 0) return -1;
            int fallback = -1;
            for (int i = 0; i < mats.Length && i < subMeshCount; i++)
            {
                if (!mats[i]) continue;
                var tn = (mats[i].mainTexture ? mats[i].mainTexture.name : mats[i].name).ToLowerInvariant();
                if (tn.Contains("leaf") || tn.Contains("leaves") || tn.Contains("foliage") || tn.Contains("branch"))
                    continue;
                if (tn.Contains("trunk") || tn.Contains("bark") || tn.Contains("wood"))
                    return i;
                if (fallback < 0 && (tn.Contains("diff") || tn.Contains("albedo") || tn.Contains("basecolor") || tn.Contains("color")))
                    fallback = i;
                if (fallback < 0) fallback = i;
            }
            return fallback;
        }

        static bool TrySitByTrunkSubmesh(GameObject tree, float plazaY)
        {
            var mf = tree.GetComponentInChildren<MeshFilter>();
            var rend = tree.GetComponentInChildren<Renderer>();
            if (!mf || !mf.sharedMesh || !rend) return false;
            var mesh = mf.sharedMesh;
            if (!mesh.isReadable) return false;
            var mats = rend.sharedMaterials;
            int trunkSub = ResolveTrunkSubmesh(mats, mesh.subMeshCount);
            if (trunkSub < 0) return false;
            if (trunkSub >= mesh.subMeshCount) return false;
            var tris = mesh.GetTriangles(trunkSub);
            var verts = mesh.vertices;
            if (tris == null || tris.Length == 0) return false;
            float minY = float.PositiveInfinity;
            var sum = Vector3.zero;
            int n = 0;
            for (int ti = 0; ti < tris.Length; ti++)
            {
                var w = mf.transform.TransformPoint(verts[tris[ti]]);
                if (w.y < minY) minY = w.y;
                sum += w;
                n++;
            }
            if (n == 0 || float.IsInfinity(minY)) return false;
            var avg = sum / n;
            // Raycast visible deck under the flare XZ — ignore stale plazaY from HubPlaza AABB.
            float deckY = VisibleCourtDeckY(avg.x, avg.z);
            // Kiss tiles: 0–5cm bury max. +0.35 was over-lift (floating lobes).
            float targetY = deckY + 0.03f;
            tree.transform.position += new Vector3(0f - avg.x, targetY - minY, 18f - avg.z);
            return true;
        }

        /// Public so MCP/play dress can re-Sit after scale without FreePacks 12m abort.
        public static string ForceSitCourtHeroTree()
        {
            var tree = GameObject.Find("CourtHeroTree");
            if (!tree) return "NO_TREE";
            // Megaworld streams rock_smallA after first Ensure — re-scrub every Sit.
            EnsureCourtPlateCleanup(tree.transform.parent != null ? tree.transform.parent : tree.transform);
            SitCourtTreeOnPlaza(tree);
            var rb = EncapsulateRenderers(tree);
            float plazaY = PlazaDeckY();
            // Leaf tips hang below plaza on jacaranda — PASS/FAIL on TRUNK foot, not full AABB.
            float trunkMinY = float.NaN;
            var mf = tree.GetComponentInChildren<MeshFilter>();
            var rend = tree.GetComponentInChildren<Renderer>();
            if (mf && mf.sharedMesh && mf.sharedMesh.isReadable && rend)
            {
                var mesh = mf.sharedMesh;
                var mats = rend.sharedMaterials;
                int trunkSub = ResolveTrunkSubmesh(mats, mesh.subMeshCount);
                if (trunkSub >= 0 && trunkSub < mesh.subMeshCount)
                {
                    var tris = mesh.GetTriangles(trunkSub);
                    var verts = mesh.vertices;
                    float minY = float.PositiveInfinity;
                    for (int ti = 0; ti < tris.Length; ti++)
                    {
                        var w = mf.transform.TransformPoint(verts[tris[ti]]);
                        if (w.y < minY) minY = w.y;
                    }
                    if (!float.IsInfinity(minY)) trunkMinY = minY;
                }
            }
            if (rb.size.sqrMagnitude < 1e-6f) return "NO_RENDS";
            string trunkBit = float.IsNaN(trunkMinY)
                ? "trunkMinY=NaN"
                : ("trunkMinY=" + trunkMinY + " trunkLift=" + (trunkMinY - plazaY));
            return "pos=" + tree.transform.position + " aabbMinY=" + rb.min.y + " " + trunkBit
                + " plazaY=" + plazaY + " PASS_TRUNK=" + (!float.IsNaN(trunkMinY) && trunkMinY >= plazaY - 0.5f && trunkMinY <= plazaY + 3f);
        }

        static void EnsureCourtTreeCanopy(Transform parent)
        {
            var existing = GameObject.Find("CourtHeroTree");
            if (existing)
            {
                var existingRenderers = existing.GetComponentsInChildren<Renderer>(true);
                if (existingRenderers.Length > 0)
                {
                    var existingBounds = existingRenderers[0].bounds;
                    for (int i = 1; i < existingRenderers.Length; i++) existingBounds.Encapsulate(existingRenderers[i].bounds);
                    // Reject zero-mesh LODs (broken RealWorld prefab) — force respawn.
                    bool hasMesh = false;
                    foreach (var mf in existing.GetComponentsInChildren<MeshFilter>(true))
                        if (mf && mf.sharedMesh) { hasMesh = true; break; }
                    if (hasMesh && Mathf.Max(existingBounds.size.x, existingBounds.size.z) >= 8f)
                    {
                        // Reject skinny island_tree_02 / insane FreePacks scales — respawn denser 03.
                        string meshName = null;
                        foreach (var mf in existing.GetComponentsInChildren<MeshFilter>(true))
                            if (mf && mf.sharedMesh) { meshName = mf.sharedMesh.name; break; }
                        // Jacaranda hangs tips below flare — rejects for Sit-proof hero (looks like canopy-only).
                        // Keep island_tree_03 (textured). Reject 02 (too skinny) and Kenney fat (no bark albedo).
                        bool skinny = meshName != null && (
                            meshName.IndexOf("island_tree_02", System.StringComparison.OrdinalIgnoreCase) >= 0
                            || meshName.IndexOf("tree_fat", System.StringComparison.OrdinalIgnoreCase) >= 0);
                        bool absurdScale = existing.transform.localScale.x > 5000f || existing.transform.localScale.y > 5000f || existingBounds.size.y > 90f || existingBounds.size.sqrMagnitude < 0.01f;
                        if (!(skinny || absurdScale))
                        {
                            // ALWAYS re-Sit — early-return used to skip Sit after scale fatten buried the trunk.
                            SitCourtTreeOnPlaza(existing);
                            ConfigureCourtTreeMaterials(existing);
                            EnsureCourtBannerSockets(existing);
                            return;
                        }
                    }
                }
                if (Application.isPlaying) Object.Destroy(existing);
                else Object.DestroyImmediate(existing);
            }

            // North-star canopy: prefer denser PolyHaven FBX (island_tree_03 / jacaranda) before skinny 02.
            // Do NOT XZ-scale fatten — that buried the trunk and still left sky holes. Density = better mesh.
            GameObject prefab = null;
            // Thick trunk first (Kenney fat). Skip Concordia_Real_Oak — LODs ship with null meshes.
            // Jacaranda hangs tips that read as canopy-only in Sit plates — keep as late fallback.
            // Textured PolyHaven bark first (Kenney fat = flat silhouette — fails Sit-proof plate).
            string[] fbxPaths = {
                "Assets/Concordia/PolyHaven/Models/island_tree_03/island_tree_03_1k.fbx",
                "Assets/Concordia/PolyHaven/Models/jacaranda_tree/jacaranda_tree_1k.fbx",
                "Assets/Concordia/PolyHaven/Models/island_tree_02/island_tree_02_1k.fbx"
            };
            for (int fi = 0; fi < fbxPaths.Length && !prefab; fi++)
                prefab = FreePacks.Load<GameObject>(fbxPaths[fi]);
            if (!prefab)
            {
                string stem = null;
                string[] prefer = { "tree_fat_darkh", "tree_fat", "tree_detailed_dark", "island_tree_03_1k", "jacaranda_tree_1k" };
                for (int si = 0; si < prefer.Length; si++)
                {
                    if (FreePacks.HasStoreStem(prefer[si]) || FreePacks.HasStem(prefer[si])) { stem = prefer[si]; break; }
                }
                if (!string.IsNullOrEmpty(stem))
                {
                    prefab = FreePacks.Mesh(stem);
                    if (!prefab && (stem == "Concordia_Real_ForestTree" || stem == "Concordia_Real_Oak"))
                        prefab = FreePacks.Load<GameObject>("Assets/Concordia/Generated/RealWorld/" + stem + ".prefab");
                }
            }
            if (!prefab) return;
            var tree = Object.Instantiate(prefab, parent);
            tree.name = "CourtHeroTree";
            // RealOak / broken LODs: MeshFilter present but sharedMesh null — abort and try next path.
            bool spawnedHasMesh = false;
            foreach (var mfChk in tree.GetComponentsInChildren<MeshFilter>(true))
                if (mfChk && mfChk.sharedMesh) { spawnedHasMesh = true; break; }
            if (!spawnedHasMesh)
            {
                if (Application.isPlaying) Object.Destroy(tree);
                else Object.DestroyImmediate(tree);
                // Walk remaining fbxPaths manually
                for (int fi2 = 0; fi2 < fbxPaths.Length; fi2++)
                {
                    if (prefab != null && FreePacks.Load<GameObject>(fbxPaths[fi2]) == prefab) continue;
                    var alt = FreePacks.Load<GameObject>(fbxPaths[fi2]);
                    if (!alt) continue;
                    tree = Object.Instantiate(alt, parent);
                    tree.name = "CourtHeroTree";
                    spawnedHasMesh = false;
                    foreach (var mfChk in tree.GetComponentsInChildren<MeshFilter>(true))
                        if (mfChk && mfChk.sharedMesh) { spawnedHasMesh = true; break; }
                    if (spawnedHasMesh) { prefab = alt; break; }
                    if (Application.isPlaying) Object.Destroy(tree);
                    else Object.DestroyImmediate(tree);
                    tree = null;
                }
                if (tree == null) return;
            }
            tree.transform.position = new Vector3(0f, PlazaDeckY(), 18f);
            tree.transform.rotation = Quaternion.identity;
            tree.transform.localScale = Vector3.one;
            // Uniform height scale only — no XZ fatten (buried roots + fake mass).
            var b0 = new Bounds(tree.transform.position, Vector3.zero);
            bool any = false;
            foreach (var r in tree.GetComponentsInChildren<Renderer>(true))
            {
                if (!any) { b0 = r.bounds; any = true; }
                else b0.Encapsulate(r.bounds);
            }
            if (any && b0.size.y > 1e-4f)
            {
                var hs = 40f / b0.size.y;
                tree.transform.localScale = new Vector3(hs, hs, hs);
            }
            else
                FreePacks.FitMax(tree, 40f);
            SitCourtTreeOnPlaza(tree);
            FreePacks.TrunkCollider(tree);
            FreePacks.PaintIfBlank(tree);
            ConfigureCourtTreeMaterials(tree);
            EnsureCourtBannerSockets(tree);
        }

        static void EnsureCourtBannerSockets(GameObject tree)
        {
            if (!tree) return;
            var renderers = tree.GetComponentsInChildren<Renderer>(true);
            if (renderers.Length == 0) return;
            var bounds = renderers[0].bounds;
            for (int i = 1; i < renderers.Length; i++) bounds.Encapsulate(renderers[i].bounds);

            CourtSocket(tree.transform, "CourtTree_BannerSocket_W",
                bounds.center + new Vector3(-bounds.size.x * 0.22f, bounds.size.y * 0.015f, -bounds.size.z * 0.10f));
            CourtSocket(tree.transform, "CourtTree_BannerSocket_E",
                bounds.center + new Vector3(bounds.size.x * 0.22f, bounds.size.y * 0.025f, -bounds.size.z * 0.06f));
            CourtSocket(tree.transform, "CourtTree_BannerSocket_N",
                bounds.center + new Vector3(-bounds.size.x * 0.06f, bounds.size.y * 0.045f, bounds.size.z * 0.08f));
            CourtSocket(tree.transform, "CourtTree_BannerSocket_S",
                bounds.center + new Vector3(bounds.size.x * 0.08f, bounds.size.y * 0.012f, -bounds.size.z * 0.18f));
        }

static void ConfigureCourtTreeMaterials(GameObject tree)
        {
            if (!tree) return;
            // Plate: DARK wet bark under canopy. Leaves stay green — never brown-wash foliage.
            var darkBark = new Color(0.28f, 0.17f, 0.11f, 1f);
            var deepBark = new Color(0.18f, 0.11f, 0.07f, 1f);
            var leafTint = new Color(0.55f, 0.68f, 0.32f, 1f);
            foreach (var renderer in tree.GetComponentsInChildren<Renderer>(true))
            {
                if (!renderer) continue;
                var materials = renderer.sharedMaterials;
                if (materials == null) continue;
                var next = new Material[materials.Length];
                for (int i = 0; i < materials.Length; i++)
                {
                    var src = materials[i];
                    if (!src) { next[i] = src; continue; }
                    var material = new Material(src);
                    material.name = (src.name ?? "mat") + "_CourtPlate";
                    Texture albedo = FirstAlbedo(material) ?? material.mainTexture;
                    string materialName = (material.name ?? string.Empty).ToLowerInvariant();
                    string textureName = albedo ? (albedo.name ?? string.Empty).ToLowerInvariant() : string.Empty;
                    // Also sniff every texture slot name — jacaranda leaf maps sometimes miss FirstAlbedo.
                    if (!textureName.Contains("leaf") && !textureName.Contains("trunk") && !textureName.Contains("branch"))
                    {
                        for (int ti = 0; ti < 16; ti++)
                        {
                            if (!material.HasProperty("_BaseMap") && ti > 0) break;
                            try {
                                var tt = material.GetTexture(ti == 0 ? "_BaseMap" : (ti == 1 ? "_MainTex" : "_BaseColorMap"));
                                if (tt != null) { textureName += " " + tt.name.ToLowerInvariant(); break; }
                            } catch {}
                        }
                        if (material.mainTexture) textureName += " " + material.mainTexture.name.ToLowerInvariant();
                    }
                    // island_tree_02 slots: 0 trunk, 1 leaves, 2 branches (name match can fail on instanced mats).
                    // Texture name ONLY — jacaranda slots are branches/trunk/leaves (not 0/1/2 island_tree).
                    // Slot-index fallback painted jacaranda leaves as bark (teal/brown silhouette).
                    bool leafByTex = textureName.Contains("leaf") || textureName.Contains("foliage")
                                     || textureName.Contains("needle") || textureName.Contains("canopy");
                    bool branchByTex = textureName.Contains("branch");
                    bool trunkByTex = textureName.Contains("trunk") || textureName.Contains("bark")
                                      || textureName.Contains("wood");
                    // jacaranda FBX slots: 0=branches, 1=trunk, 2=leaves (NOT island_tree order).
                    bool jacaranda = textureName.Contains("jacaranda") || (tree && tree.name.ToLowerInvariant().Contains("jacaranda"));
                    if (!jacaranda && tree != null)
                    {
                        foreach (var mfJ in tree.GetComponentsInChildren<MeshFilter>(true))
                        {
                            if (mfJ && mfJ.sharedMesh && mfJ.sharedMesh.name.ToLowerInvariant().Contains("jacaranda"))
                            { jacaranda = true; break; }
                        }
                    }
                    bool leaf = leafByTex || materialName.Contains("leaf") || materialName.Contains("foliage")
                                || (jacaranda && i == 2);
                    bool branch = !leaf && (branchByTex || materialName.Contains("branch") || (jacaranda && i == 0));
                    bool trunk = !leaf && !branch && (trunkByTex || (jacaranda && i == 1) || (!jacaranda && i == 0));
                    // Always kill emissive / cyan wash on every slot
                    if (material.HasProperty("_EmissionColor")) material.SetColor("_EmissionColor", Color.black);
                    material.DisableKeyword("_EMISSION");
                    if (material.HasProperty("_MetallicGlossMap")) material.SetTexture("_MetallicGlossMap", null);
                    material.DisableKeyword("_METALLICSPECGLOSSMAP");
                    if (leaf)
                    {
                        if (material.HasProperty("_Surface")) material.SetFloat("_Surface", 0f);
                        if (material.HasProperty("_AlphaClip")) material.SetFloat("_AlphaClip", 1f);
                        if (material.HasProperty("_Cutoff")) material.SetFloat("_Cutoff", 0.35f);
                        if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", leafTint);
                        if (material.HasProperty("_Color")) material.SetColor("_Color", leafTint);
                        if (material.HasProperty("_Metallic")) material.SetFloat("_Metallic", 0f);
                        if (material.HasProperty("_Smoothness")) material.SetFloat("_Smoothness", 0.14f);
                        if (material.HasProperty("_SpecularColor")) material.SetColor("_SpecularColor", new Color(0.08f, 0.10f, 0.06f, 1f));
                        material.EnableKeyword("_ALPHATEST_ON");
                        material.DisableKeyword("_SURFACE_TYPE_TRANSPARENT");
                        material.renderQueue = 2450;
                    }
                    else
                    {
                        var bark = branch ? darkBark : deepBark; // trunk + unknown → deepBark
                        if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", bark);
                        if (material.HasProperty("_Color")) material.SetColor("_Color", bark);
                        if (material.HasProperty("_Metallic")) material.SetFloat("_Metallic", 0f);
                        if (material.HasProperty("_Smoothness")) material.SetFloat("_Smoothness", 0.10f);
                        if (material.HasProperty("_Glossiness")) material.SetFloat("_Glossiness", 0.10f);
                        if (material.HasProperty("_SpecularColor")) material.SetColor("_SpecularColor", new Color(0.05f, 0.04f, 0.03f, 1f));
                    }
                    next[i] = material;
                }
                renderer.sharedMaterials = next;
                renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.On;
                renderer.receiveShadows = true;
            }
        }

        static Transform CourtSocket(Transform parent, string name, Vector3 worldPosition)
        {
            var existing = parent.Find(name);
            if (existing) return existing;
            var go = new GameObject(name);
            go.transform.SetParent(parent, true);
            go.transform.position = worldPosition;
            return go.transform;
        }

        static void EnsureAccentBanners(Transform parent)
        {
            var existing = GameObject.Find("CourtAccentBanners");
            if (existing) Object.Destroy(existing);
            var hold = new GameObject("CourtAccentBanners").transform;
            hold.SetParent(parent, false);

            var tree = GameObject.Find("CourtHeroTree");
            if (!tree) return;

            // Draped cloth: multi-panel strip facing south — not a single flat billboard.
            var red = new Color(0.82f, 0.04f, 0.06f, 1f);
            var unlit = Shader.Find("Universal Render Pipeline/Unlit")
                        ?? Shader.Find("Unlit/Color")
                        ?? Shader.Find("Sprites/Default");
            void MakeDrape(string name, Vector3 worldPos, float yaw)
            {
                var root = new GameObject(name).transform;
                root.SetParent(hold, false);
                root.position = worldPos;
                root.rotation = Quaternion.Euler(0f, yaw, 0f);
                // 4 hanging panels with slight fold angles = readable drape silhouette.
                float[] folds = { -18f, -6f, 6f, 16f };
                for (int p = 0; p < folds.Length; p++)
                {
                    var q = GameObject.CreatePrimitive(PrimitiveType.Quad);
                    Object.Destroy(q.GetComponent<Collider>());
                    q.name = name + "_Panel_" + p;
                    q.transform.SetParent(root, false);
                    q.transform.localPosition = new Vector3((p - 1.5f) * 0.55f, -p * 0.15f, p * 0.08f);
                    q.transform.localRotation = Quaternion.Euler(8f + p * 2f, folds[p], 4f * (p % 2 == 0 ? 1 : -1));
                    q.transform.localScale = new Vector3(0.95f, 2.6f + p * 0.15f, 1f);
                    if (unlit != null)
                    {
                        var mat = new Material(unlit);
                        if (mat.HasProperty("_BaseColor")) mat.SetColor("_BaseColor", red);
                        if (mat.HasProperty("_Color")) mat.SetColor("_Color", red);
                        q.GetComponent<MeshRenderer>().sharedMaterial = mat;
                    }
                }
            }

            // Heights ~4–6m so trunk-contact plate (flare on tiles) still sees Unlit deep red.
            var trunk = tree.transform.position;
            MakeDrape("CourtDrape_L", trunk + new Vector3(-2.2f, 5.2f, -2.8f), 168f);
            MakeDrape("CourtDrape_R", trunk + new Vector3(2.4f, 4.9f, -2.6f), 192f);
            MakeDrape("CourtDrape_C", trunk + new Vector3(0.1f, 6.0f, -2.2f), 180f);

            // Also keep store stems on sockets when present (extra mass).
            var sockets = new[]
            {
                tree.transform.Find("CourtTree_BannerSocket_S"),
                tree.transform.Find("CourtTree_BannerSocket_W"),
                tree.transform.Find("CourtTree_BannerSocket_E")
            };
            for (var i = 0; i < sockets.Length; i++)
            {
                var socket = sockets[i];
                if (!socket) continue;
                var clothGo = FreePacks.SpawnStore("banner-red", socket, socket.position, 0f, 4.8f, required: false)
                              ?? FreePacks.SpawnStore("flag-banner-short", socket, socket.position, 0f, 4.4f, required: false);
                if (!clothGo) continue;
                clothGo.name = "CourtBanner_" + i;
                clothGo.transform.SetParent(socket, true);
                clothGo.transform.localPosition = Vector3.zero;
                clothGo.transform.rotation = Quaternion.Euler(0f, 180f, i % 2 == 0 ? 4f : -4f);
                FreePacks.StripColliders(clothGo);
                FreePacks.DyeCloth(clothGo, red);
            }
        }

        static void EnsureSoulLanterns(Transform parent)
        {
            if (GameObject.Find("CourtSoulLanterns")) return;
            var hold = new GameObject("CourtSoulLanterns").transform;
            hold.SetParent(parent, false);
            var positions = new[]
            {
                new Vector3(-10.5f, 0f, 9.5f), new Vector3(10.5f, 0f, 9.5f),
                new Vector3(-12.5f, 0f, -5.5f), new Vector3(12.5f, 0f, -5.5f)
            };
            for (var i = 0; i < positions.Length; i++)
            {
                var mount = new GameObject("SoulLanternMount_" + i).transform;
                mount.SetParent(hold, false);
                mount.localPosition = positions[i];
                var lantern = FreePacks.SpawnStore("Lantern_01_1k", mount, mount.position, i * 90f, 1.25f,
                    required: false, byHeight: false)
                              ?? FreePacks.SpawnStore("wooden_lantern_01_1k", mount, mount.position, i * 90f, 1.25f,
                                  required: false, byHeight: false);
                if (lantern)
                {
                    lantern.name = "SoulLantern_" + i;
                    lantern.transform.SetParent(mount, true);
                    lantern.transform.localPosition = Vector3.zero;
                    FreePacks.StripColliders(lantern);
                }
                var core = GameObject.CreatePrimitive(PrimitiveType.Sphere);
                core.name = "SoulCore_" + i;
                core.transform.SetParent(mount, false);
                core.transform.localPosition = Vector3.up * 0.72f;
                core.transform.localScale = Vector3.one * 0.10f;
                var collider = core.GetComponent<Collider>();
                if (collider) Object.Destroy(collider);
                var renderer = core.GetComponent<Renderer>();
                if (renderer) renderer.sharedMaterial = Emit(new Color(1f, 0.46f, 0.16f), 3.4f);
                Point(mount, "SoulLight_" + i, Vector3.up * 0.72f,
                    new Color(1f, 0.32f, 0.12f), 0.85f, 7f, false);
            }
        }

        static void EnsurePuddles(Transform parent)
        {
            // SLICE 2b — CourtGroundDress owns the rich puddle set. Keep a thin legacy
            // stamp only when dress has not run yet (boot order), then dress replaces it.
            if (GameObject.Find(CourtGroundDress.RootName)) return;
            if (GameObject.Find("CourtPuddles")) return;
            var hold = new GameObject("CourtPuddles").transform;
            hold.SetParent(parent, false);
            var wet = WetStone("patterned_cobblestone_02", 8f);
            if (wet.HasProperty("_Smoothness")) wet.SetFloat("_Smoothness", 0.55f);
            Vector3[] puddles =
            {
                new Vector3(-3.2f, 0.02f, 2.4f), new Vector3(4.1f, 0.02f, -1.8f),
                new Vector3(1.2f, 0.02f, 5.5f), new Vector3(-5.5f, 0.02f, -4.2f),
                new Vector3(0.4f, 0.02f, -6.8f)
            };
            for (var i = 0; i < puddles.Length; i++)
            {
                var disc = Prim(hold, PrimitiveType.Cylinder, puddles[i],
                    new Vector3(1.6f + (i % 3) * 0.35f, 0.01f, 1.6f + (i % 2) * 0.4f), wet, "CourtPuddleLegacy_" + i, false);
                var col = disc.GetComponent<Collider>();
                if (col) Object.Destroy(col);
            }
        }

        static void EnsureHeroRim(Transform parent)
        {
            var go = GameObject.Find("HeroRimSpot");
            if (!go)
            {
                go = new GameObject("HeroRimSpot");
                go.transform.SetParent(parent, false);
                go.AddComponent<Light>();
                go.AddComponent<CourtHeroRimFollow>();
            }
            var l = go.GetComponent<Light>();
            l.type = LightType.Spot;
            l.color = new Color(1f, 0.9f, 0.75f);
            l.intensity = 0.35f;
            l.range = 12f;
            l.spotAngle = 55f;
            l.shadows = LightShadows.None;
            l.enabled = true;
        }

        public static void PushVolume()
        {
            bool hub = WorldClock.World == WorldId.Hub;
            float dens = hub ? (_interior ? 0.003f : 0.004f) : 0.022f;
            Shader.SetGlobalFloat("_CxVolDensity", dens);
            Shader.SetGlobalFloat("_CxVolHeight", hub ? 0.35f : 1.2f);
            Shader.SetGlobalFloat("_CxVolFalloff", hub ? 7.5f : 10f);
            Shader.SetGlobalFloat("_CxVolMaxM", hub ? 72f : 48f);
            Shader.SetGlobalFloat("_CxVolSun", hub ? (_interior ? 0.08f : 0.12f) : 1.1f);
            var fog = RenderSettings.fogColor;
            // Scattering biased toward key — cool air + warm shafts.
            var sunHint = RenderSettings.sun && RenderSettings.sun.enabled ? RenderSettings.sun.color : new Color(1f, 0.86f, 0.68f);
            Shader.SetGlobalColor("_CxVolColor", Color.Lerp(fog * 1.05f, sunHint, 0.35f));
            var sun = RenderSettings.sun;
            var sunCol = sun && sun.enabled ? sun.color * sun.intensity : new Color(0.85f, 0.78f, 0.62f);
            Shader.SetGlobalColor("_CxVolSunColor", Color.Lerp(sunCol, Color.white, 0.35f));
        }


        static void DisableVolumeFogFeature()
        {
            VolumeFogLive = false;
            Shader.SetGlobalFloat("_CxVolDensity", 0f);
            Shader.SetGlobalFloat("_CxVolSun", 0f);
            try
            {
                var urp = UniversalRenderPipeline.asset;
                if (!urp) return;
                // Runtime-safe: walk rendererFeatures without SerializedObject.
                var listField = typeof(UniversalRenderPipelineAsset).GetField("m_RendererDataList",
                    System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
                var arr = listField != null ? listField.GetValue(urp) as ScriptableRendererData[] : null;
                if (arr == null || arr.Length < 1 || !arr[0]) return;
                var featsProp = arr[0].GetType().GetProperty("rendererFeatures");
                var feats = featsProp != null ? featsProp.GetValue(arr[0]) as System.Collections.IList : null;
                if (feats == null) return;
                foreach (var f in feats)
                {
                    if (f == null) continue;
                    if (f.GetType().Name.IndexOf("HubVolumeFog", System.StringComparison.OrdinalIgnoreCase) < 0) continue;
                    var feat = f as ScriptableRendererFeature;
                    if (feat) feat.SetActive(false);
                }
            }
            catch { }
        }

        static void TryEnableVolumeFog()
        {
#if UNITY_EDITOR
            try
            {
                var urp = UniversalRenderPipeline.asset;
                if (!urp) return;
                var so = new SerializedObject(urp);
                var list = so.FindProperty("m_RendererDataList");
                if (list == null || list.arraySize < 1) return;
                var renderer = list.GetArrayElementAtIndex(0).objectReferenceValue as ScriptableRendererData;
                if (!renderer) return;
                var featsProp = renderer.GetType().GetProperty("rendererFeatures");
                var feats = featsProp != null ? featsProp.GetValue(renderer) as System.Collections.IList : null;
                if (feats == null) return;
                foreach (var f in feats)
                {
                    if (f != null && f.GetType().Name.IndexOf("HubVolumeFog", System.StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        VolumeFogLive = true;
                        return;
                    }
                }
                var feat = ScriptableObject.CreateInstance<HubVolumeFogFeature>();
                if (!feat) return;
                feat.name = "HubVolumeFog";
                feats.Add(feat);
                AssetDatabase.AddObjectToAsset(feat, renderer);
                EditorUtility.SetDirty(renderer);
                VolumeFogLive = true;
            }
            catch { }
#else
            VolumeFogLive = Shader.Find("Hidden/Concordia/VolumeFog") != null;
#endif
        }

        static void TryEnableSsao()
        {
#if UNITY_EDITOR
            try
            {
                var urp = UniversalRenderPipeline.asset;
                if (!urp) return;
                var so = new SerializedObject(urp);
                var list = so.FindProperty("m_RendererDataList");
                if (list == null || list.arraySize < 1) return;
                var renderer = list.GetArrayElementAtIndex(0).objectReferenceValue as ScriptableRendererData;
                if (!renderer) return;
                var featsProp = renderer.GetType().GetProperty("rendererFeatures");
                var feats = featsProp != null ? featsProp.GetValue(renderer) as System.Collections.IList : null;
                if (feats == null) return;
                foreach (var f in feats)
                    if (f != null && f.GetType().Name.IndexOf("AmbientOcclusion", System.StringComparison.OrdinalIgnoreCase) >= 0)
                        return;
                var t = System.Type.GetType("UnityEngine.Rendering.Universal.ScreenSpaceAmbientOcclusion, Unity.RenderPipelines.Universal.Runtime");
                if (t == null) return;
                var feat = ScriptableObject.CreateInstance(t) as ScriptableRendererFeature;
                if (!feat) return;
                feat.name = "SSAO";
                feats.Add(feat);
                AssetDatabase.AddObjectToAsset(feat, renderer);
                EditorUtility.SetDirty(renderer);
            }
            catch { }
#endif
        }

        public static Material Emit(Color c, float intensity = 2.4f)
        {
            var m = Lit(c, 0.05f, 0.55f);
            var hdr = c * intensity;
            m.EnableKeyword("_EMISSION");
            if (m.HasProperty("_EmissionColor")) m.SetColor("_EmissionColor", hdr);
            if (m.HasProperty("_EmissionMap")) m.SetTexture("_EmissionMap", Texture2D.whiteTexture);
            return m;
        }

        public static Material UnlitAlpha(Color c)
        {
            EnsureShaders();
            var sh = _unlit != null ? _unlit : Shader.Find("Sprites/Default");
            var m = new Material(sh);
            m.color = c;
            if (m.HasProperty("_BaseColor")) m.SetColor("_BaseColor", c);
            if (m.HasProperty("_Color")) m.SetColor("_Color", c);
            m.SetFloat("_Surface", 1f);
            m.SetOverrideTag("RenderType", "Transparent");
            m.SetInt("_SrcBlend", (int)BlendMode.SrcAlpha);
            m.SetInt("_DstBlend", (int)BlendMode.One);
            m.SetInt("_ZWrite", 0);
            m.DisableKeyword("_ALPHATEST_ON");
            m.EnableKeyword("_ALPHABLEND_ON");
            m.renderQueue = 3000;
            return m;
        }

        public static Material ParticleMat(Color c, bool additive = true)
        {
            EnsureShaders();
            var sh = _particles != null ? _particles : (_unlit != null ? _unlit : Shader.Find("Sprites/Default"));
            var m = new Material(sh);
            if (m.HasProperty("_BaseColor")) m.SetColor("_BaseColor", c);
            if (m.HasProperty("_Color")) m.SetColor("_Color", c);
            m.SetInt("_SrcBlend", (int)BlendMode.SrcAlpha);
            m.SetInt("_DstBlend", (int)(additive ? BlendMode.One : BlendMode.OneMinusSrcAlpha));
            m.SetInt("_ZWrite", 0);
            m.renderQueue = 3000;
            return m;
        }

        static void EnsurePipeline()
        {
            if (GraphicsSettings.currentRenderPipeline != null) return;
            var urp = BuildAssets.Load<UniversalRenderPipelineAsset>("Assets/Settings/URP-Pipeline.asset");
            if (urp)
            {
                GraphicsSettings.defaultRenderPipeline = urp;
                QualitySettings.renderPipeline = urp;
            }
        }

        static void EnsureShaders()
        {
            if (_lit == null || IsErrorShader(_lit))
                _lit = FindUrp("Universal Render Pipeline/Lit")
                    ?? FindUrp("Universal Render Pipeline/Simple Lit")
                    ?? StealUrpFromAssets()
                    ?? StealShader(PrimitiveType.Cube);
            if (_unlit == null || IsErrorShader(_unlit))
                _unlit = FindUrp("Universal Render Pipeline/Unlit") ?? _lit;
            if (_particles == null || IsErrorShader(_particles))
                _particles = FindUrp("Universal Render Pipeline/Particles/Unlit")
                             ?? Shader.Find("Particles/Standard Unlit")
                             ?? _unlit;
        }

        static Shader FindUrp(string name)
        {
            var s = Shader.Find(name);
            if (s && !IsErrorShader(s)) return s;
            return null;
        }

        static bool IsErrorShader(Shader s)
        {
            if (!s) return true;
            var n = s.name ?? "";
            return n.IndexOf("Error", System.StringComparison.OrdinalIgnoreCase) >= 0
                   || n.IndexOf("Hidden/InternalError", System.StringComparison.OrdinalIgnoreCase) >= 0;
        }

        static Shader StealUrpFromAssets()
        {
#if UNITY_EDITOR
            foreach (var guid in AssetDatabase.FindAssets("t:Material"))
            {
                var p = AssetDatabase.GUIDToAssetPath(guid);
                if (string.IsNullOrEmpty(p) || p.Contains("/Editor/")) continue;
                var m = BuildAssets.Load<Material>(p);
                if (!m || !m.shader) continue;
                var n = m.shader.name ?? "";
                if (n.StartsWith("Universal Render Pipeline/Lit") && !IsErrorShader(m.shader))
                    return m.shader;
            }
#endif
            return null;
        }

        public static void DressTextMesh(TextMesh tm)
        {
            if (!tm) return;
            EnsureShaders();
            var r = tm.GetComponent<MeshRenderer>() ?? tm.GetComponent<Renderer>();
            if (!r) return;
            var sh = _unlit != null ? _unlit : Shader.Find("Sprites/Default");
            if (!sh) return;
            var m = new Material(sh);
            var c = tm.color;
            if (m.HasProperty("_BaseColor")) m.SetColor("_BaseColor", c);
            if (m.HasProperty("_Color")) m.SetColor("_Color", c);
            m.color = c;
            r.sharedMaterial = m;
        }

        static string _boundHdr;

        static string HdrFile(WorldId world)
        {
            if (world == WorldId.Hub)
            {
                float s = Sun01(WorldClock.Hour);
                if (s < 0.18f) return "dikhololo_night_2k.hdr";
                if (s < 0.42f) return "the_sky_is_on_fire_2k.hdr";
                return "kloofendal_48d_partly_cloudy_puresky_2k.hdr";
            }
            return world switch
            {
                WorldId.Ruins => "kloppenheim_06_puresky_2k.hdr",
                WorldId.Crime => "dikhololo_night_2k.hdr",
                WorldId.Cyber => "dikhololo_night_2k.hdr",
                WorldId.Frontier => "industrial_sunset_puresky_2k.hdr",
                WorldId.Superhero => "industrial_sunset_puresky_2k.hdr",
                WorldId.Tunya => "kloofendal_48d_partly_cloudy_puresky_2k.hdr",
                WorldId.Fantasy => "venice_sunset_2k.hdr",
                WorldId.Crucible => "kloppenheim_06_puresky_2k.hdr",
                _ => "autumn_field_puresky_2k.hdr"
            };
        }

        static bool TryHdrSky(WorldId world)
        {
            var file = HdrFile(world);
            if (_boundHdr == file && RenderSettings.skybox && RenderSettings.skybox.name.StartsWith("PH_HDR_"))
            {
                if (world == WorldId.Hub) CourtWalkableHorizon.SoftenSkyband();
                return true;
            }

            const string root = "Assets/Concordia/PolyHaven/HDRIs/";
            var path = root + file;
            // Hub day exposure kept modest so Poly Haven painted peaks do not
            // overpower CourtWalkableHorizon mesh hills (double-horizon).
            float exposure = file.IndexOf("night", System.StringComparison.OrdinalIgnoreCase) >= 0 ? 0.42f
                : file.IndexOf("fire", System.StringComparison.OrdinalIgnoreCase) >= 0
                  || file.IndexOf("sunset", System.StringComparison.OrdinalIgnoreCase) >= 0 ? 0.55f
                : world == WorldId.Hub ? 0.56f : 0.62f;
            // HDRs in this project are imported as Cubemap (textureShape 2).
            // Skybox/Panoramic on a Cubemap is a white void. Use Cubemap shader
            // for cubes; Panoramic only when the asset is actually 2D lat-long.
            var cubemap = BuildAssets.Load<Cubemap>(path);
            var cubeSh = Shader.Find("Skybox/Cubemap");
            if (cubemap && cubeSh && !IsErrorShader(cubeSh))
            {
                var m = new Material(cubeSh);
                m.name = "PH_HDR_" + file;
                m.SetTexture("_Tex", cubemap);
                m.SetFloat("_Exposure", exposure);
                if (world == WorldId.Hub && m.HasProperty("_Tint"))
                    m.SetColor("_Tint", new Color(0.88f, 0.94f, 0.96f, 1f));
                RenderSettings.skybox = m;
                DynamicGI.UpdateEnvironment();
                _boundHdr = file;
                if (world == WorldId.Hub) CourtWalkableHorizon.SoftenSkyband();
                return true;
            }
            var tex2d = BuildAssets.Load<Texture2D>(path);
            var pano = Shader.Find("Skybox/Panoramic");
            if (tex2d && tex2d.dimension == TextureDimension.Tex2D && pano && !IsErrorShader(pano))
            {
                var m = new Material(pano);
                m.name = "PH_HDR_" + file;
                if (m.HasProperty("_MainTex")) m.SetTexture("_MainTex", tex2d);
                m.SetFloat("_Exposure", exposure);
                if (world == WorldId.Hub && m.HasProperty("_Tint"))
                    m.SetColor("_Tint", new Color(0.88f, 0.94f, 0.96f, 1f));
                RenderSettings.skybox = m;
                DynamicGI.UpdateEnvironment();
                _boundHdr = file;
                if (world == WorldId.Hub) CourtWalkableHorizon.SoftenSkyband();
                return true;
            }
            return false;
        }

        static Shader StealShader(PrimitiveType t)
        {
            var tmp = GameObject.CreatePrimitive(t);
            tmp.hideFlags = HideFlags.HideAndDontSave;
            var sh = tmp.GetComponent<Renderer>()?.sharedMaterial?.shader;
            Object.DestroyImmediate(tmp);
            return sh;
        }

        public static bool ApplySky(WorldId world)
        {
            if (TryHdrSky(world))
                return true;
            var sh = Shader.Find("Skybox/Procedural");
            if (sh)
            {
                var m = new Material(sh);
                m.SetFloat("_SunSize", world == WorldId.Hub ? 0.04f : 0.04f);
                m.SetFloat("_SunSizeConvergence", 6f);
                m.SetFloat("_AtmosphereThickness", world == WorldId.Hub ? 0.92f : 1.0f);
                m.SetFloat("_Exposure", world == WorldId.Hub ? 1.15f : 1.1f);
                var sky = world == WorldId.Hub ? new Color(0.52f, 0.62f, 0.78f)
                    : world == WorldId.Cyber ? new Color(0.12f, 0.04f, 0.22f)
                    : world == WorldId.Crime ? new Color(0.10f, 0.08f, 0.12f)
                    : world == WorldId.Frontier ? new Color(0.72f, 0.55f, 0.32f)
                    : new Color(0.28f, 0.38f, 0.55f);
                var ground = world == WorldId.Hub ? new Color(0.45f, 0.28f, 0.12f) : new Color(0.18f, 0.16f, 0.14f);
                m.SetColor("_SkyTint", sky);
                m.SetColor("_GroundColor", ground);
                RenderSettings.skybox = m;
                var suns = Object.FindObjectsByType<Light>(FindObjectsSortMode.None);
                for (int i = 0; i < suns.Length; i++)
                    if (suns[i] && suns[i].type == LightType.Directional) { RenderSettings.sun = suns[i]; break; }
                return false;
            }
            EnsureShaders();
            var fallback = new Material(_unlit != null ? _unlit : Shader.Find("Sprites/Default"));
            var top = world == WorldId.Hub ? new Color(0.48f, 0.62f, 0.82f) : new Color(0.12f, 0.14f, 0.22f);
            if (fallback.HasProperty("_BaseColor")) fallback.SetColor("_BaseColor", top);
            fallback.color = top;
            RenderSettings.skybox = fallback;
            return false;
        }

        // ---- Prop model substitution ----------------------------------------------------------
        // 53% of the world's renderers were Unity primitives (306 cubes, 77 quads, 26 spheres)
        // while 758 real CC0 models sat imported and unused. A textured cube is still a cube —
        // that, not lighting or materials, is what made the world read as a 2009 greybox.
        //
        // Prim() keeps building the primitive (so colliders, bounds and gameplay placement are
        // byte-for-byte unchanged) and then hides its RENDERER and parents a real model inside it,
        // fitted to the same footprint. Purely a visual upgrade; nothing gameplay-facing moves.
        //
        // Curated table, NO fuzzy fallback. Geometry is not like textures: a fuzzy "contains"
        // match happily resolves "bench" to "bench_vice_01_1k" (a workshop vice), and a confidently
        // wrong model looks worse than an honest primitive. Unmapped names keep their primitive.
        static readonly Dictionary<string, string> PropModels = new Dictionary<string, string>
        {
            { "barrel",   "barrel_01_1k" },
            { "crate",    "old_military_crate_1k" },
            { "chest",    "treasure_chest_1k" },
            { "lantern",  "lantern_01_1k" },
            { "lamp",     "wooden_lantern_01_1k" },
            { "statue",   "statue_block" },
            { "pot",      "ceramic_pot_1k" },
            { "vase",     "antique_ceramic_vase_01_1k" },
            { "fence",    "fence_bend" },
            { "bush",     "plant_bush" },
            { "tree",     "concordia_real_foresttree" },
            { "sword",    "cx_weapon_longsword" },
            { "shield",   "kite_shield_1k" },
            { "pillar",   "statue_column" },
            { "post",     "log_large" },
        };

        /// Confident semantic match only — returns null when we should keep the primitive.
        /// Token-bounded (incl. PascalCase): "Street" must NEVER match key "tree"
        /// (substring trap that hid every road cube under a forest-tree mesh).
        static string PropStemFor(string name)
        {
            if (string.IsNullOrEmpty(name)) return null;
            // Insert breaks before capitals: CourtTree → court_tree; Street stays street.
            var sb = new System.Text.StringBuilder(name.Length + 4);
            for (int i = 0; i < name.Length; i++)
            {
                char c = name[i];
                if (i > 0 && char.IsUpper(c) && char.IsLetter(name[i - 1]) && char.IsLower(name[i - 1]))
                    sb.Append('_');
                sb.Append(char.ToLowerInvariant(c));
            }
            var n = sb.ToString();
            var parts = n.Split(new[] { '_', '-', ' ', '.', '/', '(', ')' },
                System.StringSplitOptions.RemoveEmptyEntries);
            foreach (var kv in PropModels)
            {
                if (n == kv.Key) return kv.Value;
                if (n.StartsWith(kv.Key + "_", System.StringComparison.Ordinal) ||
                    n.StartsWith(kv.Key + "-", System.StringComparison.Ordinal))
                    return kv.Value;
                for (int i = 0; i < parts.Length; i++)
                    if (parts[i] == kv.Key) return kv.Value;
            }
            return null;
        }

        /// Ground / pavement primitives — never nest PropModels (roads must stay flat bands).
        public static GameObject PrimSurface(Transform parent, PrimitiveType t, Vector3 pos, Vector3 scale,
            Material mat, string n, bool collider = true)
        {
            var go = GameObject.CreatePrimitive(t);
            go.name = n;
            go.transform.SetParent(parent, false);
            go.transform.localPosition = pos;
            go.transform.localRotation = Quaternion.identity;
            go.transform.localScale = scale;
            Object.Destroy(go.GetComponent<Collider>());
            if (collider)
            {
                var box = go.AddComponent<BoxCollider>();
                if (t == PrimitiveType.Cylinder || t == PrimitiveType.Capsule)
                    box.size = new Vector3(1f, 2f, 1f);
                else
                    box.size = Vector3.one;
            }
            var r = go.GetComponent<Renderer>();
            if (r && mat) r.sharedMaterial = mat;
            if (r && mat && (t == PrimitiveType.Cube || t == PrimitiveType.Cylinder)) WorldTile(r, mat, scale);
            return go;
        }

        /// Pbr materials are cached and shared, with a fixed repeat count per face,
        /// so a 40 m x 3.6 m road deck got the same repeats both ways — the texture
        /// stretched ~11x along the street (the streaked "planks" on the Court).
        /// Give each cube surface tiling proportional to its real size instead:
        /// the material's tile counts as repeats per 8 m, so texels stay square.
        /// A Cube's top face and a Cylinder's caps map U to local X and V to local Z.
        static void WorldTile(Renderer r, Material mat, Vector3 scale)
        {
            if (!mat.HasProperty("_BaseMap") || !mat.GetTexture("_BaseMap")) return;
            float perMeter = mat.GetTextureScale("_BaseMap").x / 8f;
            if (perMeter <= 0f) return;
            var mpb = new MaterialPropertyBlock();
            r.GetPropertyBlock(mpb);
            mpb.SetVector("_BaseMap_ST", new Vector4(
                Mathf.Max(0.25f, Mathf.Abs(scale.x) * perMeter),
                Mathf.Max(0.25f, Mathf.Abs(scale.z) * perMeter), 0f, 0f));
            r.SetPropertyBlock(mpb);
        }

        /// Hides the primitive's renderer and nests a real model scaled into its footprint.
        static void DressWithModel(GameObject prim, string semanticName, Vector3 footprint)
        {
            var stem = PropStemFor(semanticName);
            if (string.IsNullOrEmpty(stem)) return;

            var prefab = FreePacks.Mesh(stem);
            if (!prefab) return;                       // kit miss — keep the honest primitive

            var model = Object.Instantiate(prefab, prim.transform);
            model.name = "Model_" + stem;
            model.transform.localPosition = Vector3.zero;
            model.transform.localRotation = Quaternion.identity;

            // Fit the model into the primitive's footprint. The parent's own localScale already
            // applies, so measure in the model's local space and divide it back out.
            var rends = model.GetComponentsInChildren<Renderer>(true);
            if (rends.Length == 0) { Object.Destroy(model); return; }

            var b = rends[0].bounds;
            for (int i = 1; i < rends.Length; i++) b.Encapsulate(rends[i].bounds);
            var size = b.size;
            float largest = Mathf.Max(size.x, Mathf.Max(size.y, size.z));
            if (largest <= 0.0001f) { Object.Destroy(model); return; }

            float target = Mathf.Max(footprint.x, Mathf.Max(footprint.y, footprint.z));
            float k = target / largest;
            // Divide out the parent scale so the fit is absolute, not compounded.
            model.transform.localScale = new Vector3(
                Mathf.Approximately(footprint.x, 0f) ? k : k / Mathf.Max(0.0001f, footprint.x),
                Mathf.Approximately(footprint.y, 0f) ? k : k / Mathf.Max(0.0001f, footprint.y),
                Mathf.Approximately(footprint.z, 0f) ? k : k / Mathf.Max(0.0001f, footprint.z));

            foreach (var c in model.GetComponentsInChildren<Collider>(true)) Object.Destroy(c);

            var primRend = prim.GetComponent<Renderer>();
            if (primRend) primRend.enabled = false;    // keep collider + bounds, drop the cube look

            FreePacks.PaintIfBlank(model);
        }

        public static GameObject Prim(Transform parent, PrimitiveType t, Vector3 pos, Vector3 scale, Material mat, string n, bool collider = true)
        {
            var go = GameObject.CreatePrimitive(t);
            go.name = n;
            go.transform.SetParent(parent, false);
            go.transform.localPosition = pos;
            go.transform.localRotation = Quaternion.identity;
            go.transform.localScale = scale;
            Object.Destroy(go.GetComponent<Collider>());
            if (collider)
            {
                var box = go.AddComponent<BoxCollider>();
                if (t == PrimitiveType.Cylinder || t == PrimitiveType.Capsule)
                    box.size = new Vector3(1f, 2f, 1f);
                else
                    box.size = Vector3.one;
            }
            var r = go.GetComponent<Renderer>();
            if (r && mat) r.sharedMaterial = mat;
            DressWithModel(go, n, scale);
            return go;
        }

        static bool ShaderNeedsUrp(Shader sh)
        {
            if (!sh) return true;
            var n = sh.name ?? "";
            if (n.StartsWith("Universal Render Pipeline/")) return false;
            if (n.StartsWith("Skybox/")) return false;
            if (n.StartsWith("Sprites/")) return false;
            if (n.StartsWith("Hidden/") && n.IndexOf("Error", System.StringComparison.OrdinalIgnoreCase) < 0) return false;
            if (n.StartsWith("TextMeshPro")) return false;
            if (n.StartsWith("Shader Graphs/")) return true;
            return true;
        }

        static readonly Dictionary<Material, Material> _urpUpgradeCache = new Dictionary<Material, Material>();

        /// Converts one built-in-pipeline material to URP Lit, preserving albedo/normal/colour and
        /// metallic-smoothness. Shared by the global sweep and the per-object path so the two can
        /// never diverge. Cached per source material — the same source converts once.
        static Material ConvertToUrp(Material src)
        {
            if (_urpUpgradeCache.TryGetValue(src, out var hit) && hit) return hit;

            var dst = new Material(_lit);
            var col = FirstColor(src, Color.white);
            if (dst.HasProperty("_BaseColor")) dst.SetColor("_BaseColor", col);
            dst.color = col;

            var tex = FirstAlbedo(src);
            if (tex)
            {
                if (dst.HasProperty("_BaseMap")) dst.SetTexture("_BaseMap", tex);
                if (dst.HasProperty("_MainTex")) dst.SetTexture("_MainTex", tex);
            }
            var nrm = FirstNormal(src);
            if (nrm)
            {
                if (dst.HasProperty("_BumpMap")) dst.SetTexture("_BumpMap", nrm);
                dst.EnableKeyword("_NORMALMAP");
            }
            if (src.HasProperty("_Metallic") && dst.HasProperty("_Metallic"))
                dst.SetFloat("_Metallic", src.GetFloat("_Metallic"));
            else if (src.HasProperty("metallicFactor") && dst.HasProperty("_Metallic"))
                dst.SetFloat("_Metallic", src.GetFloat("metallicFactor"));
            else if (dst.HasProperty("_Metallic"))
                dst.SetFloat("_Metallic", 0.04f);

            if (src.HasProperty("_Glossiness") && dst.HasProperty("_Smoothness"))
                dst.SetFloat("_Smoothness", src.GetFloat("_Glossiness"));
            else if (src.HasProperty("_Smoothness") && dst.HasProperty("_Smoothness"))
                dst.SetFloat("_Smoothness", src.GetFloat("_Smoothness"));
            else if (dst.HasProperty("_Smoothness"))
                dst.SetFloat("_Smoothness", 0.22f);

            _urpUpgradeCache[src] = dst;
            return dst;
        }

        /// Per-object Standard->URP upgrade.
        ///
        /// UpgradeStandardMaterials() below is a ONE-SHOT scene sweep run at boot (ConcordiaGame,
        /// WorldBuilder). Anything streamed in afterwards — the Megaworld content: rock_smallA,
        /// tent_detailedOpen, statue, trophy, crops_wheatStageB — kept its built-in `Standard`
        /// shader, which URP cannot render, so it drew MAGENTA in the live Hub despite the boot
        /// sweep having "already handled it". This is the same fix applied at spawn time instead.
        public static int UpgradeStandardOn(GameObject go)
        {
            if (!go) return 0;
            EnsureShaders();
            if (_lit == null) return 0;

            int n = 0;
            foreach (var r in go.GetComponentsInChildren<Renderer>(true))
            {
                if (!r) continue;
                var slots = r.sharedMaterials;
                if (slots == null || slots.Length == 0) continue;

                var next = new Material[slots.Length];
                bool any = false;
                for (int s = 0; s < slots.Length; s++)
                {
                    var src = slots[s];
                    if (src == null || !ShaderNeedsUrp(src.shader)) { next[s] = src; continue; }
                    next[s] = ConvertToUrp(src);
                    any = true;
                    n++;
                }
                if (any) r.sharedMaterials = next;
            }
            return n;
        }

        public static int UpgradeStandardMaterials()
        {
            EnsureShaders();
            if (_lit == null) return 0;
            var cache = new System.Collections.Generic.Dictionary<Material, Material>();
            int n = 0;
            var rs = Object.FindObjectsByType<Renderer>(FindObjectsInactive.Exclude, FindObjectsSortMode.None);
            for (int i = 0; i < rs.Length; i++)
            {
                if (rs[i].GetComponent<TextMesh>())
                {
                    DressTextMesh(rs[i].GetComponent<TextMesh>());
                    n++;
                    continue;
                }
                var slots = rs[i].sharedMaterials;
                if (slots == null || slots.Length == 0) continue;
                var next = new Material[slots.Length];
                bool any = false;
                for (int s = 0; s < slots.Length; s++)
                {
                    var src = slots[s];
                    if (src == null || !ShaderNeedsUrp(src.shader))
                    {
                        next[s] = src;
                        continue;
                    }
                    if (!cache.TryGetValue(src, out var dst))
                    {
                        dst = new Material(_lit);
                        var col = FirstColor(src, Color.white);
                        if (dst.HasProperty("_BaseColor")) dst.SetColor("_BaseColor", col);
                        dst.color = col;
                        var tex = FirstAlbedo(src);
                        if (tex)
                        {
                            if (dst.HasProperty("_BaseMap")) dst.SetTexture("_BaseMap", tex);
                            if (dst.HasProperty("_MainTex")) dst.SetTexture("_MainTex", tex);
                        }
                        var nrm = FirstNormal(src);
                        if (nrm)
                        {
                            if (dst.HasProperty("_BumpMap")) dst.SetTexture("_BumpMap", nrm);
                            dst.EnableKeyword("_NORMALMAP");
                        }
                        if (src.HasProperty("_Metallic") && dst.HasProperty("_Metallic"))
                            dst.SetFloat("_Metallic", src.GetFloat("_Metallic"));
                        else if (src.HasProperty("metallicFactor") && dst.HasProperty("_Metallic"))
                            dst.SetFloat("_Metallic", src.GetFloat("metallicFactor"));
                        else if (dst.HasProperty("_Metallic"))
                            dst.SetFloat("_Metallic", 0.04f);
                        if (src.HasProperty("_Glossiness") && dst.HasProperty("_Smoothness"))
                            dst.SetFloat("_Smoothness", src.GetFloat("_Glossiness"));
                        else if (src.HasProperty("_Smoothness") && dst.HasProperty("_Smoothness"))
                            dst.SetFloat("_Smoothness", src.GetFloat("_Smoothness"));
                        else if (dst.HasProperty("_Smoothness"))
                            dst.SetFloat("_Smoothness", 0.22f);
                        cache[src] = dst;
                    }
                    next[s] = dst;
                    any = true;
                    n++;
                }
                if (any) rs[i].sharedMaterials = next;
            }
            return n;
        }

        public static Texture2D SoftRay()
        {
            var tex = new Texture2D(32, 256, TextureFormat.RGBA32, false);
            tex.wrapMode = TextureWrapMode.Clamp;
            for (int y = 0; y < 256; y++)
            for (int x = 0; x < 32; x++)
            {
                float v = y / 255f;
                float u = Mathf.Abs(x / 31f - 0.5f) * 2f;
                float a = (1f - u * u) * (1f - v) * (1f - v) * 0.55f;
                tex.SetPixel(x, y, new Color(1f, 0.92f, 0.72f, a));
            }
            tex.Apply();
            return tex;
        }
    }
}
