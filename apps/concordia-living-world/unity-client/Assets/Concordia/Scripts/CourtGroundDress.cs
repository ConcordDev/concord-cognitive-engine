using System.IO;
using UnityEngine;
using UnityEngine.Rendering;
using Unity.Cinemachine;
#if UNITY_EDITOR
using UnityEditor;
#endif

namespace Concordia
{
    /// <summary>
    /// SLICE 2b — underfoot dress for Unburned Court + Hub road bands.
    /// Uneven relief, wet/engraved stone feel, distinct puddle volumes with soft edges,
    /// readable pebble/rock scatter, and continuous road + sidewalk + curb step.
    /// Names start with "Court" so EnsureCourtPlateCleanup never strips them.
    /// </summary>
    public static class CourtGroundDress
    {
        public const string RootName = "CourtGroundDress";
        public const string DemoRoadName = "CourtDemoRoadBand";
        public const string StillCamName = "CourtPass4StillCam";

        static Texture2D _radialWaterTex;
        static Texture2D _radialDampTex;

        public static void Ensure()
        {
            Ensure(false);
        }

        /// <param name="force">Destroy + rebuild dress (rework / visual fail recovery).</param>
        public static void Ensure(bool force)
        {
            var rig = GameObject.Find("CourtLookRig");
            var parent = rig ? rig.transform : null;
            if (!parent)
            {
                var mega = GameObject.Find("Megaworld");
                parent = mega ? mega.transform : null;
            }
            if (!parent) return;

            var hold = parent.Find(RootName);
            if (force && hold)
            {
                // Never DestroyImmediate in Play — it has been aborting the session.
                hold.gameObject.name = RootName + "_OLD";
                hold.gameObject.SetActive(false);
                if (Application.isPlaying) Object.Destroy(hold.gameObject);
                else Object.DestroyImmediate(hold.gameObject);
                hold = null;
            }

            if (!hold)
            {
                hold = new GameObject(RootName).transform;
                hold.SetParent(parent, false);
                BuildMicroRelief(hold);
                BuildPuddles(hold);
                BuildGritScatter(hold);
            }
            else
            {
                // PASS3: upgrade in-place puddles to soft radial-alpha (no full rebuild needed).
                UpgradePuddlesToSoftAlpha(hold);
                // PASS4: force-separate hero puddles so stills don't read as one wet sheet.
                SeparateHeroPuddles(hold);
            }

            SoftenHorizonLand();
            SoftenCyanVistaMarkers();
            StripFalseStreetModels();
            DressExistingRoadBands();
            EnsureDemoRoadBand(parent);
            SoftenCourtGroundPlane();
            AmplifyUnderfootReadable();
            RetintCourtScatterEarth();
            BanFreePacksRoadRocks();
            KillProofFrustumMarkers();
        }

        /// <summary>
        /// PASS4 — ≥3 unmistakable separate soft puddles. Compact damp underlayers (not the
        /// Pass3 R×1.4 sheet), centers ≥2.2m apart, high-contrast Sprite + Unlit soft edge.
        /// </summary>
        public static void SeparateHeroPuddles(Transform hold = null)
        {
            if (!hold)
            {
                var go = GameObject.Find(RootName);
                hold = go ? go.transform : null;
            }
            if (!hold) return;

            // Invalidate cached radials so BuildRadialAlphaTex uses Pass4 contrast.
            _radialWaterTex = null;
            _radialDampTex = null;

            // Triangle cluster: all three in close plaza FOV, centers ≥2.2m apart.
            Vector3[] hero =
            {
                new Vector3(-1.7f, 0f, 1.15f),
                new Vector3(0.25f, 0f, 2.55f),
                new Vector3(1.85f, 0f, 0.85f),
                new Vector3(-2.6f, 0f, -2.4f),
                new Vector3(3.0f, 0f, 2.9f),
            };
            float[] rad = { 0.55f, 0.50f, 0.58f, 0.48f, 0.50f };
            var matWater = MakeSpriteRadialWaterMat(new Color(0.10f, 0.20f, 0.24f), 0.98f);
            var matDamp = MakeSoftDampMat(new Color(0.05f, 0.07f, 0.06f), 0.82f);
            var matUnlit = MakeSoftWaterMat(new Color(0.08f, 0.16f, 0.19f), 0.90f);

            for (int i = 0; i < hero.Length; i++)
            {
                Transform soft = null, damp = null, alias = null, feather = null;
                foreach (Transform c in hold.GetComponentsInChildren<Transform>(true))
                {
                    if (!c || c.name == null) continue;
                    if (c.name == "CourtPuddleSoft_" + i) soft = c;
                    else if (c.name == "CourtPuddleDamp_" + i) damp = c;
                    else if (c.name == "CourtPuddle_" + i) alias = c;
                    else if (c.name == "CourtPuddleFeather_" + i) feather = c;
                }

                // Compact damp — visible wet body, small enough not to merge with neighbors.
                if (!damp)
                {
                    var go = SpawnSoftDisc(hold, hero[i], rad[i] * 0.95f, rad[i] * 0.78f, matDamp,
                        "CourtPuddleDamp_" + i, 0.055f);
                    damp = go ? go.transform : null;
                }
                if (damp)
                {
                    damp.gameObject.SetActive(true);
                    damp.position = hero[i] + new Vector3(0f, 0.055f, 0f);
                    damp.localScale = Vector3.one;
                    var mf = damp.GetComponent<MeshFilter>();
                    if (mf) mf.sharedMesh = BuildSoftPuddleMesh(rad[i] * 0.95f, rad[i] * 0.78f);
                    var rd = damp.GetComponent<Renderer>();
                    if (rd) { rd.enabled = true; rd.sharedMaterial = matDamp; }
                }

                // Unlit feather disc — soft radial that Camera.Render keeps (backup to Sprite).
                if (!feather)
                {
                    var go = SpawnSoftDisc(hold, hero[i], rad[i] * 1.05f, rad[i] * 0.88f, matUnlit,
                        "CourtPuddleFeather_" + i, 0.078f);
                    feather = go ? go.transform : null;
                }
                if (feather)
                {
                    feather.gameObject.SetActive(true);
                    feather.position = hero[i] + new Vector3(0f, 0.078f, 0f);
                    var mf = feather.GetComponent<MeshFilter>();
                    if (mf) mf.sharedMesh = BuildSoftPuddleMesh(rad[i] * 1.05f, rad[i] * 0.88f);
                    var rd = feather.GetComponent<Renderer>();
                    if (rd) { rd.enabled = true; rd.sharedMaterial = matUnlit; }
                }

                if (soft)
                {
                    soft.gameObject.SetActive(true);
                    soft.position = hero[i] + new Vector3(0f, 0.090f, 0f);
                    soft.rotation = Quaternion.Euler(90f, i * 23f, 0f);
                    soft.localScale = new Vector3(rad[i] * 2.05f, rad[i] * 1.65f, 1f);
                    var r = soft.GetComponent<Renderer>();
                    if (r)
                    {
                        r.enabled = true;
                        r.sharedMaterial = matWater;
                        r.shadowCastingMode = ShadowCastingMode.Off;
                        r.receiveShadows = false;
                    }
                }
                if (alias)
                {
                    alias.position = hero[i] + new Vector3(0f, 0.090f, 0f);
                    alias.gameObject.SetActive(true);
                }
            }

            int softN = 0;
            foreach (Transform t in hold.GetComponentsInChildren<Transform>(true))
                if (t && t.name != null && t.name.StartsWith("CourtPuddleSoft_", System.StringComparison.Ordinal)
                    && t.gameObject.activeInHierarchy)
                    softN++;
            if (softN < 3)
            {
                BuildPuddles(hold);
                // One-shot rebuild only — avoid recursion.
                softN = 0;
                foreach (Transform t in hold.GetComponentsInChildren<Transform>(true))
                    if (t && t.name != null && t.name.StartsWith("CourtPuddleSoft_", System.StringComparison.Ordinal)
                        && t.gameObject.activeInHierarchy)
                        softN++;
            }
        }

        /// <summary>
        /// PASS3 leftover #3 — FreePacks rock_smallA / CourtCurbRock read as orange pyramids.
        /// Hide GLOBALLY on settlement roads (not only plaza dress root).
        /// </summary>
        public static int BanFreePacksRoadRocks()
        {
            int n = 0;
            foreach (var t in Object.FindObjectsByType<Transform>(FindObjectsInactive.Include))
            {
                if (!t || t.name == null) continue;
                bool curbRock = t.name == "CourtCurbRock"
                                || t.name.StartsWith("CourtCurbRock", System.StringComparison.Ordinal);
                bool smallA = t.name.IndexOf("rock_smallA", System.StringComparison.OrdinalIgnoreCase) >= 0;
                if (!curbRock && !smallA) continue;
                if (!t.gameObject.activeSelf && !HasEnabledRenderer(t)) continue;
                t.gameObject.SetActive(false);
                n++;
            }
            return n;
        }

        static bool HasEnabledRenderer(Transform t)
        {
            foreach (var r in t.GetComponentsInChildren<Renderer>(true))
                if (r && r.enabled) return true;
            return false;
        }

        /// <summary>
        /// LeanPlay city/continent impostors often ship as flat cyan Emit discs.
        /// FreePacks rock/weed kits also land cyan — retint those too (Court* scatter).
        /// </summary>
        public static void SoftenCyanVistaMarkers()
        {
            var earth = HubLook.Pbr("packed_earth", new Color(0.42f, 0.34f, 0.24f), 0.04f, 0.22f, 8f);
            var turf = HubLook.Pbr("grass", new Color(0.30f, 0.38f, 0.22f), 0.03f, 0.26f, 7f);
            var rock = HubLook.Pbr("rock_ground", new Color(0.48f, 0.44f, 0.38f), 0.06f, 0.22f, 4f);
            if (!earth) return;
            if (!rock) rock = earth;
            var origin = Vector3.zero;
            var tree = GameObject.Find("CourtHeroTree");
            if (tree) origin = new Vector3(tree.transform.position.x, 0f, tree.transform.position.z);
            float maxR = CourtWalkableHorizon.MaskRadiusM + 20f;
            int i = 0;
            foreach (var r in Object.FindObjectsByType<Renderer>(FindObjectsInactive.Exclude))
            {
                if (!r || !r.sharedMaterial) continue;
                var n = r.gameObject.name ?? "";
                if ((r.bounds.center - origin).sqrMagnitude > maxR * maxR) continue;

                // Keep road/sidewalk/curb/puddle/plaza mats alone.
                if (n.StartsWith("CourtRoad", System.StringComparison.Ordinal)) continue;
                if (n.StartsWith("CourtSidewalk", System.StringComparison.Ordinal)) continue;
                if (n.StartsWith("CourtCurb_", System.StringComparison.Ordinal)) continue;
                if (n.StartsWith("CourtPuddle", System.StringComparison.Ordinal)) continue;
                if (n == "CourtPlazaWetDisc" || n == "CourtGround" || n == "CourtFloorLean") continue;
                if (n.StartsWith("CourtRelief_", System.StringComparison.Ordinal)) continue;
                if (n.StartsWith("CourtGrit_", System.StringComparison.Ordinal)) continue;

                var m = r.sharedMaterial;
                Color c = m.HasProperty("_BaseColor") ? m.GetColor("_BaseColor")
                    : (m.HasProperty("_Color") ? m.GetColor("_Color") : Color.white);
                bool cyanish = c.b > 0.45f && c.g > 0.35f && c.r < 0.45f && c.b > c.r + 0.12f;
                bool tealKit = c.g > 0.55f && c.b > 0.45f && c.r < 0.40f; // FreePacks cyan-teal rock kit
                bool scatter = n.StartsWith("CourtRock", System.StringComparison.Ordinal)
                               || n.StartsWith("CourtPebble", System.StringComparison.Ordinal)
                               || n.StartsWith("CourtWeed", System.StringComparison.Ordinal)
                               || n == "CourtCurbRock"
                               || n.StartsWith("CourtCurbRock", System.StringComparison.Ordinal)
                               || n.StartsWith("Model_", System.StringComparison.Ordinal);
                if (!cyanish && !tealKit && !scatter) continue;

                if (scatter || tealKit)
                    r.sharedMaterial = rock;
                else
                    r.sharedMaterial = (i++ % 2 == 0) ? (turf ? turf : earth) : earth;
            }
        }

        /// <summary>Force earth/rock mats onto underfoot scatter (FreePacks often ship cyan).</summary>
        public static void RetintCourtScatterEarth()
        {
            var rock = HubLook.Pbr("rock_ground", new Color(0.50f, 0.46f, 0.40f), 0.07f, 0.24f, 3.5f);
            var pebble = HubLook.Pbr("gravel", new Color(0.42f, 0.39f, 0.34f), 0.05f, 0.20f, 2.5f);
            var turf = HubLook.Pbr("grass", new Color(0.28f, 0.36f, 0.20f), 0.03f, 0.26f, 6f);
            if (!rock) rock = HubLook.Pbr("packed_earth", new Color(0.42f, 0.34f, 0.24f), 0.04f, 0.22f, 8f);
            if (!pebble) pebble = rock;
            var hold = GameObject.Find(RootName);
            if (!hold) return;
            foreach (var r in hold.GetComponentsInChildren<Renderer>(true))
            {
                if (!r) continue;
                var n = r.gameObject.name ?? "";
                if (n.StartsWith("CourtRock", System.StringComparison.Ordinal) ||
                    n.StartsWith("CourtCurbRock", System.StringComparison.Ordinal) ||
                    n == "CourtCurbRock")
                    r.sharedMaterial = rock;
                else if (n.StartsWith("CourtPebble", System.StringComparison.Ordinal))
                    r.sharedMaterial = pebble;
                else if (n.StartsWith("CourtWeed", System.StringComparison.Ordinal) && turf)
                    r.sharedMaterial = turf;
            }
            // Settlement curb rocks: do NOT retint — BanFreePacksRoadRocks hides them (orange pyramids).
        }

        /// <summary>
        /// Hide cyan/orange debug prims + SoulCore emit spheres + city/continent impostors
        /// in the Court proof frustum. PASS4: no size gate — small cyan plaza squares and flat
        /// orange discs must die; far impostors killed by name OR cyan color within 280m.
        /// </summary>
        public static int KillProofFrustumMarkers()
        {
            var origin = Vector3.zero;
            var tree = GameObject.Find("CourtHeroTree");
            if (tree) origin = new Vector3(tree.transform.position.x, 0f, tree.transform.position.z);
            // Demo curb band can sit ~40m south — cover both still frustums.
            var demo = GameObject.Find(DemoRoadName);
            Vector3 curbOrigin = demo
                ? new Vector3(demo.transform.position.x, 0f, demo.transform.position.z)
                : origin;
            float maxR = 280f;
            int killed = 0;
            foreach (var r in Object.FindObjectsByType<Renderer>(FindObjectsInactive.Include))
            {
                if (!r || !r.enabled) continue;
                var bc = r.bounds.center;
                float dPlaza = (new Vector3(bc.x, 0f, bc.z) - origin).sqrMagnitude;
                float dCurb = (new Vector3(bc.x, 0f, bc.z) - curbOrigin).sqrMagnitude;
                if (dPlaza > maxR * maxR && dCurb > maxR * maxR) continue;
                var n = r.gameObject.name ?? "";
                // Never kill underfoot dress / road band.
                if (n.StartsWith("CourtPuddle", System.StringComparison.Ordinal)) continue;
                if (n.StartsWith("CourtRoad", System.StringComparison.Ordinal)) continue;
                if (n.StartsWith("CourtSidewalk", System.StringComparison.Ordinal)) continue;
                if (n.StartsWith("CourtCurb_", System.StringComparison.Ordinal)) continue;
                if (n.StartsWith("CourtRelief", System.StringComparison.Ordinal)) continue;
                if (n.StartsWith("CourtPebble", System.StringComparison.Ordinal)) continue;
                if (n.StartsWith("CourtRock", System.StringComparison.Ordinal)) continue;
                if (n.StartsWith("CourtGrit", System.StringComparison.Ordinal)) continue;
                if (n.StartsWith("CourtDemo", System.StringComparison.Ordinal)) continue;
                if (n.StartsWith("CourtWeed", System.StringComparison.Ordinal)) continue;
                if (n.StartsWith("CourtDebris", System.StringComparison.Ordinal)) continue;
                if (n == "CourtGround" || n == "CourtFloorLean" || n == "CourtPlazaWetDisc") continue;
                if (n.StartsWith("CourtHero", System.StringComparison.Ordinal)) continue;
                // SLICE 4 — keep Crown Road decks + approach landmark shells.
                if (n.StartsWith("CrownRoad_", System.StringComparison.Ordinal)) continue;
                if (n.StartsWith("ApproachLandmark", System.StringComparison.Ordinal)) continue;
                if (n.StartsWith("ShellBody", System.StringComparison.Ordinal)
                    || n.StartsWith("ShellRoof", System.StringComparison.Ordinal)
                    || n.StartsWith("ShellDoor", System.StringComparison.Ordinal)
                    || n.StartsWith("ShellWin", System.StringComparison.Ordinal)) continue;
                if (n.StartsWith("LeanBuilding_", System.StringComparison.Ordinal)) continue;
                // SLICE 6 — keep FarGeography Present masses (terrain + skyline) in vista stills.
                if (n.StartsWith("FarGeography_", System.StringComparison.Ordinal)
                    || n.StartsWith("FarPad", System.StringComparison.Ordinal)
                    || n.StartsWith("FarHill_", System.StringComparison.Ordinal)
                    || n.StartsWith("FarSilhouette_", System.StringComparison.Ordinal)
                    || n.StartsWith("FarMass_", System.StringComparison.Ordinal)) continue;
                // SLICE 7 — keep inter-spoke wilderness pads/trees/paths.
                if (n.StartsWith("HubWild", System.StringComparison.Ordinal)
                    || n == HubWilderness.RootName
                    || HubWilderness.IsHubWild(r.transform)) continue;
                // Also keep if parent chain is FarGeography (child FreePacks stems).
                bool underFar = false;
                for (var t = r.transform; t != null; t = t.parent)
                {
                    var tn = t.name ?? "";
                    if (tn.StartsWith("FarGeography_", System.StringComparison.Ordinal)
                        || tn == HubWilderness.RootName
                        || tn.StartsWith("HubWild", System.StringComparison.Ordinal))
                    { underFar = true; break; }
                }
                if (underFar) continue;

                bool killName = n.StartsWith("SoulCore_", System.StringComparison.Ordinal)
                                || n.StartsWith("WorldBadge", System.StringComparison.Ordinal)
                                || n.StartsWith("LampGlow", System.StringComparison.Ordinal)
                                || n.StartsWith("SoulLight", System.StringComparison.Ordinal)
                                || n.IndexOf("Debug", System.StringComparison.OrdinalIgnoreCase) >= 0
                                || n.IndexOf("Marker", System.StringComparison.OrdinalIgnoreCase) >= 0
                                || n.IndexOf("Impostor", System.StringComparison.OrdinalIgnoreCase) >= 0
                                || n.StartsWith("Continent", System.StringComparison.Ordinal)
                                || n.StartsWith("CityImpostor", System.StringComparison.Ordinal)
                                || n.StartsWith("CitySilhouette", System.StringComparison.Ordinal)
                                || n.StartsWith("Vista", System.StringComparison.Ordinal)
                                || n.StartsWith("Skyline", System.StringComparison.Ordinal)
                                || n.StartsWith("HorizonDisc", System.StringComparison.Ordinal)
                                || n.StartsWith("EmitDisc", System.StringComparison.Ordinal)
                                || n.StartsWith("Badge_", System.StringComparison.Ordinal);
                var m = r.sharedMaterial;
                bool hotEmit = false;
                if (m && m.HasProperty("_EmissionColor"))
                {
                    var e = m.GetColor("_EmissionColor");
                    hotEmit = (e.r + e.g + e.b) > 0.55f;
                }
                Color c = Color.white;
                if (m)
                {
                    c = m.HasProperty("_BaseColor") ? m.GetColor("_BaseColor")
                        : (m.HasProperty("_Color") ? m.GetColor("_Color") : Color.white);
                }
                // PASS4: no size.y gate — Pass3 left small cyan plaza squares + flat orange discs.
                bool neonCyan = c.b > 0.50f && c.r < 0.55f && c.b > c.r + 0.08f;
                bool neonOrange = (c.r > 0.75f && c.g > 0.25f && c.b < 0.38f)
                                  || (c.r > 0.85f && c.g > 0.40f && c.b < 0.28f);
                bool neon = neonCyan || neonOrange;
                if (killName || neon || hotEmit)
                {
                    r.enabled = false;
                    killed++;
                }
            }

            // Kill hot orange/cyan point lights that wash the plaza still.
            foreach (var light in Object.FindObjectsByType<Light>(FindObjectsInactive.Exclude))
            {
                if (!light || !light.enabled) continue;
                if (light.type != LightType.Point && light.type != LightType.Spot) continue;
                var lp = light.transform.position;
                float dPlaza = (new Vector3(lp.x, 0f, lp.z) - origin).sqrMagnitude;
                float dCurb = (new Vector3(lp.x, 0f, lp.z) - curbOrigin).sqrMagnitude;
                if (dPlaza > maxR * maxR && dCurb > maxR * maxR) continue;
                var col = light.color;
                bool hot = (col.r > 0.85f && col.g > 0.35f && col.b < 0.25f)
                           || (col.b > 0.7f && col.r < 0.4f)
                           || light.intensity > 8f;
                var ln = light.gameObject.name ?? "";
                if (hot || ln.StartsWith("Soul", System.StringComparison.Ordinal)
                        || ln.IndexOf("Glow", System.StringComparison.OrdinalIgnoreCase) >= 0)
                    light.enabled = false;
            }
            return killed;
        }

        /// <summary>Teleport / hide ModularPerson clones near a still aim so curb still is clean.</summary>
        public static void ClearNpcsForStill(Vector3 focus, float radius = 18f)
        {
            foreach (var mp in Object.FindObjectsByType<ModularPerson>(FindObjectsInactive.Exclude))
            {
                if (!mp) continue;
                if ((mp.transform.position - focus).sqrMagnitude > radius * radius) continue;
                mp.gameObject.SetActive(false);
            }
            // Also hide any Transform named like a walker near focus.
            foreach (var t in Object.FindObjectsByType<Transform>(FindObjectsInactive.Exclude))
            {
                if (!t || t.name == null) continue;
                if (!t.name.StartsWith("Walker_", System.StringComparison.Ordinal)
                    && !t.name.StartsWith("Crowd_", System.StringComparison.Ordinal)
                    && !t.name.StartsWith("Person_", System.StringComparison.Ordinal)
                    && !t.name.StartsWith("ModularPerson", System.StringComparison.Ordinal))
                    continue;
                if ((t.position - focus).sqrMagnitude > radius * radius) continue;
                t.gameObject.SetActive(false);
            }
        }

        /// <summary>
        /// Prior PropStemFor bug: "Street".Contains("tree") → every road cube hid under a forest tree.
        /// Strip nested Model_* children and re-enable the primitive renderer.
        /// </summary>
        public static void StripFalseStreetModels()
        {
            foreach (var t in Object.FindObjectsByType<Transform>(FindObjectsInactive.Exclude))
            {
                if (!t || t.name == null) continue;
                bool roadish = t.name == "Street" || t.name.StartsWith("CourtRoad", System.StringComparison.Ordinal)
                               || t.name.StartsWith("RoadDeck", System.StringComparison.Ordinal)
                               || t.name.StartsWith("CourtSidewalk", System.StringComparison.Ordinal)
                               || t.name.StartsWith("Sidewalk", System.StringComparison.Ordinal)
                               || t.name.StartsWith("CourtCurb", System.StringComparison.Ordinal)
                               || t.name.StartsWith("Curb", System.StringComparison.Ordinal);
                if (!roadish) continue;
                for (int i = t.childCount - 1; i >= 0; i--)
                {
                    var c = t.GetChild(i);
                    if (c && c.name != null && c.name.StartsWith("Model_", System.StringComparison.Ordinal))
                    {
                        if (Application.isPlaying) Object.Destroy(c.gameObject);
                        else Object.DestroyImmediate(c.gameObject);
                    }
                }
                var r = t.GetComponent<Renderer>();
                if (r) r.enabled = true;
            }
        }

        /// <summary>Bump puddle/grit/relief/rock scale so underfoot reads in LeanPlay stills.</summary>
        static void AmplifyUnderfootReadable()
        {
            var hold = GameObject.Find(RootName);
            if (!hold) return;
            var soft = MakeSpriteRadialWaterMat(new Color(0.10f, 0.20f, 0.24f), 0.98f);
            var damp = MakeSoftDampMat(new Color(0.05f, 0.07f, 0.06f), 0.82f);
            foreach (var t in hold.GetComponentsInChildren<Transform>(true))
            {
                if (t.name.StartsWith("CourtPuddleSoft_", System.StringComparison.Ordinal))
                {
                    var p = t.position;
                    p.y = Mathf.Max(0.088f, p.y);
                    t.position = p;
                    var r = t.GetComponent<Renderer>();
                    if (r && soft) r.sharedMaterial = soft;
                }
                else if (t.name.StartsWith("CourtPuddleDamp_", System.StringComparison.Ordinal)
                         || t.name.StartsWith("CourtPuddleFeather_", System.StringComparison.Ordinal))
                {
                    // Keep active — compact damp/feather are the visible wet body for Pass4.
                    var r = t.GetComponent<Renderer>();
                    if (r && damp && t.name.StartsWith("CourtPuddleDamp_", System.StringComparison.Ordinal))
                        r.sharedMaterial = damp;
                }
                else if (t.name.StartsWith("CourtPuddleWater_", System.StringComparison.Ordinal)
                         || t.name.StartsWith("CourtPuddleHalo_", System.StringComparison.Ordinal)
                         || t.name.StartsWith("CourtPuddleRim_", System.StringComparison.Ordinal))
                {
                    // PASS2 concentric rings — hide; soft alpha discs replace them.
                    var r = t.GetComponent<Renderer>();
                    if (r) r.enabled = false;
                }
                else if (t.name.StartsWith("CourtGrit_", System.StringComparison.Ordinal))
                {
                    var p = t.position; p.y = 0.057f; t.position = p;
                }
                else if (t.name.StartsWith("CourtRelief_", System.StringComparison.Ordinal))
                {
                    var s = t.localScale;
                    s.y = Mathf.Max(0.16f, s.y);
                    t.localScale = s;
                }
                else if (t.name.StartsWith("CourtRock", System.StringComparison.Ordinal) && t.localScale.x < 0.85f)
                {
                    t.localScale *= 1.85f;
                }
                else if (t.name.StartsWith("CourtPebble_", System.StringComparison.Ordinal) && t.localScale.x < 0.28f)
                {
                    t.localScale *= 1.6f;
                }
            }
        }

        /// <summary>
        /// Upgrade bare LeanPlay Street cubes (pre-sidewalk) into full road bands.
        /// Idempotent: skips already-dressed StreetBand children.
        /// </summary>
        public static void DressExistingRoadBands()
        {
            var all = Object.FindObjectsByType<Transform>(FindObjectsInactive.Exclude);
            for (int i = 0; i < all.Length; i++)
            {
                var t = all[i];
                if (!t || t.name == null) continue;
                if (!t.name.StartsWith("SettlementRoads_", System.StringComparison.Ordinal)) continue;
                UpgradeRoadRoot(t);
            }
        }

        static void UpgradeRoadRoot(Transform root)
        {
            var bare = new System.Collections.Generic.List<Transform>();
            for (int i = 0; i < root.childCount; i++)
            {
                var c = root.GetChild(i);
                if (!c) continue;
                if (c.name == "StreetBand" || (c.name != null && c.name.StartsWith("StreetBand", System.StringComparison.Ordinal)))
                    continue;
                if (c.name == DemoRoadName) continue;
                if (c.name == "Street") bare.Add(c);
            }
            for (int i = 0; i < bare.Count; i++)
            {
                var street = bare[i];
                if (!street) continue;
                bool hasWalk = false;
                var p = street.parent;
                if (p)
                {
                    for (int j = 0; j < p.childCount; j++)
                    {
                        var n = p.GetChild(j).name;
                        if (n != null && (n.StartsWith("CourtSidewalk", System.StringComparison.Ordinal)
                                          || n.StartsWith("Sidewalk", System.StringComparison.Ordinal)
                                          || n == "StreetBand" || n.StartsWith("StreetBand", System.StringComparison.Ordinal)
                                          || n == DemoRoadName))
                        { hasWalk = true; break; }
                    }
                }
                if (hasWalk)
                {
                    // Already banded — still raise curb step + re-materialize if thin.
                    ReinforceBandHeights(street.parent);
                    continue;
                }

                var scale = street.localScale;
                float roadW = Mathf.Max(3.6f, scale.x);
                float len = scale.z;
                var pos = street.position;
                var rot = street.rotation;

                var band = new GameObject("StreetBand").transform;
                band.SetParent(root, false);
                band.SetPositionAndRotation(pos, rot);

                // Drop false tree models before reparent.
                for (int k = street.childCount - 1; k >= 0; k--)
                {
                    var ch = street.GetChild(k);
                    if (ch && ch.name != null && ch.name.StartsWith("Model_", System.StringComparison.Ordinal))
                    {
                        if (Application.isPlaying) Object.Destroy(ch.gameObject);
                        else Object.DestroyImmediate(ch.gameObject);
                    }
                }
                var sr = street.GetComponent<Renderer>();
                if (sr) sr.enabled = true;

                street.SetParent(band, true);
                street.name = "CourtRoadDeck";
                street.localPosition = new Vector3(0f, 0.04f, 0f);
                street.localRotation = Quaternion.identity;
                street.localScale = new Vector3(roadW, 0.08f, len);
                var roadMat = HubLook.Pbr("wet_asphalt", new Color(0.22f, 0.22f, 0.24f), 0.02f, 0.14f, 5.5f);
                if (sr && roadMat) { sr.enabled = true; sr.sharedMaterial = roadMat; }

                AttachSidewalkCurb(band, roadW, len);
            }
        }

        static void ReinforceBandHeights(Transform band)
        {
            if (!band) return;
            for (int i = 0; i < band.childCount; i++)
            {
                var c = band.GetChild(i);
                if (!c || c.name == null) continue;
                if (c.name.StartsWith("Curb", System.StringComparison.Ordinal) ||
                    c.name.StartsWith("CourtCurb", System.StringComparison.Ordinal))
                {
                    if (!c.name.StartsWith("Court", System.StringComparison.Ordinal))
                        c.name = "Court" + c.name;
                    var lp = c.localPosition;
                    var ls = c.localScale;
                    ls.y = Mathf.Max(0.55f, ls.y);
                    lp.y = ls.y * 0.5f;
                    c.localScale = ls;
                    c.localPosition = lp;
                    var r = c.GetComponent<Renderer>();
                    var curbMat = HubLook.Lit(new Color(0.50f, 0.44f, 0.36f), 0.05f, 0.20f);
                    if (r) { r.enabled = true; if (curbMat) r.sharedMaterial = curbMat; }
                }
                else if (c.name.StartsWith("Sidewalk", System.StringComparison.Ordinal) ||
                         c.name.StartsWith("CourtSidewalk", System.StringComparison.Ordinal))
                {
                    if (!c.name.StartsWith("Court", System.StringComparison.Ordinal))
                        c.name = "Court" + c.name;
                    var lp = c.localPosition;
                    var ls = c.localScale;
                    ls.y = Mathf.Max(0.14f, ls.y);
                    lp.y = 0.40f; // top near curb lip
                    c.localScale = ls;
                    c.localPosition = lp;
                    var r = c.GetComponent<Renderer>();
                    var walkMat = HubLook.Lit(new Color(0.74f, 0.72f, 0.66f), 0.02f, 0.24f);
                    if (r) { r.enabled = true; if (walkMat) r.sharedMaterial = walkMat; }
                }
                else if (c.name == "Street" || c.name == "RoadDeck" || c.name == "CourtRoadDeck")
                {
                    var lp = c.localPosition;
                    var ls = c.localScale;
                    ls.y = Mathf.Max(0.08f, ls.y);
                    lp.y = 0.04f;
                    c.localScale = ls;
                    c.localPosition = lp;
                    c.name = "CourtRoadDeck";
                    var r = c.GetComponent<Renderer>();
                    var roadMat = HubLook.Lit(new Color(0.14f, 0.14f, 0.16f), 0.02f, 0.12f);
                    if (r && roadMat) { r.enabled = true; r.sharedMaterial = roadMat; }
                }
            }
        }

        static void AttachSidewalkCurb(Transform band, float roadW, float len)
        {
            var walkMat = HubLook.Lit(new Color(0.74f, 0.72f, 0.66f), 0.02f, 0.24f);
            var curbMat = HubLook.Lit(new Color(0.50f, 0.44f, 0.36f), 0.05f, 0.20f);
            float walkW = ConcordiaHost.LeanPlay ? 1.7f : 1.95f;
            float curbH = 0.55f;   // PASS3: unmistakable ~0.5m+ nose-on step
            float curbT = 0.30f;
            float walkY = 0.40f;   // sidewalk top near curb lip
            float edge = roadW * 0.5f + walkW * 0.5f + 0.10f;

            // Court* prefix — EnsureCourtPlateCleanup disables bare Cube prims otherwise.
            // Flat Lit colors = unmistakable asphalt / concrete / stone in stills (no PBR wood swap).
            HubLook.PrimSurface(band, PrimitiveType.Cube, new Vector3(-edge, walkY, 0f),
                new Vector3(walkW, 0.14f, len), walkMat, "CourtSidewalk_L", true);
            HubLook.PrimSurface(band, PrimitiveType.Cube, new Vector3(edge, walkY, 0f),
                new Vector3(walkW, 0.14f, len), walkMat, "CourtSidewalk_R", true);
            float curbX = roadW * 0.5f + 0.12f;
            HubLook.PrimSurface(band, PrimitiveType.Cube, new Vector3(-curbX, curbH * 0.5f, 0f),
                new Vector3(curbT, curbH, len), curbMat, "CourtCurb_L", true);
            HubLook.PrimSurface(band, PrimitiveType.Cube, new Vector3(curbX, curbH * 0.5f, 0f),
                new Vector3(curbT, curbH, len), curbMat, "CourtCurb_R", true);
        }

        /// <summary>
        /// Guaranteed camera target: continuous asphalt band + sidewalk + curb just south of plaza.
        /// </summary>
        public static void EnsureDemoRoadBand(Transform parent)
        {
            if (!parent) return;
            var existing = parent.Find(DemoRoadName);
            if (existing)
            {
                ReinforceBandHeights(existing);
                return;
            }

            float roadW = 5.2f;
            float len = 18f;
            var band = new GameObject(DemoRoadName).transform;
            band.SetParent(parent, false);
            band.SetPositionAndRotation(new Vector3(0f, 0.12f, -42f), Quaternion.identity);

            var roadMat = HubLook.Lit(new Color(0.14f, 0.14f, 0.16f), 0.02f, 0.12f);
            HubLook.PrimSurface(band, PrimitiveType.Cube, new Vector3(0f, 0.04f, 0f),
                new Vector3(roadW, 0.08f, len), roadMat, "CourtRoadDeck", true);
            AttachSidewalkCurb(band, roadW, len);
        }

        /// <summary>Re-apply dirt/rock/grass mats so hills never read as cyan debug discs.</summary>
        public static void SoftenHorizonLand()
        {
            var root = GameObject.Find(CourtWalkableHorizon.RootName);
            if (!root) return;

            var earth = HubLook.Pbr("packed_earth", new Color(0.42f, 0.34f, 0.24f), 0.04f, 0.22f, 12f);
            var turf = HubLook.Pbr("grass", new Color(0.30f, 0.38f, 0.22f), 0.03f, 0.26f, 9f);
            if (!turf) turf = HubLook.Pbr("grove_moss", new Color(0.28f, 0.36f, 0.22f), 0.04f, 0.28f, 10f);
            var rock = HubLook.Pbr("rock_ground", new Color(0.38f, 0.36f, 0.32f), 0.05f, 0.20f, 8f);
            if (!rock) rock = earth;

            var rends = root.GetComponentsInChildren<Renderer>(true);
            for (int i = 0; i < rends.Length; i++)
            {
                var r = rends[i];
                if (!r) continue;
                var n = r.gameObject.name;
                if (n.StartsWith("CourtHorizonMask", System.StringComparison.Ordinal))
                {
                    var fog = RenderSettings.fogColor;
                    var land = Color.Lerp(new Color(0.36f, 0.40f, 0.32f), fog, 0.35f);
                    var mat = HubLook.Lit(land, 0.02f, 0.08f);
                    if (mat && mat.HasProperty("_BaseColor"))
                        mat.SetColor("_BaseColor", new Color(land.r, land.g, land.b, 1f));
                    r.sharedMaterial = mat;
                    continue;
                }
                if (n.IndexOf("Approach", System.StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    if (earth) r.sharedMaterial = earth;
                    continue;
                }
                if (n.IndexOf("Hill_Near", System.StringComparison.OrdinalIgnoreCase) >= 0 ||
                    n.IndexOf("WalkHill_Near", System.StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    r.sharedMaterial = (i % 2 == 0) ? turf : earth;
                    continue;
                }
                if (n.IndexOf("Hill_Mid", System.StringComparison.OrdinalIgnoreCase) >= 0 ||
                    n.IndexOf("WalkHill_Mid", System.StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    r.sharedMaterial = (i % 3 == 0) ? rock : ((i % 2 == 0) ? turf : earth);
                    continue;
                }
                if (earth) r.sharedMaterial = earth;
            }
        }

        static void SoftenCourtGroundPlane()
        {
            // Plaza base: matte/damp stone — NOT full-surface high gloss (puddles own the wet).
            var baseMat = HubLook.Pbr("cobblestone_square", new Color(0.34f, 0.35f, 0.36f), 0.04f, 0.28f, 5.5f);
            if (baseMat && baseMat.HasProperty("_Smoothness")) baseMat.SetFloat("_Smoothness", 0.28f);
            if (baseMat && baseMat.HasProperty("_BumpScale")) baseMat.SetFloat("_BumpScale", 1.35f);

            ApplyMatIfPresent("CourtGround", baseMat);
            ApplyMatIfPresent("CourtFloorLean", baseMat);
            foreach (var go in Object.FindObjectsByType<Transform>(FindObjectsInactive.Exclude))
            {
                if (!go || go.name == null) continue;
                if (!go.name.StartsWith("CourtTile_", System.StringComparison.Ordinal) &&
                    go.name != "Arena") continue;
                var r = go.GetComponent<Renderer>();
                if (r && baseMat) r.sharedMaterial = baseMat;
            }

            EnsurePlazaDisc(baseMat);
        }

        static void EnsurePlazaDisc(Material mat)
        {
            var existing = GameObject.Find("CourtPlazaWetDisc");
            if (existing)
            {
                var rr = existing.GetComponent<Renderer>();
                if (rr && mat) rr.sharedMaterial = mat;
                return;
            }
            var hold = GameObject.Find(RootName);
            var parent = hold ? hold.transform : null;
            if (!parent)
            {
                var mega = GameObject.Find("Megaworld");
                parent = mega ? mega.transform : null;
            }
            if (!parent || !mat) return;
            var disc = HubLook.PrimSurface(parent, PrimitiveType.Cylinder,
                new Vector3(0f, 0.02f, 0f),
                new Vector3(Canon.RingRadius * 1.15f, 0.02f, Canon.RingRadius * 1.15f),
                mat, "CourtPlazaWetDisc", true);
            if (disc) disc.name = "CourtPlazaWetDisc";
        }

        static void ApplyMatIfPresent(string name, Material mat)
        {
            if (!mat) return;
            var go = GameObject.Find(name);
            if (!go) return;
            var r = go.GetComponent<Renderer>();
            if (r) r.sharedMaterial = mat;
        }

        static Texture2D BuildRadialAlphaTex(int size, float coreSolid, float featherStart, Color rgb)
        {
            var tex = new Texture2D(size, size, TextureFormat.RGBA32, false, false)
            {
                name = "CourtRadialWater",
                wrapMode = TextureWrapMode.Clamp,
                filterMode = FilterMode.Bilinear,
                hideFlags = HideFlags.HideAndDontSave
            };
            float cx = (size - 1) * 0.5f;
            for (int y = 0; y < size; y++)
            {
                for (int x = 0; x < size; x++)
                {
                    float dx = (x - cx) / cx;
                    float dy = (y - cx) / cx;
                    float r = Mathf.Sqrt(dx * dx + dy * dy);
                    float a;
                    if (r <= coreSolid) a = 1f;
                    else if (r >= 1f) a = 0f;
                    else
                    {
                        // Soft radial falloff that survives URP Camera.Render (texture alpha, not vertex).
                        float t = Mathf.InverseLerp(featherStart, 1f, r);
                        a = 1f - Mathf.SmoothStep(0f, 1f, t);
                        a = Mathf.Pow(Mathf.Clamp01(a), 1.25f);
                    }
                    float shade = Mathf.Lerp(1f, 0.62f, Mathf.Clamp01(r));
                    tex.SetPixel(x, y, new Color(rgb.r * shade, rgb.g * shade, rgb.b * shade, a));
                }
            }
            tex.Apply(false, true);
            return tex;
        }

        static Texture2D RadialWaterTex()
        {
            if (_radialWaterTex) return _radialWaterTex;
            // PASS4: smaller solid core + earlier feather = clearer soft edge; higher contrast.
            _radialWaterTex = BuildRadialAlphaTex(256, 0.18f, 0.28f, Color.white);
            return _radialWaterTex;
        }

        static Texture2D RadialDampTex()
        {
            if (_radialDampTex) return _radialDampTex;
            _radialDampTex = BuildRadialAlphaTex(256, 0.15f, 0.25f, Color.white);
            return _radialDampTex;
        }

        /// <summary>URP Unlit transparent with radial _BaseMap alpha — soft edge that Camera.Render keeps.</summary>
        static Material MakeSoftWaterMat(Color tint, float alphaMul)
        {
            // Prefer Unlit transparent: Lit often ignores texture alpha falloff in still captures.
            var sh = Shader.Find("Universal Render Pipeline/Unlit");
            if (!sh) sh = Shader.Find("Sprites/Default");
            if (!sh) sh = Shader.Find("Universal Render Pipeline/Lit");
            var m = new Material(sh);
            ForceTransparentAlpha(m);
            var tex = RadialWaterTex();
            if (m.HasProperty("_BaseMap")) m.SetTexture("_BaseMap", tex);
            if (m.HasProperty("_MainTex")) m.SetTexture("_MainTex", tex);
            var c = new Color(tint.r, tint.g, tint.b, Mathf.Clamp01(alphaMul));
            if (m.HasProperty("_BaseColor")) m.SetColor("_BaseColor", c);
            if (m.HasProperty("_Color")) m.SetColor("_Color", c);
            m.name = "CourtSoftWaterRuntime";
            return m;
        }

        static Material MakeSoftDampMat(Color tint, float alphaMul)
        {
            var sh = Shader.Find("Universal Render Pipeline/Unlit");
            if (!sh) sh = Shader.Find("Sprites/Default");
            if (!sh) sh = Shader.Find("Universal Render Pipeline/Lit");
            var m = new Material(sh);
            ForceTransparentAlpha(m);
            var tex = RadialDampTex();
            if (m.HasProperty("_BaseMap")) m.SetTexture("_BaseMap", tex);
            if (m.HasProperty("_MainTex")) m.SetTexture("_MainTex", tex);
            var c = new Color(tint.r, tint.g, tint.b, Mathf.Clamp01(alphaMul));
            if (m.HasProperty("_BaseColor")) m.SetColor("_BaseColor", c);
            if (m.HasProperty("_Color")) m.SetColor("_Color", c);
            m.name = "CourtSoftDampRuntime";
            return m;
        }

        static void ForceTransparentAlpha(Material m)
        {
            if (!m) return;
            if (m.HasProperty("_Surface")) m.SetFloat("_Surface", 1f);
            if (m.HasProperty("_Blend")) m.SetFloat("_Blend", 0f); // Alpha
            m.SetOverrideTag("RenderType", "Transparent");
            m.SetInt("_SrcBlend", (int)BlendMode.SrcAlpha);
            m.SetInt("_DstBlend", (int)BlendMode.OneMinusSrcAlpha);
            if (m.HasProperty("_SrcBlendAlpha")) m.SetInt("_SrcBlendAlpha", (int)BlendMode.One);
            if (m.HasProperty("_DstBlendAlpha")) m.SetInt("_DstBlendAlpha", (int)BlendMode.OneMinusSrcAlpha);
            m.SetInt("_ZWrite", 0);
            m.DisableKeyword("_ALPHATEST_ON");
            m.DisableKeyword("_ALPHAPREMULTIPLY_ON");
            m.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            m.EnableKeyword("_ALPHABLEND_ON");
            m.renderQueue = 3000;
        }

        static Material LoadPuddleMat()
        {
            return MakeSoftWaterMat(new Color(0.07f, 0.13f, 0.15f), 0.78f);
        }

        static Material LoadPuddleRimMat()
        {
            return MakeSoftDampMat(new Color(0.12f, 0.14f, 0.12f), 0.55f);
        }

        static Material LoadPuddleSoftEdgeMat()
        {
            return MakeSoftWaterMat(new Color(0.06f, 0.12f, 0.14f), 0.45f);
        }

        /// <summary>
        /// Soft radial puddle mesh — flat disc; UVs map 0–1 so _BaseMap radial alpha feathers the edge.
        /// </summary>
        static Mesh BuildSoftPuddleMesh(float rx, float rz, int rings = 6, int segs = 28)
        {
            var mesh = new Mesh { name = "CourtSoftPuddle" };
            int vertsPerRing = segs;
            int vCount = 1 + rings * vertsPerRing;
            var verts = new Vector3[vCount];
            var uvs = new Vector2[vCount];
            var cols = new Color[vCount];
            verts[0] = Vector3.zero;
            uvs[0] = new Vector2(0.5f, 0.5f);
            cols[0] = Color.white;
            int vi = 1;
            for (int ring = 1; ring <= rings; ring++)
            {
                float t = ring / (float)rings;
                for (int s = 0; s < segs; s++)
                {
                    float a = (s / (float)segs) * Mathf.PI * 2f;
                    float x = Mathf.Cos(a) * rx * t;
                    float z = Mathf.Sin(a) * rz * t;
                    float y = (1f - t) * 0.008f;
                    verts[vi] = new Vector3(x, y, z);
                    uvs[vi] = new Vector2(0.5f + 0.5f * (x / rx), 0.5f + 0.5f * (z / rz));
                    cols[vi] = Color.white;
                    vi++;
                }
            }
            var tris = new System.Collections.Generic.List<int>(rings * segs * 6);
            for (int s = 0; s < segs; s++)
            {
                int a = 1 + s;
                int b = 1 + ((s + 1) % segs);
                tris.Add(0); tris.Add(a); tris.Add(b);
            }
            for (int ring = 1; ring < rings; ring++)
            {
                int r0 = 1 + (ring - 1) * segs;
                int r1 = 1 + ring * segs;
                for (int s = 0; s < segs; s++)
                {
                    int s1 = (s + 1) % segs;
                    tris.Add(r0 + s); tris.Add(r1 + s); tris.Add(r1 + s1);
                    tris.Add(r0 + s); tris.Add(r1 + s1); tris.Add(r0 + s1);
                }
            }
            mesh.SetVertices(verts);
            mesh.SetUVs(0, uvs);
            mesh.SetColors(cols);
            mesh.SetTriangles(tris, 0);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        static GameObject SpawnSoftDisc(Transform hold, Vector3 at, float rx, float rz,
            Material mat, string name, float yLift)
        {
            var go = new GameObject(name);
            go.transform.SetParent(hold, false);
            go.transform.position = at + new Vector3(0f, yLift, 0f);
            var mf = go.AddComponent<MeshFilter>();
            mf.sharedMesh = BuildSoftPuddleMesh(rx, rz);
            var mr = go.AddComponent<MeshRenderer>();
            mr.sharedMaterial = mat;
            mr.shadowCastingMode = ShadowCastingMode.Off;
            mr.receiveShadows = true;
            return go;
        }

        /// <summary>
        /// Raised/sunken cobble slabs — micro-relief that breaks the flat plane in camera.
        /// </summary>
        static void BuildMicroRelief(Transform hold)
        {
            var stone = HubLook.Pbr("cobblestone_square", new Color(0.36f, 0.37f, 0.38f), 0.04f, 0.22f, 4.2f);
            if (stone && stone.HasProperty("_Smoothness")) stone.SetFloat("_Smoothness", 0.30f);
            if (stone && stone.HasProperty("_BumpScale")) stone.SetFloat("_BumpScale", 1.4f);

            int count = ConcordiaHost.LeanPlay ? 18 : 26;
            float radius = 16f;
            for (int i = 0; i < count; i++)
            {
                float a = (i / (float)count) * Mathf.PI * 2f + 0.31f * i;
                float d = 2.4f + (i % 5) * 2.0f;
                if (d > radius) d = radius * 0.85f;
                // Raised slabs only in hero FOV — height must read in stills (not only normals).
                float y = (i % 2 == 0) ? 0.08f + (i % 3) * 0.04f : 0.02f;
                var pos = new Vector3(Mathf.Cos(a) * d, y, Mathf.Sin(a) * d);
                float w = 1.6f + (i % 4) * 0.40f;
                float h = 0.14f + (i % 3) * 0.07f;
                var slab = HubLook.PrimSurface(hold, PrimitiveType.Cube, pos,
                    new Vector3(w, h, w * (0.65f + (i % 3) * 0.15f)), stone,
                    "CourtRelief_" + i, false);
                if (!slab) continue;
                slab.transform.localRotation = Quaternion.Euler(
                    (i % 2) * 2.5f - 1.2f, i * 17.3f, (i % 3) * 1.8f - 0.9f);
            }

            var grit = HubLook.Pbr("pebble_embedded_pavement", new Color(0.28f, 0.28f, 0.30f), 0.02f, 0.18f, 3.5f);
            if (!grit) grit = HubLook.Pbr("gravel", new Color(0.32f, 0.30f, 0.28f), 0.02f, 0.16f, 4f);
            int patches = ConcordiaHost.LeanPlay ? 14 : 24;
            for (int i = 0; i < patches; i++)
            {
                float a = i * 2.399f;
                float d = 3.0f + (i % 7) * 1.7f;
                var pos = new Vector3(Mathf.Cos(a) * d, 0.055f, Mathf.Sin(a) * d);
                float s = 0.65f + (i % 4) * 0.28f;
                HubLook.PrimSurface(hold, PrimitiveType.Cylinder, pos,
                    new Vector3(s, 0.012f, s), grit, "CourtGrit_" + i, false);
            }
        }

        /// <summary>
        /// PASS3: true soft water edges via Sprite/Default quad + radial alpha texture
        /// (survives URP Camera.Render). Concentric Lit rings are NOT enough.
        /// </summary>
        static void BuildPuddles(Transform hold)
        {
            if (GameObject.Find("CourtPuddles"))
            {
                var old = GameObject.Find("CourtPuddles");
                if (old) old.SetActive(false);
            }

            var matDamp = MakeSoftDampMat(new Color(0.05f, 0.07f, 0.06f), 0.82f);
            var matWater = MakeSpriteRadialWaterMat(new Color(0.10f, 0.20f, 0.24f), 0.98f);

            // PASS4: triangle cluster in plaza FOV; centers ≥2.2m apart.
            Vector3[] hero =
            {
                new Vector3(-1.7f, 0f, 1.15f),
                new Vector3(0.25f, 0f, 2.55f),
                new Vector3(1.85f, 0f, 0.85f),
                new Vector3(-2.6f, 0f, -2.4f),
                new Vector3(3.0f, 0f, 2.9f),
            };
            float[] rad = { 0.55f, 0.50f, 0.58f, 0.48f, 0.50f };

            int n = ConcordiaHost.LeanPlay ? 5 : hero.Length;
            for (int i = 0; i < n; i++)
                SpawnSoftPuddle(hold, hero[i], rad[i], matDamp, matWater, i);
        }

        static Material MakeSpriteRadialWaterMat(Color tint, float alphaMul)
        {
            var sh = Shader.Find("Sprites/Default");
            if (!sh) sh = Shader.Find("Universal Render Pipeline/Unlit");
            var m = new Material(sh);
            var tex = BuildRadialAlphaTex(256, 0.16f, 0.26f, tint);
            if (m.HasProperty("_MainTex")) m.SetTexture("_MainTex", tex);
            if (m.HasProperty("_BaseMap")) m.SetTexture("_BaseMap", tex);
            var c = new Color(1f, 1f, 1f, Mathf.Clamp01(alphaMul));
            if (m.HasProperty("_Color")) m.SetColor("_Color", c);
            if (m.HasProperty("_BaseColor")) m.SetColor("_BaseColor", new Color(tint.r, tint.g, tint.b, alphaMul));
            m.name = "CourtSpriteSoftWater";
            m.renderQueue = 3000;
            return m;
        }

        static void SpawnSoftPuddle(Transform hold, Vector3 at, float R,
            Material matDamp, Material matWater, int id)
        {
            // Soft radial mesh damp underlayer — compact (Pass4: do not use R×1.4 sheet).
            SpawnSoftDisc(hold, at, R * 0.95f, R * 0.78f, matDamp,
                "CourtPuddleDamp_" + id, 0.055f);

            // Unlit feather disc (soft edge backup for Camera.Render).
            SpawnSoftDisc(hold, at, R * 1.05f, R * 0.88f,
                MakeSoftWaterMat(new Color(0.08f, 0.16f, 0.19f), 0.90f),
                "CourtPuddleFeather_" + id, 0.078f);

            // Sprite quad — radial alpha feather that Camera.Render keeps.
            var go = GameObject.CreatePrimitive(PrimitiveType.Quad);
            Object.Destroy(go.GetComponent<Collider>());
            go.name = "CourtPuddleSoft_" + id;
            go.transform.SetParent(hold, false);
            go.transform.position = at + new Vector3(0f, 0.090f, 0f);
            go.transform.rotation = Quaternion.Euler(90f, id * 19f, 0f);
            go.transform.localScale = new Vector3(R * 2.05f, R * 1.65f, 1f);
            var mr = go.GetComponent<MeshRenderer>();
            if (mr)
            {
                mr.sharedMaterial = matWater;
                mr.shadowCastingMode = ShadowCastingMode.Off;
                mr.receiveShadows = false;
            }

            var alias = new GameObject("CourtPuddle_" + id);
            alias.transform.SetParent(hold, false);
            alias.transform.position = at + new Vector3(0f, 0.068f, 0f);
        }

        /// <summary>In-place PASS3 upgrade: hide Lit rings, ensure Sprite soft quads exist.</summary>
        static void UpgradePuddlesToSoftAlpha(Transform hold)
        {
            if (!hold) return;
            bool haveSpriteSoft = false;
            foreach (Transform c in hold)
            {
                if (!c || c.name == null) continue;
                if (c.name.StartsWith("CourtPuddleSoft_", System.StringComparison.Ordinal)
                    && c.gameObject.activeInHierarchy)
                {
                    var r = c.GetComponent<Renderer>();
                    if (r && r.sharedMaterial && r.sharedMaterial.shader
                        && r.sharedMaterial.shader.name.IndexOf("Sprites", System.StringComparison.Ordinal) >= 0)
                        haveSpriteSoft = true;
                }
                if (c.name.StartsWith("CourtPuddleRim_", System.StringComparison.Ordinal)
                    || c.name.StartsWith("CourtPuddleHalo_", System.StringComparison.Ordinal)
                    || c.name.StartsWith("CourtPuddleWater_", System.StringComparison.Ordinal))
                {
                    c.gameObject.SetActive(false);
                }
            }
            if (!haveSpriteSoft)
            {
                foreach (Transform c in hold)
                {
                    if (!c || c.name == null) continue;
                    if (c.name.StartsWith("CourtPuddleSoft_", System.StringComparison.Ordinal)
                        || c.name.StartsWith("CourtPuddleDamp_", System.StringComparison.Ordinal)
                        || (c.name.StartsWith("CourtPuddle_", System.StringComparison.Ordinal)
                            && c.name.Length < 16))
                        c.gameObject.SetActive(false);
                }
                BuildPuddles(hold);
            }
        }

        static void BuildGritScatter(Transform hold)
        {
            int rocks = ConcordiaHost.LeanPlay ? 14 : 28;
            int pebbles = ConcordiaHost.LeanPlay ? 22 : 40;
            int weeds = ConcordiaHost.LeanPlay ? 10 : 20;
            // PASS2: never leave FreePacks rock_smallA pyramids in plaza FOV — they read as orange debug frustums.
            string[] weedStems = { "grass", "grass_leafs", "plant_bushSmall", "plant_flatShort", "flower_redA" };
            var pebbleMat = HubLook.Lit(new Color(0.40f, 0.36f, 0.30f), 0.06f, 0.20f);
            var rockMat = HubLook.Lit(new Color(0.46f, 0.41f, 0.34f), 0.08f, 0.22f);
            var earthMat = HubLook.Lit(new Color(0.38f, 0.32f, 0.24f), 0.04f, 0.22f);

            // Hero rocks — irregular Lit chunks only (no FreePacks rock_smallA).
            Vector3[] heroRock =
            {
                new Vector3(-0.9f, 0f, 0.55f),
                new Vector3(1.55f, 0f, 1.9f),
                new Vector3(0.35f, 0f, -1.35f),
                new Vector3(-2.4f, 0f, 2.8f),
                new Vector3(3.1f, 0f, -0.2f),
            };
            for (int i = 0; i < heroRock.Length; i++)
            {
                float sx = 0.48f + (i % 3) * 0.10f;
                float sy = 0.18f + (i % 2) * 0.07f;
                float sz = 0.36f + (i % 4) * 0.08f;
                var chunk = HubLook.PrimSurface(hold, PrimitiveType.Cube,
                    heroRock[i] + new Vector3(0f, sy * 0.5f + 0.02f, 0f),
                    new Vector3(sx, sy, sz), rockMat, "CourtRockChunk_" + i, false);
                if (chunk)
                    chunk.transform.localRotation = Quaternion.Euler(10f + i * 8f, i * 37f, 6f + i * 5f);
            }

            // Always-on readable pebble prims near hero puddles — foot-scale irregular stones.
            Vector3[] pebbleHero =
            {
                new Vector3(-1.2f, 0.08f, 1.2f), new Vector3(-0.4f, 0.07f, 1.6f),
                new Vector3(0.8f, 0.09f, 0.9f), new Vector3(1.6f, 0.08f, -0.2f),
                new Vector3(2.0f, 0.10f, 1.5f), new Vector3(-2.0f, 0.08f, 0.4f),
                new Vector3(0.2f, 0.11f, 2.4f), new Vector3(1.1f, 0.09f, 2.8f),
                new Vector3(-1.0f, 0.08f, 2.6f), new Vector3(2.4f, 0.07f, 0.6f),
            };
            for (int i = 0; i < pebbleHero.Length; i++)
            {
                float sx = 0.16f + (i % 4) * 0.06f;
                float sy = 0.09f + (i % 3) * 0.03f;
                float sz = 0.13f + (i % 5) * 0.04f;
                var go = HubLook.PrimSurface(hold, PrimitiveType.Cube, pebbleHero[i],
                    new Vector3(sx, sy, sz), (i % 3 == 0) ? earthMat : pebbleMat,
                    "CourtPebbleHero_" + i, false);
                if (go) go.transform.localRotation = Quaternion.Euler(i * 20f, i * 40f, i * 10f);
            }

            // Ring rocks further out — Lit chunks only (no FreePacks rock_smallA).
            for (int i = heroRock.Length; i < rocks; i++)
            {
                float a = i * 1.7f + 0.4f;
                float d = 7.5f + (i % 6) * 1.8f;
                var at = new Vector3(Mathf.Cos(a) * d, 0f, Mathf.Sin(a) * d);
                float sx = 0.38f + (i % 3) * 0.08f;
                float sy = 0.14f + (i % 2) * 0.05f;
                float sz = 0.30f + (i % 4) * 0.06f;
                var chunk = HubLook.PrimSurface(hold, PrimitiveType.Cube, at + new Vector3(0f, sy * 0.5f, 0f),
                    new Vector3(sx, sy, sz), rockMat, "CourtRockChunk_" + i, false);
                if (chunk) chunk.transform.localRotation = Quaternion.Euler(i * 11f, i * 29f, i * 7f);
            }

            // 3D pebbles clustered near hero puddles — must read in close still.
            Vector3[] pebbleCluster =
            {
                new Vector3(-1.2f, 0.06f, 1.0f), new Vector3(-2.1f, 0.05f, 1.7f),
                new Vector3(2.0f, 0.06f, -0.3f), new Vector3(2.8f, 0.05f, -1.0f),
                new Vector3(0.6f, 0.06f, 3.3f), new Vector3(-0.2f, 0.05f, 4.2f),
                new Vector3(1.0f, 0.06f, 1.2f), new Vector3(-0.4f, 0.05f, -0.8f),
            };
            for (int i = 0; i < pebbles; i++)
            {
                Vector3 at;
                if (i < pebbleCluster.Length) at = pebbleCluster[i];
                else
                {
                    float a = i * 1.15f;
                    float d = 1.2f + (i % 5) * 0.9f;
                    at = new Vector3(Mathf.Cos(a) * d, 0.055f, Mathf.Sin(a) * d);
                }
                float s = 0.18f + (i % 5) * 0.07f;
                var shape = (i % 3 == 0) ? PrimitiveType.Cube : PrimitiveType.Sphere;
                var go = HubLook.PrimSurface(hold, shape, at, new Vector3(s, s * 0.7f, s * 0.85f),
                    pebbleMat, "CourtPebble_" + i, false);
                if (go) go.transform.localRotation = Quaternion.Euler(i * 17f, i * 41f, i * 9f);
            }

            for (int i = 0; i < weeds; i++)
            {
                float a = i * 2.1f + 1.1f;
                float d = 10f + (i % 5) * 2.2f;
                var at = new Vector3(Mathf.Cos(a) * d, 0f, Mathf.Sin(a) * d);
                var stem = weedStems[i % weedStems.Length];
                var go = FreePacks.Spawn(stem, hold, at, i * 41f, 0.45f + (i % 3) * 0.15f,
                    required: false, byHeight: true);
                if (go)
                {
                    go.name = "CourtWeed_" + i;
                    FreePacks.StripColliders(go);
                }
            }

            int debris = ConcordiaHost.LeanPlay ? 3 : 8;
            for (int i = 0; i < debris; i++)
            {
                var at = new Vector3(((i % 2) * 2 - 1) * (6f + i * 1.1f), 0f, 8f + i * 2.5f);
                var crate = FreePacks.Spawn(DressVocab.Crate(), hold, at, 12f + i * 20f, 0.55f,
                    required: false, byHeight: false);
                if (crate)
                {
                    crate.name = "CourtDebris_" + i;
                    FreePacks.StripColliders(crate);
                }
            }
        }

        // ─── PASS4 locked still rig ───────────────────────────────────────────

        /// <summary>
        /// Dedicated still capture: day hour pinned, ChaseCam/Cinemachine OFF, approach collar
        /// hidden, NPCs cleared, soft puddles separated, proof frustum scrubbed.
        /// Writes plaza + nose-on curb PNGs via Camera.Render (PASS4 filenames).
        /// </summary>
        public static string CapturePass4Stills(string outDir)
        {
            if (string.IsNullOrEmpty(outDir))
                outDir = Path.Combine(System.Environment.GetFolderPath(System.Environment.SpecialFolder.UserProfile),
                    ".zuko", "remaining-work");
            Directory.CreateDirectory(outDir);

            // Keep Play alive if Editor loses focus during MCP still write.
            Application.runInBackground = true;
#if UNITY_EDITOR
            UnityEditor.PlayerSettings.runInBackground = true;
#endif

            Ensure(false);
            SeparateHeroPuddles();
            SolidRetintUnderfootScatter();
            int banned = BanFreePacksRoadRocks();
            int killed = KillProofFrustumMarkers();
            killed += HideProofClutterForStills();

            // Pin daylight.
            WorldClock.Hour = 14.5f;
            HubLook.ApplyHour(WorldId.Hub, WorldClock.Hour);

            DisableChaseAndCinemachine();
            HideApproachCollar();

            var demo = GameObject.Find(DemoRoadName);
            var curbFocus = demo
                ? demo.transform.position + new Vector3(2.55f, 0.29f, 0f)
                : new Vector3(2.55f, 0.29f, -42f);
            ClearNpcsForStill(curbFocus, 28f);
            ClearNpcsForStill(new Vector3(0f, 0f, 1f), 22f);

            var cam = EnsureStillCamera();
            cam.farClipPlane = 16f;
            string plazaPath = Path.Combine(outDir, "SLICE2B-PASS4-STILL-plaza-puddles-rocks-2026-09-20.png");
            string curbPath = Path.Combine(outDir, "SLICE2B-PASS4-STILL-road-curb-2026-09-20.png");

            // Plaza: elevated look-down south of CX_SignFace onto 3 soft puddles + rocks + relief.
            killed += KillProofFrustumMarkers();
            cam.transform.position = new Vector3(0.05f, 2.15f, -1.0f);
            cam.transform.rotation = Quaternion.LookRotation(
                (new Vector3(0.1f, 0.05f, 1.2f) - cam.transform.position).normalized, Vector3.up);
            cam.fieldOfView = 48f;
            cam.farClipPlane = 14f;
            RenderStill(cam, plazaPath);

            // Nose-on curb: asphalt + curb FACE + sidewalk TOP; frustum scrubbed again.
            killed += KillProofFrustumMarkers();
            HideWarmDiscsNearCurb();
            float z = demo ? demo.transform.position.z : -42f;
            float yBand = demo ? demo.transform.position.y : 0.15f;
            var eye = new Vector3(0.15f, yBand + 0.85f, z);
            var aim = new Vector3(2.55f, yBand + 0.28f, z);
            cam.transform.position = eye;
            cam.transform.rotation = Quaternion.LookRotation((aim - eye).normalized, Vector3.up);
            cam.fieldOfView = 38f;
            cam.farClipPlane = 12f;
            RenderStill(cam, curbPath);
            cam.farClipPlane = 36f;

            int soft = 0;
            var hold = GameObject.Find(RootName);
            if (hold)
            {
                foreach (Transform t in hold.GetComponentsInChildren<Transform>(true))
                    if (t && t.name != null && t.name.StartsWith("CourtPuddleSoft_", System.StringComparison.Ordinal)
                        && t.gameObject.activeInHierarchy)
                        soft++;
            }

            return "plaza=" + plazaPath + " curb=" + curbPath
                   + " softPuddles=" + soft + " bannedRocks=" + banned
                   + " killedMarkers=" + killed
                   + " hour=" + WorldClock.Hour
                   + " demo=" + (demo != null);
        }

        /// <summary>Back-compat alias — writes PASS4 stills.</summary>
        public static string CapturePass3Stills(string outDir) => CapturePass4Stills(outDir);

        /// <summary>
        /// SLICE 3 — streetscape stills from Market + Archive district streets (LeanPlay).
        /// Standing on a paved ribbon facing lean building facades / lots.
        /// </summary>
        public static string CaptureStreetscapeStills(string outDir)
        {
            if (string.IsNullOrEmpty(outDir))
                outDir = Path.Combine(System.Environment.GetFolderPath(System.Environment.SpecialFolder.UserProfile),
                    ".zuko", "remaining-work");
            Directory.CreateDirectory(outDir);

            Application.runInBackground = true;
#if UNITY_EDITOR
            UnityEditor.PlayerSettings.runInBackground = true;
#endif

            Ensure(false);
            KillProofFrustumMarkers();
            HideProofClutterForStills();
            WorldClock.Hour = 14.5f;
            HubLook.ApplyHour(WorldId.Hub, WorldClock.Hour);
            DisableChaseAndCinemachine();

            string marketPath = Path.Combine(outDir, "SLICE3-STILL-market-street-2026-09-20.png");
            string archivePath = Path.Combine(outDir, "SLICE3-STILL-archive-street-2026-09-20.png");

            var cam = EnsureStillCamera();
            int killed = 0;

            killed += ShootDistrictStreetStill(cam, "market_district", marketPath);
            WorldClock.Hour = 14.5f;
            HubLook.ApplyHour(WorldId.Hub, WorldClock.Hour);
            killed += KillProofFrustumMarkers();
            killed += ShootDistrictStreetStill(cam, "archive_quarter", archivePath);
            killed += KillProofFrustumMarkers();

            cam.farClipPlane = 36f;
            return "market=" + marketPath + " archive=" + archivePath + " killed=" + killed;
        }

        /// <summary>
        /// SLICE 4 — Crown Road spoke + approach landmark stills (LeanPlay medium ring).
        /// </summary>
        public static string CaptureCrownRoadStills(string outDir)
        {
            if (string.IsNullOrEmpty(outDir))
                outDir = Path.Combine(System.Environment.GetFolderPath(System.Environment.SpecialFolder.UserProfile),
                    ".zuko", "remaining-work");
            Directory.CreateDirectory(outDir);

            Application.runInBackground = true;
#if UNITY_EDITOR
            UnityEditor.PlayerSettings.runInBackground = true;
#endif

            Ensure(false);
            KillProofFrustumMarkers();
            HideProofClutterForStills();
            WorldClock.Hour = 14.5f;
            HubLook.ApplyHour(WorldId.Hub, WorldClock.Hour);
            DisableChaseAndCinemachine();

            string spokePath = Path.Combine(outDir, "SLICE4-STILL-crown-road-spoke-2026-09-20.png");
            string landmarkPath = Path.Combine(outDir, "SLICE4-STILL-approach-landmark-2026-09-20.png");

            var cam = EnsureStillCamera();
            int killed = 0;

            killed += ShootCrownRoadSpokeStill(cam, spokePath);
            WorldClock.Hour = 14.5f;
            HubLook.ApplyHour(WorldId.Hub, WorldClock.Hour);
            killed += KillProofFrustumMarkers();
            killed += ShootApproachLandmarkStill(cam, landmarkPath);
            killed += KillProofFrustumMarkers();

            cam.farClipPlane = 60f;
            return "spoke=" + spokePath + " landmark=" + landmarkPath + " killed=" + killed;
        }

        /// <summary>
        /// SLICE 5 — Mid-distance Market/Archive activity stills (people readable + building mass).
        /// Does NOT ClearNpcsForStill — activity is the point. Rematerializes StreamNpcSim near eye.
        /// </summary>
        public static string CaptureDataNpcActivityStills(string outDir)
        {
            if (string.IsNullOrEmpty(outDir))
                outDir = Path.Combine(System.Environment.GetFolderPath(System.Environment.SpecialFolder.UserProfile),
                    ".zuko", "remaining-work");
            Directory.CreateDirectory(outDir);

            Application.runInBackground = true;
#if UNITY_EDITOR
            UnityEditor.PlayerSettings.runInBackground = true;
#endif

            Ensure(false);
            KillProofFrustumMarkers();
            HideProofClutterForStills();
            WorldClock.Hour = 14.5f;
            HubLook.ApplyHour(WorldId.Hub, WorldClock.Hour);
            DisableChaseAndCinemachine();

            // Thin Court fog so mid-street people read (same class as Hub vista stills).
            float prevFog = RenderSettings.fogDensity;
            HubLook.LiveFog(0.006f);
            RenderSettings.fog = true;

            string marketPath = Path.Combine(outDir, "SLICE5-STILL-market-activity-2026-09-20.png");
            string nearPath = Path.Combine(outDir, "SLICE5-STILL-near-ring-people-2026-09-20.png");

            var cam = EnsureStillCamera();
            int killed = 0;
            int remat = 0;

            killed += ShootDataNpcActivityStill(cam, "market_district", marketPath, ref remat);
            WorldClock.Hour = 14.5f;
            HubLook.ApplyHour(WorldId.Hub, WorldClock.Hour);
            killed += KillProofFrustumMarkers();
            // Second angle: Archive if present, else Market corner offset.
            var archive = FindDistrictRoot("archive_quarter");
            if (archive)
                killed += ShootDataNpcActivityStill(cam, "archive_quarter", nearPath, ref remat);
            else
                killed += ShootDataNpcActivityStill(cam, "market_district", nearPath, ref remat, cornerBias: true);
            killed += KillProofFrustumMarkers();

            HubLook.LiveFog(prevFog);
            cam.farClipPlane = 80f;

            int sim = StreamNpcSim.Count;
            int live = StreamNpcSim.CountLiveFullBodies();
            Debug.Log("[Concordia] CaptureDataNpcActivityStills sim=" + sim + " live=" + live
                      + " remat=" + remat + " market=" + marketPath + " near=" + nearPath);
            return "market=" + marketPath + " near=" + nearPath + " sim=" + sim
                   + " live=" + live + " remat=" + remat + " killed=" + killed;
        }

        static int ShootDataNpcActivityStill(Camera cam, string districtId, string path,
                                                ref int rematTotal, bool cornerBias = false)
        {
            int killed = 0;
            var dist = FindDistrictRoot(districtId);
            Vector3 buildCenter;
            Vector3 streetEye;
            Transform bestStreet = null;
            if (!dist)
            {
                Debug.LogWarning("[Concordia] CaptureDataNpcActivityStills: no District_" + districtId);
                buildCenter = districtId.Contains("archive")
                    ? new Vector3(0f, 0f, -50f)
                    : new Vector3(Mathf.Cos(-Mathf.PI * 0.18f) * 52f, 0f,
                        Mathf.Sin(-Mathf.PI * 0.18f) * 52f);
                streetEye = buildCenter + new Vector3(0f, 1.85f, 0f);
            }
            else
            {
                buildCenter = Vector3.zero;
                int buildN = 0;
                var builds = dist.Find("Buildings");
                if (builds)
                {
                    foreach (Transform t in builds)
                    {
                        if (!t || !t.name.StartsWith("LeanBuilding_", System.StringComparison.Ordinal)) continue;
                        buildCenter += t.position;
                        buildN++;
                    }
                }
                if (buildN > 0) buildCenter /= buildN;
                else buildCenter = dist.position;

                streetEye = buildCenter + Vector3.up * 1.85f;
                var streets = dist.Find("Streets");
                if (streets && streets.childCount > 0)
                {
                    float bestD = float.MaxValue;
                    foreach (Transform band in streets)
                    {
                        if (!band) continue;
                        float d = (band.position - buildCenter).sqrMagnitude;
                        if (d < bestD) { bestD = d; bestStreet = band; }
                    }
                    if (bestStreet)
                    {
                        streetEye = bestStreet.position + Vector3.up * 1.85f;
                        streetEye += bestStreet.right * (cornerBias ? 2.4f : 0.6f);
                        if (cornerBias) streetEye += bestStreet.forward * 3.5f;
                    }
                }
            }

            // Player in near ring so StreamNpcPresence stays Full.
            var player = ConcordiaPlayer.Live;
            var playerPos = streetEye; playerPos.y = 0f;
            if (player) player.transform.position = playerPos;

            rematTotal += StreamNpcSim.RematerializeNear(streetEye, 36f, 8);
            rematTotal += StreamNpcSim.RematerializeNear(buildCenter, 40f, 4);

            // Stage 3–4 hub citizens ON the street ribbon in front of the still aim.
            var staged = StageHubCitizensOnStreet(districtId, bestStreet, streetEye, buildCenter, 4);
            rematTotal += staged;

            // Hide fence/gate clutter near eye.
            foreach (var r in Object.FindObjectsByType<Renderer>(FindObjectsInactive.Exclude))
            {
                if (!r || !r.enabled) continue;
                var n = r.gameObject.name ?? "";
                bool fencey = n.IndexOf("gate", System.StringComparison.OrdinalIgnoreCase) >= 0
                              || n.IndexOf("Fence", System.StringComparison.OrdinalIgnoreCase) >= 0
                              || n.IndexOf("FortRim", System.StringComparison.OrdinalIgnoreCase) >= 0
                              || n.IndexOf("iron", System.StringComparison.OrdinalIgnoreCase) >= 0;
                if (!fencey) continue;
                if ((r.bounds.center - streetEye).sqrMagnitude < 28f * 28f)
                    r.enabled = false;
            }

            killed += KillProofFrustumMarkers();
            // Extra cyan/orange emit scrub in frustum (continent impostors / debug prims).
            killed += KillCyanOrangeNear(streetEye, 55f);

            // MID-DISTANCE: pull back so street depth + people + building mass read together.
            var aim = buildCenter + Vector3.up * 1.9f;
            // Prefer aiming at staged people if we have them.
            var peopleCentroid = Vector3.zero;
            int peopleN = 0;
            foreach (var rec in StreamNpcSim.All)
            {
                if (rec == null || !rec.Body || !rec.Body.activeInHierarchy) continue;
                if (rec.Band < StreamLodBand.Full) continue;
                if (string.IsNullOrEmpty(rec.Id) || !rec.Id.StartsWith("hub-", System.StringComparison.Ordinal))
                    continue;
                if ((rec.Body.transform.position - streetEye).sqrMagnitude > 22f * 22f) continue;
                ForceVisibleBody(rec.Body);
                peopleCentroid += rec.Body.transform.position;
                peopleN++;
            }
            if (peopleN > 0)
            {
                peopleCentroid /= peopleN;
                aim = peopleCentroid + Vector3.up * 1.5f;
                // Bias aim toward buildings so mass stays behind people.
                aim = Vector3.Lerp(aim, buildCenter + Vector3.up * 2.2f, 0.35f);
            }

            var look = (aim - streetEye);
            if (look.sqrMagnitude < 0.01f) look = Vector3.forward;
            var back = look.normalized;
            cam.transform.position = streetEye - back * 12f + Vector3.up * 1.35f
                                     + Vector3.Cross(Vector3.up, back).normalized * (cornerBias ? 3.5f : 1.6f);
            cam.transform.rotation = Quaternion.LookRotation(
                (aim - cam.transform.position).normalized, Vector3.up);
            cam.fieldOfView = 50f;
            cam.farClipPlane = 90f;

            int visiblePeople = 0;
            foreach (var mp in Object.FindObjectsByType<ModularPerson>(FindObjectsInactive.Exclude))
            {
                if (!mp || !mp.gameObject.activeInHierarchy) continue;
                // Only count bodies with at least one enabled renderer (not parked husks).
                bool lit = false;
                foreach (var rend in mp.GetComponentsInChildren<Renderer>(true))
                {
                    if (rend && rend.enabled) { lit = true; break; }
                }
                if (!lit) continue;
                var vp = cam.WorldToViewportPoint(mp.transform.position + Vector3.up * 1f);
                if (vp.z > 0.8f && vp.z < 40f && vp.x > 0.08f && vp.x < 0.92f && vp.y > 0.05f && vp.y < 0.95f)
                    visiblePeople++;
            }

            RenderStill(cam, path);
            Debug.Log("[Concordia] CaptureDataNpcActivityStills wrote " + path
                      + " district=" + districtId + " peopleInFrustum=" + visiblePeople
                      + " staged=" + staged
                      + " sim=" + StreamNpcSim.Count + " live=" + StreamNpcSim.CountLiveFullBodies()
                      + " eye=" + cam.transform.position);
            return killed;
        }

        static int StageHubCitizensOnStreet(string districtId, Transform street, Vector3 streetEye,
                                            Vector3 buildCenter, int want)
        {
            string prefix = districtId != null && districtId.Contains("archive") ? "hub-arc"
                          : districtId != null && districtId.Contains("council") ? "hub-cnc"
                          : districtId != null && districtId.Contains("warden") ? "hub-wdn"
                          : "hub-mkt";
            var along = street ? street.forward : (buildCenter - streetEye);
            along.y = 0f;
            if (along.sqrMagnitude < 0.01f) along = Vector3.forward;
            along.Normalize();
            var side = Vector3.Cross(Vector3.up, along).normalized;

            // Free Full slots so hub citizens can rematerialize for the still.
            ParkFarthestFull(streetEye, want + 1);

            int n = 0;
            for (var i = 0; i < StreamNpcSim.All.Count && n < want; i++)
            {
                var r = StreamNpcSim.All[i];
                if (r == null || string.IsNullOrEmpty(r.Id)) continue;
                if (!r.Id.StartsWith(prefix, System.StringComparison.Ordinal)) continue;

                var pos = streetEye + along * (2.5f + n * 1.8f) + side * ((n % 2 == 0) ? -1.2f : 1.4f);
                pos.y = 0f;
                r.Pos = pos;
                r.Home = pos;
                if (!r.Body || !r.Body.activeInHierarchy || r.Band < StreamLodBand.Full)
                    StreamNpcSim.TryRematerialize(r);
                if (!r.Body)
                {
                    // Cap blocked — force a body for still proof (counts against cap after).
                    StreamNpcSim.ForceSpawnBody(r);
                }
                if (!r.Body) continue;
                r.Body.transform.position = pos;
                r.Body.transform.rotation = Quaternion.LookRotation(along, Vector3.up);
                ForceVisibleBody(r.Body);
                var presence = r.Body.GetComponent<StreamNpcPresence>()
                               ?? r.Body.AddComponent<StreamNpcPresence>();
                presence.BindSimId(r.Id);
                // Reset band so Apply re-enables renderers even if already "Full".
                presence.Apply(StreamLodBand.Simulation);
                presence.Apply(StreamLodBand.Full);
                r.Band = StreamLodBand.Full;
                n++;
            }
            return n;
        }

        static void ParkFarthestFull(Vector3 focus, int freeSlots)
        {
            while (StreamNpcSim.CountLiveFullBodies() > StreamNpcSim.FullBodyCap - freeSlots)
            {
                StreamNpcSim.Record farthest = null;
                float best = -1f;
                for (var i = 0; i < StreamNpcSim.All.Count; i++)
                {
                    var r = StreamNpcSim.All[i];
                    if (r == null || !r.Body || r.Band < StreamLodBand.Full) continue;
                    float d = (r.Pos - focus).sqrMagnitude;
                    if (d > best) { best = d; farthest = r; }
                }
                if (farthest == null || !farthest.Body) break;
                var p = farthest.Body.GetComponent<StreamNpcPresence>()
                        ?? farthest.Body.AddComponent<StreamNpcPresence>();
                p.BindSimId(farthest.Id);
                p.Apply(StreamLodBand.Abstract);
            }
        }

        static void ForceVisibleBody(GameObject go)
        {
            if (!go) return;
            if (!go.activeSelf) go.SetActive(true);
            foreach (var rend in go.GetComponentsInChildren<Renderer>(true))
                if (rend) rend.enabled = true;
            var cc = go.GetComponent<CharacterController>();
            if (cc) cc.enabled = true;
            var life = go.GetComponent<NpcLife>();
            if (life) life.enabled = true;
        }

        static int KillCyanOrangeNear(Vector3 focus, float radius)
        {
            int n = 0;
            float r2 = radius * radius;
            foreach (var rend in Object.FindObjectsByType<Renderer>(FindObjectsInactive.Exclude))
            {
                if (!rend || !rend.enabled) continue;
                if ((rend.bounds.center - focus).sqrMagnitude > r2) continue;
                var mat = rend.sharedMaterial;
                if (!mat) continue;
                Color c = Color.black;
                if (mat.HasProperty("_BaseColor")) c = mat.GetColor("_BaseColor");
                else if (mat.HasProperty("_Color")) c = mat.GetColor("_Color");
                else if (mat.HasProperty("_EmissionColor")) c = mat.GetColor("_EmissionColor");
                bool cyan = c.g > 0.45f && c.b > 0.55f && c.r < 0.35f;
                bool orange = c.r > 0.7f && c.g > 0.25f && c.g < 0.65f && c.b < 0.25f;
                var nm = rend.gameObject.name ?? "";
                bool nameHit = nm.IndexOf("Impostor", System.StringComparison.OrdinalIgnoreCase) >= 0
                               || nm.IndexOf("Debug", System.StringComparison.OrdinalIgnoreCase) >= 0
                               || nm.IndexOf("Marker", System.StringComparison.OrdinalIgnoreCase) >= 0;
                if (cyan || orange || nameHit)
                {
                    rend.enabled = false;
                    n++;
                }
            }
            return n;
        }

        /// <summary>
        /// Hub vista stills — elevated / mid-far proof of CITY DENSITY (streets + lots +
        /// buildings + crown spokes). Dutch rejected Slice 3/4 street-level stills as too
        /// nose-on; these shots sit at eye Y 16–28m with farClip ≥ 180.
        /// Temporarily thins Court teal fog (0.027 Exp² washes 50m) so district mass reads.
        /// </summary>
        public static string CaptureHubVistaStills(string outDir)
        {
            if (string.IsNullOrEmpty(outDir))
                outDir = Path.Combine(System.Environment.GetFolderPath(System.Environment.SpecialFolder.UserProfile),
                    ".zuko", "remaining-work");
            Directory.CreateDirectory(outDir);

            Application.runInBackground = true;
#if UNITY_EDITOR
            UnityEditor.PlayerSettings.runInBackground = true;
#endif

            Ensure(false);
            KillProofFrustumMarkers();
            HideProofClutterForStills();
            WorldClock.Hour = 14.5f;
            HubLook.ApplyHour(WorldId.Hub, WorldClock.Hour);
            DisableChaseAndCinemachine();

            // Court cinematic fog (~0.027 Exp²) melts mid-ring — pin a vista density.
            float prevFog = RenderSettings.fogDensity;
            HubLook.LiveFog(0.0045f);
            RenderSettings.fog = true;

            string courtMarketPath = Path.Combine(outDir, "HUB-VISTA-court-to-market-2026-09-20.png");
            string heartRingPath = Path.Combine(outDir, "HUB-VISTA-heart-ring-2026-09-20.png");
            string crownSpokePath = Path.Combine(outDir, "HUB-VISTA-crown-spoke-out-2026-09-20.png");

            var cam = EnsureStillCamera();
            cam.farClipPlane = 220f;
            int killed = 0;

            killed += ShootVistaCourtToMarket(cam, courtMarketPath);
            WorldClock.Hour = 14.5f;
            HubLook.ApplyHour(WorldId.Hub, WorldClock.Hour);
            HubLook.LiveFog(0.0045f);
            killed += KillProofFrustumMarkers();

            killed += ShootVistaHeartRing(cam, heartRingPath);
            WorldClock.Hour = 14.5f;
            HubLook.ApplyHour(WorldId.Hub, WorldClock.Hour);
            HubLook.LiveFog(0.0045f);
            killed += KillProofFrustumMarkers();

            killed += ShootVistaCrownSpokeOut(cam, crownSpokePath);
            killed += KillProofFrustumMarkers();

            // Restore Court fog so Play stays honest after stills.
            HubLook.LiveFog(prevFog > 0.001f ? prevFog : 0.027f);
            cam.farClipPlane = 220f;
            return "courtMarket=" + courtMarketPath
                   + " heartRing=" + heartRingPath
                   + " crownSpoke=" + crownSpokePath
                   + " killed=" + killed
                   + " vistaFog=0.0045";
        }

        /// <summary>
        /// SLICE 6 — elevated Hub→Presents vista + mid-far single Present mass.
        /// farClip high enough for RingMeters (~220) + Sere (~297). Does NOT
        /// RequestFull foreign continents; keeps FarGeography impostors visible.
        /// </summary>
        public static string CaptureFarGeographyStills(string outDir)
        {
            if (string.IsNullOrEmpty(outDir))
                outDir = Path.Combine(System.Environment.GetFolderPath(System.Environment.SpecialFolder.UserProfile),
                    ".zuko", "remaining-work");
            Directory.CreateDirectory(outDir);

            Application.runInBackground = true;
#if UNITY_EDITOR
            UnityEditor.PlayerSettings.runInBackground = true;
#endif
            Ensure(false);
            KillProofFrustumMarkers();
            HideProofClutterForStills();
            WorldClock.Hour = 14.5f;
            HubLook.ApplyHour(WorldId.Hub, WorldClock.Hour);
            DisableChaseAndCinemachine();

            // Guarantee Present masses exist before framing (Boot coroutine may still be yielding).
            int seeded = ContinentStream.Live ? ContinentStream.Live.EnsureFarGeographyNow() : 0;

            float prevFog = RenderSettings.fogDensity;
            bool prevFogOn = RenderSettings.fog;
            // Vista must see RingMeters (~220) — Court fog melts Presents into void.
            HubLook.LiveFog(0.0018f);
            RenderSettings.fog = true;

            string hubToPresents = Path.Combine(outDir, "SLICE6-STILL-hub-to-presents-2026-09-20.png");
            string ringMass = Path.Combine(outDir, "SLICE6-STILL-ring-present-mass-2026-09-20.png");

            var cam = EnsureStillCamera();
            cam.farClipPlane = 560f;
            cam.orthographic = false;
            cam.fieldOfView = 58f;
            cam.clearFlags = CameraClearFlags.Skybox;

            int farCount = ReviveFarGeographyChunks(out Transform cyberChunk);
            if (farCount == 0)
                Debug.LogWarning("[Concordia] CaptureFarGeographyStills: no FarGeography chunks (seeded=" + seeded + ")");

            // (a) Elevated Hub looking out — Cyber (0°) + Ruins (45°) in one frustum.
            var pCyber = MegaworldMap.Present(WorldId.Cyber);
            var pRuins = MegaworldMap.Present(WorldId.Ruins);
            var lookMid = (pCyber + pRuins) * 0.5f;
            lookMid.y = 12f;
            var eyeA = new Vector3(-18f, 38f, -22f);
            cam.transform.position = eyeA;
            cam.transform.rotation = Quaternion.LookRotation((lookMid - eyeA).normalized, Vector3.up);
            ClearNpcsForStill(Vector3.zero, 40f);
            KillProofFrustumMarkers();
            KillCyanOrangeDebugOnly(eyeA, 560f);
            KillMidRingFloatJunk(eyeA, lookMid);
            // Plate-cleanup may have run mid-scrub — revive Present masses again.
            ReviveFarGeographyChunks(out cyberChunk);
            RenderStill(cam, hubToPresents);

            // (b) Mid-far on Crown Road spoke toward Cyber Present — elevate, not nose-on.
            // Stay outside StreamIn (~175) so LeanPlay never upgrades; frame ONE Present mass.
            var present = cyberChunk ? cyberChunk.position : MegaworldMap.Present(WorldId.Cyber);
            var spokeDir = new Vector3(present.x, 0f, present.z);
            if (spokeDir.sqrMagnitude < 0.01f) spokeDir = Vector3.right;
            else spokeDir.Normalize();
            // ~155m from Hub → ~65m from Present (lod 2 band). Height 28 — Dutch rejected close-ups.
            var eyeB = spokeDir * 155f + Vector3.up * 28f;
            var lookB = present + Vector3.up * 14f;
            cam.transform.position = eyeB;
            cam.transform.rotation = Quaternion.LookRotation((lookB - eyeB).normalized, Vector3.up);
            cam.fieldOfView = 48f;
            cam.farClipPlane = 560f;
            RenderSettings.fog = false; // single Present mass must not melt into haze
            ClearNpcsForStill(eyeB, 30f);
            KillProofFrustumMarkers();
            KillCyanOrangeDebugOnly(eyeB, 560f);
            KillMidRingFloatJunk(eyeB, present);
            ReviveFarGeographyChunks(out cyberChunk);
            present = cyberChunk ? cyberChunk.position : MegaworldMap.Present(WorldId.Cyber);
            lookB = present + Vector3.up * 14f;
            cam.transform.position = eyeB;
            cam.transform.rotation = Quaternion.LookRotation((lookB - eyeB).normalized, Vector3.up);
            RenderStill(cam, ringMass);

            HubLook.LiveFog(prevFog > 0.001f ? prevFog : 0.022f);
            RenderSettings.fog = prevFogOn;
            cam.farClipPlane = 420f;

            long b1 = 0, b2 = 0;
            try { b1 = new FileInfo(hubToPresents).Length; } catch { }
            try { b2 = new FileInfo(ringMass).Length; } catch { }
            Debug.Log("[Concordia] CaptureFarGeographyStills farGeography=" + farCount
                      + " hubToPresentsBytes=" + b1 + " ringMassBytes=" + b2
                      + " a=" + hubToPresents + " b=" + ringMass);
            return "OK farGeography=" + farCount
                   + " hubToPresents=" + hubToPresents + " bytes=" + b1
                   + " ringMass=" + ringMass + " bytes=" + b2;
        }

        /// <summary>
        /// SLICE 7 REWORK — stills looking OUT past an approach landmark into
        /// native wild treeline + wildlife. No mega-pad wedge shots.
        /// </summary>
        public static string CaptureHubWildernessStills(string outDir)
        {
            if (string.IsNullOrEmpty(outDir))
                outDir = Path.Combine(System.Environment.GetFolderPath(System.Environment.SpecialFolder.UserProfile),
                    ".zuko", "remaining-work");
            Directory.CreateDirectory(outDir);

            Application.runInBackground = true;
#if UNITY_EDITOR
            UnityEditor.PlayerSettings.runInBackground = true;
#endif
            Ensure(false);
            KillProofFrustumMarkers();
            HideProofClutterForStills();
            WorldClock.Hour = 14.5f;
            HubLook.ApplyHour(WorldId.Hub, WorldClock.Hour);
            DisableChaseAndCinemachine();

            var mega = GameObject.Find("Megaworld");
            HubWilderness.Stats wildStats = null;
            if (mega)
                wildStats = HubWilderness.Ensure(mega.transform, force: true);
            else
                Debug.LogWarning("[Concordia] CaptureHubWildernessStills: no Megaworld");

            float prevFog = RenderSettings.fogDensity;
            bool prevFogOn = RenderSettings.fog;
            HubLook.LiveFog(0.0028f);
            RenderSettings.fog = true;

            string wildOut = Path.Combine(outDir, "SLICE7-STILL-wild-outside-city-2026-09-20.png");
            string wildLife = Path.Combine(outDir, "SLICE7-STILL-wildlife-or-treeline-2026-09-20.png");

            // FarGeography FarPads (esp. Cyber PH_blue_floor_tiles) dominate the horizon
            // past approaches — hide for wilderness stills only; restore after. Slice 6 keeps them.
            var farPads = SuspendFarPadsForWildernessStills();

            var cam = EnsureStillCamera();
            cam.farClipPlane = 200f; // stop before Present FarMass ring (~220) even if a pad leaks
            cam.orthographic = false;
            cam.fieldOfView = 58f;
            cam.clearFlags = CameraClearFlags.Skybox;

            // Landmark-framed still A: past Pinewood looking at spoke wild belt.
            Transform pineLm = null, beltTree = null;
            foreach (var t in Object.FindObjectsByType<Transform>(FindObjectsSortMode.None))
            {
                if (!t) continue;
                var n = t.name ?? "";
                if (pineLm == null && n.IndexOf("ApproachLandmark_pinewood", System.StringComparison.OrdinalIgnoreCase) >= 0)
                    pineLm = t;
                if (beltTree == null && n.StartsWith("HubWildTree_belt_salt", System.StringComparison.Ordinal))
                    beltTree = t;
            }
            var pinePos = pineLm ? pineLm.position : new Vector3(62f, 0f, -28f);
            var treePos = beltTree ? beltTree.position : new Vector3(110f, 0f, -45f);
            var pineFlat = new Vector3(pinePos.x, 0f, pinePos.z);
            var side = Vector3.Cross(Vector3.up, pineFlat.normalized).normalized;
            var eyeA = pinePos + Vector3.up * 8.5f + pineFlat.normalized * 10f + side * 12f;
            var lookA = treePos + Vector3.up * 3.2f;
            cam.transform.position = eyeA;
            cam.transform.rotation = Quaternion.LookRotation((lookA - eyeA).normalized, Vector3.up);
            cam.fieldOfView = 48f;
            ClearNpcsForStill(eyeA, 36f);
            KillProofFrustumMarkers();
            KillCyanOrangeDebugOnly(eyeA, 220f);
            SoftReviveHubWilderness();
            SoftReviveContinentGround();
            RenderStill(cam, wildOut);

            // (b) Mid treeline across belt + rematerialize fauna on ground.
            var eyeB = treePos + Vector3.up * 3.6f + side * 16f - pineFlat.normalized * 4f;
            var lookB = treePos + pineFlat.normalized * 14f + Vector3.up * 2.4f - side * 6f;
            cam.transform.position = eyeB;
            cam.transform.rotation = Quaternion.LookRotation((lookB - eyeB).normalized, Vector3.up);
            cam.fieldOfView = 42f;
            cam.farClipPlane = 150f;
            ClearNpcsForStill(eyeB, 28f);
            KillProofFrustumMarkers();
            KillCyanOrangeDebugOnly(eyeB, 180f);
            SoftReviveHubWilderness();
            SoftReviveContinentGround();
            int faunaLive = WildernessWildlife.RematerializeNear(lookB, 42f, 3);
            if (faunaLive < 1)
                faunaLive = WildernessWildlife.RematerializeNear(eyeB, 55f, 3);
            RenderStill(cam, wildLife);

            RestoreFarPads(farPads);

            HubLook.LiveFog(prevFog > 0.001f ? prevFog : 0.022f);
            RenderSettings.fog = prevFogOn;
            cam.farClipPlane = 420f;

            long b1 = 0, b2 = 0;
            try { b1 = new FileInfo(wildOut).Length; } catch { }
            try { b2 = new FileInfo(wildLife).Length; } catch { }
            int treeN = wildStats != null ? wildStats.Trees : 0;
            int clusterN = wildStats != null ? wildStats.Clusters : 0;
            // Hierarchy proof: wilderness root must NOT live under SettlementStreetscape_*.
            string parentProof = "none";
            var wildGo = GameObject.Find(HubWilderness.RootName);
            if (wildGo && wildGo.transform.parent)
                parentProof = wildGo.transform.parent.name;
            bool underStreet = false;
            for (var p = wildGo ? wildGo.transform : null; p != null; p = p.parent)
            {
                var pn = p.name ?? "";
                if (pn.StartsWith("SettlementStreetscape_", System.StringComparison.Ordinal)
                    || pn.StartsWith("District_", System.StringComparison.Ordinal))
                { underStreet = true; break; }
            }
            Debug.Log("[Concordia] CaptureHubWildernessStills " + (wildStats != null ? wildStats.ToString() : "null")
                      + " faunaLive=" + faunaLive
                      + " parent=" + parentProof + " underStreet=" + underStreet
                      + " wildOutBytes=" + b1 + " wildLifeBytes=" + b2
                      + " a=" + wildOut + " b=" + wildLife);
            return "OK wilderness trees=" + treeN + " clusters=" + clusterN
                   + " faunaSeed=" + WildernessWildlife.SeedCount
                   + " faunaLive=" + faunaLive
                   + " parent=" + parentProof + " underStreet=" + underStreet
                   + " wildOut=" + wildOut + " bytes=" + b1
                   + " wildLife=" + wildLife + " bytes=" + b2;
        }

        static void SoftReviveHubWilderness()
        {
            var hold = GameObject.Find(HubWilderness.RootName);
            if (!hold) return;
            foreach (var r in hold.GetComponentsInChildren<Renderer>(true))
            {
                if (!r) continue;
                var n = r.gameObject.name ?? "";
                if (n.IndexOf("rock_smallA", System.StringComparison.OrdinalIgnoreCase) >= 0)
                    continue;
                // Never revive Pass-1 mega pads if any leftover name survives a hot reload.
                if (n.StartsWith("HubWildPad_", System.StringComparison.Ordinal)
                    || n.StartsWith("HubWildGround_", System.StringComparison.Ordinal))
                {
                    r.enabled = false;
                    r.gameObject.SetActive(false);
                    continue;
                }
                r.enabled = true;
                if (!r.gameObject.activeSelf) r.gameObject.SetActive(true);
            }
        }

        static void SoftReviveContinentGround()
        {
            var cg = GameObject.Find("ContinentGround");
            var earth = HubLook.Lit(new Color(0.34f, 0.42f, 0.26f), 0.015f, 0.08f);
            if (!cg)
            {
                var mega = GameObject.Find("Megaworld");
                var go = GameObject.CreatePrimitive(PrimitiveType.Plane);
                go.name = "ContinentGround";
                if (mega) go.transform.SetParent(mega.transform, false);
                go.transform.localScale = new Vector3(24f, 1f, 24f);
                Object.Destroy(go.GetComponent<Collider>());
                cg = go;
            }
            cg.SetActive(true);
            var rr = cg.GetComponent<Renderer>();
            if (rr)
            {
                rr.enabled = true;
                if (earth) rr.sharedMaterial = earth;
            }
        }

        /// <summary>
        /// Temporarily hide FarGeography FarPad / FarMass so wilderness stills aren't
        /// dominated by Present-ring blue tiles / mega prims. Caller must RestoreFarPads.
        /// </summary>
        static System.Collections.Generic.List<GameObject> SuspendFarPadsForWildernessStills()
        {
            var list = new System.Collections.Generic.List<GameObject>(24);
            foreach (var t in Object.FindObjectsByType<Transform>(FindObjectsSortMode.None))
            {
                if (!t || !t.gameObject.activeInHierarchy) continue;
                var n = t.name ?? "";
                bool pad = n == "FarPad" || n.StartsWith("FarPad", System.StringComparison.Ordinal)
                           || n.StartsWith("FarMass_", System.StringComparison.Ordinal)
                           || n.StartsWith("FarHill_", System.StringComparison.Ordinal);
                if (!pad) continue;
                // Only FarGeography children — leave Hub wilderness alone.
                bool underFar = false;
                for (var p = t.parent; p != null; p = p.parent)
                {
                    var pn = p.name ?? "";
                    if (pn.StartsWith("FarGeography_", System.StringComparison.Ordinal))
                    { underFar = true; break; }
                }
                if (!underFar) continue;
                list.Add(t.gameObject);
                t.gameObject.SetActive(false);
            }
            return list;
        }

        static void RestoreFarPads(System.Collections.Generic.List<GameObject> list)
        {
            if (list == null) return;
            for (int i = 0; i < list.Count; i++)
            {
                if (list[i]) list[i].SetActive(true);
            }
        }

        /// <summary>
        /// HubLook.EnsureCourtPlateCleanup used to SetActive(false) Plane/Capsule Far* prims
        /// inside 260m. Always revive before Slice 6 stills.
        /// </summary>
        static int ReviveFarGeographyChunks(out Transform cyberChunk)
        {
            cyberChunk = null;
            int farCount = 0;
            if (!ContinentStream.Live) return 0;
            foreach (var id in MegaworldMap.All)
            {
                if (id == WorldId.Hub) continue;
                var chunk = ContinentStream.Live.ChunkOf(id);
                if (!chunk) continue;
                farCount++;
                if (id == WorldId.Cyber) cyberChunk = chunk;
                chunk.gameObject.SetActive(true);
                foreach (var t in chunk.GetComponentsInChildren<Transform>(true))
                    if (t) t.gameObject.SetActive(true);
                foreach (var r in chunk.GetComponentsInChildren<Renderer>(true))
                    if (r) r.enabled = true;
            }
            return farCount;
        }

        /// <summary>Kill cyan/orange debug markers only — never FarGeography Present masses.</summary>
        static int KillCyanOrangeDebugOnly(Vector3 origin, float maxR)
        {
            int n = 0;
            float maxR2 = maxR * maxR;
            foreach (var r in Object.FindObjectsByType<Renderer>(FindObjectsInactive.Exclude))
            {
                if (!r || !r.enabled) continue;
                var bc = r.bounds.center;
                if ((new Vector3(bc.x, 0f, bc.z) - new Vector3(origin.x, 0f, origin.z)).sqrMagnitude > maxR2)
                    continue;
                var nm = r.gameObject.name ?? "";
                for (var t = r.transform; t != null; t = t.parent)
                {
                    var tn = t.name ?? "";
                    if (tn.StartsWith("FarGeography_", System.StringComparison.Ordinal))
                        goto Next;
                }
                if (nm.StartsWith("FarPad", System.StringComparison.Ordinal)
                    || nm.StartsWith("FarHill_", System.StringComparison.Ordinal)
                    || nm.StartsWith("FarSilhouette_", System.StringComparison.Ordinal)
                    || nm.StartsWith("FarMass_", System.StringComparison.Ordinal)
                    || nm.StartsWith("LeanBuilding_", System.StringComparison.Ordinal)
                    || nm.StartsWith("CrownRoad_", System.StringComparison.Ordinal)
                    || nm.StartsWith("ApproachLandmark", System.StringComparison.Ordinal)
                    || nm.StartsWith("Court", System.StringComparison.Ordinal)
                    || nm.StartsWith("HubWild", System.StringComparison.Ordinal)
                    || nm == HubWilderness.RootName)
                    continue;
                if (HubWilderness.IsHubWild(r.transform)) continue;
                var m = r.sharedMaterial;
                if (!m) continue;
                Color c = m.HasProperty("_BaseColor") ? m.GetColor("_BaseColor")
                    : (m.HasProperty("_Color") ? m.GetColor("_Color") : Color.white);
                bool cyan = c.b > 0.50f && c.r < 0.45f && c.b > c.r + 0.12f;
                bool orange = c.r > 0.75f && c.g > 0.25f && c.b < 0.38f;
                bool nameHit = nm.IndexOf("Debug", System.StringComparison.OrdinalIgnoreCase) >= 0
                               || nm.IndexOf("Marker", System.StringComparison.OrdinalIgnoreCase) >= 0
                               || nm.StartsWith("SoulCore_", System.StringComparison.Ordinal)
                               || nm.StartsWith("EmitDisc", System.StringComparison.Ordinal)
                               || nm.StartsWith("PortalFace", System.StringComparison.Ordinal)
                               || nm.StartsWith("PortalMembrane", System.StringComparison.Ordinal)
                               || nm == "Swirl"
                               || nm.StartsWith("WorldBadge", System.StringComparison.Ordinal)
                               || nm.StartsWith("Gate_", System.StringComparison.Ordinal);
                // Flat glowing ground quads (portal membranes / gate pads) near Hub.
                if (!nameHit && !cyan && !orange)
                {
                    var s = r.bounds.size;
                    var p = r.bounds.center;
                    if (p.magnitude < 55f && s.y < 0.45f && s.x > 0.8f && s.x < 6f
                        && Mathf.Abs(s.x - s.z) < 1.5f)
                    {
                        bool bright = (c.a < 0.85f)
                                      || (c.b > 0.55f && c.r < 0.5f)
                                      || (c.r > 0.7f && c.b < 0.45f);
                        if (bright) nameHit = true;
                    }
                }
                if (cyan || orange || nameHit)
                {
                    r.enabled = false;
                    n++;
                }
                Next: ;
            }
            return n;
        }

        /// <summary>
        /// Mid-ring wilderness/link floaters (spheres/cubes) read as debug between Hub and Presents.
        /// Never touch FarGeography_* Present masses.
        /// </summary>
        static int KillMidRingFloatJunk(Vector3 eye, Vector3 toward)
        {
            int n = 0;
            foreach (var r in Object.FindObjectsByType<Renderer>(FindObjectsInactive.Exclude))
            {
                if (!r || !r.enabled) continue;
                for (var t = r.transform; t != null; t = t.parent)
                {
                    var tn = t.name ?? "";
                    if (tn.StartsWith("FarGeography_", System.StringComparison.Ordinal)
                        || tn.StartsWith("CrownRoad_", System.StringComparison.Ordinal)
                        || tn.StartsWith("ApproachLandmark", System.StringComparison.Ordinal)
                        || tn.StartsWith("LeanBuilding_", System.StringComparison.Ordinal)
                        || tn.StartsWith("District_", System.StringComparison.Ordinal)
                        || tn.StartsWith("Court", System.StringComparison.Ordinal)
                        || tn == HubWilderness.RootName
                        || tn.StartsWith("HubWild", System.StringComparison.Ordinal))
                        goto Keep;
                }
                var bc = r.bounds.center;
                float dHub = new Vector2(bc.x, bc.z).magnitude;
                // Between Hub court (~40) and Present ring (~220), kill orphan float prims.
                if (dHub < 55f || dHub > 200f) continue;
                if (bc.y < 0.4f) continue; // grounded dress stays
                var nm = r.gameObject.name ?? "";
                var mf = r.GetComponent<MeshFilter>();
                bool primish = mf && mf.sharedMesh && (
                    mf.sharedMesh.name.IndexOf("Sphere", System.StringComparison.OrdinalIgnoreCase) >= 0
                    || mf.sharedMesh.name.IndexOf("Cube", System.StringComparison.OrdinalIgnoreCase) >= 0
                    || mf.sharedMesh.name.IndexOf("Capsule", System.StringComparison.OrdinalIgnoreCase) >= 0
                    || mf.sharedMesh.name.IndexOf("Cylinder", System.StringComparison.OrdinalIgnoreCase) >= 0);
                bool nameHit = nm.IndexOf("Debug", System.StringComparison.OrdinalIgnoreCase) >= 0
                               || nm.IndexOf("Marker", System.StringComparison.OrdinalIgnoreCase) >= 0
                               || nm.StartsWith("SoulCore_", System.StringComparison.Ordinal)
                               || nm.StartsWith("Gate", System.StringComparison.Ordinal)
                               || nm.StartsWith("Link", System.StringComparison.Ordinal)
                               || nm.StartsWith("Wilderness", System.StringComparison.Ordinal)
                               || nm.StartsWith("RoadLife", System.StringComparison.Ordinal);
                if (!primish && !nameHit) continue;
                // Keep if it's a FarHill / FarMass under a Present (already skipped by parent).
                if (nm.StartsWith("Far", System.StringComparison.Ordinal)) continue;
                r.enabled = false;
                n++;
                Keep: ;
            }
            return n;
        }

        /// <summary>
        /// True top-down + high perspective aerial of lean Hub city mass (Dutch request).
        /// Uses EnsureStillCamera + RenderStill (same path as Slice 3/4 stills).
        /// </summary>
        public static string CaptureHubAerialStill(string outDir)
        {
            if (string.IsNullOrEmpty(outDir))
                outDir = Path.Combine(System.Environment.GetFolderPath(System.Environment.SpecialFolder.UserProfile),
                    ".zuko", "remaining-work");
            Directory.CreateDirectory(outDir);

            Application.runInBackground = true;
#if UNITY_EDITOR
            UnityEditor.PlayerSettings.runInBackground = true;
#endif
            Ensure(false);
            KillProofFrustumMarkers();
            HideProofClutterForStills();
            WorldClock.Hour = 14.5f;
            HubLook.ApplyHour(WorldId.Hub, WorldClock.Hour);
            DisableChaseAndCinemachine();

            float prevFog = RenderSettings.fogDensity;
            bool prevFogOn = RenderSettings.fog;
            HubLook.LiveFog(0.0025f);
            RenderSettings.fog = false;

            var bounds = new Bounds(Vector3.zero, Vector3.zero);
            int n = 0;
            bool init = false;
            foreach (var t in Object.FindObjectsByType<Transform>(FindObjectsInactive.Exclude))
            {
                if (!t || t.name == null) continue;
                bool hit = t.name.StartsWith("LeanBuilding_", System.StringComparison.Ordinal)
                           || t.name.StartsWith("ApproachLandmark_", System.StringComparison.Ordinal)
                           || t.name.StartsWith("CrownRoad_", System.StringComparison.Ordinal)
                           || t.name.StartsWith("LotPad", System.StringComparison.Ordinal)
                           || t.name.StartsWith("CourtRoadDeck", System.StringComparison.Ordinal);
                if (!hit) continue;
                if (!init) { bounds = new Bounds(t.position, Vector3.one * 2f); init = true; }
                else bounds.Encapsulate(t.position);
                n++;
            }
            if (n < 4)
            {
                HubLook.LiveFog(prevFog > 0.001f ? prevFog : 0.027f);
                RenderSettings.fog = prevFogOn;
                return "TOO_FEW n=" + n;
            }

            Vector3 center = bounds.center;
            center.y = 0f;
            var cam = EnsureStillCamera();
            cam.farClipPlane = 400f;
            cam.clearFlags = CameraClearFlags.Skybox;

            string orthoPath = Path.Combine(outDir, "HUB-AERIAL-2026-09-20.png");
            string perspPath = Path.Combine(outDir, "HUB-AERIAL-perspective-2026-09-20.png");

            // Ortho top-down
            cam.orthographic = true;
            cam.orthographicSize = Mathf.Max(bounds.size.x, bounds.size.z, 40f) * 0.55f + 20f;
            var eye = center + new Vector3(6f, 180f, -6f);
            cam.transform.position = eye;
            cam.transform.rotation = Quaternion.Euler(90f, 0f, 0f);
            ClearNpcsForStill(center, 200f);
            KillProofFrustumMarkers();
            KillSlice4FrustumJunk(center, 200f);
            RenderStill(cam, orthoPath);

            // High perspective
            cam.orthographic = false;
            cam.fieldOfView = 48f;
            eye = center + new Vector3(-48f, 95f, -48f);
            cam.transform.position = eye;
            cam.transform.rotation = Quaternion.LookRotation((center + Vector3.up * 4f - eye).normalized, Vector3.up);
            ClearNpcsForStill(center, 200f);
            KillProofFrustumMarkers();
            RenderStill(cam, perspPath);

            HubLook.LiveFog(prevFog > 0.001f ? prevFog : 0.027f);
            RenderSettings.fog = prevFogOn;
            cam.orthographic = false;
            cam.farClipPlane = 120f;

            long b1 = new FileInfo(orthoPath).Length;
            long b2 = new FileInfo(perspPath).Length;
            Debug.Log("[Concordia] CaptureHubAerialStill n=" + n + " ortho=" + b1 + " persp=" + b2
                      + " center=" + center + " size=" + bounds.size);
            return "OK n=" + n + " orthoBytes=" + b1 + " perspBytes=" + b2
                   + " ortho=" + orthoPath + " persp=" + perspPath;
        }

        static Vector3 DistrictMassCenter(string districtId, Vector3 fallback)
        {
            var dist = FindDistrictRoot(districtId);
            if (!dist) return fallback;
            var builds = dist.Find("Buildings");
            if (builds && builds.childCount > 0)
            {
                Vector3 c = Vector3.zero;
                int n = 0;
                foreach (Transform t in builds)
                {
                    if (!t || !t.name.StartsWith("LeanBuilding_", System.StringComparison.Ordinal)) continue;
                    c += t.position;
                    n++;
                }
                if (n > 0) return c / n;
            }
            return dist.position;
        }

        static int CountLeanBuildingsNear(Vector3 eye, float radius)
        {
            int n = 0;
            float r2 = radius * radius;
            foreach (var t in Object.FindObjectsByType<Transform>(FindObjectsInactive.Exclude))
            {
                if (!t || t.name == null) continue;
                if (!t.name.StartsWith("LeanBuilding_", System.StringComparison.Ordinal)) continue;
                if ((t.position - eye).sqrMagnitude > r2) continue;
                n++;
            }
            return n;
        }

        static int ShootVistaCourtToMarket(Camera cam, string path)
        {
            int killed = 0;
            // Market ring ~52m SE/E (ang ≈ −0.18π) — fall back if district missing.
            var market = DistrictMassCenter("market_district",
                new Vector3(Mathf.Cos(-Mathf.PI * 0.18f) * 52f, 0f, Mathf.Sin(-Mathf.PI * 0.18f) * 52f));
            // Elevated OUTSIDE Court canopy (Y=22@origin was inside Sanctum trees).
            // Stand ~18m toward market, Y=24, slight side offset — see streets + multiple facades.
            var toMarketFlat = new Vector3(market.x, 0f, market.z);
            var dir = toMarketFlat.sqrMagnitude > 1f ? toMarketFlat.normalized : new Vector3(0.85f, 0f, -0.53f);
            var side = Vector3.Cross(Vector3.up, dir);
            var eye = dir * 18f + side * 6f + Vector3.up * 24f;
            eye.y = Mathf.Clamp(eye.y, 16f, 28f);
            var aim = market + Vector3.up * 2.5f;

            ClearNpcsForStill(eye, 90f);
            killed += KillProofFrustumMarkers();
            killed += KillSlice4FrustumJunk(eye, 140f);
            HideVistaNearFieldJunk(eye, 55f);
            HideVistaFoliageNearEye(eye, 14f);

            cam.transform.position = eye;
            cam.transform.rotation = Quaternion.LookRotation((aim - eye).normalized, Vector3.up);
            cam.fieldOfView = 60f;
            cam.farClipPlane = 220f;
            RenderStill(cam, path);
            int lean = CountLeanBuildingsNear(market, 55f);
            Debug.Log("[Concordia] CaptureHubVistaStills court→market wrote " + path
                      + " eye=" + eye + " aim=" + aim + " leanNearMarket=" + lean);
            return killed;
        }

        static int ShootVistaHeartRing(Camera cam, string path)
        {
            int killed = 0;
            var market = DistrictMassCenter("market_district",
                new Vector3(Mathf.Cos(-Mathf.PI * 0.18f) * 52f, 0f, Mathf.Sin(-Mathf.PI * 0.18f) * 52f));
            var archive = DistrictMassCenter("archive_quarter", new Vector3(0f, 0f, -50f));
            var council = DistrictMassCenter("council_chamber", new Vector3(0f, 0f, 48f));
            // Aim between Market + Archive so STREET→LOT→BUILDING reads as a ring sector.
            var mass = (market * 0.45f + archive * 0.40f + council * 0.15f);

            // Elevated SE orbit — outside canopy, looking across Market+Archive toward heart.
            var eyeFlat = new Vector3(32f, 0f, -28f);
            float outR = eyeFlat.magnitude;
            if (outR < 35f || outR > 45f)
                eyeFlat = eyeFlat.normalized * 40f;
            var eye = new Vector3(eyeFlat.x, 24f, eyeFlat.z);
            var aim = mass + Vector3.up * 1.5f;

            ClearNpcsForStill(eye, 110f);
            killed += KillProofFrustumMarkers();
            killed += KillSlice4FrustumJunk(eye, 160f);
            HideVistaNearFieldJunk(eye, 55f);
            HideVistaFoliageNearEye(eye, 16f);

            cam.transform.position = eye;
            cam.transform.rotation = Quaternion.LookRotation((aim - eye).normalized, Vector3.up);
            cam.fieldOfView = 58f;
            cam.farClipPlane = 220f;
            RenderStill(cam, path);
            int lean = CountLeanBuildingsNear(mass, 70f);
            Debug.Log("[Concordia] CaptureHubVistaStills heart-ring wrote " + path
                      + " eye=" + eye + " mass=" + mass + " leanNearMass=" + lean);
            return killed;
        }

        static int ShootVistaCrownSpokeOut(Camera cam, string path)
        {
            int killed = 0;
            Transform bestBand = null;
            foreach (var t in Object.FindObjectsByType<Transform>(FindObjectsInactive.Exclude))
            {
                if (!t || string.IsNullOrEmpty(t.name)) continue;
                if (!t.name.StartsWith("CrownRoad_", System.StringComparison.Ordinal)) continue;
                if (!(t.name.EndsWith("_s0", System.StringComparison.Ordinal)
                      || t.name.EndsWith("_s1", System.StringComparison.Ordinal)))
                    continue;
                bool pine = t.name.IndexOf("pinewood", System.StringComparison.OrdinalIgnoreCase) >= 0;
                if (pine) { bestBand = t; break; }
                if (bestBand == null) bestBand = t;
            }

            Transform landmark = null;
            var city = GameObject.Find("City_pinewood_crossing");
            if (city)
            {
                foreach (Transform t in city.GetComponentsInChildren<Transform>(true))
                {
                    if (!t || t.name == null) continue;
                    if (t.name.StartsWith("ApproachLandmark_", System.StringComparison.Ordinal)
                        && !t.name.StartsWith("ApproachLandmarkAnnex_", System.StringComparison.Ordinal))
                    { landmark = t; break; }
                }
            }

            // Prefer market district as "distant city" mass in the same frame.
            var market = DistrictMassCenter("market_district",
                new Vector3(Mathf.Cos(-Mathf.PI * 0.18f) * 52f, 0f, Mathf.Sin(-Mathf.PI * 0.18f) * 52f));

            Vector3 eye;
            Vector3 aim;
            if (bestBand)
            {
                // Elevated beside spoke: look OUT along road toward landmark, heart+city in side.
                var roadFwd = bestBand.forward;
                var radial = new Vector3(bestBand.position.x, 0f, bestBand.position.z);
                if (radial.sqrMagnitude > 0.01f)
                {
                    radial.Normalize();
                    if (Vector3.Dot(roadFwd, radial) < 0f) roadFwd = -roadFwd;
                }
                // Pull eye back along spoke + up + lateral so ribbon reads under camera.
                eye = bestBand.position - roadFwd * 14f + bestBand.right * 9f + Vector3.up * 22f;
                eye.y = Mathf.Clamp(eye.y, 16f, 28f);
                var landmarkAim = landmark
                    ? landmark.position + Vector3.up * 3f
                    : bestBand.position + roadFwd * 30f + Vector3.up * 3f;
                // Blend landmark + market mass so spoke + landmark + city share one frame.
                aim = Vector3.Lerp(landmarkAim, market + Vector3.up * 2f, 0.32f);
            }
            else
            {
                eye = new Vector3(42f, 22f, -18f);
                aim = landmark ? landmark.position + Vector3.up * 4f : market + Vector3.up * 3f;
            }

            ClearNpcsForStill(eye, 110f);
            killed += KillProofFrustumMarkers();
            killed += KillSlice4FrustumJunk(eye, 160f);
            HideVistaNearFieldJunk(eye, 55f);
            HideVistaFoliageNearEye(eye, 16f);

            cam.transform.position = eye;
            cam.transform.rotation = Quaternion.LookRotation((aim - eye).normalized, Vector3.up);
            cam.fieldOfView = 62f;
            cam.farClipPlane = 220f;
            RenderStill(cam, path);
            Debug.Log("[Concordia] CaptureHubVistaStills crown-spoke wrote " + path
                      + " band=" + (bestBand ? bestBand.name : "none")
                      + " landmark=" + (landmark ? landmark.name : "none")
                      + " eye=" + eye);
            return killed;
        }

        /// <summary>Vista hygiene — hide FortRim / iron gates / nearby neon that fill elevated frustum.</summary>
        static void HideVistaNearFieldJunk(Vector3 eye, float radius)
        {
            float r2 = radius * radius;
            foreach (var r in Object.FindObjectsByType<Renderer>(FindObjectsInactive.Exclude))
            {
                if (!r || !r.enabled) continue;
                if ((r.bounds.center - eye).sqrMagnitude > r2) continue;
                var n = r.gameObject.name ?? "";
                if (n.StartsWith("LeanBuilding_", System.StringComparison.Ordinal)
                    || n.StartsWith("CourtRoad", System.StringComparison.Ordinal)
                    || n.StartsWith("CourtSidewalk", System.StringComparison.Ordinal)
                    || n.StartsWith("CourtCurb", System.StringComparison.Ordinal)
                    || n.StartsWith("CrownRoad_", System.StringComparison.Ordinal)
                    || n.StartsWith("ApproachLandmark", System.StringComparison.Ordinal)
                    || n.StartsWith("LotPad", System.StringComparison.Ordinal)
                    || n.StartsWith("Lot_", System.StringComparison.Ordinal)
                    || n.StartsWith("Shell", System.StringComparison.Ordinal))
                    continue;
                bool fencey = n.IndexOf("gate", System.StringComparison.OrdinalIgnoreCase) >= 0
                              || n.IndexOf("Fence", System.StringComparison.OrdinalIgnoreCase) >= 0
                              || n.IndexOf("FortRim", System.StringComparison.OrdinalIgnoreCase) >= 0
                              || n.IndexOf("iron", System.StringComparison.OrdinalIgnoreCase) >= 0
                              || n.StartsWith("CX_Sign", System.StringComparison.Ordinal)
                              || n.IndexOf("SignFace", System.StringComparison.OrdinalIgnoreCase) >= 0
                              || n.StartsWith("SoulCore_", System.StringComparison.Ordinal)
                              || n.StartsWith("WorldBadge", System.StringComparison.Ordinal);
                if (fencey) r.enabled = false;
            }
        }

        /// <summary>Hide tree/foliage that would nose-fill an elevated eye (Court canopy).</summary>
        static void HideVistaFoliageNearEye(Vector3 eye, float radius)
        {
            float r2 = radius * radius;
            foreach (var r in Object.FindObjectsByType<Renderer>(FindObjectsInactive.Exclude))
            {
                if (!r || !r.enabled) continue;
                if ((r.bounds.center - eye).sqrMagnitude > r2) continue;
                var n = r.gameObject.name ?? "";
                bool foliage = n.IndexOf("tree", System.StringComparison.OrdinalIgnoreCase) >= 0
                               || n.IndexOf("Tree", System.StringComparison.Ordinal) >= 0
                               || n.IndexOf("foliage", System.StringComparison.OrdinalIgnoreCase) >= 0
                               || n.IndexOf("canopy", System.StringComparison.OrdinalIgnoreCase) >= 0
                               || n.IndexOf("leaf", System.StringComparison.OrdinalIgnoreCase) >= 0
                               || n.StartsWith("CX_Tree", System.StringComparison.Ordinal)
                               || n.IndexOf("bush", System.StringComparison.OrdinalIgnoreCase) >= 0;
                // Also kill anything whose bounds swallow the eye (inside canopy).
                bool swallows = r.bounds.Contains(eye)
                                || (r.bounds.size.y > 8f && r.bounds.size.x > 4f
                                    && Vector3.Distance(r.bounds.ClosestPoint(eye), eye) < 1.2f);
                if (foliage || swallows) r.enabled = false;
            }
        }

        static int ShootCrownRoadSpokeStill(Camera cam, string path)
        {
            int killed = 0;
            Transform bestBand = null;
            // Prefer pinewood segment band (CrownRoad_pinewood_crossing_s0) — has CourtRoadDeck.
            foreach (var t in Object.FindObjectsByType<Transform>(FindObjectsInactive.Exclude))
            {
                if (!t || string.IsNullOrEmpty(t.name)) continue;
                if (!t.name.StartsWith("CrownRoad_", System.StringComparison.Ordinal)) continue;
                // Segment bands end in _s0 / _s1 — do NOT use IndexOf("_s") (matches "_spire").
                if (!(t.name.EndsWith("_s0", System.StringComparison.Ordinal)
                      || t.name.EndsWith("_s1", System.StringComparison.Ordinal)))
                    continue;
                bool pine = t.name.IndexOf("pinewood", System.StringComparison.OrdinalIgnoreCase) >= 0;
                if (pine) { bestBand = t; break; }
                if (bestBand == null) bestBand = t;
            }
            if (!bestBand)
            {
                foreach (var t in Object.FindObjectsByType<Transform>(FindObjectsInactive.Exclude))
                {
                    if (!t || t.name == null) continue;
                    if (!t.name.StartsWith("SettlementCrownRoads_", System.StringComparison.Ordinal)) continue;
                    if (t.childCount == 0) continue;
                    var spoke = t.GetChild(0);
                    if (spoke && spoke.childCount > 0) bestBand = spoke.GetChild(0);
                    else bestBand = spoke;
                    break;
                }
            }

            Vector3 eye;
            Vector3 aim;
            if (bestBand)
            {
                // Stand on the deck, look outward along the spoke (band forward = road axis).
                eye = bestBand.position + Vector3.up * 1.55f - bestBand.forward * 1.0f + bestBand.right * 0.25f;
                aim = bestBand.position + bestBand.forward * 22f + Vector3.up * 0.35f;
                // If this segment is the outer half, look back toward the ring/gatehouse.
                float bandR = new Vector2(bestBand.position.x, bestBand.position.z).magnitude;
                if (bandR > 52f)
                {
                    eye = bestBand.position + Vector3.up * 1.55f + bestBand.forward * 1.0f;
                    aim = bestBand.position - bestBand.forward * 20f + Vector3.up * 1.5f;
                }
            }
            else
            {
                eye = new Vector3(38f, 1.65f, -16f);
                aim = new Vector3(55f, 0.5f, -24f);
            }

            ClearNpcsForStill(eye, 40f);
            killed += KillProofFrustumMarkers();
            killed += KillSlice4FrustumJunk(eye, 80f);

            cam.transform.position = eye;
            cam.transform.rotation = Quaternion.LookRotation((aim - eye).normalized, Vector3.up);
            cam.fieldOfView = 58f;
            cam.farClipPlane = 80f;
            RenderStill(cam, path);
            Debug.Log("[Concordia] CaptureCrownRoadStills spoke wrote " + path
                      + " band=" + (bestBand ? bestBand.name : "none")
                      + " eye=" + cam.transform.position);
            return killed;
        }

        static int ShootApproachLandmarkStill(Camera cam, string path)
        {
            int killed = 0;
            Transform city = null;
            Transform landmark = null;
            string[] preferIds = { "pinewood_crossing", "three_refusals_tavern", "broken_spire", "upper_grove" };
            foreach (var id in preferIds)
            {
                var go = GameObject.Find("City_" + id);
                if (!go) continue;
                city = go.transform;
                foreach (Transform t in city.GetComponentsInChildren<Transform>(true))
                {
                    if (!t || t.name == null) continue;
                    if (t.name.StartsWith("ApproachLandmark_", System.StringComparison.Ordinal)
                        && !t.name.StartsWith("ApproachLandmarkAnnex_", System.StringComparison.Ordinal))
                    { landmark = t; break; }
                }
                if (landmark) break;
            }

            Vector3 eye;
            Vector3 aim;
            if (landmark)
            {
                aim = landmark.position + Vector3.up * 2.8f;
                var flat = new Vector3(landmark.position.x, 0f, landmark.position.z);
                var toCourt = flat.sqrMagnitude > 0.01f ? -flat.normalized : Vector3.back;
                // Nose-on facade from the Crown Road approach side (from Court outward).
                eye = landmark.position + toCourt * 16f + Vector3.up * 2.0f + landmark.right * 2.2f;
            }
            else if (city)
            {
                aim = city.position + Vector3.up * 2.5f;
                eye = city.position - city.forward * 14f + Vector3.up * 2.0f;
            }
            else
            {
                eye = new Vector3(48f, 2.2f, -18f);
                aim = new Vector3(62f, 2.5f, -28f);
            }

            ClearNpcsForStill(eye, 40f);
            killed += KillProofFrustumMarkers();
            killed += KillSlice4FrustumJunk(eye, 90f);

            cam.transform.position = eye;
            cam.transform.rotation = Quaternion.LookRotation((aim - eye).normalized, Vector3.up);
            cam.fieldOfView = 50f;
            cam.farClipPlane = 60f;
            RenderStill(cam, path);
            Debug.Log("[Concordia] CaptureCrownRoadStills landmark wrote " + path
                      + " city=" + (city ? city.name : "none")
                      + " landmark=" + (landmark ? landmark.name : "none")
                      + " eye=" + cam.transform.position);
            return killed;
        }

        /// <summary>SLICE 4 still hygiene — kill cyan/orange cubes, GateMarker, SoulCore near frustum.</summary>
        static int KillSlice4FrustumJunk(Vector3 eye, float radius)
        {
            int n = 0;
            float r2 = radius * radius;
            foreach (var rend in Object.FindObjectsByType<Renderer>(FindObjectsInactive.Exclude))
            {
                if (!rend || !rend.enabled) continue;
                if ((rend.bounds.center - eye).sqrMagnitude > r2) continue;
                var nm = rend.gameObject.name ?? "";
                // Never kill road / landmark mass.
                if (nm.StartsWith("CourtRoad", System.StringComparison.Ordinal)
                    || nm.StartsWith("CourtSidewalk", System.StringComparison.Ordinal)
                    || nm.StartsWith("CourtCurb", System.StringComparison.Ordinal)
                    || nm.StartsWith("CrownRoad_", System.StringComparison.Ordinal)
                    || nm.StartsWith("ApproachLandmark", System.StringComparison.Ordinal)
                    || nm.StartsWith("Shell", System.StringComparison.Ordinal)
                    || nm.StartsWith("LeanBuilding_", System.StringComparison.Ordinal)
                    || nm == "Plaque" || nm.StartsWith("LotPad", System.StringComparison.Ordinal))
                    continue;

                bool killName = nm.IndexOf("Swirl", System.StringComparison.OrdinalIgnoreCase) >= 0
                                || nm.StartsWith("SoulCore_", System.StringComparison.Ordinal)
                                || nm.StartsWith("GateMarker", System.StringComparison.Ordinal)
                                || nm.IndexOf("Marker", System.StringComparison.OrdinalIgnoreCase) >= 0
                                || nm.StartsWith("Continent", System.StringComparison.Ordinal)
                                || nm.StartsWith("CityImpostor", System.StringComparison.Ordinal)
                                || nm.StartsWith("WorldBadge", System.StringComparison.Ordinal)
                                || nm.StartsWith("EmitDisc", System.StringComparison.Ordinal)
                                || nm.StartsWith("StubPad", System.StringComparison.Ordinal)
                                || nm.StartsWith("RegionBoundary", System.StringComparison.Ordinal)
                                || nm.IndexOf("Puddle", System.StringComparison.OrdinalIgnoreCase) >= 0
                                || nm.IndexOf("Missing_", System.StringComparison.Ordinal) >= 0;
                // Also kill VisualFidelity region discs / wilderness hills in frustum.
                for (var p = rend.transform; p != null; p = p.parent)
                {
                    var pn = p.name ?? "";
                    if (pn.StartsWith("RegionBoundary", System.StringComparison.Ordinal)
                        || pn.StartsWith("VisualFidelity", System.StringComparison.Ordinal)
                        || pn.StartsWith("ContinentWilderness", System.StringComparison.Ordinal))
                    { killName = true; break; }
                }
                var m = rend.sharedMaterial;
                Color c = Color.white;
                if (m)
                    c = m.HasProperty("_BaseColor") ? m.GetColor("_BaseColor")
                        : (m.HasProperty("_Color") ? m.GetColor("_Color") : Color.white);
                bool neonCyan = c.b > 0.50f && c.r < 0.55f && c.b > c.r + 0.08f;
                bool neonOrange = c.r > 0.75f && c.g > 0.25f && c.b < 0.38f;
                // Floating small cubes (debug prims) — kill by size + height.
                var sz = rend.bounds.size;
                bool floatingCube = rend.bounds.center.y > 1.2f
                                    && sz.x < 2.2f && sz.y < 2.2f && sz.z < 2.2f
                                    && Mathf.Abs(sz.x - sz.z) < 0.8f;
                if (killName || neonCyan || neonOrange || floatingCube)
                {
                    rend.enabled = false;
                    n++;
                }
            }
            return n;
        }

        static int ShootDistrictStreetStill(Camera cam, string districtId, string path)
        {
            int killed = 0;
            var dist = FindDistrictRoot(districtId);
            if (!dist)
            {
                Debug.LogWarning("[Concordia] CaptureStreetscapeStills: no District_" + districtId);
                cam.transform.position = new Vector3(0f, 2f, 0f);
                cam.transform.rotation = Quaternion.LookRotation(Vector3.forward, Vector3.up);
                cam.fieldOfView = 55f;
                cam.farClipPlane = 40f;
                RenderStill(cam, path);
                return killed;
            }

            Vector3 buildCenter = Vector3.zero;
            int buildN = 0;
            var builds = dist.Find("Buildings");
            if (builds)
            {
                foreach (Transform t in builds)
                {
                    if (!t || !t.name.StartsWith("LeanBuilding_", System.StringComparison.Ordinal)) continue;
                    buildCenter += t.position;
                    buildN++;
                }
            }
            if (buildN > 0) buildCenter /= buildN;
            else buildCenter = dist.position;

            Vector3 streetEye = buildCenter + new Vector3(0f, 1.65f, 0f);
            var streets = dist.Find("Streets");
            Transform best = null;
            if (streets && streets.childCount > 0)
            {
                float bestD = float.MaxValue;
                foreach (Transform band in streets)
                {
                    if (!band) continue;
                    float d = (band.position - buildCenter).sqrMagnitude;
                    if (d < bestD) { bestD = d; best = band; }
                }
                if (best)
                {
                    streetEye = best.position + Vector3.up * 1.65f;
                    streetEye += best.right * 0.4f;
                }
            }

            // FortRim / iron gates often sit between Court and metro streets — hide near eye.
            foreach (var r in Object.FindObjectsByType<Renderer>(FindObjectsInactive.Exclude))
            {
                if (!r || !r.enabled) continue;
                var n = r.gameObject.name ?? "";
                bool fencey = n.IndexOf("gate", System.StringComparison.OrdinalIgnoreCase) >= 0
                              || n.IndexOf("Fence", System.StringComparison.OrdinalIgnoreCase) >= 0
                              || n.IndexOf("FortRim", System.StringComparison.OrdinalIgnoreCase) >= 0
                              || n.IndexOf("iron", System.StringComparison.OrdinalIgnoreCase) >= 0;
                if (!fencey) continue;
                if ((r.bounds.center - streetEye).sqrMagnitude < 28f * 28f)
                    r.enabled = false;
            }

            ClearNpcsForStill(streetEye, 32f);
            killed += KillProofFrustumMarkers();

            var aim = buildCenter + Vector3.up * 2.4f;
            var look = (aim - streetEye);
            if (look.sqrMagnitude < 0.01f) look = dist.forward;
            cam.transform.position = streetEye - look.normalized * 5.8f + Vector3.up * 0.25f;
            cam.transform.rotation = Quaternion.LookRotation(
                (aim - cam.transform.position).normalized, Vector3.up);
            cam.fieldOfView = 58f;
            cam.farClipPlane = 48f;

            RenderStill(cam, path);
            Debug.Log("[Concordia] CaptureStreetscapeStills wrote " + path
                      + " district=" + districtId + " buildings=" + buildN
                      + " eye=" + cam.transform.position);
            return killed;
        }

        static Transform FindDistrictRoot(string districtId)
        {
            if (string.IsNullOrEmpty(districtId)) return null;
            var want = "District_" + districtId;
            foreach (var t in Object.FindObjectsByType<Transform>(FindObjectsInactive.Exclude))
            {
                if (!t || t.name != want) continue;
                // Prefer under SettlementStreetscape_*
                var p = t.parent;
                while (p)
                {
                    if (p.name != null && p.name.StartsWith("SettlementStreetscape_", System.StringComparison.Ordinal))
                        return t;
                    p = p.parent;
                }
            }
            // Fallback: any District_* match
            foreach (var t in Object.FindObjectsByType<Transform>(FindObjectsInactive.Exclude))
                if (t && t.name == want) return t;
            return null;
        }

        /// <summary>
        /// PASS4 still hygiene — hide CX_SignFace / badges / non-dress clutter that fills the
        /// plaza look-down frustum (sign was reading as a wooden door wall).
        /// </summary>
        public static int HideProofClutterForStills()
        {
            int n = 0;
            var dress = GameObject.Find(RootName);
            var keep = new System.Collections.Generic.HashSet<Transform>();
            if (dress)
            {
                foreach (var t in dress.GetComponentsInChildren<Transform>(true))
                    if (t) keep.Add(t);
            }
            var demo = GameObject.Find(DemoRoadName);
            if (demo)
            {
                foreach (var t in demo.GetComponentsInChildren<Transform>(true))
                    if (t) keep.Add(t);
            }
            foreach (var r in Object.FindObjectsByType<Renderer>(FindObjectsInactive.Exclude))
            {
                if (!r || !r.enabled) continue;
                var nm = r.gameObject.name ?? "";
                bool killName = nm.IndexOf("SignFace", System.StringComparison.OrdinalIgnoreCase) >= 0
                                || nm.StartsWith("CX_Sign", System.StringComparison.Ordinal)
                                || nm.StartsWith("WorldBadge", System.StringComparison.Ordinal)
                                || nm.StartsWith("SoulCore_", System.StringComparison.Ordinal)
                                || nm == "Name"
                                || nm.StartsWith("KernelBuilding", System.StringComparison.Ordinal);
                var p = r.bounds.center;
                bool nearPlaza = Mathf.Abs(p.x) < 22f && Mathf.Abs(p.z) < 22f && p.y < 8f;
                if (!killName && !nearPlaza) continue;
                if (!killName)
                {
                    // Near plaza: hide non-dress / non-road clutter (cyan FreePacks, props).
                    bool kept = false;
                    for (var t = r.transform; t != null; t = t.parent)
                    {
                        if (keep.Contains(t)) { kept = true; break; }
                        var tn = t.name ?? "";
                        if (tn.StartsWith("CourtDemo", System.StringComparison.Ordinal)
                            || tn.StartsWith("CourtRoad", System.StringComparison.Ordinal)
                            || tn.StartsWith("CourtSidewalk", System.StringComparison.Ordinal)
                            || tn.StartsWith("CourtCurb", System.StringComparison.Ordinal)
                            || tn == "CourtGround" || tn == RootName)
                        { kept = true; break; }
                    }
                    if (kept) continue;
                    // Keep sky / sun.
                    if (nm.IndexOf("Sky", System.StringComparison.OrdinalIgnoreCase) >= 0) continue;
                    if (nm.IndexOf("Directional", System.StringComparison.OrdinalIgnoreCase) >= 0) continue;
                }
                r.enabled = false;
                n++;
            }
            return n;
        }

        /// <summary>Solid Lit earth/rock colors — FreePacks textures often read cyan in stills.</summary>
        public static void SolidRetintUnderfootScatter()
        {
            var rock = HubLook.Lit(new Color(0.46f, 0.41f, 0.34f), 0.08f, 0.20f);
            var peb = HubLook.Lit(new Color(0.38f, 0.34f, 0.28f), 0.06f, 0.18f);
            var grit = HubLook.Lit(new Color(0.34f, 0.32f, 0.28f), 0.04f, 0.16f);
            var hold = GameObject.Find(RootName);
            if (!hold) return;
            foreach (var r in hold.GetComponentsInChildren<Renderer>(true))
            {
                if (!r) continue;
                var n = r.gameObject.name ?? "";
                if (n.StartsWith("CourtRock", System.StringComparison.Ordinal)
                    || n.StartsWith("CourtRelief", System.StringComparison.Ordinal))
                { if (rock) r.sharedMaterial = rock; }
                else if (n.StartsWith("CourtPebble", System.StringComparison.Ordinal))
                { if (peb) r.sharedMaterial = peb; }
                else if (n.StartsWith("CourtGrit", System.StringComparison.Ordinal))
                { if (grit) r.sharedMaterial = grit; }
            }
        }

        /// <summary>PASS4 curb still — hide warm/orange discs and Gate Swirl near demo band.</summary>
        static void HideWarmDiscsNearCurb()
        {
            var demo = GameObject.Find(DemoRoadName);
            var origin = demo ? demo.transform.position : Vector3.zero;
            foreach (var r in Object.FindObjectsByType<Renderer>(FindObjectsInactive.Exclude))
            {
                if (!r || !r.enabled) continue;
                var n = r.gameObject.name ?? "";
                if (n.StartsWith("CourtDemo", System.StringComparison.Ordinal)) continue;
                if (n.StartsWith("CourtRoad", System.StringComparison.Ordinal)) continue;
                if (n.StartsWith("CourtSidewalk", System.StringComparison.Ordinal)) continue;
                if (n.StartsWith("CourtCurb", System.StringComparison.Ordinal)) continue;
                float d = (new Vector3(r.bounds.center.x, 0f, r.bounds.center.z)
                           - new Vector3(origin.x, 0f, origin.z)).magnitude;
                if (d > 40f) continue;
                bool killName = n.IndexOf("Swirl", System.StringComparison.OrdinalIgnoreCase) >= 0
                                || n.IndexOf("Disc", System.StringComparison.OrdinalIgnoreCase) >= 0
                                || n.StartsWith("Gate_", System.StringComparison.Ordinal);
                var m = r.sharedMaterial;
                Color c = Color.white;
                if (m)
                    c = m.HasProperty("_BaseColor") ? m.GetColor("_BaseColor")
                        : (m.HasProperty("_Color") ? m.GetColor("_Color") : Color.white);
                bool warm = c.r > 0.65f && c.g > 0.30f && c.b < 0.45f && c.r > c.b + 0.12f;
                bool flatDisc = r.bounds.size.y < 0.35f && r.bounds.size.x > 0.25f
                                && r.bounds.size.x < 4f && Mathf.Abs(r.bounds.size.x - r.bounds.size.z) < 0.6f;
                if (killName || (warm && flatDisc) || (warm && d > 8f))
                    r.enabled = false;
            }
        }

        static void DisableChaseAndCinemachine()
        {
            foreach (var c in Object.FindObjectsByType<ChaseCamera>(FindObjectsInactive.Exclude))
                if (c) c.enabled = false;
            foreach (var b in Object.FindObjectsByType<CinemachineBrain>(FindObjectsInactive.Exclude))
                if (b) b.enabled = false;
            foreach (var v in Object.FindObjectsByType<CinemachineCamera>(FindObjectsInactive.Exclude))
                if (v) v.enabled = false;
        }

        static void HideApproachCollar()
        {
            foreach (var t in Object.FindObjectsByType<Transform>(FindObjectsInactive.Exclude))
            {
                if (!t || t.name == null) continue;
                if (!t.name.StartsWith("CourtApproachGround", System.StringComparison.Ordinal)) continue;
                t.gameObject.SetActive(false);
            }
        }

        static Camera EnsureStillCamera()
        {
            var existing = GameObject.Find(StillCamName);
            Camera cam;
            if (existing)
            {
                cam = existing.GetComponent<Camera>();
                if (!cam) cam = existing.AddComponent<Camera>();
            }
            else
            {
                var go = new GameObject(StillCamName);
                cam = go.AddComponent<Camera>();
            }
            cam.enabled = true;
            cam.clearFlags = CameraClearFlags.Skybox;
            cam.nearClipPlane = 0.05f;
            cam.farClipPlane = 220f;
            cam.allowHDR = true;
            cam.allowMSAA = true;
            // Steal AudioListener off so we don't dual-listen.
            var al = cam.GetComponent<AudioListener>();
            if (al) al.enabled = false;
            // Kill any brain that might have been added.
            var brain = cam.GetComponent<CinemachineBrain>();
            if (brain) brain.enabled = false;
            return cam;
        }

        static void RenderStill(Camera cam, string path)
        {
            int w = 1920, h = 1080;
            var rt = RenderTexture.GetTemporary(w, h, 24, RenderTextureFormat.ARGB32);
            var prev = cam.targetTexture;
            var prevActive = RenderTexture.active;
            cam.targetTexture = rt;
            cam.Render();
            RenderTexture.active = rt;
            var tex = new Texture2D(w, h, TextureFormat.RGB24, false);
            tex.ReadPixels(new Rect(0, 0, w, h), 0, 0, false);
            tex.Apply(false, false);
            File.WriteAllBytes(path, tex.EncodeToPNG());
            Object.Destroy(tex);
            cam.targetTexture = prev;
            RenderTexture.active = prevActive;
            RenderTexture.ReleaseTemporary(rt);
        }
    }
}
