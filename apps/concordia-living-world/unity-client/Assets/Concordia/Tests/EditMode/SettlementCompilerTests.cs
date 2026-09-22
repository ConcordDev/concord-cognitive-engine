// Contract tests for the Concordia settlement compiler.
//
// These pin the two things that were genuinely unknown before this pass: the modular-kit
// naming grammar (361 modules across three Poly Haven glbs, discovered at runtime rather
// than hand-typed) and roof geometry (the project's first generated mesh — nothing else in
// the tree writes a MeshFilter, so there is no existing correctness precedent to lean on).
//
// Every module name below is verbatim from the glb JSON chunks, not invented. The parse
// cases marked "regression" each caught a real bug: the base course omits its bay token, and
// the factory kit has a `garage` bay the apartments kit does not.

using Concordia.Settlement;
using NUnit.Framework;
using UnityEngine;

namespace Concordia.Tests
{
    public class ModuleKitParseTests
    {
        // Verbatim from modular_urban_apartments_facade_1k.glb.
        static readonly string[] Apartments =
        {
            "base_standard_01", "base_corner_large_01", "base_corner_small_02",
            "base_angled_large_01", "base_end_01",
            "dado_standard_standard_01", "dado_door_centered_small_01", "dado_pier_corner_01",
            "wall_standard_standard_01", "wall_standard_corner_small_01",
            "wall_window_centered_small_01", "wall_window_centered_large_01",
            "wall_window_offset_small_06", "wall_door_centered_small_01",
            "wall_door_window_small_03", "wall_pier_corner_01",
            "cornice_standard_standard_01", "cornice_pier_corner_01",
            "crown_standard_standard_01", "crown_end_02",
            // inserts — the leaf/glazing that drops into a punched panel
            "window_centered_small_01", "window_centered_large_01", "window_offset_small_06",
            "door_centered_small_01", "door_window_small_03"
        };

        // Verbatim from modular_factory_facade_1k.glb.
        static readonly string[] Factory =
        {
            "base_standard_01", "cornice01_standard_standard_01", "cornice02_end_01",
            "cornice03_pier_standard_01", "dado_garage_door_01", "dado_garage_centered_01",
            "wall_window_tall_large_01", "wall_standard_standard_01", "crown_standard_standard_01",
            "window_tall_large_01"
        };

        [Test]
        public void EveryRealModuleNameParses()
        {
            var kit = ModuleKit.FromNames(ModuleKit.Apartments, Apartments);
            Assert.IsTrue(kit.Ready);
            Assert.AreEqual(Apartments.Length, kit.ModuleCount,
                "a name that fails to parse is silently dropped — every one of these is real");
        }

        [Test]
        public void FactoryGrammarParses_IncludingCorniceNumberingAndGarageBays()
        {
            var kit = ModuleKit.FromNames(ModuleKit.Factory, Factory);
            Assert.AreEqual(Factory.Length, kit.ModuleCount);
            // regression: `cornice01_`/`02_`/`03_` are one course, not three unknown ones
            Assert.Greater(kit.CountFor(Course.Cornice, Bay.Solid, Plan.Standard), 0);
            // regression: a `garage` bay is a door bay, not an unparseable head
            Assert.Greater(kit.CountFor(Course.Dado, Bay.Door, Plan.Standard), 0);
        }

        [Test]
        public void BaseCourse_OmitsItsBayToken_AndStillParses()
        {
            // regression: `base_angled_large_01` has no bay token at all — an earlier parse
            // rejected it and dropped 6 apartments + 4 factory modules on the floor.
            var kit = ModuleKit.FromNames(ModuleKit.Apartments, Apartments);
            Assert.Greater(kit.CountFor(Course.Base, Bay.Solid, Plan.AngledLarge), 0);
            Assert.Greater(kit.CountFor(Course.Base, Bay.Solid, Plan.CornerLarge), 0);
            Assert.Greater(kit.CountFor(Course.Base, Bay.Solid, Plan.CornerSmall), 0);
        }

        [Test]
        public void PunchedPanelsPairWithTheirInsert_AndSolidWallsDoNot()
        {
            var kit = ModuleKit.FromNames(ModuleKit.Apartments, Apartments);

            Assert.AreEqual("window_centered_small_01", kit.InsertFor("wall_window_centered_small_01"));
            Assert.AreEqual("door_centered_small_01", kit.InsertFor("wall_door_centered_small_01"));
            Assert.AreEqual("door_window_small_03", kit.InsertFor("wall_door_window_small_03"));

            Assert.IsNull(kit.InsertFor("wall_standard_standard_01"),
                "a blank wall has no leaf to insert");
            Assert.IsNull(kit.InsertFor("cornice_standard_standard_01"));
        }

        [Test]
        public void MissingInsert_ReturnsNull_RatherThanGuessing()
        {
            // 9 punched panels across the two kits genuinely ship without a matching insert.
            // Empty stays empty — the composer must get null, not a substituted leaf.
            var kit = ModuleKit.FromNames(ModuleKit.Apartments, Apartments);
            Assert.IsNull(kit.InsertFor("wall_door_window_small_013"));
        }

        [Test]
        public void PickIsDeterministic_SoAWorldRebuildsTheSameStreet()
        {
            var kit = ModuleKit.FromNames(ModuleKit.Apartments, Apartments);
            var a = kit.Pick(Course.Wall, Bay.Window, Plan.Standard, 7);
            var b = kit.Pick(Course.Wall, Bay.Window, Plan.Standard, 7);
            Assert.AreEqual(a, b);
            Assert.IsNotNull(a);
        }

        [Test]
        public void PickHandlesNegativeVariantHashes()
        {
            // String hashes go negative; a raw % would index out of range.
            var kit = ModuleKit.FromNames(ModuleKit.Apartments, Apartments);
            Assert.IsNotNull(kit.Pick(Course.Wall, Bay.Window, Plan.Standard, -13));
            Assert.IsNotNull(kit.Pick(Course.Wall, Bay.Solid, Plan.Standard, int.MinValue + 1));
        }

        [Test]
        public void SizePreferenceSelectsTheRightOpening_AndIsIgnoredWhenAbsent()
        {
            var kit = ModuleKit.FromNames(ModuleKit.Apartments, Apartments);

            var large = kit.Pick(Course.Wall, Bay.Window, Plan.Standard, 0, "large");
            Assert.IsNotNull(large);
            StringAssert.Contains("large", large);

            // A size this kit has no window for must still return a window, not null.
            var odd = kit.Pick(Course.Wall, Bay.Window, Plan.Standard, 0, "colossal");
            Assert.IsNotNull(odd);
            StringAssert.StartsWith("wall_window", odd);
        }

        [Test]
        public void UnknownBayDegradesToSolid_RatherThanReturningNothing()
        {
            // The fort kit has no window bays at all. A caller asking for one must get a
            // wall, so the building still encloses instead of opening a hole in the world.
            var kit = ModuleKit.FromNames("stub", new[] { "wall_standard_standard_01" });
            Assert.AreEqual("wall_standard_standard_01",
                kit.Pick(Course.Wall, Bay.Window, Plan.AngledLarge, 3));
        }

        [Test]
        public void EmptyKitIsNotReady_AndPicksNothing()
        {
            var kit = ModuleKit.FromNames("nothing", new string[0]);
            Assert.IsFalse(kit.Ready);
            Assert.IsNull(kit.Pick(Course.Wall, Bay.Solid, Plan.Standard, 0));
        }
    }

    public class RoofMesherTests
    {
        static float MaxY(Mesh m)
        {
            var max = float.NegativeInfinity;
            foreach (var v in m.vertices) if (v.y > max) max = v.y;
            return max;
        }

        [TestCase(RoofKind.Flat)]
        [TestCase(RoofKind.Shed)]
        [TestCase(RoofKind.Gable)]
        [TestCase(RoofKind.Hip)]
        public void EveryRoofKindProducesRealGeometry(RoofKind kind)
        {
            var m = RoofMesher.Generate(kind, 9f, 6f);
            Assert.Greater(m.vertexCount, 0);
            Assert.Greater(m.triangles.Length, 0);
            Assert.AreEqual(0, m.triangles.Length % 3);
        }

        [TestCase(RoofKind.Flat)]
        [TestCase(RoofKind.Shed)]
        [TestCase(RoofKind.Gable)]
        [TestCase(RoofKind.Hip)]
        public void NoDegenerateTriangles(RoofKind kind)
        {
            var m = RoofMesher.Generate(kind, 9f, 6f);
            var v = m.vertices;
            var t = m.triangles;
            for (int i = 0; i < t.Length; i += 3)
            {
                var area = Vector3.Cross(v[t[i + 1]] - v[t[i]], v[t[i + 2]] - v[t[i]]).magnitude * 0.5f;
                Assert.Greater(area, 1e-5f, "zero-area triangle at index " + i + " of " + kind);
            }
        }

        [TestCase(RoofKind.Flat)]
        [TestCase(RoofKind.Shed)]
        [TestCase(RoofKind.Gable)]
        [TestCase(RoofKind.Hip)]
        public void RoofFacesUpward_NotInsideOut(RoofKind kind)
        {
            // Winding is the one roof bug invisible in a screenshot: a back-faced roof looks
            // absent from above and solid from inside. The weather-facing surface must have
            // a genuinely upward normal.
            var m = RoofMesher.Generate(kind, 9f, 6f);
            var up = 0;
            foreach (var n in m.normals) if (n.y > 0.35f) up++;
            Assert.Greater(up, 0, kind + " has no upward-facing surface — winding is reversed");
        }

        [Test]
        public void FlatRoofIsExactlyHorizontal()
        {
            var m = RoofMesher.Generate(RoofKind.Flat, 8f, 8f);
            foreach (var n in m.normals)
                Assert.Greater(n.y, 0.99f, "a flat roof must face straight up");
            Assert.AreEqual(0f, MaxY(m), 1e-4f);
        }

        [Test]
        public void PitchDrivesHeight_AndPeakHeightAgreesWithTheMesh()
        {
            foreach (var kind in new[] { RoofKind.Shed, RoofKind.Gable, RoofKind.Hip })
            {
                var m = RoofMesher.Generate(kind, 10f, 6f, 40f, 0.5f);
                var predicted = RoofMesher.PeakHeight(kind, 6f, 40f, 0.5f);
                Assert.AreEqual(predicted, MaxY(m), 1e-3f,
                    kind + ": PeakHeight must match the mesh, or anything stacked on the roof floats");
            }
        }

        [Test]
        public void ZeroPitchCollapsesToFlat()
        {
            var m = RoofMesher.Generate(RoofKind.Gable, 8f, 5f, 0f);
            Assert.AreEqual(0f, MaxY(m), 1e-4f);
            Assert.AreEqual(0f, RoofMesher.PeakHeight(RoofKind.Gable, 5f, 0f), 1e-4f);
        }

        [Test]
        public void OverhangProjectsPastTheWallLine()
        {
            var m = RoofMesher.Generate(RoofKind.Gable, 10f, 6f, 30f, 0.75f);
            Assert.AreEqual(10f + 1.5f, m.bounds.size.x, 1e-3f, "eaves must overhang on both sides");
            Assert.AreEqual(6f + 1.5f, m.bounds.size.z, 1e-3f);
        }

        [Test]
        public void UvsAreNotDegenerate()
        {
            foreach (var kind in new[] { RoofKind.Flat, RoofKind.Shed, RoofKind.Gable, RoofKind.Hip })
            {
                var uv = RoofMesher.Generate(kind, 9f, 6f).uv;
                Assert.AreEqual(RoofMesher.Generate(kind, 9f, 6f).vertexCount, uv.Length);
                float minU = float.MaxValue, maxU = float.MinValue, minV = float.MaxValue, maxV = float.MinValue;
                foreach (var c in uv)
                {
                    minU = Mathf.Min(minU, c.x); maxU = Mathf.Max(maxU, c.x);
                    minV = Mathf.Min(minV, c.y); maxV = Mathf.Max(maxV, c.y);
                }
                Assert.Greater(maxU - minU, 0.01f, kind + " UVs collapse in U — the texture would smear");
                Assert.Greater(maxV - minV, 0.01f, kind + " UVs collapse in V");
            }
        }

        [Test]
        public void NarrowFootprintDegradesToAPyramid_InsteadOfInvertingTheRidge()
        {
            // A hip roof on a deep-but-narrow plot would push the ridge through itself.
            var m = RoofMesher.Generate(RoofKind.Hip, 3f, 30f, 35f);
            var v = m.vertices;
            var t = m.triangles;
            for (int i = 0; i < t.Length; i += 3)
            {
                var area = Vector3.Cross(v[t[i + 1]] - v[t[i]], v[t[i + 2]] - v[t[i]]).magnitude * 0.5f;
                Assert.Greater(area, 1e-5f);
            }
        }

        [Test]
        public void MaterialStemsAreNamedNotInvented()
        {
            // Each of these is a real Poly Haven folder under Assets/Concordia/PolyHaven/Textures.
            Assert.AreEqual("thatch_roof_angled", RoofMesher.MaterialStem(RoofKind.Gable, "grove"));
            Assert.AreEqual("roof_slates_02", RoofMesher.MaterialStem(RoofKind.Gable, "ash"));
            Assert.AreEqual("clay_roof_tiles", RoofMesher.MaterialStem(RoofKind.Gable, "court"));
            Assert.AreEqual("asphalt_02", RoofMesher.MaterialStem(RoofKind.Flat, "court"));
        }
    }
}
