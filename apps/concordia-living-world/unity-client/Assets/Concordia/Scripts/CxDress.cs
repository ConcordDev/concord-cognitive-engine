using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// Makes CX_ plates usable on the live Humanoid: dress tints, grip sockets,
    /// HUD skins, civic billboards. Does not invent a second skeleton —
    /// Rocketbox / Mixamo FBX stay the skinned mesh.
    /// </summary>
    public static class CxDress
    {
        // Resources.Load-relative — the authored content is duplicated (183MB, negligible) under
        // Assets/Concordia/Resources/Concordia/Generated/ so it actually ships in a Player build.
        // "Assets/Concordia/Generated" (no Resources/ prefix) still exists untouched, since several
        // OTHER files (ModularPerson.LoadPersonPrefab/MakeSword, FreePacks.SearchFolders) hold
        // hardcoded Editor-only AssetDatabase paths into it — moving the original would have broken
        // those; copying leaves them alone while giving CxDress a genuinely runtime-safe source.
        const string Root = "Concordia/Generated";
        static Texture2D _hudHealth, _hudInv, _hudTalk, _hudToast;
        static readonly System.Collections.Generic.Dictionary<string, Material> _plateMaterials =
            new System.Collections.Generic.Dictionary<string, Material>();
        static bool _hudLoaded;

        public static Color CourtCloth = new Color(0.12f, 0.11f, 0.10f);
        public static Color CourtSash = new Color(0.78f, 0.52f, 0.16f);
        public static Color SteelLeather = new Color(0.38f, 0.24f, 0.14f);
        public static Color SteelIron = new Color(0.55f, 0.56f, 0.58f);
        public static Color BanditMoss = new Color(0.22f, 0.32f, 0.18f);

        public static void Person(ModularPerson person, Appearance look, bool steelLive)
        {
            if (!person) return;
            EnsureSockets(person);
            // CX_Hero_* / CX_Guest_* "plates" are 2D concept paintings (portrait
            // jpgs), not UV-unwrapped skins, so binding one onto a Rocketbox
            // skinned mesh can't produce a correct look. Their material GUIDs had
            // also gone stale, so the hero and every named guest rendered flat
            // grey (look captures, 2026-09-30). Authored bodies keep their own
            // albedo/normal maps below; the plates stay available for UI
            // portraits. TryApplyHeroPlate / TryApplyNamedPlate are left
            // unused rather than deleted.
            RestoreRocketboxSkin(person);

            // Authored Rocketbox/CX bodies already carry their real albedo and normal maps.
            // Never flatten them to a white-tinted material; only procedural fallback bodies
            // receive the palette below. This preserves the Court traveler skin/clothing read.
            if (person.HasAuthoredBody) return;
            var cloth = steelLive ? SteelLeather : CourtCloth;
            var trim = steelLive ? SteelIron : CourtSash;
            if (look != null)
            {
                if (look.outfit == 4) cloth = new Color(0.42f, 0.10f, 0.14f);
                if (look.outfit == 5) cloth = new Color(0.12f, 0.12f, 0.16f);
                if (look.outfit == 2) cloth = new Color(0.10f, 0.22f, 0.24f);
                if (look.outfit == 3) cloth = new Color(0.28f, 0.20f, 0.12f);
            }
            foreach (var r in person.GetComponentsInChildren<Renderer>(true))
            {
                if (!r) continue;
                var n = r.gameObject.name.ToLowerInvariant();
                if (n.Contains("head") || n.Contains("face") || n.Contains("eye") || n.Contains("hair"))
                    continue;
                if (n.StartsWith("cx_gear") || n.Contains("cx_held") || n.Contains("estoc") || n.Contains("katana") || n.Contains("shield") || n.Contains("helmet") || n.Contains("pauldron") || n.Contains("plate"))
                    continue;
                TintRenderer(r, n.Contains("metal") || n.Contains("armor") ? trim : cloth);
            }
        }

        public static string HeroPrefabPath(WorldId world, Vector3 position)
        {
            var steel = world != WorldId.Hub && Canon.SteelLive(world, position);
            return "Assets/Concordia/Generated/Prefabs/P0/Hero/" +
                (steel ? "CX_Hero_Steel_front.prefab" : "CX_Hero_Court_front.prefab");
        }

        public static string NamedPrefabPath(string displayName)
        {
            var plate = PlateFor(displayName);
            if (string.IsNullOrEmpty(plate)) return null;
            var folder = plate.StartsWith("CX_Hero_", System.StringComparison.Ordinal)
                ? "P0/Hero"
                : plate.StartsWith("CX_Bandit_Sundering_", System.StringComparison.Ordinal)
                    ? "P0/Bandits"
                    : plate.StartsWith("CX_Pillar_", System.StringComparison.Ordinal)
                        ? "P3/Pillars"
                        : "P3/Guests";
            return "Assets/Concordia/Generated/Prefabs/" + folder + "/" + plate + ".prefab";
        }

        public static string CivicPrefabPath(WorldId world)
        {
            switch (world)
            {
                case WorldId.Fantasy: return "Assets/Concordia/Generated/Prefabs/P4/Sundering/CX_Civic_Sundering_Wardpost.prefab";
                case WorldId.Tunya: return "Assets/Concordia/Generated/Prefabs/P4/Tunya/CX_Civic_Tunya_Waystone.prefab";
                case WorldId.Cyber: return "Assets/Concordia/Generated/Prefabs/P4/Grid/CX_Civic_Grid_Kiosk.prefab";
                case WorldId.Crime: return "Assets/Concordia/Generated/Prefabs/P4/Crime/CX_Civic_Crime_StreetSign.prefab";
                case WorldId.Frontier: return "Assets/Concordia/Generated/Prefabs/P4/Frontier/CX_Civic_Frontier_Wagon.prefab";
                case WorldId.Superhero: return "Assets/Concordia/Generated/Prefabs/P4/Dawn/CX_Civic_Dawn_SunDisc.prefab";
                case WorldId.Ruins: return "Assets/Concordia/Generated/Prefabs/P4/Ruins/CX_Civic_Ruins_GlyphMarker.prefab";
                case WorldId.Crucible: return "Assets/Concordia/Generated/Prefabs/P4/Crucible/CX_Civic_Crucible_DriftMarker.prefab";
                case WorldId.Sere: return "Assets/Concordia/Generated/Prefabs/P4/Sere/CX_Civic_Sere_TesseraPost.prefab";
                default: return "Assets/Concordia/Generated/Prefabs/P4/Hub/CX_Civic_Hub_Waypost.prefab";
            }
        }

        public static string GeneratedGearPrefabPath(string stem)
        {
            var s = (stem ?? string.Empty).ToLowerInvariant();
            if (s.Contains("banditscrap")) return "Assets/Concordia/Generated/Prefabs/P2/Gear/CX_Gear_BanditScrap.prefab";
            if (s.Contains("courttunic")) return "Assets/Concordia/Generated/Prefabs/P2/Gear/CX_Gear_CourtTunic.prefab";
            if (s.Contains("crimsoncourt")) return "Assets/Concordia/Generated/Prefabs/P2/Gear/CX_Gear_CrimsonCourt.prefab";
            if (s.Contains("nightmarket")) return "Assets/Concordia/Generated/Prefabs/P2/Gear/CX_Gear_NightMarket.prefab";
            if (s.Contains("steeljerkin")) return "Assets/Concordia/Generated/Prefabs/P2/Gear/CX_Gear_SteelJerkin.prefab";
            return null;
        }

        public static GameObject SpawnPrefab(string assetPath, Transform parent, Vector3 position, float yaw, string name)
        {
            if (string.IsNullOrEmpty(assetPath)) return null;
            var prefab = BuildAssets.Load<GameObject>(assetPath);
            if (!prefab) return null;
            var go = Object.Instantiate(prefab, parent);
            go.name = string.IsNullOrEmpty(name) ? prefab.name : name;
            go.transform.position = position;
            go.transform.rotation = Quaternion.Euler(0f, yaw, 0f);
            Debug.Log("[Concordia] CX prefab spawned path=" + assetPath + " name=" + go.name);
            return go;
        }

        static bool TryApplyHeroPlate(ModularPerson person, Appearance look, bool steelLive)
        {
            if (!person || !person.HasAuthoredBody || !person.GetComponentInParent<ConcordiaPlayer>()) return false;
            var plate = steelLive ? "CX_Hero_Steel_front" : "CX_Hero_Court_front";
            var material = LoadPlateMaterial(plate);
            if (!material) return false;
            SkinnedMeshRenderer target = null;
            foreach (var renderer in person.GetComponentsInChildren<SkinnedMeshRenderer>(true))
            {
                if (renderer && renderer.sharedMesh) { target = renderer; break; }
            }
            if (!target) return false;
            ApplyMaterialToRenderers(target, material);
            Debug.Log("[Concordia] CX hero plate bound owner=" + person.name + " plate=" + plate);
            return true;
        }

        static void ApplyMaterialToRenderers(Renderer target, Material material)
        {
            if (!target || !material) return;
            var slots = target.sharedMaterials;
            if (slots == null || slots.Length == 0) slots = new Material[1];
            for (int i = 0; i < slots.Length; i++) slots[i] = material;
            target.sharedMaterials = slots;
        }

        static void ApplyMaterialToRenderers(GameObject root, Material material)
        {
            if (!root || !material) return;
            foreach (var renderer in root.GetComponentsInChildren<Renderer>(true))
                ApplyMaterialToRenderers(renderer, material);
        }

        static readonly string[] RocketboxParts = { "_body", "_head", "_opacity" };

        /// The generated hero/guest prefabs have CX_* plate materials baked into
        /// their Rocketbox body, so skipping the plate binding alone left them
        /// wearing the plate (flat grey — its texture GUID is stale). Rebuild
        /// each plated or empty slot from the mesh's Rocketbox naming
        /// ("m002_hipoly_81_bones_opacity" -> m002_body / m002_head /
        /// m002_opacity, slot order as on un-plated Rocketbox humans) through the
        /// same skin lookup every other human uses.
        static void RestoreRocketboxSkin(ModularPerson person)
        {
            if (!person) return;
            foreach (var smr in person.GetComponentsInChildren<SkinnedMeshRenderer>(true))
            {
                if (!smr || !smr.sharedMesh) continue;
                var slots = smr.sharedMaterials;
                bool plated = false;
                foreach (var m in slots)
                    if (!m || m.name.StartsWith("CX_Hero_", System.StringComparison.Ordinal)
                           || m.name.StartsWith("CX_Guest_", System.StringComparison.Ordinal)) { plated = true; break; }
                if (!plated) continue;
                var meshName = smr.sharedMesh.name;
                int cut = meshName.IndexOf('_');
                if (cut <= 0) continue;
                var prefix = meshName.Substring(0, cut);
                var next = (Material[])slots.Clone();
                bool any = false;
                for (int i = 0; i < slots.Length && i < RocketboxParts.Length; i++)
                {
                    var m = HubLook.Lit(Color.white, 0.02f, 0.30f);
                    if (FreePacks.SkinByName(m, prefix + RocketboxParts[i])) { next[i] = m; any = true; }
                }
                if (any)
                {
                    smr.sharedMaterials = next;
                    Debug.Log("[Concordia] Rocketbox skin restored owner=" + person.name + " mesh=" + meshName);
                }
            }
        }

        static bool TryApplyNamedPlate(ModularPerson person, Appearance look)
        {
            if (!person || !person.HasAuthoredBody || look == null) return false;
            if (person.GetComponentInParent<ConcordiaPlayer>()) return false;

            var plate = PlateFor(look.displayName);
            if (string.IsNullOrEmpty(plate)) return false;
            var material = LoadPlateMaterial(plate);
            if (!material) return false;

            SkinnedMeshRenderer target = null;
            foreach (var renderer in person.GetComponentsInChildren<SkinnedMeshRenderer>(true))
            {
                if (renderer && renderer.sharedMesh)
                {
                    target = renderer;
                    break;
                }
            }
            if (!target)
            {
                Debug.LogWarning("[Concordia] CX plate skipped; no authored skinned renderer for " + look.displayName);
                return false;
            }

            ApplyMaterialToRenderers(target, material);
            Debug.Log("[Concordia] CX plate bound owner=" + person.name + " plate=" + plate);
            return true;
        }

        static string PlateFor(string displayName)
        {
            switch (displayName)
            {
                case "The Lamplighter": return "CX_Guest_Lamplighter";
                case "Elias Voss": return "CX_Guest_EliasVoss";
                case "Vesper Kane": return "CX_Guest_VesperKane";
                case "Lady Seraphine Voss": return "CX_Guest_SeraphineVoss";
                case "Jax Rivera": return "CX_Guest_JaxRivera";
                case "Mama Iron Rose": return "CX_Guest_MamaIronRose";
                case "Kael Nakamura": return "CX_Guest_KaelZero";
                case "Nyx Torres": return "CX_Guest_NyxTorres";
                case "Thorne Blackroot": return "CX_Guest_ThorneBlackroot";
                case "Lyra Silentchant": return "CX_Guest_LyraSilentchant";
                case "Arena Warden Gale": return "CX_Guest_WardenGale";
                case "Asbir Thelane": return "CX_Guest_AsbirThelane";
                case "Maren Ashveil": return "CX_Guest_MarenAshveil";
                case "Brackish": return "CX_Guest_Brackish";
                case "Old Seam": return "CX_Guest_OldSeam";
                case "Concord": return "CX_Pillar_Concord";
                case "Concordia": return "CX_Pillar_Concordia";
                case "Sovereign": return "CX_Pillar_Sovereign";
                case "Marrow": return "CX_Bandit_Sundering_marrow";
                case "Hitch": return "CX_Bandit_Sundering_hitch";
                case "Dusk": return "CX_Bandit_Sundering_dusk";
                case "Nettle": return "CX_Bandit_Sundering_nettle";
                default: return null;
            }
        }

        static Material LoadPlateMaterial(string plate)
        {
            if (string.IsNullOrEmpty(plate)) return null;
            var folder = plate.StartsWith("CX_Bandit_Sundering_", System.StringComparison.Ordinal)
                ? "P0/Bandits"
                : plate.StartsWith("CX_Pillar_", System.StringComparison.Ordinal)
                    ? "P3/Pillars"
                    : "P3/Guests";
            var key = folder + "/" + plate;
            if (_plateMaterials.TryGetValue(key, out var cached) && cached) return cached;

            var authored = BuildAssets.Load<Material>(
                "Assets/Concordia/Generated/Materials/" + folder + "/" + plate + ".mat");
            if (authored)
            {
                _plateMaterials[key] = authored;
                return authored;
            }

            var texture = Tex(folder + "/" + plate + ".jpg");
            if (!texture) return null;
            var shader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard");
            if (!shader) return null;
            var runtime = new Material(shader) { name = plate + "_Runtime" };
            if (runtime.HasProperty("_BaseMap")) runtime.SetTexture("_BaseMap", texture);
            if (runtime.HasProperty("_MainTex")) runtime.SetTexture("_MainTex", texture);
            if (runtime.HasProperty("_BaseColor")) runtime.SetColor("_BaseColor", Color.white);
            if (runtime.HasProperty("_Color")) runtime.SetColor("_Color", Color.white);
            _plateMaterials[key] = runtime;
            return runtime;
        }

        public static void EnsureGripSockets(ModularPerson person) => EnsureSockets(person);

        public static void EnsureSockets(ModularPerson person)
        {
            if (!person) return;
            person.rightHand = person.rightHand ? person.rightHand : FindHand(person.transform, true);
            person.leftHand = person.leftHand ? person.leftHand : FindHand(person.transform, false);
            CharacterGear.Socket(person.gameObject, person, CharacterGear.Slot.HandR);
            CharacterGear.Socket(person.gameObject, person, CharacterGear.Slot.HandL);
            CharacterGear.Socket(person.gameObject, person, CharacterGear.Slot.Back);
            CharacterGear.Socket(person.gameObject, person, CharacterGear.Slot.Chest);
            CharacterGear.Socket(person.gameObject, person, CharacterGear.Slot.ShoulderL);
            CharacterGear.Socket(person.gameObject, person, CharacterGear.Slot.ShoulderR);
            CharacterGear.Socket(person.gameObject, person, CharacterGear.Slot.Head);
            CharacterGear.Socket(person.gameObject, person, CharacterGear.Slot.Hip);
        }

        /// <summary>
        /// Bind pack meshes onto Rocketbox sockets so the traveler reads as
        /// armored with a back weapon. Does not replace the Biped body.
        /// </summary>
        public static void HeroKit(ModularPerson person)
        {
            if (!person) return;
            EnsureSockets(person);
            var body = person.gameObject;
            var back = CharacterGear.Socket(body, person, CharacterGear.Slot.Back);
            CharacterGear.ClearSlot(back);

            // Court / Hub: match CX_Hero_Court_front (linen traveler) — NO cube plates, NO viking helmet.
            // Steel worlds still get a real mesh blade on the back; never CharacterGear.Plate primitives.
            if (ModularPerson.CastingWorld == WorldId.Hub || !Canon.SteelLive(ModularPerson.CastingWorld, body.transform.position))
            {
                // Quiet Court kit: one real mesh blade if present; silhouette stays the Rocketbox body.
                var courtBlade = CharacterGear.Equip(body, "cx_weapon_longsword", CharacterGear.Slot.Back, 1.18f)
                    ?? CharacterGear.Equip(body, "antique_estoc_1k", CharacterGear.Slot.Back, 1.18f)
                    ?? CharacterGear.Equip(body, "weapon-shortsword", CharacterGear.Slot.Back, 1.05f);
                if (!courtBlade)
                    Debug.Log("[Concordia] CxDress: Court HeroKit — body only (no mesh blade in FreePacks)");
                Debug.Log("[Concordia] CxDress: HeroKit Court traveler (no cube armor)");
                return;
            }

            var blade = CharacterGear.Equip(body, "cx_weapon_longsword", CharacterGear.Slot.Back, 1.18f)
                ?? CharacterGear.Equip(body, "antique_estoc_1k", CharacterGear.Slot.Back, 1.28f)
                ?? CharacterGear.Equip(body, "antique_katana_01_1k", CharacterGear.Slot.Back, 1.22f);
            if (!blade)
                Debug.LogWarning("Concordia CxDress: no back blade resolved — estoc, katana and longsword all missing.");
            ApplyMaterialToRenderers(blade, LoadPlateMaterial("CX_Hero_Steel_grip"));
            CharacterGear.Equip(body, "kite_shield_1k", CharacterGear.Slot.Back, 0.68f);
            // Head mesh only if authored — never vikinghelmet toy look.
            CharacterGear.Equip(body, "leather_cap", CharacterGear.Slot.Head, 0.30f);
            Debug.Log("[Concordia] CxDress: HeroKit steel mesh gear (no cube plates)");
        }

        static Transform FindHand(Transform root, bool right)
        {
            var names = right
                ? new[] { "Bip01 R Hand", "mixamorig:RightHand", "RightHand", "HandR", "hand_r" }
                : new[] { "Bip01 L Hand", "mixamorig:LeftHand", "LeftHand", "HandL", "hand_l" };
            foreach (var t in root.GetComponentsInChildren<Transform>(true))
            {
                if (!t) continue;
                foreach (var n in names)
                    if (string.Equals(t.name, n, System.StringComparison.OrdinalIgnoreCase))
                        return t;
            }
            return null;
        }

        public static GameObject HeldWeapon(string stem)
        {
            var mesh = FreePacks.Mesh(stem)
                       ?? FreePacks.Mesh("longsword")
                       ?? FreePacks.Mesh("Sword16")
                       ?? FreePacks.Mesh("weapon-sword");
            GameObject go;
            if (mesh)
            {
                go = Object.Instantiate(mesh);
                go.name = "CX_Held_" + stem;
                foreach (var c in go.GetComponentsInChildren<Collider>()) Object.Destroy(c);
                FreePacks.PaintIfBlank(go);
                TintRenderer(go.GetComponentInChildren<Renderer>(), SteelIron);
                return go;
            }
            go = new GameObject("CX_Held_" + stem);
            var blade = GameObject.CreatePrimitive(PrimitiveType.Cube);
            blade.name = "Blade";
            blade.transform.SetParent(go.transform, false);
            blade.transform.localPosition = new Vector3(0.42f, 0f, 0f);
            blade.transform.localScale = new Vector3(0.84f, 0.035f, 0.08f);
            var bladeCollider = blade.GetComponent<Collider>();
            if (bladeCollider)
            {
                if (Application.isPlaying) Object.Destroy(bladeCollider);
                else Object.DestroyImmediate(bladeCollider);
            }
            var grip = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            grip.name = "Grip";
            grip.transform.SetParent(go.transform, false);
            grip.transform.localRotation = Quaternion.Euler(0f, 0f, 90f);
            grip.transform.localScale = new Vector3(0.04f, 0.07f, 0.04f);
            var gripCollider = grip.GetComponent<Collider>();
            if (gripCollider)
            {
                if (Application.isPlaying) Object.Destroy(gripCollider);
                else Object.DestroyImmediate(gripCollider);
            }
            var br = blade.GetComponent<Renderer>();
            if (br) br.sharedMaterial = HubLook.Lit(SteelIron, 0.45f, 0.72f);
            var gr = grip.GetComponent<Renderer>();
            if (gr) gr.sharedMaterial = HubLook.Lit(SteelLeather, 0.12f, 0.28f);
            return go;
        }

        public static Texture2D Hud(bool steel, string slot)
        {
            LoadHud();
            if (slot == "inventory") return _hudInv;
            if (slot == "dialogue") return _hudTalk;
            if (slot == "toast") return _hudToast;
            return _hudHealth;
        }

        static void LoadHud()
        {
            if (_hudLoaded) return;
            _hudLoaded = true;
            bool steel = false;
            var p = ConcordiaPlayer.Live;
            if (p) steel = Canon.SteelLive(p.world, p.transform.position);
            var folder = steel ? "P0/HUD/Steel" : "P0/HUD/Court";
            var prefix = steel ? "CX_HUD_Steel_" : "CX_HUD_Court_";
            _hudHealth = Tex(folder + "/" + prefix + "health.jpg");
            _hudInv = Tex(folder + "/" + prefix + "inventory.jpg");
            _hudTalk = Tex(folder + "/" + prefix + "dialogue.jpg");
            _hudToast = Tex(folder + "/" + prefix + "questtoast.jpg");
        }

        public static GameObject Billboard(Transform parent, Vector3 pos, string relPath, float width, float height)
        {
            var tex = Tex(relPath);
            var go = GameObject.CreatePrimitive(PrimitiveType.Quad);
            go.name = "CX_" + System.IO.Path.GetFileNameWithoutExtension(relPath);
            go.transform.SetParent(parent, false);
            go.transform.position = pos;
            go.transform.localScale = new Vector3(width, height, 1f);
            Object.Destroy(go.GetComponent<Collider>());
            var r = go.GetComponent<Renderer>();
            if (r)
            {
                var m = HubLook.Lit(Color.white, 0.04f, 0.22f);
                if (tex) m.SetTexture("_BaseMap", tex);
                r.sharedMaterial = m;
            }
            return go;
        }

        public static void CivicSign(Transform hold, Vector3 at, WorldId world)
        {
            if (!hold) return;
            var rel = world switch
            {
                WorldId.Hub => "P4/Hub/CX_Civic_Hub_Waypost.jpg",
                WorldId.Fantasy => "P4/Sundering/CX_Civic_Sundering_Wardpost.jpg",
                WorldId.Ruins => "P4/Ruins/CX_Civic_Ruins_GlyphMarker.jpg",
                WorldId.Tunya => "P4/Tunya/CX_Civic_Tunya_Waystone.jpg",
                WorldId.Crime => "P4/Crime/CX_Civic_Crime_StreetSign.jpg",
                WorldId.Cyber => "P4/Grid/CX_Civic_Grid_Pylon.jpg",
                WorldId.Superhero => "P4/Dawn/CX_Civic_Dawn_SunDisc.jpg",
                WorldId.Crucible => "P4/Crucible/CX_Civic_Crucible_DriftMarker.jpg",
                WorldId.Sere => "P4/Sere/CX_Civic_Sere_TesseraPost.jpg",
                _ => "P2/Signs/CX_Sign_RingPost.jpg"
            };
            var plate = Billboard(hold, at + Vector3.up * 1.55f, rel, 0.55f, 0.85f);
            if (plate) plate.name = "CX_SignFace";
        }

        static Texture2D Tex(string rel)
        {
            if (string.IsNullOrEmpty(rel)) return null;
            // Resources.Load wants an extension-less path; callers pass "*.jpg"/"*.png" rel paths.
            var noExt = System.IO.Path.ChangeExtension(rel, null) ?? rel;
            return Resources.Load<Texture2D>(Root + "/" + noExt);
        }

        static void TintRenderer(Renderer r, Color cloth)
        {
            if (!r) return;
            var src = r.sharedMaterial;
            if (!src) return;
            var m = new Material(src);
            if (m.HasProperty("_BaseMap")) m.SetTexture("_BaseMap", Texture2D.whiteTexture);
            if (m.HasProperty("_MainTex")) m.SetTexture("_MainTex", Texture2D.whiteTexture);
            if (m.HasProperty("_BaseColor"))
                m.SetColor("_BaseColor", cloth);
            else
                m.color = cloth;
            r.material = m;
        }
    }
}
