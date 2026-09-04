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
                cam.farClipPlane = world == WorldId.Hub ? 420f : 280f;
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
            FreePacks.Spawn("lantern", parent, pos, 0, 1.35f);
            var bulb = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            bulb.name = "LanternGlow";
            bulb.transform.SetParent(parent, false);
            bulb.transform.position = pos + Vector3.up * 1.65f;
            bulb.transform.localScale = Vector3.one * 0.18f;
            Object.Destroy(bulb.GetComponent<Collider>());
            bulb.GetComponent<Renderer>().sharedMaterial = Emit(new Color(1f, 0.72f, 0.38f), 3.5f);
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
            return src.color.a > 0.01f ? src.color : fallback;
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

        public static Material Pbr(string stem, Color tint, float metallic = 0.08f, float smooth = 0.28f, float tile = 8f)
        {
            var m = Lit(tint, metallic, smooth);
            var diff = LoadPbrTex(stem + "_diff_2k.jpg") ?? LoadPbrTex(stem + "_diff_2k");
            var nrm = LoadPbrTex(stem + "_nor_gl_2k.jpg") ?? LoadPbrTex(stem + "_nor_gl_2k");
            var rough = LoadPbrTex(stem + "_rough_2k.jpg") ?? LoadPbrTex(stem + "_rough_2k");
            if (diff)
            {
                if (m.HasProperty("_BaseMap")) m.SetTexture("_BaseMap", diff);
                if (m.HasProperty("_MainTex")) m.SetTexture("_MainTex", diff);
                m.SetTextureScale("_BaseMap", Vector2.one * tile);
                m.SetTextureScale("_MainTex", Vector2.one * tile);
            }
            if (nrm)
            {
                if (m.HasProperty("_BumpMap")) m.SetTexture("_BumpMap", nrm);
                m.EnableKeyword("_NORMALMAP");
                m.SetTextureScale("_BumpMap", Vector2.one * tile);
                if (m.HasProperty("_BumpScale")) m.SetFloat("_BumpScale", 1.35f);
            }
            if (rough && m.HasProperty("_Smoothness"))
                m.SetFloat("_Smoothness", Mathf.Min(smooth, 0.22f));
            return m;
        }

        static Texture LoadPbrTex(string file)
        {
#if UNITY_EDITOR
            return AssetDatabase.LoadAssetAtPath<Texture>("Assets/Concordia/Models/polyhaven/" + file);
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
