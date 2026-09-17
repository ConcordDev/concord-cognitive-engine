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
            var steel = HubLook.Lit(SteelIron, 0.62f, 0.78f);
            var dark = HubLook.Lit(new Color(0.10f, 0.09f, 0.08f), 0.18f, 0.32f);
            var back = CharacterGear.Socket(body, person, CharacterGear.Slot.Back);
            CharacterGear.ClearSlot(back);
            CharacterGear.Equip(body, "antique_estoc_1k", CharacterGear.Slot.Back, 1.28f)
                ?? CharacterGear.Equip(body, "antique_katana_01_1k", CharacterGear.Slot.Back, 1.22f)
                ?? CharacterGear.Equip(body, "cx_weapon_longsword", CharacterGear.Slot.Back, 1.18f);
            CharacterGear.Equip(body, "kite_shield_1k", CharacterGear.Slot.Back, 0.68f);
            CharacterGear.Equip(body, "vikinghelmet", CharacterGear.Slot.Head, 0.30f);

            var chest = CharacterGear.Socket(body, person, CharacterGear.Slot.Chest);
            CharacterGear.Plate(chest, "CX_Gear_ChestPlate", new Vector3(0f, 0.02f, 0.11f), new Vector3(0.34f, 0.42f, 0.08f), steel);
            CharacterGear.Plate(chest, "CX_Gear_Fauld", new Vector3(0f, -0.22f, 0.08f), new Vector3(0.30f, 0.14f, 0.07f), dark);
            var sl = CharacterGear.Socket(body, person, CharacterGear.Slot.ShoulderL);
            var sr = CharacterGear.Socket(body, person, CharacterGear.Slot.ShoulderR);
            CharacterGear.Plate(sl, "CX_Gear_PauldronL", new Vector3(-0.05f, 0.08f, 0f), new Vector3(0.16f, 0.12f, 0.22f), steel);
            CharacterGear.Plate(sr, "CX_Gear_PauldronR", new Vector3(0.05f, 0.08f, 0f), new Vector3(0.16f, 0.12f, 0.22f), steel);
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
