using System;
using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// Lightweight authored water evidence for geography places tagged as river,
    /// lake, coast, harbor, delta, flood, or water. It is presentation-only and
    /// reconstructs from WorldGeography rather than creating gameplay state.
    /// </summary>
    public static class WorldWaterSurface
    {
        const string WaterMaterialPath = "Assets/Concordia/Materials/Masters/Concordia_Master_WaterPuddle.mat";

        public static void Build(Transform visualRoot, WorldId world)
        {
            if (!visualRoot) return;
            var existing = visualRoot.Find("WaterSurfaces");
            if (existing) return;

            var material = FreePacks.Load<Material>(WaterMaterialPath);
            if (!material)
            {
                Debug.LogWarning("[Concordia] WaterSurface skipped; material unavailable at " + WaterMaterialPath);
                return;
            }

            var places = WorldGeography.Places(world);
            Transform holder = null;
            for (var i = 0; i < places.Count; i++)
            {
                var place = places[i];
                if (place == null || !IsWater(place.kind)) continue;
                if (holder == null)
                {
                    holder = new GameObject("WaterSurfaces").transform;
                    holder.SetParent(visualRoot, false);
                }
                CreateSurface(holder, world, place, material, i);
            }
        }

        static void CreateSurface(Transform holder, WorldId world, PlaceDef place, Material material, int index)
        {
            var key = place.id == null || string.IsNullOrEmpty(place.id.value) ? world + "_water_" + index : place.id.value;
            var width = 8f;
            var depth = 5f;
            var kind = (place.kind ?? string.Empty).ToLowerInvariant();
            if (kind.Contains("river") || kind.Contains("delta")) { width = 22f; depth = 5f; }
            else if (kind.Contains("lake") || kind.Contains("coast") || kind.Contains("harbor")) { width = 18f; depth = 12f; }
            else if (kind.Contains("flood")) { width = 14f; depth = 10f; }

            var go = new GameObject("Water_" + Slug(key));
            go.transform.SetParent(holder, false);
            go.transform.position = new Vector3(place.localPosition.x, 0.045f, place.localPosition.y);
            go.transform.rotation = Quaternion.Euler(0f, StableHash(key) % 360, 0f);

            var filter = go.AddComponent<MeshFilter>();
            filter.sharedMesh = BuildMesh(width, depth, key);
            var renderer = go.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            renderer.receiveShadows = false;

            var marker = go.AddComponent<WorldWaterSurfaceMarker>();
            marker.world = world.ToString();
            marker.placeId = key;
            marker.placeKind = place.kind;
            marker.waterGrammar = WorldVisualProfileCatalog.For(world).waterGrammar;
            marker.surfaceScale = new Vector2(width, depth);
        }

        static Mesh BuildMesh(float width, float depth, string seedKey)
        {
            var hw = width * 0.5f;
            var hd = depth * 0.5f;
            var edge = 0.015f + (StableHash(seedKey) % 7) * 0.002f;
            var mesh = new Mesh { name = "WaterSurface_" + Slug(seedKey) };
            mesh.vertices = new[]
            {
                new Vector3(-hw, 0f, -hd), new Vector3(hw, edge, -hd * 0.92f),
                new Vector3(hw, 0f, hd), new Vector3(-hw * 0.92f, edge, hd),
                new Vector3(0f, edge * 1.5f, 0f)
            };
            mesh.uv = new[]
            {
                new Vector2(0f, 0f), new Vector2(1f, 0f), new Vector2(1f, 1f), new Vector2(0f, 1f), new Vector2(0.5f, 0.5f)
            };
            mesh.triangles = new[]
            {
                0, 1, 4,
                1, 2, 4,
                2, 3, 4,
                3, 0, 4
            };
            mesh.RecalculateBounds();
            mesh.RecalculateNormals();
            return mesh;
        }

        static bool IsWater(string raw)
        {
            var key = (raw ?? string.Empty).ToLowerInvariant();
            return key.Contains("water") || key.Contains("river") || key.Contains("lake") ||
                   key.Contains("coast") || key.Contains("harbor") || key.Contains("delta") || key.Contains("flood");
        }

        static string Slug(string raw)
        {
            if (string.IsNullOrEmpty(raw)) return "water";
            return raw.Trim().ToLowerInvariant().Replace(' ', '_').Replace('/', '_');
        }

        static int StableHash(string text)
        {
            unchecked
            {
                var hash = 23;
                if (!string.IsNullOrEmpty(text))
                    for (var i = 0; i < text.Length; i++) hash = hash * 31 + text[i];
                return hash & 0x7fffffff;
            }
        }
    }

    [DisallowMultipleComponent]
    public sealed class WorldWaterSurfaceMarker : MonoBehaviour
    {
        public string world;
        public string placeId;
        public string placeKind;
        public string waterGrammar;
        public Vector2 surfaceScale;
    }
}
