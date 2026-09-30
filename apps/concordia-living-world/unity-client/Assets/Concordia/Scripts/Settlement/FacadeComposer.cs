using UnityEngine;

namespace Concordia.Settlement
{
    /// <summary>
    /// Builds one building on one plot out of modular-kit pieces plus a generated roof.
    ///
    /// Module geometry, all measured off the glb rather than assumed:
    ///   · pivot sits at the module's BOTTOM-RIGHT — X spans [-3, 0], Y spans [0, height]
    ///   · the panel plane is Z = 0 and trim projects OUTWARD along +Z
    ///   · the outward face normal is Unity local +Z (glTF -Y, rotated by the Z-up correction)
    /// So a bay placed at local x sits in [x-3, x], courses stack by simple cumulative height,
    /// and a wall's yaw is just the direction its street-facing side should look.
    ///
    /// Inserts line up for free: `window_centered_small_01` occupies the same bay span as
    /// `wall_window_centered_small_01`, so the leaf takes the panel's exact transform.
    ///
    /// Corner seams are closed with the kit's own thin pier quoins rather than the 2m corner
    /// modules — the corner modules would force the bay grid off a 3m multiple, and a pier is
    /// 0.25m so it costs no frontage.
    /// </summary>
    public static class FacadeComposer
    {
        public const float BaseH = 0.75f;
        public const float DadoH = 0.5f;
        public const float StoreyH = 3.0f;
        public const float CorniceH = 0.2f;
        public const float CrownH = 0.75f;
        public const float BayW = 3.0f;

        /// Total height from pavement to eave for a given storey count.
        public static float EaveHeight(int storeys) =>
            BaseH + DadoH + Mathf.Max(1, storeys) * StoreyH + CorniceH + CrownH;

        public static GameObject Build(Transform parent, Plot plot, ModuleKit kit,
                                       Material wallMat, Material roofMat,
                                       RoofKind roof = RoofKind.Flat, float pitchDeg = 32f)
        {
            if (kit == null || !kit.Ready) return null;

            var storeys = Mathf.Clamp(plot.Storeys, 1, 8);
            var frontBays = Mathf.Max(1, Mathf.RoundToInt(plot.Frontage / BayW));
            var sideBays = Mathf.Max(1, Mathf.RoundToInt(plot.Depth / BayW));
            var w = frontBays * BayW;
            var d = sideBays * BayW;

            var go = new GameObject("Building_" + plot.DistrictId + "_" + plot.Seed);
            go.transform.SetParent(parent, false);
            go.transform.position = new Vector3(plot.Centre.x, 0f, plot.Centre.y);
            go.transform.rotation = Quaternion.Euler(0f, plot.Yaw, 0f);
            var t = go.transform;

            // A "size" preference held constant for the whole building, so its own windows
            // agree with each other while the neighbour (different seed) differs.
            var size = (plot.Seed % 3) == 0 ? "large" : (plot.Seed % 3) == 1 ? "small" : null;
            var doorBay = frontBays > 2 ? frontBays / 2 : 0;

            // Four faces of the box. Local +Z is the street side.
            Run(t, kit, Face.Front, w, d, frontBays, storeys, plot.Seed, doorBay, size);
            Run(t, kit, Face.Back, w, d, frontBays, storeys, plot.Seed, -1, size);
            Run(t, kit, Face.Right, w, d, sideBays, storeys, plot.Seed, -1, size);
            Run(t, kit, Face.Left, w, d, sideBays, storeys, plot.Seed, -1, size);

            Quoins(t, kit, w, d, storeys, plot.Seed);

            var eave = EaveHeight(storeys);
            if (roofMat != null)
            {
                RoofMesher.Place(t, roof, new Vector3(plot.Centre.x, eave, plot.Centre.y), plot.Yaw,
                                 w, d, roofMat, pitchDeg, roof == RoofKind.Flat ? 0f : 0.45f);
            }

            // Deliberately NOT a blanket material override. The Poly Haven kits ship their
            // own authored split — `..._trim_01`, `..._trim_02`, `..._objects`, `..._glass`,
            // `..._plaster`, each with real diffuse + normal maps. Painting one wall material
            // over all of them would flatten the glazing and the stonework into one surface
            // and throw away most of why the kit looks like anything. HubKit already ran the
            // Standard->URP sweep at import (HubKit.InstantiateGlb), so these render correctly
            // as-is. `wallMat` is only a fallback for a module whose albedo came in blank.
            if (wallMat != null)
                foreach (var r in go.GetComponentsInChildren<Renderer>(true))
                {
                    if (!r || r.gameObject.name == "Roof") continue;
                    var m = r.sharedMaterial;
                    if (!m || HubLook.IsBlankAlbedo(HubLook.FirstAlbedo(m))) r.sharedMaterial = wallMat;
                }

            // One box collider for the whole shell — 40-odd module colliders per building
            // would be a physics cost for nothing, and the facade is zero-thickness anyway.
            var col = go.AddComponent<BoxCollider>();
            col.center = new Vector3(0f, eave * 0.5f, 0f);
            col.size = new Vector3(w, eave, d);
            return go;
        }

        enum Face { Front, Back, Right, Left }

        /// <summary>
        /// One wall of the box: base, dado, N storey courses, cornice, crown.
        /// `doorBay` is the bay index that gets a door on the ground storey, or -1 for none.
        /// </summary>
        static void Run(Transform t, ModuleKit kit, Face face, float w, float d,
                        int bays, int storeys, int seed, int doorBay, string size)
        {
            // Outward normal and the axis the run walks along, per face.
            float yaw;
            Vector3 origin, step;
            switch (face)
            {
                case Face.Front: yaw = 0f; origin = new Vector3(-w * 0.5f, 0f, d * 0.5f); step = Vector3.right; break;
                case Face.Back: yaw = 180f; origin = new Vector3(w * 0.5f, 0f, -d * 0.5f); step = Vector3.left; break;
                case Face.Right: yaw = 90f; origin = new Vector3(w * 0.5f, 0f, d * 0.5f); step = Vector3.back; break;
                default: yaw = 270f; origin = new Vector3(-w * 0.5f, 0f, -d * 0.5f); step = Vector3.forward; break;
            }

            for (int b = 0; b < bays; b++)
            {
                // Pivot is the module's far edge, so bay b sits one full bay along the run.
                var at = origin + step * ((b + 1) * BayW);
                var bayVariant = seed + b * 7919;

                float y = 0f;
                Put(t, kit, Course.Base, Bay.Solid, Plan.Standard, seed, at, y, yaw, size: null);
                y += BaseH;

                var groundIsDoor = face == Face.Front && b == doorBay;
                Put(t, kit, Course.Dado, groundIsDoor ? Bay.Door : Bay.Solid, Plan.Standard,
                    seed, at, y, yaw, size: null);
                y += DadoH;

                for (int s = 0; s < storeys; s++)
                {
                    var bay = PickBay(face, s, b, doorBay, bayVariant);
                    var module = kit.Pick(Course.Wall, bay, Plan.Standard, bayVariant + s * 31, size);
                    var placed = kit.Place(module, t, LocalToWorld(t, at, y), t.eulerAngles.y + yaw);
                    if (placed) placed.transform.SetParent(t, true);

                    // The leaf/glazing takes the panel's exact transform — same bay span.
                    var insert = kit.InsertFor(module);
                    if (!string.IsNullOrEmpty(insert))
                    {
                        var leaf = kit.Place(insert, t, LocalToWorld(t, at, y), t.eulerAngles.y + yaw);
                        if (leaf) leaf.transform.SetParent(t, true);
                    }
                    y += StoreyH;
                }

                Put(t, kit, Course.Cornice, Bay.Solid, Plan.Standard, seed, at, y, yaw, size: null);
                y += CorniceH;
                Put(t, kit, Course.Crown, Bay.Solid, Plan.Standard, seed, at, y, yaw, size: null);
            }
        }

        /// <summary>
        /// What a given bay does. The street face is generous with openings; the back is
        /// mostly blank, which is what actually makes a block read as having a front and a
        /// back rather than four identical elevations.
        /// </summary>
        static Bay PickBay(Face face, int storey, int bayIndex, int doorBay, int variant)
        {
            if (face == Face.Front)
            {
                if (storey == 0 && bayIndex == doorBay) return Bay.Door;
                if (storey == 0) return ((variant >> 2) % 5) == 0 ? Bay.Solid : Bay.Window;
                return Bay.Window;
            }
            if (face == Face.Back) return ((variant + storey) % 4) == 0 ? Bay.Window : Bay.Solid;
            return ((variant + storey) % 3) == 0 ? Bay.Solid : Bay.Window;   // side elevations
        }

        static void Put(Transform t, ModuleKit kit, Course course, Bay bay, Plan plan,
                        int seed, Vector3 at, float y, float yaw, string size)
        {
            var module = kit.Pick(course, bay, plan, seed, size);
            if (string.IsNullOrEmpty(module)) return;
            var placed = kit.Place(module, t, LocalToWorld(t, at, y), t.eulerAngles.y + yaw);
            if (placed) placed.transform.SetParent(t, true);
        }

        static Vector3 LocalToWorld(Transform t, Vector3 local, float y) =>
            t.TransformPoint(new Vector3(local.x, y, local.z));

        /// <summary>
        /// Thin corner quoins. Two zero-thickness panels meeting at 90 degrees leave a
        /// hairline, and the trim courses (which DO have depth) cross at the corner; a pier
        /// covers both. 0.25m wide, so unlike the kit's 2m corner modules it costs no bay.
        /// </summary>
        static void Quoins(Transform t, ModuleKit kit, float w, float d, int storeys, int seed)
        {
            var corners = new[]
            {
                (pos: new Vector3(w * 0.5f, 0f, d * 0.5f), yaw: 0f),
                (pos: new Vector3(w * 0.5f, 0f, -d * 0.5f), yaw: 90f),
                (pos: new Vector3(-w * 0.5f, 0f, -d * 0.5f), yaw: 180f),
                (pos: new Vector3(-w * 0.5f, 0f, d * 0.5f), yaw: 270f)
            };

            foreach (var c in corners)
            {
                float y = 0f;
                Put(t, kit, Course.Base, Bay.Pier, Plan.Pier, seed, c.pos, y, c.yaw, null);
                y += BaseH;
                Put(t, kit, Course.Dado, Bay.Pier, Plan.CornerSmall, seed, c.pos, y, c.yaw, null);
                y += DadoH;
                for (int s = 0; s < storeys; s++)
                {
                    Put(t, kit, Course.Wall, Bay.Pier, Plan.CornerSmall, seed, c.pos, y, c.yaw, null);
                    y += StoreyH;
                }
                Put(t, kit, Course.Cornice, Bay.Pier, Plan.CornerSmall, seed, c.pos, y, c.yaw, null);
                y += CorniceH;
                Put(t, kit, Course.Crown, Bay.Pier, Plan.CornerSmall, seed, c.pos, y, c.yaw, null);
            }
        }
    }
}
