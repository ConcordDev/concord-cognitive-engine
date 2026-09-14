using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// Shared strike timing. Damage lands at the apex, not on the click.
    /// Easing is overlapping-action (Disney): windup, snap, follow-through, recover.
    /// Rocketbox Biped cannot play ExplosiveLLC/Kevin clips — this is the live feel.
    /// </summary>
    public static class CombatMotion
    {
        public static float Smooth(float t)
        {
            t = Mathf.Clamp01(t);
            return t * t * (3f - 2f * t);
        }

        /// <summary>0..1 strike clock → 0..~1.12 pose weight with overshoot.</summary>
        public static float Pulse(float t)
        {
            t = Mathf.Clamp01(t);
            if (t < 0.16f) return Smooth(t / 0.16f) * 0.28f;
            if (t < 0.38f) return 0.28f + Smooth((t - 0.16f) / 0.22f) * 0.84f;
            if (t < 0.58f) return 1.12f - Smooth((t - 0.38f) / 0.20f) * 0.22f;
            return 0.90f * (1f - Smooth((t - 0.58f) / 0.42f));
        }

        public static float Duration(bool heavy, FightStyle style)
        {
            float d = style switch
            {
                FightStyle.WingChun => 0.32f,
                FightStyle.Karate => 0.40f,
                FightStyle.MuayThai => 0.48f,
                FightStyle.Capoeira => 0.58f,
                _ => 0.52f
            };
            return heavy ? d * 1.28f : d;
        }

        /// <summary>Seconds after commit before the SphereCast. Apex of Pulse.</summary>
        public static float Delay(bool heavy, FightStyle style) =>
            Duration(heavy, style) * 0.36f;

        public static float ComboOpen(bool heavy, FightStyle style) =>
            Duration(heavy, style) * 0.55f;
    }
}
