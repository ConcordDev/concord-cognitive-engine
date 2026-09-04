using UnityEngine;

namespace Concordia
{
    public static class Grounding
    {
        public static void Snap(CharacterController cc)
        {
            if (!cc) return;
            var t = cc.transform;
            var origin = t.position + Vector3.up * 8f;
            float y = 0.08f;
            var hits = Physics.SphereCastAll(origin, 0.18f, Vector3.down, 16f, ~0, QueryTriggerInteraction.Ignore);
            float best = 99f;
            foreach (var h in hits)
            {
                if (!h.collider) continue;
                if (h.transform == t || h.transform.IsChildOf(t)) continue;
                if (h.normal.y < 0.4f) continue;
                if (h.point.y < -0.2f || h.point.y > 4.5f) continue;
                var sz = h.collider.bounds.size;
                if (sz.y > 8f) continue;
                if (h.distance < best) { best = h.distance; y = h.point.y + 0.04f; }
            }
            if (y < 0f || y > 4.5f) y = 0.08f;
            cc.enabled = false;
            t.position = new Vector3(t.position.x, y, t.position.z);
            cc.enabled = true;
        }

        public static CharacterController EnsureController(GameObject go, float height = 1.8f)
        {
            var cc = go.GetComponent<CharacterController>();
            if (!cc) cc = go.AddComponent<CharacterController>();
            cc.height = height;
            cc.center = new Vector3(0, height * 0.5f, 0);
            cc.radius = 0.28f;
            cc.slopeLimit = 50f;
            cc.stepOffset = 0.4f;
            cc.minMoveDistance = 0f;
            cc.skinWidth = 0.08f;
            return cc;
        }
    }
}
