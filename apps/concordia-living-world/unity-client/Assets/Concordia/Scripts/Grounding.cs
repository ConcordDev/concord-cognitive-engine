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
                    || nm.IndexOf("Terrain", System.StringComparison.OrdinalIgnoreCase) >= 0
                    || nm.IndexOf("CourtWalk", System.StringComparison.OrdinalIgnoreCase) >= 0
                    || nm.IndexOf("CourtApproach", System.StringComparison.OrdinalIgnoreCase) >= 0;
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
            if (nm.IndexOf("CourtWalk", System.StringComparison.OrdinalIgnoreCase) >= 0) return true;
            if (nm.IndexOf("CourtApproach", System.StringComparison.OrdinalIgnoreCase) >= 0) return true;
            return col.bounds.size.y <= 1.6f;
        }

        public static bool CanMove(CharacterController cc)
        {
            // CharacterController is a Collider, not a Behaviour — no isActiveAndEnabled.
            return cc != null
                && cc.enabled
                && cc.gameObject.activeInHierarchy;
        }

        public static void ClampStepOffset(CharacterController cc, float desired = 0.4f)
        {
            if (!cc) return;
            // Clear first — default stepOffset is illegal once lossyScale shrinks height/radius.
            cc.stepOffset = 0f;
            var scale = cc.transform.lossyScale;
            var scaledHeight = Mathf.Abs(cc.height * scale.y);
            var radialScale = Mathf.Max(Mathf.Abs(scale.x), Mathf.Abs(scale.z));
            var scaledRadius = Mathf.Abs(cc.radius * radialScale);
            var maximum = scaledHeight + scaledRadius * 2f;
            maximum = maximum > 1e-3f ? maximum * 0.95f : 0f;
            cc.stepOffset = Mathf.Clamp(desired, 0f, maximum);
        }

        public static CharacterController EnsureController(GameObject go, float height = 1.8f)
        {
            var cc = go.GetComponent<CharacterController>();
            if (!cc)
            {
                // Unity validates the default stepOffset during AddComponent. If
                // the target is already non-uniformly scaled, the default value
                // can be illegal before we get a chance to configure the controller.
                var originalScale = go.transform.localScale;
                go.transform.localScale = Vector3.one;
                try
                {
                    cc = go.AddComponent<CharacterController>();
                }
                finally
                {
                    go.transform.localScale = originalScale;
                }
            }
            cc.stepOffset = 0f;
            cc.height = height;
            cc.center = new Vector3(0, height * 0.5f, 0);
            cc.radius = 0.28f;
            cc.slopeLimit = 50f;
            ClampStepOffset(cc, Mathf.Min(0.4f, Mathf.Max(0.05f, height * 0.5f)));
            cc.minMoveDistance = 0f;
            cc.skinWidth = 0.08f;
            return cc;
        }
    }
}
