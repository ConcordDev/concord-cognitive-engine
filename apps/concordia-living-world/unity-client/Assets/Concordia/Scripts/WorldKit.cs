using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// One hold per world. Distinct ground, sky, landmark, streets, keep.
    /// Geometry is Kenney/KayKit + PBR — law and names come from Canon.
    /// </summary>
    public static class WorldKit
    {
        public static void Build(Transform root, WorldDef w)
        {
            Ground(root, w);
            Landmark(root, w);
            Streets(root, w);
            KeepRing(root, w);
            Rim(root, w);
            Accents(root, w);
        }

        static void Ground(Transform root, WorldDef w)
        {
            var (stem, tint, tile) = w.id switch
            {
                WorldId.Ruins => ("ash_soil", new Color(0.55f, 0.48f, 0.40f), 14f),
                WorldId.Tunya => ("grove_moss", new Color(0.45f, 0.55f, 0.32f), 12f),
                WorldId.Fantasy => ("stone_tiles", new Color(0.42f, 0.48f, 0.38f), 10f),
                WorldId.Crime => ("wet_asphalt", new Color(0.28f, 0.26f, 0.24f), 16f),
                WorldId.Cyber => ("neon_grid", new Color(0.55f, 0.7f, 1f), 8f),
                WorldId.Frontier => ("packed_earth", new Color(0.72f, 0.58f, 0.38f), 14f),
                WorldId.Superhero => ("concrete_floor", new Color(0.48f, 0.50f, 0.55f), 12f),
                WorldId.Crucible => ("metal_plate", new Color(0.35f, 0.85f, 0.78f), 9f),
                _ => ("stone_tiles", new Color(0.55f, 0.50f, 0.42f), 10f)
            };
            var mat = HubLook.Pbr(stem, tint, 0.04f, 0.18f, tile);
            var bed = HubLook.Prim(root, PrimitiveType.Cube, new Vector3(0f, -0.08f, 0f), new Vector3(140f, 0.16f, 140f), mat, "HoldGround");
            var col = bed.GetComponent<Collider>();
            if (col) Object.Destroy(col);
            bed.AddComponent<BoxCollider>();
        }

        static void Landmark(Transform root, WorldDef w)
        {
            switch (w.id)
            {
                case WorldId.Ruins:
                    FreePacks.Spawn("crypt-large", root, new Vector3(0, 0, 10), 0, 12f);
                    FreePacks.Spawn("altar-stone", root, new Vector3(0, 0, 4), 0, 2.4f);
                    FreePacks.Spawn("coffin", root, new Vector3(3.2f, 0, 6), 20, 1.8f);
                    FreePacks.Spawn("coffin", root, new Vector3(-3.4f, 0, 7), -15, 1.8f);
                    HubLook.Point(root, "AshHearth", new Vector3(0, 4, 10), new Color(1f, 0.55f, 0.22f), 3.5f, 18f, true);
                    break;
                case WorldId.Tunya:
                    FreePacks.Spawn("tree_oak", root, new Vector3(0, 0, 8), 0, 16f);
                    FreePacks.Spawn("tree_pineTallA", root, new Vector3(6, 0, 12), 40, 12f);
                    FreePacks.Spawn("tree_pineTallA", root, new Vector3(-7, 0, 11), -30, 13f);
                    for (int i = 0; i < 24; i++)
                        FreePacks.Spawn("crops_wheatStageB", root, new Vector3(-8 + (i % 8) * 2f, 0, 16 + (i / 8) * 2.2f), 0, 1.5f);
                    break;
                case WorldId.Fantasy:
                    FreePacks.Spawn("fountain-round", root, new Vector3(0, 0, 8), 0, 4.2f);
                    FreePacks.Spawn("statue", root, new Vector3(5, 0, 8), 40, 3.2f);
                    FreePacks.Spawn("tower-square-base", root, new Vector3(-8, 0, 14), 0, 10f);
                    FreePacks.Spawn("tower-square-roof", root, new Vector3(-8, 8, 14), 0, 6f);
                    FreePacks.Spawn("banner-red", root, new Vector3(3, 0, 5), 20, 3f);
                    break;
                case WorldId.Crime:
                    FreePacks.Spawn("building-d", root, new Vector3(0, 0, 12), 0, 14f);
                    FreePacks.Spawn("dumpster", root, new Vector3(4, 0, 6), 20, 2f);
                    FreePacks.Spawn("dumpster", root, new Vector3(-5, 0, 7), -10, 2f);
                    FreePacks.Spawn("barrel", root, new Vector3(2, 0, 5), 0, 1f);
                    HubLook.Point(root, "NeonSign", new Vector3(2, 6, 12), new Color(1f, 0.2f, 0.35f), 5f, 16f, false);
                    HubLook.Point(root, "AlleyGreen", new Vector3(-4, 3, 8), new Color(0.2f, 1f, 0.45f), 2.2f, 10f, false);
                    break;
                case WorldId.Cyber:
                    FreePacks.Spawn("building-skyscraper-c", root, new Vector3(0, 0, 14), 0, 22f);
                    FreePacks.Spawn("corridor_cross", root, new Vector3(0, 0, 6), 0, 8f);
                    HubLook.Point(root, "GridCyan", new Vector3(0, 8, 8), new Color(0.2f, 1f, 0.85f), 6f, 22f, false);
                    HubLook.Point(root, "GridMag", new Vector3(6, 5, 12), new Color(0.9f, 0.15f, 1f), 4f, 14f, false);
                    break;
                case WorldId.Frontier:
                    FreePacks.Spawn("tent_detailedOpen", root, new Vector3(0, 0, 8), 0, 5f);
                    FreePacks.Spawn("cart", root, new Vector3(5, 0, 6), 40, 2.8f);
                    FreePacks.Spawn("campfire_stones", root, new Vector3(-2, 0, 6), 0, 1.6f);
                    FreePacks.Spawn("campfire_logs", root, new Vector3(-2, 0, 6), 0, 1.2f);
                    FreePacks.Spawn("cannon", root, new Vector3(7, 0, 10), 180, 2f);
                    HubLook.Point(root, "Campfire", new Vector3(-2, 1.2f, 6), new Color(1f, 0.5f, 0.15f), 3.2f, 12f, true);
                    break;
                case WorldId.Superhero:
                    FreePacks.Spawn("building-skyscraper-a", root, new Vector3(-6, 0, 16), 0, 24f);
                    FreePacks.Spawn("building-skyscraper-d", root, new Vector3(8, 0, 18), 20, 20f);
                    HubLook.Point(root, "DawnGold", new Vector3(0, 14, 10), new Color(1f, 0.72f, 0.35f), 8f, 28f, false);
                    break;
                default:
                    FreePacks.Spawn("detail-crystal-large", root, new Vector3(0, 0, 8), 0, 5f);
                    FreePacks.Spawn("tower-hexagon-base", root, new Vector3(8, 0, 12), 30, 10f);
                    FreePacks.Spawn("detail-crystal-large", root, new Vector3(-6, 0, 10), 15, 3.5f);
                    HubLook.Point(root, "Lattice", new Vector3(0, 6, 8), new Color(0.2f, 1f, 0.85f), 5.5f, 20f, false);
                    break;
            }
        }

        static void Streets(Transform root, WorldDef w)
        {
            for (int i = 0; i < 8; i++)
            {
                float a = i / 8f * Mathf.PI * 2f;
                var dir = new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a));
                for (int k = 1; k <= 6; k++)
                {
                    var p = dir * (6f + k * 4.5f);
                    var yaw = -a * Mathf.Rad2Deg + 90f;
                    var road = w.id == WorldId.Tunya || w.id == WorldId.Frontier
                        ? FreePacks.Spawn("road-straight", root, p, yaw, 5f, false, false)
                        : FreePacks.Spawn("road-straight", root, p, yaw, 5.5f, false, false);
                    if (!road)
                    {
                        var mat = HubLook.Pbr(w.id == WorldId.Crime ? "wet_asphalt" : "concrete_floor", w.ground, 0.04f, 0.16f, 4f);
                        var slab = HubLook.Prim(root, PrimitiveType.Cube, p + Vector3.up * 0.04f, new Vector3(3.2f, 0.06f, 4.6f), mat, "Street_" + i + "_" + k, false);
                        slab.transform.rotation = Quaternion.Euler(0, yaw, 0);
                    }
                }
            }
        }

        static void KeepRing(Transform root, WorldDef w)
        {
            string[] kit = w.id switch
            {
                WorldId.Ruins => new[] { "crypt-a", "crypt-small", "column-large", "gravestone" },
                WorldId.Tunya => new[] { "tent_detailedOpen", "tent_smallOpen", "tree_oak", "crops_cornStageD" },
                WorldId.Fantasy => new[] { "building-small-b", "tower-square-base", "hedge-large", "statue" },
                WorldId.Crime => new[] { "building-type-h", "building-type-c", "building-d", "dumpster" },
                WorldId.Cyber => new[] { "building-skyscraper-a", "building-skyscraper-c", "corridor_end", "detail-overhang-wide" },
                WorldId.Frontier => new[] { "tent_detailedOpen", "cart", "palm-straight", "barrel" },
                WorldId.Superhero => new[] { "building-skyscraper-d", "building-type-a", "building-skyscraper-b", "building-small-d" },
                _ => new[] { "detail-crystal-large", "tower-hexagon-mid", "column-large", "crypt-small" }
            };
            float[] rads = { 16f, 22f, 30f };
            int[] counts = { 8, 10, 12 };
            for (int ring = 0; ring < rads.Length; ring++)
            {
                int n = counts[ring];
                for (int i = 0; i < n; i++)
                {
                    float a = i / (float)n * Mathf.PI * 2f + ring * 0.17f;
                    var p = new Vector3(Mathf.Cos(a) * rads[ring], 0f, Mathf.Sin(a) * rads[ring]);
                    var yaw = -a * Mathf.Rad2Deg + 90f;
                    var stem = kit[(i + ring) % kit.Length];
                    float h = ring == 0 ? 5.5f : ring == 1 ? 7.5f : 9f;
                    if (stem.Contains("tent") || stem.Contains("crops") || stem.Contains("cart") || stem.Contains("barrel"))
                        h = 2.8f + ring;
                    if (stem.Contains("skyscraper")) h = 16f + ring * 4f;
                    if (stem.Contains("tree") || stem.Contains("palm")) h = 8f + ring * 2f;
                    FreePacks.Spawn(stem, root, p, yaw, h);
                }
            }
        }

        static void Rim(Transform root, WorldDef w)
        {
            string rim = w.id switch
            {
                WorldId.Ruins => "cliff_large_stone",
                WorldId.Tunya => "cliff_large_rock",
                WorldId.Fantasy => "tower-hexagon-base",
                WorldId.Crime => "building-skyscraper-e",
                WorldId.Cyber => "building-skyscraper-d",
                WorldId.Frontier => "rocks-large",
                WorldId.Superhero => "building-skyscraper-b",
                _ => "cliff_stone"
            };
            float h = w.id == WorldId.Cyber || w.id == WorldId.Superhero ? 22f : 10f;
            for (int i = 0; i < 14; i++)
            {
                float a = i / 14f * Mathf.PI * 2f + 0.08f;
                FreePacks.Spawn(rim, root, new Vector3(Mathf.Cos(a) * 52f, 0f, Mathf.Sin(a) * 52f), a * Mathf.Rad2Deg, h);
            }
        }

        static void Accents(Transform root, WorldDef w)
        {
            if (w.id == WorldId.Crime || w.weather == "rain")
                FreePacks.Prefab("Assets/VFX/VFX_Rain.prefab", root, new Vector3(0, 8, 0));
            if (w.id == WorldId.Ruins)
                FreePacks.Prefab("Assets/VFX/VFX_Snow.prefab", root, new Vector3(0, 8, 0));
            if (w.id == WorldId.Tunya || w.id == WorldId.Fantasy)
                FreePacks.Prefab("Assets/VFX/VFX_Fireflies.prefab", root, new Vector3(0, 2.2f, 8));
        }
    }
}
