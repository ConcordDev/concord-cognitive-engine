// Concordia — Poly Haven texture pipeline.
//
// Three stacked defects made the imported CC0 kit render as greybox:
//   1. HubLook.Pbr looked for "<stem>_diff_2k"; Poly Haven ships "<stem>_diffuse_2k"
//      -> albedo resolved to null on every PBR material (0 files matched, 790 exist).
//   2. "_nor_gl" maps imported as TextureImporterType.Default, so Unity never decoded
//      them as normals.
//   3. "_arm" (AO/Roughness/Metallic) imported as sRGB, gamma-corrupting linear data.
//
// The postprocessor fixes (2) and (3) for every future pull; FixExisting() repairs
// what is already on disk, in bounded batches (the box this runs on is RAM-tight).

using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

namespace Concordia.EditorTools
{
    public static class PolyHavenPipeline
    {
        public const string TextureRoot = "Assets/Concordia/PolyHaven/Textures";

        /// Linear (non-color) suffixes. Poly Haven packs ARM as R=AO, G=Roughness, B=Metallic.
        static readonly string[] LinearSuffixes = { "_arm_", "_displacement_", "_rough_", "_metal_", "_ao_" };
        static readonly string[] NormalSuffixes = { "_nor_gl_", "_nor_dx_", "_normal_" };

        public static bool IsNormal(string path) => HasSuffix(path, NormalSuffixes);
        public static bool IsLinear(string path) => HasSuffix(path, LinearSuffixes);

        static bool HasSuffix(string path, string[] suffixes)
        {
            if (string.IsNullOrEmpty(path)) return false;
            var f = System.IO.Path.GetFileName(path);
            for (int i = 0; i < suffixes.Length; i++)
                if (f.IndexOf(suffixes[i], System.StringComparison.OrdinalIgnoreCase) >= 0) return true;
            return false;
        }

        /// Returns true when the importer had to change. Shared by the postprocessor and the repair pass
        /// so both paths can never drift apart.
        public static bool ApplyCorrectSettings(TextureImporter ti)
        {
            if (ti == null) return false;
            bool changed = false;

            if (IsNormal(ti.assetPath))
            {
                if (ti.textureType != TextureImporterType.NormalMap)
                {
                    ti.textureType = TextureImporterType.NormalMap;
                    changed = true;
                }
            }
            else if (IsLinear(ti.assetPath))
            {
                if (ti.textureType != TextureImporterType.Default) { ti.textureType = TextureImporterType.Default; changed = true; }
                if (ti.sRGBTexture) { ti.sRGBTexture = false; changed = true; }
            }

            return changed;
        }

        [MenuItem("Concordia/Poly Haven/Fix Texture Import Settings (batch of 300)")]
        public static void FixExistingBatch() => FixExisting(300);

        /// Repairs already-imported textures. `limit` bounds how many reimports we trigger in one
        /// pass — a full 1,500-texture reimport is heavy and this box has run out of RAM before.
        /// Returns how many were fixed; call repeatedly until it returns 0.
        public static int FixExisting(int limit = 300)
        {
            var guids = AssetDatabase.FindAssets("t:Texture2D", new[] { TextureRoot });
            int fixedCount = 0;

            try
            {
                AssetDatabase.StartAssetEditing();
                foreach (var guid in guids)
                {
                    if (fixedCount >= limit) break;
                    var path = AssetDatabase.GUIDToAssetPath(guid);
                    if (!IsNormal(path) && !IsLinear(path)) continue;

                    var ti = AssetImporter.GetAtPath(path) as TextureImporter;
                    if (ti == null) continue;
                    if (!ApplyCorrectSettings(ti)) continue;

                    EditorUtility.SetDirty(ti);
                    ti.SaveAndReimport();
                    fixedCount++;
                }
            }
            finally
            {
                AssetDatabase.StopAssetEditing();
            }

            Debug.Log($"[PolyHaven] import settings fixed: {fixedCount} (limit {limit})");
            return fixedCount;
        }

        /// Counts what still needs repair, without touching anything.
        public static int CountPending()
        {
            var guids = AssetDatabase.FindAssets("t:Texture2D", new[] { TextureRoot });
            int pending = 0;
            foreach (var guid in guids)
            {
                var path = AssetDatabase.GUIDToAssetPath(guid);
                if (!IsNormal(path) && !IsLinear(path)) continue;
                var ti = AssetImporter.GetAtPath(path) as TextureImporter;
                if (ti == null) continue;

                if (IsNormal(path) && ti.textureType != TextureImporterType.NormalMap) { pending++; continue; }
                if (IsLinear(path) && ti.sRGBTexture) pending++;
            }
            return pending;
        }

        /// Every texture-set stem that has at least a diffuse map, e.g. "aerial_asphalt_01".
        public static List<string> ListStems()
        {
            var stems = new List<string>();
            var guids = AssetDatabase.FindAssets("t:Texture2D", new[] { TextureRoot });
            foreach (var guid in guids)
            {
                var path = AssetDatabase.GUIDToAssetPath(guid);
                var file = System.IO.Path.GetFileNameWithoutExtension(path);
                int idx = file.IndexOf("_diffuse_", System.StringComparison.OrdinalIgnoreCase);
                if (idx > 0) stems.Add(file.Substring(0, idx));
            }
            stems.Sort();
            return stems;
        }
    }

    /// Applies correct settings at import time so a future Poly Haven pull is never wrong again.
    public sealed class PolyHavenTexturePostprocessor : AssetPostprocessor
    {
        void OnPreprocessTexture()
        {
            if (assetPath == null) return;
            if (assetPath.IndexOf("PolyHaven", System.StringComparison.OrdinalIgnoreCase) < 0) return;
            PolyHavenPipeline.ApplyCorrectSettings(assetImporter as TextureImporter);
        }
    }
}
