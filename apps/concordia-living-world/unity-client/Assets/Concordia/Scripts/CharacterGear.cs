using UnityEngine;

namespace Concordia
{
    public static class CharacterGear
    {
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
        {
            stem = DressVocab.Weapon(stem);
            var mesh = FreePacks.Mesh(stem);
            if (!mesh) return null;
            var person = body.GetComponentInChildren<ModularPerson>() ?? body.GetComponent<ModularPerson>();
            var socket = person != null
                ? (rightHand ? person.rightHand : person.leftHand)
                : Bone(body.transform,
                    rightHand
                        ? new[] { "Bip01 R Hand", "mixamorig:RightHand", "RightHand", "HandR", "hand_r" }
                        : new[] { "Bip01 L Hand", "mixamorig:LeftHand", "LeftHand", "HandL", "hand_l" });
            if (!socket) socket = body.transform;
            var go = Object.Instantiate(mesh);
            go.name = stem;
            bool shield = stem.ToLowerInvariant().Contains("shield");
            Grip(go, socket, size, rightHand, shield);
            if (person && rightHand && person.sword == null) person.sword = go;
            return go;
        }

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

            bool biped = hand.name.IndexOf("Bip", System.StringComparison.OrdinalIgnoreCase) >= 0;
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
