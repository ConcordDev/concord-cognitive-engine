using UnityEngine;

namespace Concordia
{
    public static class CharacterGear
    {
        public enum Slot
        {
            HandR, HandL, Back, Chest, ShoulderL, ShoulderR, Head, Hip
        }

        public static GameObject Spawn(
            Transform parent, Vector3 pos, float height, float yaw,
            string body, string weapon, string offhand)
        {
            var look = Appearance.Random((body + pos.x + pos.z).GetHashCode());
            look.height = Mathf.Clamp(height / 1.8f, 0.88f, 1.14f);
            var go = ModularPerson.SpawnNpc(parent, pos, yaw, look, true, 8f);
            if (!string.IsNullOrEmpty(weapon))
                Attach(go, weapon, true, 0.95f);
            if (!string.IsNullOrEmpty(offhand))
                Attach(go, offhand, false, 0.7f);
            return go;
        }

        public static GameObject Attach(GameObject body, string stem, bool rightHand, float size)
            => Equip(body, stem, rightHand ? Slot.HandR : Slot.HandL, size);

        /// <summary>
        /// Bind a pack mesh onto a Rocketbox bone socket. Hands grip; back/chest/
        /// shoulders/head hang so the mesh follows gait. Does not replace the Biped.
        /// </summary>
        public static GameObject Equip(GameObject body, string stem, Slot slot, float size)
        {
            if (!body || string.IsNullOrEmpty(stem)) return null;
            var mesh = FreePacks.Mesh(stem);
            if (!mesh && (slot == Slot.HandR || slot == Slot.HandL || slot == Slot.Back || slot == Slot.Hip))
                mesh = FreePacks.Mesh(DressVocab.Weapon(stem));
            if (!mesh) return null;
            var person = body.GetComponentInChildren<ModularPerson>() ?? body.GetComponent<ModularPerson>();
            var socket = Socket(body, person, slot);
            if (!socket) return null;
            var go = Object.Instantiate(mesh);
            go.name = "CX_Gear_" + slot + "_" + stem;
            bool shield = stem.ToLowerInvariant().Contains("shield");
            if (slot == Slot.HandR || slot == Slot.HandL)
            {
                Grip(go, socket, size, slot == Slot.HandR, shield);
                if (person && slot == Slot.HandR && person.sword == null) person.sword = go;
            }
            else
                Hang(go, socket, slot, size, shield);
            return go;
        }

        public static Transform Socket(GameObject body, ModularPerson person, Slot slot)
        {
            Transform bone = null;
            string name = SocketName(slot);
            if (person != null)
            {
                if (slot == Slot.HandR && person.rightHand)
                    bone = person.rightHand;
                else if (slot == Slot.HandL && person.leftHand)
                    bone = person.leftHand;
            }
            if (!bone && body)
                bone = Bone(body.transform, BoneNames(slot));
            if (!bone) bone = body ? body.transform : null;
            if (!bone) return null;
            var existing = bone.Find(name);
            if (existing) return existing;
            var s = new GameObject(name).transform;
            s.SetParent(bone, false);
            s.localPosition = Vector3.zero;
            s.localRotation = Quaternion.identity;
            return s;
        }

        public static void ClearSlot(Transform socket)
        {
            if (!socket) return;
            for (int i = socket.childCount - 1; i >= 0; i--)
            {
                var c = socket.GetChild(i);
                if (!c) continue;
                if (c.name.StartsWith("CX_Gear_"))
                    Object.Destroy(c.gameObject);
            }
        }

        public static string SocketName(Slot slot) => slot switch
        {
            Slot.HandR => "CX_Grip_R",
            Slot.HandL => "CX_Grip_L",
            Slot.Back => "CX_Back",
            Slot.Chest => "CX_Chest",
            Slot.ShoulderL => "CX_Shoulder_L",
            Slot.ShoulderR => "CX_Shoulder_R",
            Slot.Head => "CX_Head",
            Slot.Hip => "CX_Hip",
            _ => "CX_Grip_R"
        };

        static string[] BoneNames(Slot slot) => slot switch
        {
            Slot.HandR => new[] { "Bip01 R Hand", "mixamorig:RightHand", "RightHand", "HandR", "hand_r" },
            Slot.HandL => new[] { "Bip01 L Hand", "mixamorig:LeftHand", "LeftHand", "HandL", "hand_l" },
            Slot.Back => new[] { "Bip01 Spine2", "Bip01 Spine1", "UpperChest", "Spine1", "mixamorig:Spine1", "Chest" },
            Slot.Chest => new[] { "Bip01 Spine2", "Bip01 Spine1", "UpperChest", "Spine1", "mixamorig:Spine1", "Chest" },
            Slot.ShoulderL => new[] { "Bip01 L UpperArm", "LeftArm", "Left_UpperArm", "mixamorig:LeftArm", "UpperArm.L" },
            Slot.ShoulderR => new[] { "Bip01 R UpperArm", "RightArm", "Right_UpperArm", "mixamorig:RightArm", "UpperArm.R" },
            Slot.Head => new[] { "Bip01 Head", "Head", "mixamorig:Head" },
            Slot.Hip => new[] { "Bip01 Pelvis", "Bip01", "Hips", "mixamorig:Hips" },
            _ => new[] { "Bip01 Spine2" }
        };

        /// <summary>
        /// Primitive hands extend along local +X (right) / -X (left). Kenney
        /// blades stand on +Y. Old Euler(70,0,12) left the blade through the spine.
        /// </summary>
        public static void Grip(GameObject held, Transform hand, float size, bool right, bool shield)
        {
            if (!held || !hand) return;
            foreach (var c in held.GetComponentsInChildren<Collider>())
                Object.Destroy(c);
            held.transform.SetParent(null);
            held.transform.localScale = Vector3.one;
            FreePacks.FitMax(held, size);
            held.transform.SetParent(hand, false);
            held.transform.localPosition = Vector3.zero;
            held.transform.localRotation = Quaternion.identity;

            bool biped = hand.name.IndexOf("Bip", System.StringComparison.OrdinalIgnoreCase) >= 0
                         || (hand.parent && hand.parent.name.IndexOf("Bip", System.StringComparison.OrdinalIgnoreCase) >= 0);
            var lb = Local(held);
            Vector3 from;
            if (shield)
            {
                from = thinnest(lb);
                held.transform.localRotation = Quaternion.FromToRotation(from, Vector3.forward);
            }
            else if (biped)
            {
                // Hang rotates the hand — local −X is not always wrist→fingers.
                // Aim the blade along the live forearm→hand bone.
                from = longest(lb);
                var bone = hand.parent
                    ? (hand.position - hand.parent.position)
                    : hand.TransformDirection(Vector3.left);
                if (bone.sqrMagnitude < 1e-6f) bone = hand.TransformDirection(Vector3.left);
                var boneLocal = hand.InverseTransformDirection(bone.normalized);
                held.transform.localRotation = Quaternion.FromToRotation(from, boneLocal);
            }
            else
            {
                from = longest(lb);
                var to = right ? Vector3.right : Vector3.left;
                held.transform.localRotation = Quaternion.FromToRotation(from, to);
                lb = Local(held);
                float outboard = right ? lb.max.x : -lb.min.x;
                float inboard = right ? -lb.min.x : lb.max.x;
                if (inboard > outboard)
                    held.transform.localRotation = Quaternion.AngleAxis(180f, Vector3.up) * held.transform.localRotation;
            }

            lb = Local(held);
            if (biped)
            {
                var bone = hand.parent
                    ? (hand.position - hand.parent.position)
                    : hand.TransformDirection(Vector3.left);
                if (bone.sqrMagnitude < 1e-6f) bone = hand.TransformDirection(Vector3.left);
                var boneLocal = hand.InverseTransformDirection(bone.normalized);
                // Handle at the palm (8cm past the wrist along the live bone).
                held.transform.localPosition = boneLocal * 0.08f;
            }
            else
            {
                float palmX = right ? lb.min.x : lb.max.x;
                held.transform.localPosition = new Vector3(
                    -palmX + (right ? 0.04f : -0.04f),
                    -lb.center.y,
                    -lb.center.z + (shield ? 0.04f : 0f));
            }
        }

        /// <summary>
        /// Sheathed / worn pose. Blade stands on the back; shield faces out;
        /// helm sits on the skull. Offsets are in socket local space.
        /// </summary>
        public static void Hang(GameObject held, Transform socket, Slot slot, float size, bool shield)
        {
            if (!held || !socket) return;
            foreach (var c in held.GetComponentsInChildren<Collider>())
                Object.Destroy(c);
            held.transform.SetParent(null);
            held.transform.localScale = Vector3.one;
            FreePacks.FitMax(held, size);
            held.transform.SetParent(socket, false);
            held.transform.localPosition = Vector3.zero;
            held.transform.localRotation = Quaternion.identity;
            var lb = Local(held);
            var longAxis = longest(lb);
            var thinAxis = thinnest(lb);
            switch (slot)
            {
                case Slot.Back:
                    if (shield)
                    {
                        held.transform.localRotation = Quaternion.FromToRotation(thinAxis, Vector3.back);
                        held.transform.localPosition = new Vector3(-0.08f, 0.04f, -0.16f);
                    }
                    else
                    {
                        held.transform.localRotation = Quaternion.FromToRotation(longAxis, Vector3.up)
                            * Quaternion.AngleAxis(22f, Vector3.forward)
                            * Quaternion.AngleAxis(-12f, Vector3.right);
                        held.transform.localPosition = new Vector3(0.16f, 0.06f, -0.20f);
                    }
                    break;
                case Slot.Chest:
                    held.transform.localRotation = Quaternion.FromToRotation(thinAxis, Vector3.forward);
                    held.transform.localPosition = new Vector3(0f, 0.02f, 0.12f);
                    break;
                case Slot.ShoulderL:
                    held.transform.localRotation = Quaternion.FromToRotation(thinAxis, Vector3.left);
                    held.transform.localPosition = new Vector3(-0.04f, 0.08f, 0f);
                    break;
                case Slot.ShoulderR:
                    held.transform.localRotation = Quaternion.FromToRotation(thinAxis, Vector3.right);
                    held.transform.localPosition = new Vector3(0.04f, 0.08f, 0f);
                    break;
                case Slot.Head:
                    held.transform.localRotation = Quaternion.FromToRotation(longAxis, Vector3.up);
                    held.transform.localPosition = new Vector3(0f, 0.10f, 0.02f);
                    break;
                case Slot.Hip:
                    held.transform.localRotation = Quaternion.FromToRotation(longAxis, Vector3.up)
                        * Quaternion.AngleAxis(70f, Vector3.forward);
                    held.transform.localPosition = new Vector3(0.14f, -0.04f, 0.02f);
                    break;
            }
        }

        public static GameObject Plate(Transform socket, string name, Vector3 localPos, Vector3 localScale, Material mat)
        {
            if (!socket) return null;
            var existing = socket.Find(name);
            if (existing) Object.Destroy(existing.gameObject);
            var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
            go.name = name;
            go.transform.SetParent(socket, false);
            go.transform.localPosition = localPos;
            go.transform.localRotation = Quaternion.identity;
            go.transform.localScale = localScale;
            Object.Destroy(go.GetComponent<Collider>());
            var r = go.GetComponent<Renderer>();
            if (r && mat)
            {
                r.sharedMaterial = mat;
                r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.On;
                r.receiveShadows = true;
            }
            return go;
        }

        static Vector3 longest(Bounds b)
        {
            if (b.size.x >= b.size.y && b.size.x >= b.size.z) return Vector3.right;
            if (b.size.z >= b.size.y) return Vector3.forward;
            return Vector3.up;
        }

        static Vector3 thinnest(Bounds b)
        {
            if (b.size.x <= b.size.y && b.size.x <= b.size.z) return Vector3.right;
            if (b.size.z <= b.size.y) return Vector3.forward;
            return Vector3.up;
        }

        static Bounds Local(GameObject go)
        {
            var rends = go.GetComponentsInChildren<Renderer>();
            bool any = false;
            var b = new Bounds(Vector3.zero, Vector3.zero);
            foreach (var r in rends)
            {
                if (!r || !r.enabled) continue;
                var lb = r.localBounds;
                var c = lb.center;
                var e = lb.extents;
                for (int i = 0; i < 8; i++)
                {
                    var corner = c + new Vector3(
                        (i & 1) == 0 ? -e.x : e.x,
                        (i & 2) == 0 ? -e.y : e.y,
                        (i & 4) == 0 ? -e.z : e.z);
                    var lp = go.transform.InverseTransformPoint(r.transform.TransformPoint(corner));
                    if (!any) { b = new Bounds(lp, Vector3.zero); any = true; }
                    else b.Encapsulate(lp);
                }
            }
            if (!any) b.size = Vector3.one * 0.2f;
            return b;
        }

        static Transform Bone(Transform root, string[] names)
        {
            var all = root.GetComponentsInChildren<Transform>(true);
            foreach (var n in names)
            foreach (var t in all)
                if (string.Equals(t.name, n, System.StringComparison.OrdinalIgnoreCase))
                    return t;
            return root;
        }
    }
}
