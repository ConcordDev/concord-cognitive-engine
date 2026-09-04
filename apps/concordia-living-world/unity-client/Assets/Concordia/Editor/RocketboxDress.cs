#if UNITY_EDITOR
using UnityEditor;
using UnityEngine;

namespace Concordia.Editor
{
    /// <summary>
    /// Rocketbox FBX ships textures in a sibling folder. Bind them on import
    /// so play-mode isn't a white/magenta mannequin.
    /// </summary>
    public class RocketboxDress : AssetPostprocessor
    {
        void OnPostprocessModel(GameObject g)
        {
            if (assetPath == null || assetPath.IndexOf("/rocketbox/") < 0) return;
            if (assetPath.IndexOf("_facial") >= 0) return;
            var dir = System.IO.Path.GetDirectoryName(assetPath).Replace("\\", "/") + "/Textures";
            if (!AssetDatabase.IsValidFolder(dir)) return;
            Texture2D bodyC = null, bodyN = null, headC = null, headN = null, opac = null;
            foreach (var guid in AssetDatabase.FindAssets("t:Texture", new[] { dir }))
            {
                var p = AssetDatabase.GUIDToAssetPath(guid);
                var fn = System.IO.Path.GetFileName(p).ToLowerInvariant();
                var t = AssetDatabase.LoadAssetAtPath<Texture2D>(p);
                if (!t) continue;
                if (fn.Contains("opacity")) opac = t;
                else if (fn.Contains("head") && fn.Contains("normal") && !fn.Contains("wrinkle")) headN = t;
                else if (fn.Contains("head") && fn.Contains("color")) headC = t;
                else if (fn.Contains("body") && fn.Contains("normal")) bodyN = t;
                else if (fn.Contains("body") && fn.Contains("color")) bodyC = t;
            }
            var lit = Shader.Find("Universal Render Pipeline/Lit");
            if (!lit) return;
            foreach (var r in g.GetComponentsInChildren<Renderer>(true))
            {
                var n = r.gameObject.name.ToLowerInvariant();
                bool isOp = n.Contains("opacity") || n.Contains("hair");
                bool isHead = n.Contains("head") || n.Contains("face");
                var albedo = isOp ? (opac ? opac : headC) : isHead ? headC : bodyC;
                var nrm = isHead ? headN : bodyN;
                if (!albedo) albedo = bodyC;
                if (!albedo) continue;
                var m = new Material(lit);
                m.SetColor("_BaseColor", Color.white);
                m.SetTexture("_BaseMap", albedo);
                m.SetFloat("_Smoothness", 0.3f);
                if (nrm)
                {
                    m.SetTexture("_BumpMap", nrm);
                    m.EnableKeyword("_NORMALMAP");
                }
                r.sharedMaterial = m;
            }
        }
    }
}
#endif
