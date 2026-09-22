using System.Collections.Generic;
using UnityEngine;

namespace Concordia.Settlement
{
    public enum RoofKind { Flat, Shed, Gable, Hip }

    /// <summary>
    /// Generates roof geometry. This is the project's first mesh-generation code — there is
    /// no ProBuilder package and nothing else in the tree writes a MeshFilter.
    ///
    /// It exists because the roof is the one genuine hole in the art library: 800 HubKit
    /// stems carry 152 rocks, 110 nature props and 361 facade modules, and ZERO roof pieces.
    /// The materials to dress one do exist (19 Poly Haven roof sets — clay_roof_tiles,
    /// roof_slates_02, thatch_roof_angled, …), so the geometry is all that was missing.
    ///
    /// `Generate` is pure: no GameObjects, no scene, no statics. That keeps it testable in
    /// EditMode and keeps winding/UV bugs falsifiable instead of eyeballed in Play.
    ///
    /// Local space: footprint centred on the origin in XZ, eaves at y=0, ridge at +y.
    /// Every face gets its own four vertices so `RecalculateNormals` yields hard creases at
    /// the ridge and hips instead of smearing a fake smooth shade across them.
    /// </summary>
    public static class RoofMesher
    {
        /// <summary>
        /// Build a roof mesh over a `width` × `depth` footprint.
        /// `pitchDeg` is the slope from horizontal (0 forces Flat). `overhang` projects the
        /// eaves past the wall line on all sides. `uvMetres` is how many metres of roof one
        /// texture tile covers — keep it in real units so tiles read at a believable size
        /// regardless of building size.
        /// </summary>
        public static Mesh Generate(RoofKind kind, float width, float depth,
                                    float pitchDeg = 32f, float overhang = 0.45f, float uvMetres = 2f)
        {
            width = Mathf.Max(0.5f, width);
            depth = Mathf.Max(0.5f, depth);
            uvMetres = Mathf.Max(0.05f, uvMetres);
            pitchDeg = Mathf.Clamp(pitchDeg, 0f, 75f);
            if (pitchDeg <= 0.01f) kind = RoofKind.Flat;

            var w = width * 0.5f + overhang;
            var d = depth * 0.5f + overhang;
            var tan = Mathf.Tan(pitchDeg * Mathf.Deg2Rad);

            var v = new List<Vector3>(32);
            var uv = new List<Vector2>(32);
            var tri = new List<int>(48);

            switch (kind)
            {
                case RoofKind.Flat: BuildFlat(v, uv, tri, w, d, uvMetres); break;
                case RoofKind.Shed: BuildShed(v, uv, tri, w, d, tan, uvMetres); break;
                case RoofKind.Gable: BuildGable(v, uv, tri, w, d, tan, uvMetres); break;
                default: BuildHip(v, uv, tri, w, d, tan, uvMetres); break;
            }

            var mesh = new Mesh { name = "Roof_" + kind };
            mesh.SetVertices(v);
            mesh.SetUVs(0, uv);
            mesh.SetTriangles(tri, 0);
            mesh.RecalculateNormals();
            mesh.RecalculateTangents();
            mesh.RecalculateBounds();
            return mesh;
        }

        /// <summary>
        /// A quad, wound so its face points along +normal. Unity is left-handed and treats
        /// clockwise-as-seen-from-the-front as front-facing; getting this backwards makes a
        /// roof invisible from above and solid from inside, which is exactly the bug that is
        /// impossible to spot in a Project-window screenshot.
        /// </summary>
        static void Quad(List<Vector3> v, List<Vector2> uv, List<int> tri,
                         Vector3 a, Vector3 b, Vector3 c, Vector3 d,
                         Vector2 ua, Vector2 ub, Vector2 uc, Vector2 ud)
        {
            int i = v.Count;
            v.Add(a); v.Add(b); v.Add(c); v.Add(d);
            uv.Add(ua); uv.Add(ub); uv.Add(uc); uv.Add(ud);
            tri.Add(i); tri.Add(i + 1); tri.Add(i + 2);
            tri.Add(i); tri.Add(i + 2); tri.Add(i + 3);
        }

        static void Tri(List<Vector3> v, List<Vector2> uv, List<int> tri,
                        Vector3 a, Vector3 b, Vector3 c,
                        Vector2 ua, Vector2 ub, Vector2 uc)
        {
            int i = v.Count;
            v.Add(a); v.Add(b); v.Add(c);
            uv.Add(ua); uv.Add(ub); uv.Add(uc);
            tri.Add(i); tri.Add(i + 1); tri.Add(i + 2);
        }

        static void BuildFlat(List<Vector3> v, List<Vector2> uv, List<int> tri, float w, float d, float um)
        {
            // Deck only. On the urban and factory kits this sits inside the kit's own
            // cornice/crown parapet course, so the edge is never seen from the street.
            Quad(v, uv, tri,
                new Vector3(-w, 0f, -d), new Vector3(-w, 0f, d), new Vector3(w, 0f, d), new Vector3(w, 0f, -d),
                new Vector2(-w / um, -d / um), new Vector2(-w / um, d / um),
                new Vector2(w / um, d / um), new Vector2(w / um, -d / um));
        }

        static void BuildShed(List<Vector3> v, List<Vector2> uv, List<int> tri, float w, float d, float tan, float um)
        {
            var h = 2f * d * tan;
            var slope = Mathf.Sqrt(4f * d * d + h * h);   // true surface length, so tiles do not stretch

            Quad(v, uv, tri,
                new Vector3(-w, 0f, -d), new Vector3(-w, h, d), new Vector3(w, h, d), new Vector3(w, 0f, -d),
                new Vector2(-w / um, 0f), new Vector2(-w / um, slope / um),
                new Vector2(w / um, slope / um), new Vector2(w / um, 0f));

            // Gable infill under the slope on both ends.
            Tri(v, uv, tri, new Vector3(-w, 0f, -d), new Vector3(-w, 0f, d), new Vector3(-w, h, d),
                new Vector2(0f, 0f), new Vector2(2f * d / um, 0f), new Vector2(2f * d / um, h / um));
            Tri(v, uv, tri, new Vector3(w, 0f, -d), new Vector3(w, h, d), new Vector3(w, 0f, d),
                new Vector2(0f, 0f), new Vector2(2f * d / um, h / um), new Vector2(2f * d / um, 0f));
        }

        static void BuildGable(List<Vector3> v, List<Vector2> uv, List<int> tri, float w, float d, float tan, float um)
        {
            var h = d * tan;
            var slope = Mathf.Sqrt(d * d + h * h);
            var ridgeA = new Vector3(-w, h, 0f);
            var ridgeB = new Vector3(w, h, 0f);

            // +Z pitch. Order is eave-left -> eave-right -> ridge-right -> ridge-left so that
            // cross((b-a),(c-a)).y is POSITIVE. Walking the eave-then-ridge order instead
            // (the intuitive one) yields -2dw and renders the roof inside-out.
            Quad(v, uv, tri,
                new Vector3(-w, 0f, d), new Vector3(w, 0f, d), ridgeB, ridgeA,
                new Vector2(-w / um, 0f), new Vector2(w / um, 0f),
                new Vector2(w / um, slope / um), new Vector2(-w / um, slope / um));

            // -Z pitch
            Quad(v, uv, tri,
                new Vector3(w, 0f, -d), new Vector3(-w, 0f, -d), ridgeA, ridgeB,
                new Vector2(w / um, 0f), new Vector2(-w / um, 0f),
                new Vector2(-w / um, slope / um), new Vector2(w / um, slope / um));

            // Triangular gable ends.
            Tri(v, uv, tri, new Vector3(-w, 0f, -d), new Vector3(-w, 0f, d), ridgeA,
                new Vector2(-d / um, 0f), new Vector2(d / um, 0f), new Vector2(0f, h / um));
            Tri(v, uv, tri, new Vector3(w, 0f, d), new Vector3(w, 0f, -d), ridgeB,
                new Vector2(d / um, 0f), new Vector2(-d / um, 0f), new Vector2(0f, h / um));
        }

        static void BuildHip(List<Vector3> v, List<Vector2> uv, List<int> tri, float w, float d, float tan, float um)
        {
            var h = d * tan;
            var slope = Mathf.Sqrt(d * d + h * h);

            // Ridge is inset by the hip run so the short ends become triangles, not walls.
            // Clamped so a deep-but-narrow footprint degrades to a pyramid instead of
            // inverting the ridge through itself.
            var inset = Mathf.Min(d, w * 0.98f);
            var ridgeA = new Vector3(-w + inset, h, 0f);
            var ridgeB = new Vector3(w - inset, h, 0f);

            // Same winding rule as the gable: eave edge first, then the ridge edge reversed.
            Quad(v, uv, tri,
                new Vector3(-w, 0f, d), new Vector3(w, 0f, d), ridgeB, ridgeA,
                new Vector2(-w / um, 0f), new Vector2(w / um, 0f),
                new Vector2((w - inset) / um, slope / um), new Vector2((-w + inset) / um, slope / um));

            Quad(v, uv, tri,
                new Vector3(w, 0f, -d), new Vector3(-w, 0f, -d), ridgeA, ridgeB,
                new Vector2(w / um, 0f), new Vector2(-w / um, 0f),
                new Vector2((-w + inset) / um, slope / um), new Vector2((w - inset) / um, slope / um));

            // Hipped ends.
            Tri(v, uv, tri, new Vector3(-w, 0f, -d), new Vector3(-w, 0f, d), ridgeA,
                new Vector2(-d / um, 0f), new Vector2(d / um, 0f), new Vector2(0f, slope / um));
            Tri(v, uv, tri, new Vector3(w, 0f, d), new Vector3(w, 0f, -d), ridgeB,
                new Vector2(d / um, 0f), new Vector2(-d / um, 0f), new Vector2(0f, slope / um));
        }

        /// <summary>Roof height above the eave line, for stacking anything above it.</summary>
        public static float PeakHeight(RoofKind kind, float depth, float pitchDeg, float overhang = 0.45f)
        {
            if (kind == RoofKind.Flat || pitchDeg <= 0.01f) return 0f;
            var d = depth * 0.5f + overhang;
            var tan = Mathf.Tan(Mathf.Clamp(pitchDeg, 0f, 75f) * Mathf.Deg2Rad);
            return kind == RoofKind.Shed ? 2f * d * tan : d * tan;
        }

        /// <summary>
        /// Instantiate a generated roof into the scene. Separate from `Generate` so the
        /// geometry stays unit-testable without a scene.
        /// </summary>
        public static GameObject Place(Transform parent, RoofKind kind, Vector3 eaveCentre, float yawDeg,
                                       float width, float depth, Material mat,
                                       float pitchDeg = 32f, float overhang = 0.45f, float uvMetres = 2f)
        {
            var mesh = Generate(kind, width, depth, pitchDeg, overhang, uvMetres);
            var go = new GameObject("Roof");
            go.transform.SetParent(parent, false);
            go.transform.position = eaveCentre;
            go.transform.rotation = Quaternion.Euler(0f, yawDeg, 0f);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var mr = go.AddComponent<MeshRenderer>();
            if (mat) mr.sharedMaterial = mat;
            mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.On;
            mr.receiveShadows = true;
            return go;
        }

        /// <summary>
        /// Roof material for a culture, from the Poly Haven sets that are actually on disk.
        /// Never invents a stem — HubLook.Pbr resolves these through its alias/prefix chain.
        /// </summary>
        public static string MaterialStem(RoofKind kind, string culture)
        {
            switch (culture)
            {
                case "grove": return "thatch_roof_angled";
                case "ash": return "roof_slates_02";
                case "street": return "roof_tiles_14";
                case "grid": return "corrugated_iron_02";
                case "drift": return "roof_slates_03";
                default: return kind == RoofKind.Flat ? "asphalt_02" : "clay_roof_tiles";
            }
        }
    }
}
