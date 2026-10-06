using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// SLICE 1 — walkable near/mid hills continuous with The Unburned Court.
    /// Poly Haven HDRI mountains stay sky; these meshes are the land you walk onto.
    /// Names start with "Court" so HubLook.EnsureCourtPlateCleanup never strips them
    /// (unlike wilderness Hill_* prims, which are disabled inside the plate frustum).
    /// Terraces step ≤ CharacterController.stepOffset so north/out strides do not cliff-drop.
    /// </summary>
    public static class CourtWalkableHorizon
    {
        public const string RootName = "CourtWalkableHorizon";

        /// <summary>Near ridge band (beyond RingRadius, still in Court vista).</summary>
        public const float NearStartM = 38f;
        public const float NearEndM = 95f;
        /// <summary>Mid hills that replace the painted skybox silhouette as you walk out.</summary>
        public const float MidStartM = 100f;
        public const float MidEndM = 175f;
        /// <summary>Fog-colored occluder behind mid hills — kills double-horizon with HDRI peaks.</summary>
        public const float MaskRadiusM = 210f;

        public static void Ensure(Transform continent)
        {
            if (!continent) return;
            var hold = continent.Find(RootName);
            if (hold)
            {
                // SLICE 2b — re-dress land mats if an earlier boot left cyan/fog emit on hills.
                SoftenSkyband();
                CourtGroundDress.SoftenHorizonLand();
                return;
            }

            hold = new GameObject(RootName).transform;
            hold.SetParent(continent, false);

            var earth = HubLook.Pbr("packed_earth", new Color(0.42f, 0.34f, 0.24f), 0.04f, 0.22f, 12f);
            var turf = HubLook.Pbr("grass", new Color(0.30f, 0.38f, 0.22f), 0.03f, 0.26f, 9f);
            if (!turf) turf = HubLook.Pbr("grove_moss", new Color(0.28f, 0.36f, 0.22f), 0.04f, 0.28f, 10f);
            if (!turf) turf = earth;

            BuildApproachAprons(hold, earth);
            BuildNearHills(hold, earth, turf);
            BuildMidHills(hold, earth, turf);
            BuildHorizonMask(hold);
            SoftenSkyband();
            CourtGroundDress.SoftenHorizonLand();
        }

        /// <summary>
        /// Continuous walkable pads from the Court ring outward (north sector + full ring
        /// collar) so leaving the plaza never steps onto void between CourtGround and hills.
        /// </summary>
        static void BuildApproachAprons(Transform hold, Material earth)
        {
            // Full collar just outside the warden ring — closes the CourtGround → ContinentGround seam.
            PlaceGroundDisc(hold, "CourtApproachGround_Collar", Vector3.zero, 0.02f,
                Canon.RingRadius + 28f, earth);

            // North / Sundering (+Z) approach runway — the vista Dutch walks into from Court.
            float z0 = Canon.RingRadius + 2f;
            float z1 = MidEndM + 8f;
            float midZ = (z0 + z1) * 0.5f;
            float len = z1 - z0;
            var runway = GameObject.CreatePrimitive(PrimitiveType.Cube);
            runway.name = "CourtApproachGround_North";
            runway.transform.SetParent(hold, false);
            runway.transform.localPosition = new Vector3(Canon.Spawn.x * 0.35f, 0.025f, midZ);
            runway.transform.localScale = new Vector3(42f, 0.05f, len);
            Object.Destroy(runway.GetComponent<Collider>());
            var box = runway.AddComponent<BoxCollider>();
            box.size = Vector3.one;
            var rr = runway.GetComponent<Renderer>();
            if (rr && earth) rr.sharedMaterial = earth;

            // Side shoulders so diagonal exits still land on mesh.
            PlaceGroundPad(hold, "CourtApproachGround_NE", new Vector3(28f, 0.02f, 70f),
                new Vector3(36f, 0.05f, 55f), earth);
            PlaceGroundPad(hold, "CourtApproachGround_NW", new Vector3(-28f, 0.02f, 70f),
                new Vector3(36f, 0.05f, 55f), earth);
        }

        static void BuildNearHills(Transform hold, Material earth, Material turf)
        {
            // LeanPlay-thin: enough silhouette from Court, not a megaworld continent.
            var specs = new (float angDeg, float dist, float radius, int steps, float peak)[]
            {
                (72f, 48f, 11f, 5, 2.4f),
                (90f, 52f, 13f, 6, 2.8f),
                (108f, 50f, 10f, 5, 2.2f),
                (58f, 68f, 12f, 6, 3.1f),
                (90f, 74f, 14f, 7, 3.4f),
                (122f, 70f, 11f, 6, 2.9f),
                (78f, 88f, 13f, 7, 3.6f),
                (102f, 86f, 12f, 6, 3.2f),
            };
            for (int i = 0; i < specs.Length; i++)
            {
                var s = specs[i];
                float rad = s.angDeg * Mathf.Deg2Rad;
                var at = new Vector3(Mathf.Cos(rad) * s.dist, 0f, Mathf.Sin(rad) * s.dist);
                // Keep Sundering +Z stride open (Canon.BlocksSunderingWalk) — shift off-lane.
                if (Canon.BlocksSunderingWalk(at, s.radius * 0.55f))
                    at.x += at.x >= 0f ? 4.2f : -4.2f;
                var mat = (i % 2 == 0) ? turf : earth;
                BuildTerraceHill(hold, "CourtWalkHill_Near_" + i, at, s.radius, s.steps, s.peak, mat);
            }
            // Force land mats immediately (Pbr cache miss can leave cyan Lit defaults).
            CourtGroundDress.SoftenHorizonLand();
        }

        static void BuildMidHills(Transform hold, Material earth, Material turf)
        {
            var specs = new (float angDeg, float dist, float radius, int steps, float peak)[]
            {
                (66f, 118f, 18f, 8, 5.2f),
                (90f, 128f, 22f, 9, 6.4f),
                (114f, 120f, 17f, 8, 5.0f),
                (78f, 152f, 20f, 9, 7.0f),
                (102f, 148f, 19f, 9, 6.6f),
                (54f, 140f, 16f, 7, 4.8f),
                (126f, 138f, 16f, 7, 4.6f),
            };
            for (int i = 0; i < specs.Length; i++)
            {
                var s = specs[i];
                float rad = s.angDeg * Mathf.Deg2Rad;
                var at = new Vector3(Mathf.Cos(rad) * s.dist, 0f, Mathf.Sin(rad) * s.dist);
                if (Canon.BlocksSunderingWalk(at, s.radius * 0.5f))
                    at.x += at.x >= 0f ? 5.5f : -5.5f;
                var mat = (i % 3 == 0) ? turf : earth;
                BuildTerraceHill(hold, "CourtWalkHill_Mid_" + i, at, s.radius, s.steps, s.peak, mat);
            }
        }

        /// <summary>
        /// Concentric discs, each step ≤ 0.35m so CC.stepOffset (~0.4) can climb.
        /// Named CourtWalk* so Grounding treats them as legal floors.
        /// </summary>
        static void BuildTerraceHill(Transform hold, string name, Vector3 at, float radius,
            int steps, float peakH, Material mat)
        {
            // Enough terraces that each rise stays ≤ CC.stepOffset (~0.4).
            int need = Mathf.CeilToInt(Mathf.Max(0.5f, peakH) / 0.34f);
            steps = Mathf.Max(3, Mathf.Max(steps, need));
            float rise = peakH / steps;
            var root = new GameObject(name).transform;
            root.SetParent(hold, false);
            root.localPosition = at;

            for (int s = 0; s < steps; s++)
            {
                float t = (s + 1f) / steps;
                float y = rise * (s + 1);
                float r = radius * (1.05f - t * 0.62f);
                var disc = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
                disc.name = name + "_T" + s;
                disc.transform.SetParent(root, false);
                // Unity cylinder default height 2 → scale.y = thickness/2
                float thick = 0.42f;
                disc.transform.localPosition = new Vector3(0f, y - thick * 0.5f, 0f);
                disc.transform.localScale = new Vector3(r * 2f, thick * 0.5f, r * 2f);
                Object.Destroy(disc.GetComponent<Collider>());
                var box = disc.AddComponent<BoxCollider>();
                box.size = new Vector3(1f, 2f, 1f);
                var rend = disc.GetComponent<Renderer>();
                if (rend && mat) rend.sharedMaterial = mat;
            }
        }

        /// <summary>
        /// Soft fog-colored wall behind mid hills. Occludes HDRI mountain band from Court
        /// without claiming to be walkable destination land (still has a thin collider apron).
        /// </summary>
        static void BuildHorizonMask(Transform hold)
        {
            var fog = RenderSettings.fogColor;
            if (fog.maxColorComponent < 0.05f)
                fog = new Color(0.35f, 0.62f, 0.68f);

            // SLICE 2b — land-tinted soft occluder (not flat cyan emit topo).
            var landFog = Color.Lerp(new Color(0.36f, 0.40f, 0.32f), fog, 0.40f);
            var maskMat = HubLook.Lit(landFog, 0.02f, 0.06f);
            if (!maskMat)
                maskMat = HubLook.Emit(landFog, 0.06f);

            int segments = ConcordiaHost.LeanPlay ? 10 : 14;
            float spanDeg = 100f; // north-facing arc
            float startDeg = 90f - spanDeg * 0.5f;
            for (int i = 0; i < segments; i++)
            {
                float a0 = (startDeg + spanDeg * (i / (float)segments)) * Mathf.Deg2Rad;
                float a1 = (startDeg + spanDeg * ((i + 1f) / segments)) * Mathf.Deg2Rad;
                float am = (a0 + a1) * 0.5f;
                var pos = new Vector3(Mathf.Cos(am) * MaskRadiusM, 9f, Mathf.Sin(am) * MaskRadiusM);
                float chord = 2f * MaskRadiusM * Mathf.Sin((a1 - a0) * 0.5f);
                var wall = GameObject.CreatePrimitive(PrimitiveType.Cube);
                wall.name = "CourtHorizonMask_" + i;
                wall.transform.SetParent(hold, false);
                wall.transform.localPosition = pos;
                wall.transform.localRotation = Quaternion.Euler(0f, -am * Mathf.Rad2Deg, 0f);
                wall.transform.localScale = new Vector3(Mathf.Max(8f, chord * 1.08f), 22f, 4.5f);
                Object.Destroy(wall.GetComponent<Collider>());
                // Thin walkable lip so walking into the mask does not void-drop.
                var lip = wall.AddComponent<BoxCollider>();
                lip.center = new Vector3(0f, -0.42f, 0f);
                lip.size = new Vector3(1f, 0.16f, 1.1f);
                var rend = wall.GetComponent<Renderer>();
                if (rend && maskMat) rend.sharedMaterial = maskMat;
            }

            // Ground pad under the mask arc.
            PlaceGroundPad(hold, "CourtApproachGround_Mask",
                new Vector3(0f, 0.02f, MaskRadiusM - 6f),
                new Vector3(120f, 0.05f, 28f),
                HubLook.Pbr("packed_earth", new Color(0.36f, 0.32f, 0.26f), 0.05f, 0.22f, 12f));
        }

        /// <summary>
        /// Pull HDRI mountain band down visually: lower Hub exposure + denser teal fog
        /// so mesh hills read as the real horizon.
        /// </summary>
        public static void SoftenSkyband()
        {
            var sky = RenderSettings.skybox;
            if (sky && sky.name != null && sky.name.StartsWith("PH_HDR_"))
            {
                if (sky.HasProperty("_Exposure"))
                {
                    float e = sky.GetFloat("_Exposure");
                    // Soften painted peaks without crushing day sky.
                    sky.SetFloat("_Exposure", Mathf.Min(e, 0.58f));
                }
                if (sky.HasProperty("_Tint"))
                {
                    var fog = RenderSettings.fogColor;
                    var tint = Color.Lerp(Color.white, fog, 0.28f);
                    sky.SetColor("_Tint", tint);
                }
            }

            if (RenderSettings.fog)
            {
                // Enough fog that far HDRI peaks melt into mist. The old floor
                // (0.027 exp2) also buried the Court itself — half fog at 30 m —
                // so it matches HubLook.EnsureCourtAtmosphere's 0.013 now:
                // ~70% visible at 50 m, >97% fog past 150 m.
                float d = RenderSettings.fogDensity;
                if (d < 0.012f) HubLook.LiveFog(0.013f);
            }
        }

        static void PlaceGroundDisc(Transform hold, string name, Vector3 center, float y,
            float radiusM, Material mat)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            go.name = name;
            go.transform.SetParent(hold, false);
            go.transform.localPosition = center + Vector3.up * y;
            go.transform.localScale = new Vector3(radiusM * 2f, 0.03f, radiusM * 2f);
            Object.Destroy(go.GetComponent<Collider>());
            var box = go.AddComponent<BoxCollider>();
            box.size = new Vector3(1f, 2f, 1f);
            var rend = go.GetComponent<Renderer>();
            if (rend && mat) rend.sharedMaterial = mat;
        }

        static void PlaceGroundPad(Transform hold, string name, Vector3 pos, Vector3 scale, Material mat)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
            go.name = name;
            go.transform.SetParent(hold, false);
            go.transform.localPosition = pos;
            go.transform.localScale = scale;
            Object.Destroy(go.GetComponent<Collider>());
            var box = go.AddComponent<BoxCollider>();
            box.size = Vector3.one;
            var rend = go.GetComponent<Renderer>();
            if (rend && mat) rend.sharedMaterial = mat;
        }
    }
}
