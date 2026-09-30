using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// Unburned Court: plaza floor, monument, and gates from imported packs only.
    /// No primitive ring-city, no floating dome cubes. One missing-prop if a mesh is gone.
    /// </summary>
    public static class HubPlaza
    {
        public static void Build(Transform root)
        {
            if (ConcordiaHost.LeanPlay)
            {
                UnityEngine.Debug.Log("[Concordia] LeanPlay: sync HubPlaza thin (use BuildStaged for full look)");
                FloorLean(root);
                Monument(root);
                GatesLean(root);
                HubLook.Point(root, "MonumentLight", new Vector3(0f, 4.2f, 0f), new Color(0.55f, 0.78f, 0.92f), 0.65f, 12f, false);
                return;
            }
            Floor(root);
            Monument(root);
            Sanctum(root);
            Gates(root);
            Banners(root);
            Clutter(root);
            Dust(root, new Color(0.55f, 0.82f, 0.88f));
            Lights(root);
        }

        public static System.Collections.IEnumerator BuildStaged(Transform root)
        {
            UnityEngine.Debug.Log("[Concordia] LeanPlay: staged full HubPlaza begin");
            yield return FloorStaged(root);
            Monument(root);
            if (ConcordiaHost.LeanPlay)
            {
                FreePacks.SpawnStore("furnace", root, new Vector3(1.8f, 0f, 0.6f), 25f, 1.6f, required: false);
                FreePacks.SpawnStore("cauldron", root, new Vector3(-1.6f, 0f, 0.8f), -18f, 1.1f, required: false);
            }
            yield return null;
            Sanctum(root);
            yield return null;
            foreach (var gate in Canon.Gates)
            {
                PlaceGate(root, gate);
                yield return null;
            }
            Banners(root);
            yield return null;
            Clutter(root);
            yield return null;
            Dust(root, new Color(0.55f, 0.82f, 0.88f));
            Lights(root);
            UnityEngine.Debug.Log("[Concordia] LeanPlay: staged full HubPlaza done");
            yield return null;
        }

        static void Lights(Transform root)
        {
            HubLook.Point(root, "MonumentLight", new Vector3(0f, 4.2f, 0f), new Color(0.55f, 0.78f, 0.92f), 0.65f, 12f, false);
            HubLook.Point(root, "RimWarm", new Vector3(18f, 4f, -12f), new Color(1f, 0.42f, 0.22f), 1.4f, 16f, false);
            HubLook.Point(root, "RimCool", new Vector3(-16f, 5f, 14f), new Color(0.35f, 0.72f, 0.82f), 1.6f, 18f, false);
            HubLook.Shaft(root, new Vector3(0f, 16f, 8f), new Vector3(0.12f, -1f, 0.35f), new Color(0.7f, 0.88f, 0.92f), 18f);
            HubLook.Shaft(root, new Vector3(-6f, 18f, 4f), new Vector3(-0.08f, -1f, 0.22f), new Color(0.62f, 0.84f, 0.90f), 16f);
            HubLook.Shaft(root, new Vector3(7f, 17f, 10f), new Vector3(0.18f, -1f, 0.28f), new Color(0.78f, 0.90f, 0.94f), 15f);
        }

        static System.Collections.IEnumerator FloorStaged(Transform root)
        {
            var court = HubLook.WetStone("patterned_cobblestone_02", 5.5f);
            int placed = 0;
            const float step = 5.6f;
            const float extent = 32f;
            const int batch = 6;
            bool havePanel = FreePacks.Mesh("granite_panel") != null;
            for (float x = -extent; havePanel && x <= extent; x += step)
            for (float z = -extent; z <= extent; z += step)
            {
                if (x * x + z * z > (extent + 1f) * (extent + 1f)) continue;
                // Only a thin panel tiles well. The old fallbacks ("platform",
                // "platform.001") are 1.05 m plinths — ~130 of them turned the
                // Court into a checkerboard of raised blocks with gaps.
                var tile = FreePacks.SpawnStore("granite_panel", root, new Vector3(x, 0f, z), 0f, 5.4f, required: false, byHeight: false);
                if (!tile) continue;
                tile.name = "CourtTile_" + placed;
                PaintCourt(tile, court);
                placed++;
                if (placed % batch == 0) yield return null;
            }
            if (placed == 0)
            {
                var floor = FreePacks.SpawnStore("plaza_floor", root, Vector3.zero, 0f, 0.35f, required: false, byHeight: false)
                            ?? ContinuousFloor(root, court);
                PaintCourt(floor, court);
            }
            var arena = FreePacks.SpawnStore("granite_panel", root, Canon.Arena, 0f, 8f, required: false, byHeight: false)
                        ?? FreePacks.SpawnStore("platform.001", root, Canon.Arena, 0f, 8f, required: false, byHeight: false)
                        ?? FreePacks.SpawnStore("platform", root, Canon.Arena, 0f, 8f, required: true, byHeight: false);
            if (arena)
            {
                arena.name = "Arena";
                PaintCourt(arena, court);
            }
            yield return null;
        }

        static void FloorLean(Transform root)
        {
            var court = HubLook.WetStone("patterned_cobblestone_02", 5.5f);
            var floor = FreePacks.SpawnStore("plaza_floor", root, Vector3.zero, 0f, 0.35f, required: false, byHeight: false)
                        ?? FreePacks.SpawnStore("granite_panel", root, Vector3.zero, 0f, 24f, required: false, byHeight: false)
                        ?? HubLook.Prim(root, PrimitiveType.Cylinder, new Vector3(0f, 0.02f, 0f), new Vector3(28f, 0.04f, 28f), court, "CourtFloorLean");
            if (floor) { floor.name = "CourtFloorLean"; PaintCourt(floor, court); }
            var arena = FreePacks.SpawnStore("granite_panel", root, Canon.Arena, 0f, 8f, required: false, byHeight: false)
                        ?? FreePacks.SpawnStore("platform", root, Canon.Arena, 0f, 8f, required: false, byHeight: false);
            if (arena) { arena.name = "Arena"; PaintCourt(arena, court); }
            CourtGroundDress.Ensure();
        }

        static void Floor(Transform root)
        {
            var court = HubLook.WetStone("patterned_cobblestone_02", 5.5f);
            int placed = 0;
            const float step = 5.6f;
            const float extent = 32f;
            bool havePanel = FreePacks.Mesh("granite_panel") != null;
            for (float x = -extent; havePanel && x <= extent; x += step)
            for (float z = -extent; z <= extent; z += step)
            {
                if (x * x + z * z > (extent + 1f) * (extent + 1f)) continue;
                // Only a thin panel tiles well. The old fallbacks ("platform",
                // "platform.001") are 1.05 m plinths — ~130 of them turned the
                // Court into a checkerboard of raised blocks with gaps.
                var tile = FreePacks.SpawnStore("granite_panel", root, new Vector3(x, 0f, z), 0f, 5.4f, required: false, byHeight: false);
                if (!tile) continue;
                tile.name = "CourtTile_" + placed;
                PaintCourt(tile, court);
                placed++;
            }
            if (placed == 0)
            {
                var floor = FreePacks.SpawnStore("plaza_floor", root, Vector3.zero, 0f, 0.35f, required: false, byHeight: false)
                            ?? ContinuousFloor(root, court);
                PaintCourt(floor, court);
            }
            var arena = FreePacks.SpawnStore("granite_panel", root, Canon.Arena, 0f, 8f, required: false, byHeight: false)
                        ?? FreePacks.SpawnStore("platform.001", root, Canon.Arena, 0f, 8f, required: false, byHeight: false)
                        ?? FreePacks.SpawnStore("platform", root, Canon.Arena, 0f, 8f, required: true, byHeight: false);
            if (arena)
            {
                arena.name = "Arena";
                PaintCourt(arena, court);
            }
        }

        /// One flat paved disc over the tile grid's footprint (radius ~33 m).
        /// Named CourtTile_* so CourtGroundDress still re-materials it;
        /// PrimSurface gives it world-sized texture tiling.
        static GameObject ContinuousFloor(Transform root, Material court)
            => HubLook.PrimSurface(root, PrimitiveType.Cylinder, new Vector3(0f, 0.03f, 0f),
                new Vector3(66f, 0.03f, 66f), court, "CourtTile_Floor", true);

        static void PaintCourt(GameObject go, Material court)
        {
            if (!go || !court) return;
            foreach (var r in go.GetComponentsInChildren<Renderer>(true))
                if (r) r.sharedMaterial = court;
        }

static void Monument(Transform root)
        {
            var col = FreePacks.SpawnStore("stone_column", root, Vector3.zero, 0f, 5.8f, required: false)
                      ?? FreePacks.SpawnStore("stone_column.001", root, Vector3.zero, 0f, 5.8f, required: false);
            if (!col)
            {
                col = BuildCivicHall(root);
                if (!col)
                {
                    // Last authored fallback: reuse the resolved gate asset rather than
                    // manufacturing a primitive or silently leaving the Court empty.
                    col = FreePacks.SpawnStore("large_iron_gate", root, new Vector3(0f, 0f, 8f), 180f, 8.8f, required: false)
                          ?? FreePacks.Spawn("large_iron_gate_1k", root, new Vector3(0f, 0f, 8f), 180f, 8.8f, required: false);
                    if (col)
                    {
                        FreePacks.StripColliders(col);
                        HubLook.StoneDress(col);
                        col.name = "CourtMonumentGate";
                    }
                }
            }
            if (col)
            {
                col.name = string.IsNullOrEmpty(col.name) ? "Monument" : col.name;
                UsePlace.Stamp(col, "Commune", "The Court does not speak first. You came anyway.");
            }
            else
            {
                var marker = new GameObject("MonumentVisualMissing");
                marker.transform.SetParent(root, false);
                marker.hideFlags = HideFlags.DontSave;
                UnityEngine.Debug.LogWarning("[Concordia] Court monument kit unresolved; no primitive identity fallback was created.");
            }
            FreePacks.SpawnStore("furnace", root, new Vector3(1.8f, 0f, 0.6f), 25f, 1.6f, required: false);
            FreePacks.SpawnStore("cauldron", root, new Vector3(-1.6f, 0f, 0.8f), -18f, 1.1f, required: false);
        }

static GameObject BuildCivicHall(Transform root)
        {
            var hall = new GameObject("CourtCivicHall");
            hall.transform.SetParent(root, false);
            var placed = 0;
            var wall = FreePacks.SpawnStore("wall", hall.transform, new Vector3(0f, 0f, 10f), 180f, 12f, required: false, byHeight: false);
            if (wall)
            {
                wall.name = "CivicHallWall";
                FreePacks.StripColliders(wall);
                HubLook.StoneDress(wall);
                placed++;
            }
            for (var side = -1; side <= 1; side += 2)
            {
                var tower = FreePacks.SpawnStore("tower-square-base", hall.transform, new Vector3(side * 6.5f, 0f, 10f), 180f, 6.5f, required: false, byHeight: false);
                if (tower)
                {
                    tower.name = side < 0 ? "CivicHallTowerWest" : "CivicHallTowerEast";
                    FreePacks.StripColliders(tower);
                    HubLook.StoneDress(tower);
                    placed++;
                }
                var column = FreePacks.SpawnStore("column", hall.transform, new Vector3(side * 3.8f, 0f, 8.2f), 180f, 4.6f, required: false, byHeight: false);
                if (column)
                {
                    FreePacks.StripColliders(column);
                    HubLook.StoneDress(column);
                    placed++;
                }
                var banner = FreePacks.SpawnStore("banner", hall.transform, new Vector3(side * 3.8f, 4.5f, 8.0f), 180f, 2.8f, required: false, byHeight: false);
                if (banner)
                {
                    FreePacks.StripColliders(banner);
                    FreePacks.DyeCloth(banner, new Color(0.70f, 0.06f, 0.08f));
                    placed++;
                }
            }
            if (placed == 0)
            {
                Object.Destroy(hall);
                return null;
            }
            return hall;
        }


        static void GatesLean(Transform root)
        {
            foreach (var gate in Canon.Gates)
            {
                var p = new Vector3(Mathf.Cos(gate.angle) * Canon.RingRadius, 0f, Mathf.Sin(gate.angle) * Canon.RingRadius);
                var hold = new GameObject("Gate_" + gate.shortName).transform;
                hold.SetParent(root, false);
                hold.position = p;
                hold.rotation = Quaternion.LookRotation(-p.normalized);
                var go = hold.gameObject;
                go.AddComponent<WorldGate>().def = gate;
                var box = go.AddComponent<BoxCollider>();
                box.isTrigger = true;
                box.center = new Vector3(0f, 1.4f, 0.6f);
                box.size = new Vector3(6f, 3.2f, 3.2f);
                PlaceStoneLite(hold, gate);
                PortalMembrane(hold, new Vector3(0f, 2f, 0.1f), PortalColor(gate));
            }
        }

        /// <summary>
        /// A gate is a doorway to another world, not a fence. From outside, an
        /// archway with only a tiny 22-particle swirl and a dim point light
        /// reads as an inert iron gate standing in a field (owner feedback,
        /// 2026-09-20: "random black gates on screen doing nothing"). This is
        /// the unmistakable tell — a large, always-on, additive-unlit glowing
        /// membrane filling the archway opening, double-sided, color-identified
        /// per world (GateDef.color / PortalColor), animated so it reads as
        /// active even in a single still frame. Cheap: two quads + one script,
        /// no new shader asset, no per-frame allocation.
        /// </summary>
        static void PortalMembrane(Transform parent, Vector3 local, Color c)
        {
            var hold = new GameObject("PortalMembrane").transform;
            hold.SetParent(parent, false);
            hold.localPosition = local;
            hold.localRotation = Quaternion.identity;

            var mat = HubLook.UnlitAlpha(c);
            for (int side = 0; side < 2; side++)
            {
                var quad = GameObject.CreatePrimitive(PrimitiveType.Quad);
                quad.name = "PortalFace";
                Object.Destroy(quad.GetComponent<Collider>());
                quad.transform.SetParent(hold, false);
                quad.transform.localRotation = side == 0 ? Quaternion.identity : Quaternion.Euler(0f, 180f, 0f);
                quad.transform.localScale = new Vector3(3.0f, 4.1f, 1f);
                var r = quad.GetComponent<Renderer>();
                if (r) r.sharedMaterial = mat;
            }
            var shimmer = hold.gameObject.AddComponent<PortalShimmer>();
            shimmer.baseColor = c;
            shimmer.sharedMaterial = mat;
        }

        static void PlaceStoneLite(Transform hold, GateDef gate)
        {
            var mat = HubLook.WetStone("patterned_cobblestone_02", 2.2f);
            var marker = HubLook.Prim(hold, PrimitiveType.Cube, new Vector3(0f, 0.9f, -1.2f), new Vector3(1.6f, 1.8f, 0.25f), mat, "GateMarker_" + gate.shortName);
            HideVisual(marker);
        }

        static void Gates(Transform root)
        {
            foreach (var gate in Canon.Gates)
                PlaceGate(root, gate);
        }

        static void PlaceGate(Transform root, GateDef gate)
        {
            var p = new Vector3(Mathf.Cos(gate.angle) * Canon.RingRadius, 0f, Mathf.Sin(gate.angle) * Canon.RingRadius);
            var hold = new GameObject("Gate_" + gate.shortName).transform;
            hold.SetParent(root, false);
            hold.position = p;
            hold.rotation = Quaternion.LookRotation(-p.normalized);
            var portalCol = PortalColor(gate);
            // Owner call (2026-09-20): drop the wrought-iron arch mesh — "keep
            // the portal, drop the metal gate, it's tacky." The portal itself
            // (PortalMembrane + Swirl + light) is the gate now; no fence prop.
            PortalMembrane(hold, new Vector3(0f, 2f, 0.1f), portalCol);
            Swirl(hold, new Vector3(0f, 2.4f, 0.2f), portalCol);
            var go = hold.gameObject;
            go.AddComponent<WorldGate>().def = gate;
            var box = go.AddComponent<BoxCollider>();
            box.center = new Vector3(0f, 2f, 0f);
            box.size = new Vector3(8.4f, 5.4f, 3.6f);
            box.isTrigger = true;

            var plaque = FreePacks.SpawnStore("granite_panel", hold, hold.TransformPoint(new Vector3(3.4f, 0f, 0.4f)), hold.eulerAngles.y, 1.2f, required: false);
            if (!plaque)
                plaque = HubLook.Prim(hold, PrimitiveType.Cube, new Vector3(3.4f, 0.45f, 0.4f), new Vector3(0.8f, 0.9f, 0.14f), HubLook.Lit(new Color(0.42f, 0.32f, 0.18f), 0.08f, 0.22f), "Plaque");
            var stone = plaque.GetComponent<LoreStone>() ?? plaque.AddComponent<LoreStone>();
            stone.title = gate.name;
            stone.text = gate.refusal + " — " + gate.theNo;

            var flag = FreePacks.SpawnStore("flag-banner-long", hold, hold.TransformPoint(new Vector3(0f, 0f, -0.6f)), hold.eulerAngles.y, 3.2f, required: false)
                       ?? FreePacks.Spawn("flag-banner-long", hold, hold.TransformPoint(new Vector3(0f, 0f, -0.6f)), hold.eulerAngles.y, 3.2f, required: false);
            if (flag)
            {
                FreePacks.StripColliders(flag);
                FreePacks.DyeCloth(flag, Color.Lerp(new Color(0.62f, 0.12f, 0.10f), portalCol, 0.22f));
            }
            HubLook.Point(hold, "PortalFill", hold.TransformPoint(new Vector3(0f, 4.2f, 1.2f)), Color.Lerp(portalCol, new Color(1f, 0.72f, 0.38f), 0.5f), 1.15f, 14f, false);
        }

        static bool ThinArch(GameObject go)
        {
            if (!go) return true;
            var r = go.GetComponentInChildren<Renderer>();
            if (!r) return true;
            var s = r.bounds.size;
            return Mathf.Max(s.x, s.y, s.z) < 1.6f;
        }

        static void FallbackArch(Transform hold, Color portalCol)
        {
            if (hold)
            {
                var marker = new GameObject("ArchVisualMissing");
                marker.transform.SetParent(hold, false);
                marker.hideFlags = HideFlags.DontSave;
            }
            UnityEngine.Debug.LogWarning("[Concordia] Court arch kit unresolved; no primitive visual fallback was created.");
        }

        static void Sanctum(Transform root)
        {
            var hold = new GameObject("CourtSanctum").transform;
            hold.SetParent(root, false);
            hold.position = Canon.Arena;
            hold.rotation = Quaternion.LookRotation(Vector3.back);
            var portal = new Color(0.72f, 0.08f, 0.08f);
            var arch = FreePacks.SpawnStore("large_iron_gate", hold, hold.TransformPoint(Vector3.zero), hold.eulerAngles.y, 9.2f, required: false)
                       ?? FreePacks.SpawnStore("large_iron_gate_1k", hold, hold.TransformPoint(Vector3.zero), hold.eulerAngles.y, 9.2f, required: false)
                       ?? FreePacks.Spawn("large_iron_gate_1k", hold, hold.TransformPoint(Vector3.zero), hold.eulerAngles.y, 9.2f, required: false)
                       ?? FreePacks.SpawnStore("stone_half_gate", hold, hold.TransformPoint(Vector3.zero), hold.eulerAngles.y, 9.2f, required: false);
            if (arch && ThinArch(arch)) { Object.Destroy(arch); arch = null; }
            if (arch)
            {
                arch.name = "SanctumArch";
                FreePacks.StripColliders(arch);
                arch.transform.SetParent(hold, true);
                HubLook.StoneDress(arch);
            }
            else
                FallbackArch(hold, portal);

            var stone = HubLook.WetStone("patterned_cobblestone_02", 2.2f);
            HideVisual(HubLook.Prim(hold, PrimitiveType.Cube, new Vector3(0f, 0.12f, -3.4f), new Vector3(7.2f, 0.24f, 2.0f), stone, "Step0"));
            HideVisual(HubLook.Prim(hold, PrimitiveType.Cube, new Vector3(0f, 0.30f, -2.4f), new Vector3(6.2f, 0.24f, 1.5f), stone, "Step1"));
            HideVisual(HubLook.Prim(hold, PrimitiveType.Cube, new Vector3(0f, 0.48f, -1.5f), new Vector3(5.2f, 0.24f, 1.2f), stone, "Step2"));

            GameObject PlaceCol(Vector3 local)
            {
                var col = FreePacks.SpawnStore("stone_column", hold, hold.TransformPoint(local), 0f, 6.4f, required: false)
                          ?? FreePacks.Spawn("statue_column", hold, hold.TransformPoint(local), 0f, 6.4f, required: false)
                          ?? FreePacks.Spawn("column", hold, hold.TransformPoint(local), 0f, 6.4f, required: false);
                if (!col) return null;
                FreePacks.StripColliders(col);
                HubLook.StoneDress(col);
                return col;
            }
            PlaceCol(new Vector3(-5.2f, 0f, -2.4f));
            PlaceCol(new Vector3(5.2f, 0f, -2.4f));

            // Cloth only — no Prim Quad identity. Prefer store cloth stems; socket to
            // column/arch lintel heights when available, else skip and log once.
            Vector3[] banSpots =
            {
                new Vector3(-4.8f, 5.2f, -1.1f), new Vector3(4.8f, 5.2f, -1.1f),
                new Vector3(-2.2f, 5.0f, -1.05f), new Vector3(2.2f, 5.0f, -1.05f)
            };
            bool anyCloth = false;
            for (int bi = 0; bi < banSpots.Length; bi++)
            {
                var bp = banSpots[bi];
                var world = hold.TransformPoint(bp);
                var cloth = FreePacks.SpawnStore("banner-red", hold, world, hold.eulerAngles.y, 2.8f, required: false)
                            ?? FreePacks.SpawnStore("flag-banner-short", hold, world, hold.eulerAngles.y, 2.6f, required: false)
                            ?? FreePacks.SpawnStore("banner", hold, world, hold.eulerAngles.y, 2.8f, required: false)
                            ?? FreePacks.Spawn("banner", hold, world, hold.eulerAngles.y, 2.8f, required: false);
                if (!cloth) continue;
                anyCloth = true;
                cloth.name = "SanctumBanner_" + bi;
                cloth.transform.SetParent(hold, true);
                FreePacks.StripColliders(cloth);
                FreePacks.DyeCloth(cloth, new Color(0.78f, 0.07f, 0.09f));
                var sway = cloth.GetComponent<CourtBannerSway>() ?? cloth.AddComponent<CourtBannerSway>();
                sway.phase = bi * 0.55f;
            }
            if (!anyCloth)
                UnityEngine.Debug.LogWarning("[Concordia] Sanctum banners skipped — no cloth/banner store stem (Prim Quad fallback removed).");
            HubLook.Point(hold, "SanctumFill", hold.TransformPoint(new Vector3(0f, 3.2f, -2.4f)), new Color(0.55f, 0.78f, 0.92f), 0.85f, 14f, false);
            HubLook.Lantern(hold, hold.TransformPoint(new Vector3(-4.6f, 0f, -4.2f)));
            HubLook.Lantern(hold, hold.TransformPoint(new Vector3(4.6f, 0f, -4.2f)));
        }

        static void Banners(Transform root)
        {
            // The Court has one north composition tree. Hero-tree cloth is owned by HubLook sockets.
        }

        static Color PortalColor(GateDef gate)
        {
            if (gate.world == WorldId.Frontier) return new Color(0.35f, 0.7f, 1f);
            if (gate.world == WorldId.Cyber) return new Color(0.25f, 0.95f, 0.45f);
            return gate.color;
        }

        static void Swirl(Transform parent, Vector3 local, Color c)
        {
            var go = new GameObject("Swirl");
            go.transform.SetParent(parent, false);
            go.transform.localPosition = local;
            var ps = go.AddComponent<ParticleSystem>();
            var main = ps.main;
            main.startLifetime = 1.2f;
            main.startSpeed = 0.04f;
            main.startSize = 0.05f;
            main.startColor = new Color(c.r, c.g, c.b, 0.35f);
            main.maxParticles = 22;
            main.simulationSpace = ParticleSystemSimulationSpace.Local;
            var em = ps.emission;
            em.rateOverTime = 7f;
            var sh = ps.shape;
            sh.shapeType = ParticleSystemShapeType.Circle;
            sh.radius = 0.42f;
            var vol = ps.velocityOverLifetime;
            vol.enabled = true;
            vol.orbitalZ = 1.4f;
            vol.radial = -0.18f;
            var col = ps.colorOverLifetime;
            col.enabled = true;
            var g = new Gradient();
            g.SetKeys(new[] { new GradientColorKey(c, 0f), new GradientColorKey(Color.Lerp(c, Color.white, 0.35f), 1f) }, new[] { new GradientAlphaKey(0f, 0f), new GradientAlphaKey(0.28f, 0.3f), new GradientAlphaKey(0f, 1f) });
            col.color = g;
            var r = go.GetComponent<ParticleSystemRenderer>();
            if (r) r.sharedMaterial = HubLook.ParticleMat(c, false);
        }

        static void Dust(Transform parent, Color c)
        {
            var go = new GameObject("Dust");
            go.transform.SetParent(parent, false);
            go.transform.position = new Vector3(0f, 0.1f, 0f);
            var ps = go.AddComponent<ParticleSystem>();
            var main = ps.main;
            main.startLifetime = 6f;
            main.startSpeed = 0.08f;
            main.startSize = 0.05f;
            main.startColor = new Color(c.r, c.g, c.b, 0.16f);
            main.maxParticles = 28;
            main.simulationSpace = ParticleSystemSimulationSpace.World;
            var em = ps.emission;
            em.rateOverTime = 3f;
            var sh = ps.shape;
            sh.shapeType = ParticleSystemShapeType.Cone;
            sh.angle = 14f;
            sh.radius = 1.1f;
            sh.rotation = new Vector3(90f, 0f, 0f);
            var r = go.GetComponent<ParticleSystemRenderer>();
            if (r) r.sharedMaterial = HubLook.ParticleMat(c, false);
        }

        static void Clutter(Transform root)
        {
            foreach (var g in Canon.Gates)
            {
                var dir = new Vector3(Mathf.Cos(g.angle), 0f, Mathf.Sin(g.angle));
                HubLook.Lantern(root, dir * 18.5f);
                var flag = FreePacks.SpawnStore("banner", root, dir * 22f, -g.angle * Mathf.Rad2Deg, 2.8f, required: false)
                           ?? FreePacks.SpawnStore("flag-banner-long", root, dir * 22f, -g.angle * Mathf.Rad2Deg, 2.8f, required: false);
                if (flag)
                {
                    flag.name = "RefusalBanner_" + g.shortName;
                    FreePacks.DyeCloth(flag, Color.Lerp(new Color(0.62f, 0.12f, 0.10f), g.color, 0.18f));
                }
            }
            var grass = DressVocab.Grass(WorldId.Hub);
            for (int i = 0; i < 28; i++)
            {
                float a = i / 28f * Mathf.PI * 2f + 0.09f;
                var r = 17.6f + (i % 4) * 0.35f;
                var p = new Vector3(Mathf.Cos(a) * r, 0f, Mathf.Sin(a) * r);
                if (Canon.InArena(p)) continue;
                FreePacks.SpawnStore(grass, root, p, i * 29f, FreePacks.HumanHeight("grass"), required: false);
            }
            for (int i = 0; i < 8; i++)
            {
                float a = i / 8f * Mathf.PI * 2f + 0.48f;
                var p = new Vector3(Mathf.Cos(a) * 22.2f, 0f, Mathf.Sin(a) * 22.2f);
                if (Canon.InArena(p)) continue;
                var tangent = new Vector3(-Mathf.Sin(a), 0f, Mathf.Cos(a));
                var table = FreePacks.SpawnStore(DressVocab.Table(), root, p, a * Mathf.Rad2Deg, FreePacks.HumanHeight("table"), required: false)
                            ?? FreePacks.Spawn(DressVocab.Table(), root, p, a * Mathf.Rad2Deg, FreePacks.HumanHeight("table"), required: false);
                if (table) UsePlace.Stamp(table, "Sit", "A ring table. People leave it as they found it.", true);
                FreePacks.SpawnStore(DressVocab.Chair(), root, p + tangent * 1.05f, a * Mathf.Rad2Deg + 180f, FreePacks.HumanHeight("chair"), required: false);
                FreePacks.SpawnStore(DressVocab.Chair(), root, p - tangent * 1.05f, a * Mathf.Rad2Deg, FreePacks.HumanHeight("chair"), required: false);
            }
            for (int i = 0; i < Canon.Gates.Length; i++)
            {
                var g = Canon.Gates[i];
                var n = Canon.Gates[(i + 1) % Canon.Gates.Length];
                float mid = (g.angle + n.angle) * 0.5f;
                if (Mathf.Abs(n.angle - g.angle) > Mathf.PI) mid += Mathf.PI;
                var grove = new Vector3(Mathf.Cos(mid) * 27.5f, 0f, Mathf.Sin(mid) * 27.5f);
                FreePacks.SpawnStore(DressVocab.Rock(), root, grove + new Vector3(1.6f, 0f, -0.8f), i * 21f, 1.05f, required: false);
                var col = new Vector3(Mathf.Cos(g.angle + 0.12f) * 31.2f, 0f, Mathf.Sin(g.angle + 0.12f) * 31.2f);
                FreePacks.SpawnStore(DressVocab.Column(WorldId.Hub), root, col, g.angle * Mathf.Rad2Deg, FreePacks.HumanHeight("column"), required: false);
            }
            for (int i = 0; i < 4; i++)
            {
                var g = Canon.Gates[i];
                var dir = new Vector3(Mathf.Cos(g.angle), 0f, Mathf.Sin(g.angle));
                var side = new Vector3(-dir.z, 0f, dir.x);
                var cartPos = dir * 26.2f + side * 2.2f;
                var cart = CxDress.SpawnPrefab(
                    "Assets/Concordia/Generated/Prefabs/P2/Props/CX_Prop_WreckWagon.prefab",
                    root, cartPos, -g.angle * Mathf.Rad2Deg + 12f, "HubCart_" + i)
                           ?? FreePacks.SpawnStore(DressVocab.Cart(), root, cartPos, -g.angle * Mathf.Rad2Deg + 12f, FreePacks.HumanHeight("cart"), required: false)
                           ?? FreePacks.Spawn(DressVocab.Cart(), root, cartPos, -g.angle * Mathf.Rad2Deg + 12f, FreePacks.HumanHeight("cart"), required: false);
                if (cart) UsePlace.Stamp(cart, "Inspect", "A Ring cart. The invoice is still on the board.");
                var cratePos = dir * 26.2f + side * 3.4f;
                var crate = CxDress.SpawnPrefab(
                    "Assets/Concordia/Generated/Prefabs/P2/Props/CX_Prop_Crate.prefab",
                    root, cratePos, i * 33f, "HubCrate_" + i)
                    ?? FreePacks.SpawnStore(DressVocab.Crate(), root, cratePos, i * 33f, FreePacks.HumanHeight("crate"), required: false);
            }
            CityTownRing(root);
        }

        static void CityTownRing(Transform root)
        {
            for (int i = 0; i < 24; i++)
            {
                float a = i / 24f * Mathf.PI * 2f + 0.17f;
                float rad = 36f + (i % 3) * 2.4f;
                var p = new Vector3(Mathf.Cos(a) * rad, 0f, Mathf.Sin(a) * rad);
                if (Canon.InArena(p)) continue;
                var yaw = -a * Mathf.Rad2Deg;
                var stem = FreePacks.SpawnStore(DressVocab.House(WorldId.Hub), root, p, yaw, FreePacks.HumanHeight("house"), required: false)
                           ?? FreePacks.Spawn(DressVocab.House(WorldId.Hub), root, p, yaw, FreePacks.HumanHeight("house"), required: false)
                           ?? FreePacks.SpawnStore(DressVocab.Column(WorldId.Hub), root, p, yaw, FreePacks.HumanHeight("column"), required: false);
                if (stem) stem.name = "CityTownStem_" + i;
            }
        }

        static void HideVisual(GameObject go)
        {
            if (!go) return;
            foreach (var renderer in go.GetComponentsInChildren<Renderer>(true))
                if (renderer) renderer.enabled = false;
        }
    }

    /// <summary>
    /// Drives the two PortalFace quads under a PortalMembrane holder: a slow
    /// pulse (never fully off, so a still screenshot still reads as lit) plus
    /// a slow self-rotation so the membrane reads as active energy, not a
    /// static colored pane. One shared material instance per gate, no
    /// allocation in Update.
    /// </summary>
    public class PortalShimmer : MonoBehaviour
    {
        public Color baseColor = Color.white;
        public Material sharedMaterial;
        Material _instance;
        float _seed;

        void Start()
        {
            if (sharedMaterial) _instance = new Material(sharedMaterial);
            foreach (var r in GetComponentsInChildren<Renderer>(true))
                if (r && _instance) r.sharedMaterial = _instance;
            _seed = Random.value * 10f;
        }

        void Update()
        {
            if (!_instance) return;
            float pulse = 0.62f + 0.30f * Mathf.Sin(Time.time * 1.3f + _seed);
            var c = baseColor;
            c.a = pulse;
            if (_instance.HasProperty("_BaseColor")) _instance.SetColor("_BaseColor", c);
            if (_instance.HasProperty("_Color")) _instance.SetColor("_Color", c);
            // Spinning the whole rectangular membrane around its own forward
            // axis made it flash rectangle -> sliver -> diamond -> sliver as it
            // turned edge-on to camera (caught mid-spin in the first capture).
            // Keep the plane facing fixed; the pulse + particle Swirl already
            // carry the "alive" read without that flicker.
        }

        void OnDestroy()
        {
            if (_instance) Object.Destroy(_instance);
        }
    }
}
