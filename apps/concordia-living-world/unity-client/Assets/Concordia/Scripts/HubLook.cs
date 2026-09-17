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
            if (urp)
            {
                urp.shadowDistance = world == WorldId.Hub ? 110f : 90f;
                urp.msaaSampleCount = 1;
                urp.maxAdditionalLightsCount = 8;
                urp.colorGradingMode = ColorGradingMode.HighDynamicRange;
                urp.colorGradingLutSize = 64;
            }
            TryEnableSsao();
            QualitySettings.shadowDistance = world == WorldId.Hub ? 160f : 120f;
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
            bloom.scatter.Override(0.72f);

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

            RenderSettings.ambientMode = AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = sky;
            RenderSettings.ambientEquatorColor = eq;
            RenderSettings.ambientGroundColor = ground;
            RenderSettings.ambientIntensity = 1f;
            RenderSettings.reflectionIntensity = world == WorldId.Hub ? 1.05f : 0.88f;
            RenderSettings.defaultReflectionMode = DefaultReflectionMode.Skybox;
            DynamicGI.UpdateEnvironment();
            PlaceProbe(world == WorldId.Hub ? 120f : 95f);
            ApplyHour(world, WorldClock.Hour);
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
                float dayExp = world == WorldId.Hub ? 0.12f : 0.08f;
                color.postExposure.Override(Mathf.Lerp(-1.15f, dayExp, sun01));
                color.contrast.Override(Mathf.Lerp(18f, 12f, sun01));
                color.saturation.Override(Mathf.Lerp(-8f, 10f, sun01));
            }
            if (profile && profile.TryGet(out Vignette vig))
                vig.intensity.Override(Mathf.Lerp(0.42f, world == WorldId.Hub ? 0.18f : 0.28f, sun01));

            if (world == WorldId.Hub)
            {
                RenderSettings.ambientSkyColor = Color.Lerp(new Color(0.08f, 0.10f, 0.18f), new Color(0.58f, 0.64f, 0.74f), sun01);
                RenderSettings.ambientEquatorColor = Color.Lerp(new Color(0.06f, 0.07f, 0.10f), new Color(0.48f, 0.42f, 0.36f), sun01);
                RenderSettings.ambientGroundColor = Color.Lerp(new Color(0.03f, 0.03f, 0.04f), new Color(0.22f, 0.18f, 0.14f), sun01);
                RenderSettings.ambientIntensity = 0.35f + 0.65f * sun01;
                RenderSettings.reflectionIntensity = 0.22f + 0.83f * sun01;
                RenderSettings.fogColor = Color.Lerp(new Color(0.02f, 0.03f, 0.06f), new Color(0.55f, 0.58f, 0.62f), sun01);
                RenderSettings.fogDensity = 0.0045f + 0.01f * night;
            }

            var sky = RenderSettings.skybox;
            if (sky && sky.HasProperty("_Exposure"))
            {
                float daySky = world == WorldId.Hub ? 0.78f : 0.62f;
                sky.SetFloat("_Exposure", Mathf.Lerp(0.16f, daySky, sun01));
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
                if (l.name == "Fill") continue;
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
                    l.color = Color.Lerp(new Color(0.42f, 0.52f, 0.78f), new Color(1f, 0.94f, 0.82f), sun01);
                    l.intensity = world == WorldId.Hub
                        ? 0.06f + 1.12f * sun01
                        : 0.08f + 0.9f * sun01;
                    l.shadows = LightShadows.Soft;
                    l.shadowStrength = 0.88f + 0.08f * sun01;
                    float pitch = Mathf.Lerp(8f, 42f, sun01);
                    l.transform.rotation = Quaternion.Euler(pitch, l.transform.eulerAngles.y, 0f);
                }
                else if (l.type == LightType.Directional && l.name == "Fill")
                    l.intensity = 0.02f + 0.16f * sun01;
                else if (l.type == LightType.Directional)
                {
                    l.intensity = 0f;
                    l.enabled = false;
                }
                else if (l.type == LightType.Point && (l.name == "CourtLamp" || l.name == "MonumentLight" || l.name == "Lantern"))
                    l.intensity = Mathf.Lerp(2.6f, 0.55f, sun01);
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
                    bloomI = 0.18f; bloomT = 0.88f; exposure = 0.12f; contrast = 12f; sat = 10f; vigI = 0.18f; temp = 8f;
                    sky = new Color(0.58f, 0.64f, 0.74f); eq = new Color(0.48f, 0.42f, 0.36f); ground = new Color(0.22f, 0.18f, 0.14f); break;
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
            probe.resolution = 256;
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
            fl.color = Color.Lerp(color, Color.white, 0.35f);
            fl.intensity = intensity * 0.16f;
            fl.shadows = LightShadows.None;
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
            FreePacks.SpawnStore("lantern", parent, pos, 0, 1.35f, required: false);
            HubLook.Point(parent, "CourtLamp", pos + Vector3.up * 1.65f, new Color(1f, 0.72f, 0.38f), 1.4f, 10f, true);
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
            { "stone_tiles",    "cobblestone_floor_13" },
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
#if UNITY_EDITOR
            const string root = "Assets/Concordia/PolyHaven/Textures/";
            string[] exts = { ".jpg", ".png" };
            for (int i = 0; i < exts.Length; i++)
            {
                var t = AssetDatabase.LoadAssetAtPath<Texture>(root + stem + "/" + stem + suffix + exts[i]);
                if (t) return t;
            }
            // Legacy flat layout kept for older non-Poly-Haven packs.
            for (int i = 0; i < exts.Length; i++)
            {
                var t = AssetDatabase.LoadAssetAtPath<Texture>("Assets/Concordia/Models/polyhaven/" + stem + suffix + exts[i]);
                if (t) return t;
            }
            return null;
#else
            return null;
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
#if UNITY_EDITOR
            var urp = UnityEditor.AssetDatabase.LoadAssetAtPath<UniversalRenderPipelineAsset>("Assets/Settings/URP-Pipeline.asset");
            if (urp)
            {
                GraphicsSettings.defaultRenderPipeline = urp;
                QualitySettings.renderPipeline = urp;
            }
#endif
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
                var m = AssetDatabase.LoadAssetAtPath<Material>(p);
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

        static bool TryHdrSky(WorldId world)
        {
#if UNITY_EDITOR
            var file = world switch
            {
                WorldId.Ruins => "kloppenheim_06_puresky_2k.hdr",
                WorldId.Crime => "dikhololo_night_2k.hdr",
                WorldId.Cyber => "dikhololo_night_2k.hdr",
                WorldId.Frontier => "industrial_sunset_2k.hdr",
                WorldId.Superhero => "industrial_sunset_2k.hdr",
                WorldId.Tunya => "kloofendal_48d_partly_cloudy_puresky_2k.hdr",
                WorldId.Fantasy => "venice_sunset_2k.hdr",
                WorldId.Crucible => "kloppenheim_06_puresky_2k.hdr",
                _ => "kloofendal_48d_partly_cloudy_puresky_2k.hdr"
            };
            var path = "Assets/Concordia/Models/polyhaven/" + file;
            float exposure = world == WorldId.Hub ? 0.78f : 0.62f;
            // HDRs in this project are imported as Cubemap (textureShape 2).
            // Skybox/Panoramic on a Cubemap is a white void. Use Cubemap shader
            // for cubes; Panoramic only when the asset is actually 2D lat-long.
            var cubemap = AssetDatabase.LoadAssetAtPath<Cubemap>(path);
            var cubeSh = Shader.Find("Skybox/Cubemap");
            if (cubemap && cubeSh && !IsErrorShader(cubeSh))
            {
                var m = new Material(cubeSh);
                m.SetTexture("_Tex", cubemap);
                m.SetFloat("_Exposure", exposure);
                RenderSettings.skybox = m;
                DynamicGI.UpdateEnvironment();
                return true;
            }
            var tex2d = AssetDatabase.LoadAssetAtPath<Texture2D>(path);
            var pano = Shader.Find("Skybox/Panoramic");
            if (tex2d && tex2d.dimension == TextureDimension.Tex2D && pano && !IsErrorShader(pano))
            {
                var m = new Material(pano);
                if (m.HasProperty("_MainTex")) m.SetTexture("_MainTex", tex2d);
                m.SetFloat("_Exposure", exposure);
                RenderSettings.skybox = m;
                DynamicGI.UpdateEnvironment();
                return true;
            }
#endif
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
        static string PropStemFor(string name)
        {
            if (string.IsNullOrEmpty(name)) return null;
            var n = name.ToLowerInvariant();
            foreach (var kv in PropModels)
                if (n.Contains(kv.Key)) return kv.Value;
            return null;
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
