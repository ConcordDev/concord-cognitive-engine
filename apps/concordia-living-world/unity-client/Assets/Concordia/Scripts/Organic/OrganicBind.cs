using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// Places the authored organic SoftEnter set into the living world.
    ///
    /// Registry: Assets/Concordia/Models/Generated/ORGANIC_MANIFEST.json (125 meshes).
    /// Bind contract: Assets/Concordia/Models/Generated/ORGANIC_BIND.json (30 rows).
    /// Import path: HubKit only. This class never builds a second mesh stack; it asks
    /// HubKit for the already-imported, already URP-upgraded template and instantiates it.
    ///
    /// Every registry mesh is a normalized unit box holding LOD0/LOD1/LOD2 as three
    /// sibling nodes, so a raw instantiate would draw all three at once. The bind builds
    /// a real LODGroup from those nodes and keeps the authored hierarchy underneath.
    ///
    /// Placement respects the authored laws. Each bind row carries a `law` token from the
    /// native-bible flower_law vocabulary, and Admissible() is the only place those tokens
    /// are interpreted: inside_42m keeps a footprint wholly within the Hub Flower Law disk
    /// (Canon.HubLawRadius, 42 m), outside_42m keeps it wholly between that lip and the
    /// city wall (Canon.WallRadius, 56 m), outside_wall keeps it beyond the wall, and
    /// outside_hub_disk (every non-Hub world) imposes no Hub radius rule at all. The
    /// Sundering stride (Canon.BlocksSunderingWalk) is enforced everywhere, the Arena is
    /// the warder steel exception and admits no organic row, a candidate slot is rejected
    /// when Physics finds anything already standing there, and the architecture 4 m /
    /// clutter 1 m snap from the native-bible bind schema is applied before every test.
    /// A registry row with no mesh places nothing and fakes nothing.
    /// </summary>
    public static class OrganicBind
    {
        public const string RootName = "OrganicBind";

        /// <summary>
        /// Longest a single row may wait for HubKit before it is named and skipped. This
        /// staging coroutine runs inside chunk construction, so it must never own a wait
        /// that has no end: an unresolved mesh is reported and the pass continues.
        /// </summary>
        const float ImportWaitSeconds = 40f;

        /// <summary>Bisects Canon.Gates first, so a Hub hall never lands on a gate spoke.</summary>
        static readonly float[] Azimuths =
        {
            22.5f, 67.5f, 112.5f, 157.5f, 202.5f, 247.5f, 292.5f, 337.5f,
            0f, 45f, 90f, 135f, 180f, 225f, 270f, 315f
        };

        static readonly HashSet<string> Placed = new HashSet<string>(StringComparer.Ordinal);

        /// <summary>
        /// Stage the organic set for one world inside that world's chunk.
        /// Called from WorldHeroCatalog.BindStaged, which already owns per-world hero
        /// presentation and already runs on the staged continent path.
        /// </summary>
        public static IEnumerator StageStaged(Transform chunk, WorldId world)
        {
            if (!chunk) yield break;

            // Static state outlives a Play session that did not domain-reload, and an
            // aborted pass leaves its keys behind; clear per pass so staging always places.
            Placed.Clear();

            // HubKit owns the single glTF import path, and LoadAll clears its own index while
            // it indexes MANIFEST.json, so it has to settle before the registry registers its
            // external stems. Bounded: a wait with no end here would strand the pass silently.
            var load = HubKit.EnsureLoaded();
            var loadDeadline = Time.realtimeSinceStartup + ImportWaitSeconds;
            while (!load.IsCompleted && Time.realtimeSinceStartup < loadDeadline) yield return null;
            if (!load.IsCompleted)
            {
                Debug.LogWarning("[Concordia] OrganicBind: HubKit.EnsureLoaded did not settle within "
                                 + ImportWaitSeconds + "s; organic staging skipped for " + world + ".");
                yield break;
            }

            OrganicKit.EnsureIndexed();
            if (OrganicKit.Count == 0)
            {
                Debug.LogWarning("[Concordia] OrganicBind: the organic registry indexed no meshes; "
                                 + "nothing staged for " + world + ".");
                yield break;
            }

            var rows = OrganicKit.RowsFor(world);
            if (rows.Length == 0)
            {
                Debug.LogWarning("[Concordia] OrganicBind: no bind rows for " + world + ".");
                yield break;
            }

            var parent = chunk.Find("VisualFidelity") ?? chunk;
            var existing = parent.Find(RootName);
            if (existing && existing.Find(world.ToString())) yield break;

            var root = existing ? existing : new GameObject(RootName).transform;
            if (!existing) root.SetParent(parent, false);
            var worldRoot = new GameObject(world.ToString()).transform;
            worldRoot.SetParent(root, false);

            var placed = 0;
            var skipped = 0;
            var heroPos = Vector3.zero;
            var heroYaw = 0f;
            var heroHalf = 0f;
            var heroLaw = "";
            var haveHero = false;

            Debug.Log("[Concordia] OrganicBind " + world + " begin: rows=" + rows.Length
                      + " under " + parent.name);

            for (var i = 0; i < rows.Length; i++)
            {
                var row = rows[i];
                if (row == null || !OrganicKit.Has(row.id)) continue;

                var half = Mathf.Max(1f, row.maxDimension) * 0.5f;
                var pos = Vector3.zero;
                var yaw = 0f;
                var havePos = false;

                // The whole row - law interpretation, ground test, and the mesh wait - is
                // guarded. One row must never cost a world its authored set, and it must never
                // abort the pass before the summary, which is the only line that reports what
                // actually happened.
                try
                {
                    if (string.Equals(row.role, "hero", StringComparison.OrdinalIgnoreCase))
                    {
                        pos = Slot(world, HeroRadius(world), row, out yaw);
                        heroPos = pos;
                        heroYaw = yaw;
                        heroHalf = half;
                        heroLaw = row.law;
                        haveHero = true;
                        havePos = true;
                    }
                    else
                    {
                        var landmark = string.Equals(row.role, "landmark", StringComparison.OrdinalIgnoreCase);
                        // SnapYaw faces the hero inward, so its forward axis points at the court.
                        // The landmark and the flora therefore step in from the hall along that
                        // inward axis: a Hub hall is authored outside_42m while its urn and
                        // linden are authored inside_42m, so inbound is the only direction that
                        // lands each of the three rows inside its own law.
                        var inward = Quaternion.Euler(0f, heroYaw, 0f) * Vector3.forward;
                        var step = landmark ? heroHalf + 10f : heroHalf + 22f;
                        pos = haveHero
                            ? Snap(heroPos + inward * step, row.snapM)
                            : Slot(world, landmark ? 12f : 20f, row, out yaw);
                        havePos = true;
                        if (haveHero)
                        {
                            yaw = landmark ? heroYaw + 180f : heroYaw;
                            if (!Admissible(world, row.law, pos, half) || !FreeGround(pos, half))
                                pos = Slot(world, heroHalf + (landmark ? 8f : 12f), row, out yaw);
                        }
                    }
                }
                catch (Exception e)
                {
                    Debug.LogWarning("[Concordia] OrganicBind: '" + row.id + "' in " + world
                                     + " could not resolve a placeable slot: " + e.Message);
                }

                if (!havePos)
                {
                    skipped++;
                    yield return null;
                    continue;
                }

                // Wait for the mesh before composing. TryGet deliberately misses on its first
                // call while the import is in flight, and this chunk is never revisited, so a
                // miss here would leave the SoftEnter set invisible. Prewarm is bounded in
                // HubKit itself and this wait is bounded here, so a glb that never lands is
                // named and skipped rather than parking the pass.
                var warm = HubKit.Prewarm(row.id);
                var meshDeadline = Time.realtimeSinceStartup + ImportWaitSeconds;
                while (!warm.IsCompleted && Time.realtimeSinceStartup < meshDeadline) yield return null;
                if (!warm.IsCompleted)
                {
                    Debug.LogWarning("[Concordia] OrganicBind: HubKit import for '" + row.id + "' in " + world
                                     + " did not settle within " + ImportWaitSeconds + "s; row skipped.");
                    skipped++;
                    yield return null;
                    continue;
                }

                if (!HubKit.TryGet(row.id, out var template) || !template)
                {
                    Debug.LogWarning("[Concordia] OrganicBind: registry mesh '" + row.id + "' in " + world
                                     + " is not in HubKit's runtime index; row skipped, no stand-in placed.");
                    skipped++;
                    yield return null;
                    continue;
                }

                // One mesh that fails to compose must not cost the whole world its authored set.
                try
                {
                    if (Place(worldRoot, row, pos, yaw, world)) placed++;
                    else skipped++;
                }
                catch (Exception e)
                {
                    skipped++;
                    Debug.LogWarning("[Concordia] OrganicBind: '" + row.id + "' in " + world
                                     + " failed to compose and was skipped: " + e.Message);
                }

                yield return null;
            }

            Debug.Log("[Concordia] OrganicBind " + world + ": placed " + placed + " of " + rows.Length
                      + " authored meshes; skipped=" + skipped + "; hero_law_ok="
                      + (!haveHero || Admissible(world, heroLaw, heroPos, heroHalf)));
            yield return null;
        }

        static float HeroRadius(WorldId world) =>
            // Hub: the authored hall law is outside_42m, so the hall centre must clear the
            // Flower Law lip by its own half-width. At 49 m a 12 m hall spans 43 m to 55 m,
            // which is outside Canon.HubLawRadius 42 and inside Canon.WallRadius 56, and it
            // also clears the Ring of Doors (Canon.RingRadius 34). Other worlds have no Hub
            // radius rule, so the hero sits inside the arrival ring.
            world == WorldId.Hub ? 49f : 26f;

        /// <summary>
        /// Ring scale candidates, tried in order around each azimuth. A wider or tighter
        /// ring is a different set of grid-snapped points, so a hall that is walled in at
        /// 49 m can still find lawful, free ground without leaving its authored law.
        /// </summary>
        static readonly float[] RadiusScales = { 1f, 0.84f, 1.16f };

        /// <summary>
        /// One authored mesh: import template, build the LODGroup, fit the bind metres,
        /// ground it on the host origin, collide it, and record its registry provenance.
        /// Returns null when the registry has no mesh for the id — never a stand-in.
        /// </summary>
        public static GameObject Place(Transform parent, OrganicKit.BindRow row, Vector3 pos, float yaw, WorldId world)
        {
            if (!parent || row == null) return null;
            var key = world + ":" + row.id;
            if (!Placed.Add(key)) return null;

            if (!OrganicKit.Has(row.id))
            {
                Debug.LogWarning("[Concordia] OrganicBind: no registry mesh for '" + row.id + "'; nothing placed.");
                return null;
            }

            if (!HubKit.TryGet(row.id, out var template) || !template)
            {
                // HubKit imports on first request and reports a miss for that call. Release
                // the key so a later staging pass (world re-entry) can pick the mesh up.
                Placed.Remove(key);
                return null;
            }

            var host = new GameObject("Organic_" + row.id);
            host.transform.SetParent(parent, false);
            host.transform.position = pos;
            host.transform.rotation = Quaternion.Euler(0f, yaw, 0f);

            var art = UnityEngine.Object.Instantiate(template, host.transform);
            art.name = "Asset";
            art.transform.localPosition = Vector3.zero;
            art.transform.localRotation = Quaternion.identity;
            art.transform.localScale = Vector3.one;
            foreach (var t in art.GetComponentsInChildren<Transform>(true))
                if (t) t.gameObject.SetActive(true);
            foreach (var r in art.GetComponentsInChildren<Renderer>(true))
                if (r) r.enabled = true;

            var lodLevels = BuildLods(art);
            FreePacks.FitMax(art, Mathf.Max(0.25f, row.maxDimension));
            GroundAndCenter(art);
            Collide(art, row, out var colliderState);

            var marker = host.AddComponent<OrganicBindMarker>();
            marker.id = row.id;
            marker.worldId = world.ToString();
            marker.role = row.role;
            marker.sourceFile = OrganicKit.FileFor(row.id);
            marker.worldMetres = row.maxDimension;
            marker.lodLevels = lodLevels;
            marker.colliderState = colliderState;
            marker.bindNote = row.note;
            marker.stagedStatus = "bound-in-play-from-organic-registry";
            return host;
        }

        /// <summary>
        /// LOD0/LOD1/LOD2 siblings into one LODGroup. Returns the level count, or 1 when
        /// the row authors a single mesh or no LODGroup could be composed.
        /// </summary>
        static int BuildLods(GameObject art)
        {
            var levels = new List<Renderer>[3];
            foreach (var t in art.GetComponentsInChildren<Transform>(true))
            {
                if (!t) continue;
                var name = (t.name ?? "").ToUpperInvariant();
                var index = name.EndsWith("_LOD0", StringComparison.Ordinal) ? 0
                    : name.EndsWith("_LOD1", StringComparison.Ordinal) ? 1
                    : name.EndsWith("_LOD2", StringComparison.Ordinal) ? 2 : -1;
                if (index < 0) continue;
                var renderers = t.GetComponentsInChildren<Renderer>(true);
                if (renderers.Length == 0) continue;
                levels[index] ??= new List<Renderer>(2);
                levels[index].AddRange(renderers);
            }

            if (levels[0] == null || levels[0].Count == 0) return 1;

            var lods = new List<LOD>(3) { new LOD(0.6f, levels[0].ToArray()) };
            if (levels[1] != null) lods.Add(new LOD(0.25f, levels[1].ToArray()));
            if (levels[2] != null) lods.Add(new LOD(0.02f, levels[2].ToArray()));

            // GetComponent hands back a pseudo-null wrapper for a component that is not
            // attached, and ?? does not treat that wrapper as null, so a ?? AddComponent
            // fallback silently never runs and SetLODs throws MissingComponentException -
            // which aborted the whole staging coroutine before anything was placed.
            // TryGetComponent is a real bool test and Unity's operator bool catches a
            // pseudo-null if one is ever handed back.
            if (!art.TryGetComponent(out LODGroup group) || !group) group = art.AddComponent<LODGroup>();
            if (!group) return 1;

            group.SetLODs(lods.ToArray());
            group.RecalculateBounds();
            return lods.Count;
        }

        /// <summary>
        /// Registry meshes are pivot-centered unit boxes (min.y = -0.5), so the fitted
        /// instance is moved until its base sits on the host origin and its footprint is
        /// centered on the placed position.
        /// </summary>
        static void GroundAndCenter(GameObject art)
        {
            var host = art.transform.parent;
            var anchor = host ? host.position : Vector3.zero;
            var bounds = WorldBounds(art);
            if (bounds.size.sqrMagnitude < 0.0001f) return;
            art.transform.position += new Vector3(anchor.x - bounds.center.x, anchor.y - bounds.min.y, anchor.z - bounds.center.z);
        }

        static void Collide(GameObject art, OrganicKit.BindRow row, out string state)
        {
            var mode = (row.colliders ?? "").Trim().ToLowerInvariant();
            if (mode == "mesh")
            {
                var added = 0;
                foreach (var t in art.GetComponentsInChildren<Transform>(true))
                {
                    var filter = t ? t.GetComponent<MeshFilter>() : null;
                    if (!filter || !filter.sharedMesh) continue;
                    if (t.name.ToUpperInvariant().Contains("_LOD1") || t.name.ToUpperInvariant().Contains("_LOD2")) continue;
                    var mesh = t.gameObject.AddComponent<MeshCollider>();
                    mesh.sharedMesh = filter.sharedMesh;
                    added++;
                }
                if (added > 0)
                {
                    state = "mesh-collider-lod0-open-doorway (" + added + " parts)";
                    return;
                }
            }

            if (mode == "trunk")
            {
                FreePacks.TrunkCollider(art);
                if (art.GetComponentInChildren<Collider>())
                {
                    state = "trunk-collider";
                    return;
                }
            }

            FreePacks.MakeWalkable(art);
            state = art.GetComponentInChildren<Collider>() ? "walkable-box" : "no-collider";
        }

        static Vector3 Slot(WorldId world, float radius, OrganicKit.BindRow row, out float yaw)
        {
            var half = Mathf.Max(1f, row.maxDimension) * 0.5f;
            var lawful = Vector3.zero;
            var haveLawful = false;

            for (var s = 0; s < RadiusScales.Length; s++)
            {
                var ring = radius * RadiusScales[s];
                for (var i = 0; i < Azimuths.Length; i++)
                {
                    var a = Azimuths[i] * Mathf.Deg2Rad;
                    var flat = Snap(new Vector3(Mathf.Cos(a) * ring, 0f, Mathf.Sin(a) * ring), row.snapM);
                    if (!Admissible(world, row.law, flat, half)) continue;

                    // Remember the first lawful landing even when the ground there is busy.
                    // Holding it keeps the row inside its authored law and keeps authored
                    // content in the world; the unchecked radial default did neither and
                    // dropped the Hub hall onto the Fantasy gate.
                    if (!haveLawful)
                    {
                        lawful = flat;
                        haveLawful = true;
                    }

                    if (!FreeGround(flat, half)) continue;
                    yaw = SnapYaw(flat);
                    return new Vector3(flat.x, GroundY(flat), flat.z);
                }
            }

            if (haveLawful)
            {
                Debug.LogWarning("[Concordia] OrganicBind: every free slot for '" + row.id + "' in " + world
                                 + " was taken; holding the first lawful slot at " + lawful
                                 + " (law " + row.law + ").");
                yaw = SnapYaw(lawful);
                return new Vector3(lawful.x, GroundY(lawful), lawful.z);
            }

            // No ring carries a lawful landing at all. Place on the primary ring anyway so
            // authored content is never silently dropped, and name the law that was missed.
            var fallback = Snap(new Vector3(0f, 0f, radius), row.snapM);
            Debug.LogWarning("[Concordia] OrganicBind: no slot for '" + row.id + "' in " + world
                             + " satisfies its authored law '" + row.law + "'; placing on the primary ring at "
                             + fallback + ".");
            yaw = SnapYaw(fallback);
            return new Vector3(fallback.x, GroundY(fallback), fallback.z);
        }

        /// <summary>
        /// The single interpreter of the authored law tokens. A row's footprint, not just its
        /// pivot, must satisfy the law, so every test is against radius plus or minus the
        /// half-extent. The Hub Flower Law is a disk of 42 m and the city wall stands at 56 m.
        /// The Arena at (0, 0, 18) is the warder exception: live steel may not be drawn there,
        /// so no organic row is staged inside it either. The Sundering stride applies in every
        /// world, Hub included.
        /// </summary>
        static bool Admissible(WorldId world, string law, Vector3 p, float half)
        {
            if (world == WorldId.Hub)
            {
                var r = Mathf.Sqrt(p.x * p.x + p.z * p.z);
                switch ((law ?? "").Trim().ToLowerInvariant())
                {
                    case "inside_42m":
                        if (r + half > Canon.HubLawRadius) return false;
                        break;
                    case "outside_42m":
                        if (r - half < Canon.HubLawRadius) return false;
                        if (r + half > Canon.WallRadius) return false;
                        break;
                    case "outside_wall":
                        if (r - half < Canon.WallRadius) return false;
                        break;
                    default:
                        // outside_hub_disk imposes no Hub radius rule; the Sundering stride
                        // below is the only Hub-wide constraint that still applies.
                        break;
                }

                if (Canon.InArena(p)) return false;
            }

            return !Canon.BlocksSunderingWalk(p, half);
        }

        static bool FreeGround(Vector3 p, float half)
        {
            var y = GroundY(p);
            var centre = new Vector3(p.x, y + half + 0.25f, p.z);
            var extents = new Vector3(half, half, half);
            return !Physics.CheckBox(centre, extents, Quaternion.identity, ~0, QueryTriggerInteraction.Ignore);
        }

        static float GroundY(Vector3 p)
        {
            var origin = new Vector3(p.x, p.y + 80f, p.z);
            if (Physics.Raycast(origin, Vector3.down, out var hit, 240f, ~0, QueryTriggerInteraction.Ignore))
                return hit.point.y;
            return p.y;
        }

        static Vector3 Snap(Vector3 p, int metres)
        {
            var m = Mathf.Max(1, metres);
            return new Vector3(Mathf.Round(p.x / m) * m, p.y, Mathf.Round(p.z / m) * m);
        }

        /// <summary>Architecture yaw is snapped to 90 degrees per the bind schema.</summary>
        static float SnapYaw(Vector3 p)
        {
            var facing = Mathf.Atan2(-p.x, -p.z) * Mathf.Rad2Deg;
            return Mathf.Round(facing / 90f) * 90f;
        }

        static Bounds WorldBounds(GameObject go)
        {
            var renderers = go.GetComponentsInChildren<Renderer>(true);
            if (renderers.Length == 0) return new Bounds(go.transform.position, Vector3.zero);
            var bounds = renderers[0].bounds;
            for (var i = 1; i < renderers.Length; i++) bounds.Encapsulate(renderers[i].bounds);
            return bounds;
        }
    }

    /// <summary>Provenance for one placed organic mesh, readable in the inspector.</summary>
    [DisallowMultipleComponent]
    public sealed class OrganicBindMarker : MonoBehaviour
    {
        public string id;
        public string worldId;
        public string role;
        public string sourceFile;
        public float worldMetres;
        public int lodLevels;
        public string colliderState;
        public string bindNote;
        public string stagedStatus;
    }
}
