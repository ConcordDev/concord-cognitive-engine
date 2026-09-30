// Live verification of the settlement compiler against the REAL Poly Haven kit.
//
// This is the check the whole pass was missing. SettlementCompilerTests pins the grammar
// and the roof math against a test seam (ModuleKit.FromNames) — real bugs, really caught,
// but no actual glb is touched there. This file imports the real
// modular_urban_apartments_facade_1k.glb through the real HubKit path and asserts that
// FacadeComposer produces actual geometry from it.
//
// It deliberately does NOT boot ConcordiaHub.unity. A full Play-mode world build wants
// ~5GB (megaworld chunks, hundreds of ModularPerson rigs, the whole continent) and that is
// what kept OOM-ing a loaded 16GB Mac. None of that is needed to answer the actual
// question: does the compiler turn a SettlementDef into real buildings. This needs Unity,
// the scripts, and ~121MB of glb.
//
// If the kit genuinely cannot load, these FAIL — they never quietly pass on an empty kit.

using System.Collections;
using System.Threading.Tasks;
using Concordia.Settlement;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;

namespace Concordia.Tests
{
    public class SettlementRealKitTests
    {
        const int TimeoutFrames = 20000;   // glb import is async; EditMode ticks fast

        static IEnumerator Await(Task task)
        {
            int guard = 0;
            while (!task.IsCompleted && guard++ < TimeoutFrames) yield return null;
            Assert.IsTrue(task.IsCompleted, "timed out waiting on an async HubKit/ModuleKit task");
            if (task.IsFaulted) Assert.Fail("async task threw: " + task.Exception);
        }

        static IEnumerator LoadKit(System.Action<ModuleKit> onReady)
        {
            var ensure = HubKit.EnsureLoaded();
            yield return Await(ensure);

            var load = ModuleKit.Load(ModuleKit.Apartments);
            yield return Await(load);
            onReady(load.Result);
        }

        [UnityTest]
        public IEnumerator RealApartmentsKit_ImportsAndExposesItsModules()
        {
            ModuleKit kit = null;
            yield return LoadKit(k => kit = k);

            Assert.IsNotNull(kit, "ModuleKit.Load returned null for " + ModuleKit.Apartments);
            Assert.IsTrue(kit.Ready,
                "the real apartments glb did not import — StreamingAssets/HubKit missing, or glTFast failed. " +
                "This is the load-bearing asset for every compiled facade.");

            // 147 modules in the real file; allow slack for a future re-bake, but a handful
            // would mean the sub-node index silently failed.
            Assert.Greater(kit.ModuleCount, 100,
                "only " + kit.ModuleCount + " modules indexed from the real kit — HubKit.IndexModules is not " +
                "finding the named sub-meshes (this is exactly the bug that made 361 modules unreachable).");

            // The grammar the composer actually depends on, resolved from the real asset.
            Assert.IsNotNull(kit.Pick(Course.Wall, Bay.Solid, Plan.Standard, 0), "no solid wall module");
            Assert.IsNotNull(kit.Pick(Course.Wall, Bay.Window, Plan.Standard, 0), "no window wall module");
            Assert.IsNotNull(kit.Pick(Course.Wall, Bay.Door, Plan.Standard, 0), "no door wall module");
            Assert.IsNotNull(kit.Pick(Course.Base, Bay.Solid, Plan.Standard, 0), "no base course module");
            Assert.IsNotNull(kit.Pick(Course.Crown, Bay.Solid, Plan.Standard, 0), "no crown course module");
        }

        [UnityTest]
        public IEnumerator RealKitModule_PlacesWithCorrectGridSizeAndOrientation()
        {
            ModuleKit kit = null;
            yield return LoadKit(k => kit = k);
            Assert.IsTrue(kit != null && kit.Ready, "kit unavailable");

            var holder = new GameObject("PlaceProbe").transform;
            try
            {
                var module = kit.Pick(Course.Wall, Bay.Solid, Plan.Standard, 0);
                var placed = kit.Place(module, holder, Vector3.zero, 0f);
                Assert.IsNotNull(placed, "HubKit.PlaceModule returned null for a module the kit says it has");

                var r = placed.GetComponentInChildren<Renderer>();
                Assert.IsNotNull(r, "placed module has no Renderer — the sub-mesh was not instantiated");

                // Measured off the glb: a standard wall bay is 3m x 3m. If the Blender Z-up
                // correction or the scale-100 were dropped, this reads ~0.03 or lies flat.
                var size = r.bounds.size;
                Assert.AreEqual(3.0f, Mathf.Max(size.x, size.z), 0.25f,
                    "wall bay width is " + size + " — expected ~3m. Blender scale/rotation handling is wrong.");
                Assert.AreEqual(3.0f, size.y, 0.25f,
                    "wall bay height is " + size.y + " — expected ~3m (module is lying flat if this is ~0).");
            }
            finally { if (holder) Object.DestroyImmediate(holder.gameObject); }
        }

        [UnityTest]
        public IEnumerator FacadeComposer_BuildsARealBuilding_FromTheRealKit()
        {
            ModuleKit kit = null;
            yield return LoadKit(k => kit = k);
            Assert.IsTrue(kit != null && kit.Ready, "kit unavailable");

            var root = new GameObject("CompileProbe").transform;
            try
            {
                var plot = new Plot
                {
                    Centre = new Vector2(0f, 0f),
                    Yaw = 0f,
                    Frontage = 9f,     // 3 bays
                    Depth = 6f,        // 2 bays
                    Storeys = 3,
                    DistrictId = "probe",
                    Purpose = "market",
                    Seed = 12345
                };

                var wallMat = HubLook.Pbr("brick_wall_003", new Color(0.78f, 0.76f, 0.72f), 0.02f, 0.2f, 2f);
                var roofMat = HubLook.Pbr("clay_roof_tiles", new Color(0.72f, 0.70f, 0.68f), 0.02f, 0.18f, 3f);

                var go = FacadeComposer.Build(root, plot, kit, wallMat, roofMat, RoofKind.Gable, 32f);
                Assert.IsNotNull(go, "FacadeComposer.Build returned null against a ready kit");

                var renderers = go.GetComponentsInChildren<Renderer>(true);
                Assert.Greater(renderers.Length, 30,
                    "only " + renderers.Length + " renderers — a 3-bay x 2-bay x 3-storey building should place " +
                    "base/dado/wall/cornice/crown courses on four faces plus quoins.");

                // The building must have real extent, not a collapsed pile at the origin.
                var bounds = renderers[0].bounds;
                foreach (var r in renderers) bounds.Encapsulate(r.bounds);
                Assert.Greater(bounds.size.y, 8f,
                    "building is only " + bounds.size.y + "m tall — courses are not stacking (expected ~" +
                    FacadeComposer.EaveHeight(3) + "m to the eave plus roof).");
                Assert.Greater(bounds.size.x, 6f, "building footprint too narrow: " + bounds.size);
                Assert.Greater(bounds.size.z, 4f, "building footprint too shallow: " + bounds.size);

                // The roof is generated geometry, not a kit module — prove it actually got made.
                var roof = go.transform.Find("Roof");
                Assert.IsNotNull(roof, "no Roof child — RoofMesher never ran for this building");
                var roofMesh = roof.GetComponent<MeshFilter>();
                Assert.IsNotNull(roofMesh, "Roof has no MeshFilter");
                Assert.Greater(roofMesh.sharedMesh.vertexCount, 0, "generated roof mesh is empty");

                Debug.Log("Concordia RealKit: built " + renderers.Length + " renderers, bounds " + bounds.size +
                          ", roof verts " + roofMesh.sharedMesh.vertexCount);
            }
            finally { if (root) Object.DestroyImmediate(root.gameObject); }
        }

        [UnityTest]
        public IEnumerator Compiler_IsDeterministic_SameSeedSameBuilding()
        {
            ModuleKit kit = null;
            yield return LoadKit(k => kit = k);
            Assert.IsTrue(kit != null && kit.Ready, "kit unavailable");

            var a = new GameObject("A").transform;
            var b = new GameObject("B").transform;
            try
            {
                var plot = new Plot
                {
                    Centre = Vector2.zero, Yaw = 0f, Frontage = 9f, Depth = 6f,
                    Storeys = 2, DistrictId = "probe", Purpose = "house", Seed = 999
                };
                var goA = FacadeComposer.Build(a, plot, kit, null, null, RoofKind.Flat, 0f);
                var goB = FacadeComposer.Build(b, plot, kit, null, null, RoofKind.Flat, 0f);
                Assert.IsNotNull(goA); Assert.IsNotNull(goB);

                var ra = goA.GetComponentsInChildren<Renderer>(true).Length;
                var rb = goB.GetComponentsInChildren<Renderer>(true).Length;
                Assert.AreEqual(ra, rb,
                    "same seed produced different buildings (" + ra + " vs " + rb + ") — layout is not deterministic, " +
                    "so a world would rebuild differently on every visit.");
            }
            finally
            {
                if (a) Object.DestroyImmediate(a.gameObject);
                if (b) Object.DestroyImmediate(b.gameObject);
            }
        }
    }
}
