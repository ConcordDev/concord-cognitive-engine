using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// One plane. Hub at the origin. Gated civilizations sit on the Canon
    /// ring at MEGAWORLD_KM.civilizationRadius. Sere is off-ring, no Link.
    /// Present metres are a walkable compression of those kilometres so the
    /// player can actually reach the next civilization on foot.
    /// Angles are copied from Canon.Gates — keep them in lockstep.
    /// </summary>
    public static class MegaworldMap
    {
        public const float CivilizationRadiusKm = 400f;
        public const float PresentMetersPerKm = 0.55f;
        public const float HubCourtKm = 12f;
        public const float HubMetroKm = 40f;

        public static readonly WorldId[] All =
        {
            WorldId.Hub, WorldId.Cyber, WorldId.Ruins, WorldId.Fantasy, WorldId.Tunya,
            WorldId.Frontier, WorldId.Crime, WorldId.Superhero, WorldId.Crucible, WorldId.Sere
        };

        public static float RingMeters => CivilizationRadiusKm * PresentMetersPerKm;

        public static float AngleOf(WorldId id)
        {
            if (id == WorldId.Sere) return FieldAngle(WorldId.Crime) + 0.35f;
            foreach (var g in Canon.Gates)
                if (g.world == id) return g.angle;
            return 0f;
        }

        public static bool HasLinkGate(WorldId id) => id != WorldId.Sere;

        public static Vector3 Present(WorldId id)
        {
            if (id == WorldId.Hub) return Vector3.zero;
            var r = id == WorldId.Sere ? RingMeters * 1.35f : RingMeters;
            var a = AngleOf(id);
            return new Vector3(Mathf.Cos(a) * r, 0f, Mathf.Sin(a) * r);
        }

        public static Vector3 KmToPresent(float xKm, float zKm) =>
            new Vector3(xKm * PresentMetersPerKm, 0f, zKm * PresentMetersPerKm);

        public static Vector2 PresentToKm(Vector3 p) =>
            new Vector2(p.x / PresentMetersPerKm, p.z / PresentMetersPerKm);

        public static WorldId Nearest(Vector3 present)
        {
            var best = WorldId.Hub;
            var bestD = float.PositiveInfinity;
            foreach (var id in All)
            {
                var d = (present - Present(id)).sqrMagnitude;
                if (d < bestD) { bestD = d; best = id; }
            }
            return best;
        }

        static float FieldAngle(WorldId id)
        {
            foreach (var g in Canon.Gates)
                if (g.world == id) return g.angle;
            return 0f;
        }
    }
}
