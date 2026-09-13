using UnityEngine;

namespace Concordia
{
    public static class Grounding
    {
        public static void Snap(CharacterController cc)
        {
            if (!cc) return;
            var p = SnapPoint(cc.transform.position, 0.04f, cc.transform);
            cc.enabled = false;
            cc.transform.position = p;
            cc.enabled = true;
        }

        /// <summary>
        /// Real ground height. No 4.5m ceiling hack — multi-level floors are legal.
        /// Miss keeps the current Y instead of flattening to 0.08.
        /// </summary>
        public static Vector3 SnapPoint(Vector3 p, float extra = 0.08f, Transform self = null)
        {
            // Start just above a standing person so roofs/lintels above the
            // spawn are not the first hit. A +80m cast was snapping guards
            // onto gate tops.
            var origin = p + Vector3.up * 2.4f;
            var hits = Physics.SphereCastAll(origin, 0.18f, Vector3.down, 12f, ~0, QueryTriggerInteraction.Ignore);
            float best = float.MaxValue;
            float y = p.y;
            bool any = false;
            foreach (var h in hits)
            {
                if (!h.collider) continue;
                if (self && (h.transform == self || h.transform.IsChildOf(self))) continue;
                if (h.normal.y < 0.35f) continue;
                var sz = h.collider.bounds.size;
                var nm = h.collider.name ?? "";
                bool namedFloor = nm.IndexOf("Ground", System.StringComparison.OrdinalIgnoreCase) >= 0
                    || nm.IndexOf("Floor", System.StringComparison.OrdinalIgnoreCase) >= 0
                    || nm.IndexOf("Terrain", System.StringComparison.OrdinalIgnoreCase) >= 0;
                // Building AABBs and kit volumes are not floors. Named ground
                // meshes (heightfields, ContinentGround) stay legal even when
                // the AABB is tall.
                if (!namedFloor && sz.y > 1.6f) continue;
                if (h.distance < best) { best = h.distance; y = h.point.y + extra; any = true; }
            }
            if (!any && Physics.Raycast(origin, Vector3.down, out var ray, 12f, ~0, QueryTriggerInteraction.Ignore)
                && ray.normal.y >= 0.35f
                && ray.collider
                && IsFloor(ray.collider)
                && (!self || (ray.transform != self && !ray.transform.IsChildOf(self))))
            {
                y = ray.point.y + extra;
                any = true;
            }
            if (!any) return p;
            return new Vector3(p.x, y, p.z);
        }

        static bool IsFloor(Collider col)
        {
            if (!col) return false;
            var nm = col.name ?? "";
            if (nm.IndexOf("Ground", System.StringComparison.OrdinalIgnoreCase) >= 0) return true;
            if (nm.IndexOf("Floor", System.StringComparison.OrdinalIgnoreCase) >= 0) return true;
            if (nm.IndexOf("Terrain", System.StringComparison.OrdinalIgnoreCase) >= 0) return true;
            return col.bounds.size.y <= 1.6f;
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
