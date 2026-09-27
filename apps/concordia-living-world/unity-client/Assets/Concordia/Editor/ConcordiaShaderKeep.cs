using System.IO;
using UnityEditor;
using UnityEngine;

namespace Concordia.Editor
{
    /// <summary>
    /// The Hub is built in code: HubLook and friends create materials at runtime
    /// with Shader.Find("Universal Render Pipeline/Lit") and similar. A player
    /// build only ships a shader when some included asset references it, and no
    /// material asset referenced these — so the WebGL build (2026-09-27) shipped
    /// without URP Lit/Unlit and the whole Hub rendered magenta.
    ///
    /// This writes one "keeper" material per shader (and per runtime keyword
    /// combination the code enables) under Resources/, which is always included,
    /// so the shaders and those variants survive stripping. Idempotent; run by
    /// both exports. Add a row when code starts using a new shader or keyword.
    /// </summary>
    public static class ConcordiaShaderKeep
    {
        const string Folder = "Assets/Concordia/Resources/Concordia/ShaderKeep";

        struct Keep
        {
            public string file, shader;
            public string[] keywords;
            public bool transparent;
            public Keep(string file, string shader, bool transparent = false, params string[] keywords)
            { this.file = file; this.shader = shader; this.transparent = transparent; this.keywords = keywords; }
        }

        static readonly Keep[] Keeps =
        {
            new Keep("urp_lit", "Universal Render Pipeline/Lit"),
            new Keep("urp_lit_normal", "Universal Render Pipeline/Lit", false, "_NORMALMAP"),
            new Keep("urp_lit_emission", "Universal Render Pipeline/Lit", false, "_EMISSION"),
            new Keep("urp_lit_alphatest", "Universal Render Pipeline/Lit", false, "_ALPHATEST_ON"),
            new Keep("urp_lit_full", "Universal Render Pipeline/Lit", false, "_NORMALMAP", "_OCCLUSIONMAP", "_METALLICSPECGLOSSMAP", "_EMISSION"),
            new Keep("urp_lit_transparent", "Universal Render Pipeline/Lit", true),
            new Keep("urp_simplelit", "Universal Render Pipeline/Simple Lit"),
            new Keep("urp_unlit", "Universal Render Pipeline/Unlit"),
            new Keep("urp_unlit_transparent", "Universal Render Pipeline/Unlit", true),
            new Keep("urp_unlit_alphatest", "Universal Render Pipeline/Unlit", false, "_ALPHATEST_ON"),
            new Keep("urp_particles_unlit", "Universal Render Pipeline/Particles/Unlit"),
            new Keep("urp_particles_unlit_transparent", "Universal Render Pipeline/Particles/Unlit", true),
            new Keep("sprites_default", "Sprites/Default"),
            new Keep("unlit_color", "Unlit/Color"),
            new Keep("skybox_procedural", "Skybox/Procedural"),
            new Keep("skybox_panoramic", "Skybox/Panoramic"),
            new Keep("skybox_cubemap", "Skybox/Cubemap"),
            new Keep("concordia_volumefog", "Hidden/Concordia/VolumeFog"),
            new Keep("concordia_armrepack", "Hidden/Concordia/ArmRepack"),
            // HubKit imports every kit model (creatures, props, people) with glTFast,
            // which assigns its own Shader Graph materials — missing from builds, so
            // creatures rendered magenta in WebGL (2026-09-27).
            new Keep("gltf_pbr", "Shader Graphs/glTF-pbrMetallicRoughness"),
            new Keep("gltf_pbr_alphatest", "Shader Graphs/glTF-pbrMetallicRoughness", false, "_ALPHATEST_ON"),
            new Keep("gltf_pbr_transparent", "Shader Graphs/glTF-pbrMetallicRoughness", true),
            new Keep("gltf_unlit", "Shader Graphs/glTF-unlit"),
            new Keep("gltf_unlit_transparent", "Shader Graphs/glTF-unlit", true),
        };

        [MenuItem("Concordia/Ensure Shader Keepers")]
        public static void Ensure()
        {
            Directory.CreateDirectory(Folder);
            int made = 0, missing = 0;
            foreach (var k in Keeps)
            {
                var sh = Shader.Find(k.shader);
                if (!sh) { Debug.LogWarning("[ShaderKeep] shader not found in project: " + k.shader); missing++; continue; }
                var path = Folder + "/" + k.file + ".mat";
                var m = AssetDatabase.LoadAssetAtPath<Material>(path);
                if (!m) { m = new Material(sh); AssetDatabase.CreateAsset(m, path); made++; }
                m.shader = sh;
                if (k.transparent)
                {
                    if (m.HasProperty("_Surface")) m.SetFloat("_Surface", 1f);
                    if (m.HasProperty("_Blend")) m.SetFloat("_Blend", 0f);
                    m.SetOverrideTag("RenderType", "Transparent");
                    m.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
                    m.EnableKeyword("_ALPHABLEND_ON");
                    m.renderQueue = 3000;
                }
                foreach (var kw in k.keywords) m.EnableKeyword(kw);
                EditorUtility.SetDirty(m);
            }
            AssetDatabase.SaveAssets();
            Debug.Log($"[ShaderKeep] {Keeps.Length - missing} keeper materials ensured ({made} new, {missing} shaders missing) in {Folder}");
        }
    }
}
